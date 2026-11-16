// 画材の商品画像を JAN から返す中継サーバー（Cloudflare Workers）
//
// 目的: アプリの利用者に楽天・Yahoo! の認証情報を配らずに、JANから商品画像を取得できるようにする。
// - 取得先は「楽天市場 商品検索API」と「Yahoo!ショッピング 商品検索API（v3）」の2系統。
//   Secret が入っているほうを先に試し、失敗（メンテナンス・認証・回数制限・画像なし）したら
//   もう片方で補完する。楽天のキーが未設定なら Yahoo! が先に動く。
//   楽天の管理画面がメンテナンスで止まっている間も、Yahoo! 側で画像を返せる。
// - 認証情報は Worker Secrets に置き、応答には絶対に含めない。
//   楽天のアクセスキーはヘッダーで送り、URLやログに残さない
//   （楽天のアプリIDとYahoo!のClient IDは、各APIの仕様でクエリに載せる必要がある）。
// - 同じJANは Cloudflare のエッジキャッシュ（caches.default）に7日間ためて、
//   無料枠（1日10万リクエスト）と各APIの回数制限（楽天=1秒1回、Yahoo!=1分30回）を守る。
// - 取得できるのは画像URLと最小限のメタデータだけ。
// - JANが一致した商品の画像だけを返す。見つからないときに、似ている商品（同じ色違い・別サイズ等）で
//   埋めることはしない（404 image_not_found を返し、アプリ側は画像なしのままにする）。
//
// 楽天APIは2026年の移行でエンドポイントが openapi.rakuten.co.jp に変わり、
// applicationId と accessKey の両方が必要になった（旧 20220601 は2026年8月に廃止）。
// Yahoo! は Yahoo!デベロッパーネットワークで発行する Client ID（アプリケーションID）だけで使える。
//
// エンドポイント: GET /?jan=4900669001911
// 応答: { jan, imageUrl, itemName, itemPrice, itemUrl, shopName, source }
//       source は 'rakuten' か 'yahoo'（どちらのAPIから取れたか）

/** 楽天市場 商品検索API（現行版 2026-07-01） */
export const RAKUTEN_SEARCH_ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';

/** 旧エンドポイント（2026年8月に廃止。昔のアプリIDで動かす場合の切り替え用） */
export const LEGACY_RAKUTEN_SEARCH_ENDPOINT = 'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601';

/** Yahoo!ショッピング 商品検索API（v3） */
export const YAHOO_ITEM_SEARCH_ENDPOINT = 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch';

/** Yahoo!に要求する画像サイズ（px）。exImage.url がこの大きさで返る */
export const YAHOO_IMAGE_SIZE = 300;

/** Yahoo!に要求する返却数（1件で足りるので通信量を抑える） */
export const YAHOO_RESULTS = 1;

/** 既定で許可するブラウザのオリジン（Web版・GitHub Pages・iOSアプリ・ローカル確認） */
export const DEFAULT_ALLOWED_ORIGINS = [
  'https://shodai4.com',
  'https://shodai4.github.io',
  'capacitor://localhost',
  'http://localhost',
  'http://127.0.0.1',
];

/** キャッシュ保持期間（秒）。7日 */
export const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** キャッシュキーの前置き（オリジンごとに分けないため合成URLを使う） */
export const CACHE_KEY_PREFIX = 'https://rakuten-image-proxy.internal/v1/jan/';

/** 画像URLに付ける _ex（300x300 が画材カード・編集シートに十分な大きさ） */
export const IMAGE_EX_SIZE = '300x300';

/** 楽天APIに送る Referer の既定値（アプリ登録の「許可されたウェブサイト」と合わせる） */
export const DEFAULT_RAKUTEN_REFERER = 'https://shodai4.com/';

/** 全角数字・空白・ハイフンを落として13桁の数字に寄せる */
export function normalizeJan(value) {
  return String(value ?? '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-‐-―ー]/g, '');
}

/** JAN-13 のチェックディジット（モジュラス10/ウェイト3） */
export function calcCheckDigit(first12) {
  const d = String(first12);
  if (!/^\d{12}$/.test(d)) return NaN;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** 13桁の数字で、チェックディジットも合っているか */
export function isValidJan(value) {
  const d = normalizeJan(value);
  return /^\d{13}$/.test(d) && calcCheckDigit(d.slice(0, 12)) === Number(d[12]);
}

/** 追加で許可するオリジン（環境変数 ALLOWED_ORIGINS にカンマ区切りで入れる） */
export function allowedOrigins(env = {}) {
  const extra = String(env?.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra])];
}

/** リクエスト元のオリジンが許可されているか（Origin無し＝サーバー間/ネイティブは許可） */
export function isOriginAllowed(origin, env = {}) {
  if (!origin) return true;
  const o = String(origin).trim().replace(/\/+$/, '');
  return allowedOrigins(env).includes(o);
}

/** CORS ヘッダー（許可オリジンをそのまま返す・Vary: Origin でキャッシュ混線を防ぐ） */
export function corsHeaders(origin, env = {}) {
  if (!origin || !isOriginAllowed(origin, env)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': String(origin).trim().replace(/\/+$/, ''),
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** 同一JANのキャッシュキー */
export function cacheKey(jan) {
  return `${CACHE_KEY_PREFIX}${jan}`;
}

/* ---------------- 使うAPIを決める（楽天・Yahoo!） ---------------- */

/** 楽天のアプリID（RAKUTEN_APPLICATION_ID。短い別名 RAKUTEN_APP_ID も受ける） */
export function rakutenAppId(env = {}) {
  return String(env?.RAKUTEN_APPLICATION_ID ?? env?.RAKUTEN_APP_ID ?? '').trim();
}

/** Yahoo!の Client ID（YAHOO_CLIENT_ID。旧名の YAHOO_APP_ID も受ける） */
export function yahooClientId(env = {}) {
  return String(env?.YAHOO_CLIENT_ID ?? env?.YAHOO_APP_ID ?? '').trim();
}

/**
 * 取得を試す順番。Secret が入っているAPIだけを並べる。
 * 楽天のキーが入っていれば楽天が先（Yahoo!は補完）、楽天が無ければ Yahoo! が先。
 * どちらも無ければ空配列（＝設定未完了）。
 */
export function providerOrder(env = {}) {
  const hasYahoo = Boolean(yahooClientId(env));
  if (rakutenAppId(env)) return hasYahoo ? ['rakuten', 'yahoo'] : ['rakuten'];
  return hasYahoo ? ['yahoo'] : [];
}

/** 使用する楽天APIのエンドポイント（RAKUTEN_API_ENDPOINT で差し替え可） */
export function rakutenEndpoint(env = {}) {
  const custom = String(env?.RAKUTEN_API_ENDPOINT ?? '').trim();
  if (custom && /^https:\/\//i.test(custom)) return custom;
  return RAKUTEN_SEARCH_ENDPOINT;
}

/**
 * 楽天の商品検索APIのURL。
 * 楽天の仕様で applicationId はクエリ必須（ヘッダーでは受け付けられない）。
 * アクセスキーは秘密なのでヘッダーで送り、URLには載せない。
 */
export function rakutenApiUrl(env, jan, { hits = 1 } = {}) {
  const params = new URLSearchParams({
    applicationId: rakutenAppId(env),
    keyword: String(jan),
    hits: String(hits),
    format: 'json',
    formatVersion: '2',
  });
  const affiliate = String(env?.RAKUTEN_AFFILIATE_ID ?? '').trim();
  if (affiliate) params.set('affiliateId', affiliate);
  return `${rakutenEndpoint(env)}?${params.toString()}`;
}

/** 楽天APIへ送るヘッダー（アクセスキー・Referer）。アプリIDはURLのクエリで渡す */
export function rakutenRequestHeaders(env = {}) {
  const headers = {
    Accept: 'application/json',
    Referer: String(env?.RAKUTEN_REFERER ?? '').trim() || DEFAULT_RAKUTEN_REFERER,
  };
  const key = String(env?.RAKUTEN_ACCESS_KEY ?? '').trim();
  if (key) headers.accessKey = key;
  return headers;
}

/**
 * Yahoo!の商品検索API（v3）のURL。JANは jan_code、画像は image_size=300。
 * Client ID は Yahoo! の仕様で appid（クエリ）必須。応答やログには出さない。
 */
export function yahooApiUrl(env, jan, { results = YAHOO_RESULTS, imageSize = YAHOO_IMAGE_SIZE } = {}) {
  const params = new URLSearchParams({
    appid: yahooClientId(env),
    jan_code: String(jan),
    image_size: String(imageSize),
    results: String(results),
  });
  const affiliateId = String(env?.YAHOO_AFFILIATE_ID ?? '').trim();
  if (affiliateId) {
    params.set('affiliate_type', String(env?.YAHOO_AFFILIATE_TYPE ?? '').trim() || 'vc');
    params.set('affiliate_id', affiliateId);
  }
  return `${YAHOO_ITEM_SEARCH_ENDPOINT}?${params.toString()}`;
}

/* ---------------- 応答の読み取り ---------------- */

/** 画像URLを https にそろえ、_ex を 300x300 に上げる（http配信の商品も安全に出す） */
export function normalizeImageUrl(url) {
  const s = String(url ?? '').trim();
  if (!/^https?:\/\//i.test(s)) return '';
  const https = s.replace(/^http:\/\//i, 'https://');
  return https.replace(/([?&])_ex=\d+x\d+/g, `$1_ex=${IMAGE_EX_SIZE}`);
}

/**
 * その商品が「このJANの商品」だと言い切れるか。
 * 楽天の商品検索APIはJANの完全一致で絞る項目を持たない（keyword 検索）ので、
 * 返ってきた商品の itemCode・itemUrl・itemName のどれかにJANが載っているものだけを同じ商品とみなす。
 * 載っていないものは「似ている別の商品」の可能性があるので使わない（JAN一致の画像以外は返さない方針）。
 */
export function itemMatchesJan(item, jan) {
  const code = normalizeJan(jan);
  if (!/^\d{8,14}$/.test(code)) return false;
  const haystack = [item?.itemCode, item?.itemUrl, item?.itemName].map((v) => String(v ?? '')).join(' ');
  return haystack.includes(code);
}

/**
 * 楽天APIの応答から、JANが一致する最初の商品の画像URLとメタデータを取る
 * （formatVersion=2 / 旧形式の両対応）。JANが分からない・一致する商品が無ければ null。
 */
export function pickItem(payload, jan) {
  const list = Array.isArray(payload?.Items) ? payload.Items : Array.isArray(payload?.items) ? payload.items : [];
  for (const raw of list) {
    const it = raw && raw.Item ? raw.Item : raw;
    if (!it) continue;
    if (!itemMatchesJan(it, jan)) continue;
    const urls = it.mediumImageUrls || it.smallImageUrls || [];
    if (!Array.isArray(urls)) continue;
    let imageUrl = '';
    for (const u of urls) {
      imageUrl = normalizeImageUrl(typeof u === 'string' ? u : u?.imageUrl);
      if (imageUrl) break;
    }
    if (!imageUrl) continue;
    return {
      imageUrl,
      itemName: String(it.itemName ?? ''),
      itemPrice: Number(it.itemPrice) || 0,
      itemUrl: String(it.itemUrl ?? ''),
      shopName: String(it.shopName ?? ''),
    };
  }
  return null;
}

/**
 * Yahoo!の商品検索API（v3）の応答から最初の商品を取る。
 * 画像は exImage（image_size=300で指定した大きさ）→ image.medium（146px）→ image.small（76px）の順。
 * jan_code で絞ってはいるが、返ってきた商品の janCode が違うものは使わない
 * （似ている別商品の画像で補完しない）。画像の無い商品しか無ければ null。
 */
export function pickYahooItem(payload, jan) {
  const code = normalizeJan(jan);
  const hits = Array.isArray(payload?.hits) ? payload.hits : [];
  for (const hit of hits) {
    if (!hit || typeof hit !== 'object') continue;
    const hitJan = normalizeJan(hit.janCode);
    if (hitJan && hitJan !== code) continue; // 別のJANの商品は使わない
    if (!hitJan && !String(hit.url ?? '').includes(code) && !String(hit.name ?? '').includes(code)) {
      // janCode が返らないAPI応答では、商品URLか商品名にJANが載っているものだけを同じ商品とみなす
      continue;
    }
    const candidates = [hit.exImage?.url, hit.image?.medium, hit.image?.small];
    let imageUrl = '';
    for (const candidate of candidates) {
      imageUrl = normalizeImageUrl(candidate);
      if (imageUrl) break;
    }
    if (!imageUrl) continue;
    return {
      imageUrl,
      itemName: String(hit.name ?? ''),
      itemPrice: Number(hit.price) || 0,
      itemUrl: String(hit.url ?? ''),
      shopName: String(hit.seller?.name ?? hit.seller?.sellerId ?? ''),
    };
  }
  return null;
}

/** 楽天APIのエラー文（新形式 errors.errorMessage と旧形式 error_description の両対応） */
export function rakutenErrorMessage(payload) {
  return String(
    payload?.errors?.errorMessage
    ?? payload?.error_description
    ?? payload?.error
    ?? '',
  );
}

/** 楽天APIのエラーを中継サーバー側のエラーコードに読み替える（秘密は含めない） */
export function mapRakutenError(payload, status) {
  const message = rakutenErrorMessage(payload);
  if (/invalid access key|invalid application|api configuration not found|specify valid applicationid|referrer_missing|client_ip_not_allowed|not allowed|forbidden/i.test(message)) {
    return { status: 500, error: 'not_configured', message: '中継サーバーの楽天API設定を確認してください' };
  }
  if (Number(status) === 429 || /too ?many|rate limit/i.test(message)) {
    return { status: 429, error: 'rate_limited', message: '回数制限に達しました。少し待って再試行してください' };
  }
  if (Number(status) === 403) {
    return { status: 500, error: 'not_configured', message: '中継サーバーの楽天API設定を確認してください' };
  }
  if (Number(status) >= 400 && Number(status) < 500) {
    return { status: 502, error: 'upstream_rejected', message: '商品情報を取得できませんでした' };
  }
  return { status: 502, error: 'upstream_error', message: '商品情報を取得できませんでした' };
}

/** Yahoo!APIのエラー文（{ Error: { Code, Message } } 形式） */
export function yahooErrorMessage(payload) {
  const message = payload?.Error?.Message;
  if (typeof message === 'string') return message;
  const plain = payload?.error;
  if (typeof plain === 'string') return plain;
  return '';
}

/**
 * Yahoo!APIのエラーを中継サーバー側のエラーコードに読み替える（秘密は含めない）。
 * 401（appidなし）・403（Client IDが不正/削除済み/制限）は設定の問題として扱う。
 */
export function mapYahooError(payload, status) {
  const message = yahooErrorMessage(payload);
  const code = Number(status) || 0;
  if (code === 401 || code === 403
    || /forbidden|unauthori[sz]ed|invalid app|application id|not allowed/i.test(message)) {
    return { status: 500, error: 'not_configured', message: '中継サーバーのYahoo!API設定を確認してください' };
  }
  if (code === 429 || /too ?many|rate limit/i.test(message)) {
    return { status: 429, error: 'rate_limited', message: '回数制限に達しました。少し待って再試行してください' };
  }
  if (code >= 400 && code < 500) {
    return { status: 502, error: 'upstream_rejected', message: '商品情報を取得できませんでした' };
  }
  return { status: 502, error: 'upstream_error', message: '商品情報を取得できませんでした' };
}

/* ---------------- 取得先ごとの呼び出し ---------------- */

/** 中継サーバー側の失敗の種類（次に試すかの判断と、最後にどれを返すかに使う） */
const KIND_BY_ERROR = {
  not_configured: 'not_configured',
  rate_limited: 'rate_limited',
  image_not_found: 'no_item',
};

function failure(source, mapped) {
  return {
    ok: false,
    source,
    kind: KIND_BY_ERROR[mapped.error] || 'upstream',
    status: mapped.status,
    error: mapped.error,
    message: mapped.message,
  };
}

/** 商品が無かったときの結果 */
function noItem(source) {
  return failure(source, { status: 404, error: 'image_not_found', message: '商品画像が見つかりませんでした' });
}

/** 通信できなかったときの結果 */
function unreachable(source) {
  return failure(source, { status: 502, error: 'upstream_unreachable', message: '商品情報を取得できませんでした' });
}

/** 楽天で1件探す。返り値は { ok, source, item? } か { ok:false, kind, status, error, message } */
export async function fetchFromRakuten(jan, env, doFetch) {
  const source = 'rakuten';
  let res;
  try {
    res = await doFetch(rakutenApiUrl(env, jan), { headers: rakutenRequestHeaders(env) });
  } catch {
    return unreachable(source);
  }
  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok || (payload && (payload.error || payload.errors))) {
    return failure(source, mapRakutenError(payload, res.status));
  }
  const item = pickItem(payload, jan);
  if (!item) return noItem(source);
  return { ok: true, source, item };
}

/** Yahoo!で1件探す。返り値の形は fetchFromRakuten と同じ */
export async function fetchFromYahoo(jan, env, doFetch) {
  const source = 'yahoo';
  let res;
  try {
    // Client ID は Yahoo! の仕様でクエリ必須。ブラウザの Referer は送らず、サーバー間で叩く
    res = await doFetch(yahooApiUrl(env, jan), { headers: { Accept: 'application/json' } });
  } catch {
    return unreachable(source);
  }
  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok || (payload && payload.Error)) {
    return failure(source, mapYahooError(payload, res.status));
  }
  const item = pickYahooItem(payload, jan);
  if (!item) return noItem(source);
  return { ok: true, source, item };
}

/**
 * すべて失敗したときに、どれをクライアントへ返すか決める。
 * 1) 全員「商品なし」→ 404（どこにも無い）
 * 2) 回数制限があれば 429（待てば取れる）
 * 3) 設定不備・上流の異常があればそのエラー（「無い」とは言い切れない）
 * 4) それ以外は 404
 */
export function chooseFailure(failures = []) {
  const list = (Array.isArray(failures) ? failures : []).filter(Boolean);
  if (!list.length) {
    return { status: 502, error: 'upstream_error', message: '商品情報を取得できませんでした' };
  }
  const kinds = new Set(list.map((f) => f.kind));
  if (kinds.size === 1 && kinds.has('no_item')) {
    return { status: 404, error: 'image_not_found', message: '商品画像が見つかりませんでした' };
  }
  if (list.length > 1 && kinds.has('not_configured') && [...kinds].every((k) => k === 'not_configured' || k === 'no_item')) {
    // 複数の取得先のうち設定不備があると「無い」とは言い切れないので、設定を見直してもらう
    return {
      status: 500,
      error: 'not_configured',
      message: '中継サーバーのAPI設定（楽天・Yahoo!）を確認してください',
    };
  }
  for (const kind of ['rate_limited', 'not_configured', 'upstream']) {
    const hit = list.find((f) => f.kind === kind);
    if (hit) return { status: hit.status, error: hit.error, message: hit.message };
  }
  const first = list[0];
  return { status: first.status, error: first.error, message: first.message };
}

function jsonResponse(body, status, origin, env, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders(origin, env),
      ...extraHeaders,
    },
  });
}

function errorResponse(status, error, message, origin, env, extraHeaders = {}) {
  return jsonResponse({ error, message }, status, origin, env, extraHeaders);
}

/**
 * リクエスト処理の本体。テストから叩けるよう fetch・cache・waitUntil を差し替え可能にしている。
 * @param {Request} request
 * @param {object} env  RAKUTEN_APPLICATION_ID（別名 RAKUTEN_APP_ID）/ RAKUTEN_ACCESS_KEY /
 *                      RAKUTEN_AFFILIATE_ID / RAKUTEN_REFERER / RAKUTEN_API_ENDPOINT /
 *                      YAHOO_CLIENT_ID（別名 YAHOO_APP_ID）/ YAHOO_AFFILIATE_ID /
 *                      YAHOO_AFFILIATE_TYPE / ALLOWED_ORIGINS
 * @param {{fetchImpl?: Function, cache?: object, waitUntil?: Function}} options
 */
export async function handleRequest(request, env = {}, options = {}) {
  const { fetchImpl, cache, waitUntil } = options;
  const origin = request.headers.get('Origin') || '';
  const method = String(request.method || 'GET').toUpperCase();
  const url = new URL(request.url);

  if (method === 'OPTIONS') {
    if (!isOriginAllowed(origin, env)) return errorResponse(403, 'origin_not_allowed', 'このオリジンからは利用できません', origin, env);
    return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
  }
  if (method !== 'GET') {
    return errorResponse(405, 'method_not_allowed', 'GETのみ使えます', origin, env, { Allow: 'GET, OPTIONS' });
  }
  if (!isOriginAllowed(origin, env)) {
    return errorResponse(403, 'origin_not_allowed', 'このオリジンからは利用できません', origin, env);
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    return errorResponse(404, 'not_found', '見つかりません', origin, env);
  }

  const jan = normalizeJan(url.searchParams.get('jan'));
  if (!jan) {
    return errorResponse(400, 'missing_jan', 'jan=JANコード（13桁）を付けてください', origin, env);
  }
  if (!/^\d{13}$/.test(jan)) {
    return errorResponse(400, 'invalid_jan', 'JANコードは13桁の数字で指定してください', origin, env);
  }
  if (calcCheckDigit(jan.slice(0, 12)) !== Number(jan[12])) {
    return errorResponse(400, 'invalid_jan', 'JANコードのチェックディジットが合いません', origin, env);
  }

  const order = providerOrder(env);
  if (!order.length) {
    return errorResponse(
      500, 'not_configured',
      '中継サーバーの設定が未完了です（楽天APIかYahoo!APIのキーを登録してください）',
      origin, env,
    );
  }

  const key = cacheKey(jan);

  // 1) エッジキャッシュ（オリジン非依存のデータだけを入れ、CORSヘッダーは都度付ける）
  if (cache && typeof cache.match === 'function') {
    try {
      const hit = await cache.match(key);
      if (hit) {
        let data = null;
        try { data = JSON.parse(await hit.text()); } catch { data = null; }
        if (data && data.imageUrl) {
          return jsonResponse(data, 200, origin, env, {
            'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
            'X-Proxy-Cache': 'HIT',
            'X-Proxy-Source': String(data.source || ''),
          });
        }
      }
    } catch { /* キャッシュ不調でも取得は続ける */ }
  }

  // 2) Secret の入っているAPIを順に試し、取れたらそこで確定（失敗したら次のAPIで補完）
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!doFetch) return errorResponse(500, 'fetch_unavailable', '中継サーバーが通信できません', origin, env);

  const failures = [];
  let found = null;
  for (const source of order) {
    const result = source === 'rakuten'
      ? await fetchFromRakuten(jan, env, doFetch)
      : await fetchFromYahoo(jan, env, doFetch);
    if (result.ok) {
      found = result;
      break;
    }
    failures.push(result);
  }

  if (!found) {
    const mapped = chooseFailure(failures);
    return errorResponse(mapped.status, mapped.error, mapped.message, origin, env);
  }

  const data = { jan, ...found.item, source: found.source };

  // 3) キャッシュへ保存（応答を待たせない）
  if (cache && typeof cache.put === 'function') {
    const stored = new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
      },
    });
    const put = Promise.resolve(cache.put(key, stored)).catch(() => {});
    if (typeof waitUntil === 'function') waitUntil(put);
    else await put;
  }

  return jsonResponse(data, 200, origin, env, {
    'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
    'X-Proxy-Cache': 'MISS',
    'X-Proxy-Source': found.source,
  });
}

export default {
  async fetch(request, env, ctx) {
    const waitUntil = ctx && typeof ctx.waitUntil === 'function' ? ctx.waitUntil.bind(ctx) : undefined;
    const cache = typeof caches !== 'undefined' ? caches.default : undefined;
    return handleRequest(request, env, { cache, waitUntil });
  },
};
