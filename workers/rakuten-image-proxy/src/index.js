// 楽天市場の商品画像を JAN から返す中継サーバー（Cloudflare Workers）
//
// 目的: アプリの利用者に楽天の認証情報（アプリID・アクセスキー）を配らずに、
//       JANから商品画像を取得できるようにする。
// - 認証情報は Worker Secrets に置き、応答には絶対に含めない。
//   アクセスキーは楽天へのリクエストでもヘッダーで送り、URLやログに残さない。
// - 同じJANは Cloudflare のエッジキャッシュ（caches.default）に7日間ためて、
//   無料枠（1日10万リクエスト）と楽天APIの回数制限（アプリIDごとに1秒1回）を守る。
// - 取得できるのは画像URLと最小限のメタデータだけ。
//
// 楽天APIは2026年の移行でエンドポイントが openapi.rakuten.co.jp に変わり、
// applicationId と accessKey の両方が必要になった（旧 20220601 は2026年8月に廃止）。
//
// エンドポイント: GET /?jan=4900669001911
// 応答: { jan, imageUrl, itemName, itemPrice, itemUrl, shopName }

/** 楽天市場 商品検索API（現行版 2026-07-01） */
export const RAKUTEN_SEARCH_ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';

/** 旧エンドポイント（2026年8月に廃止。昔のアプリIDで動かす場合の切り替え用） */
export const LEGACY_RAKUTEN_SEARCH_ENDPOINT = 'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601';

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

/** 使用する楽天APIのエンドポイント（RAKUTEN_API_ENDPOINT で差し替え可） */
export function rakutenEndpoint(env = {}) {
  const custom = String(env?.RAKUTEN_API_ENDPOINT ?? '').trim();
  if (custom && /^https:\/\//i.test(custom)) return custom;
  return RAKUTEN_SEARCH_ENDPOINT;
}

/**
 * 楽天の商品検索APIのURL。秘密（applicationId・accessKey）は呼び出し側でヘッダーに入れ、
 * URLには載せない（ログ・Referer・プロキシ経由での漏えいを避ける）。
 */
export function rakutenApiUrl(env, jan, { hits = 1 } = {}) {
  const params = new URLSearchParams({
    keyword: String(jan),
    hits: String(hits),
    format: 'json',
    formatVersion: '2',
  });
  const affiliate = String(env?.RAKUTEN_AFFILIATE_ID ?? '').trim();
  if (affiliate) params.set('affiliateId', affiliate);
  return `${rakutenEndpoint(env)}?${params.toString()}`;
}

/** 楽天APIへ送るヘッダー（アプリID・アクセスキー・Referer） */
export function rakutenRequestHeaders(env = {}) {
  const headers = {
    Accept: 'application/json',
    Referer: String(env?.RAKUTEN_REFERER ?? '').trim() || DEFAULT_RAKUTEN_REFERER,
    applicationId: String(env?.RAKUTEN_APPLICATION_ID ?? '').trim(),
  };
  const key = String(env?.RAKUTEN_ACCESS_KEY ?? '').trim();
  if (key) headers.accessKey = key;
  return headers;
}

/** 画像URLを https にそろえ、_ex を 300x300 に上げる（http配信の商品も安全に出す） */
export function normalizeImageUrl(url) {
  const s = String(url ?? '').trim();
  if (!/^https?:\/\//i.test(s)) return '';
  const https = s.replace(/^http:\/\//i, 'https://');
  return https.replace(/([?&])_ex=\d+x\d+/g, `$1_ex=${IMAGE_EX_SIZE}`);
}

/** API応答から最初の商品の画像URLとメタデータを取る（formatVersion=2 / 旧形式の両対応） */
export function pickItem(payload) {
  const list = Array.isArray(payload?.Items) ? payload.Items : Array.isArray(payload?.items) ? payload.items : [];
  for (const raw of list) {
    const it = raw && raw.Item ? raw.Item : raw;
    if (!it) continue;
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
 * @param {object} env  RAKUTEN_APPLICATION_ID / RAKUTEN_ACCESS_KEY / RAKUTEN_AFFILIATE_ID /
 *                      RAKUTEN_REFERER / RAKUTEN_API_ENDPOINT / ALLOWED_ORIGINS
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
  if (!String(env?.RAKUTEN_APPLICATION_ID ?? '').trim()) {
    return errorResponse(500, 'not_configured', '中継サーバーの設定が未完了です', origin, env);
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
          });
        }
      }
    } catch { /* キャッシュ不調でも取得は続ける */ }
  }

  // 2) 楽天APIを叩く（アプリID・アクセスキーはヘッダー、URLには載せない）
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!doFetch) return errorResponse(500, 'fetch_unavailable', '中継サーバーが通信できません', origin, env);

  let res;
  try {
    res = await doFetch(rakutenApiUrl(env, jan), { headers: rakutenRequestHeaders(env) });
  } catch {
    return errorResponse(502, 'upstream_unreachable', '商品情報を取得できませんでした', origin, env);
  }

  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }

  if (!res.ok || (payload && (payload.error || payload.errors))) {
    const mapped = mapRakutenError(payload, res.status);
    return errorResponse(mapped.status, mapped.error, mapped.message, origin, env);
  }

  const item = pickItem(payload);
  if (!item) {
    return errorResponse(404, 'image_not_found', '商品画像が見つかりませんでした', origin, env, {
      'Cache-Control': 'public, max-age=600',
    });
  }

  const data = { jan, ...item };

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
  });
}

export default {
  async fetch(request, env, ctx) {
    const waitUntil = ctx && typeof ctx.waitUntil === 'function' ? ctx.waitUntil.bind(ctx) : undefined;
    const cache = typeof caches !== 'undefined' ? caches.default : undefined;
    return handleRequest(request, env, { cache, waitUntil });
  },
};
