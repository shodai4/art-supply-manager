// 商品画像まわり（手元写真の圧縮・IndexedDB保存／楽天APIからの画像取得）
// 端末内で完結する処理だけを行う。外部へ画像を送らない。
// DOMに触れるのは compressImageFile の中だけなので、純粋関数は node --test からも読める。

/* ---------------- 手元写真：圧縮と保存 ---------------- */
export const IMAGE_DB_NAME = 'art-supply-images';
export const IMAGE_DB_VERSION = 1;
export const IMAGE_STORE = 'photos';
export const MAX_EDGE = 480;      // 長辺の上限(px)。色名や色番号が判別できる大きさ
export const JPEG_QUALITY = 0.75; // 1枚 30〜60KB 前後になる設定（IndexedDBなのでlocalStorageは圧迫しない）

/** 長辺 maxEdge に収まるよう縦横比を保って縮小した大きさ（拡大はしない） */
export function fitWithin(width, height, maxEdge = MAX_EDGE) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const max = Math.max(1, Math.round(Number(maxEdge) || MAX_EDGE));
  if (w <= max && h <= max) return { width: w, height: h };
  const scale = max / Math.max(w, h);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

let dbPromise = null;
function openImageDb() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('この端末では写真を保存できません'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IMAGE_DB_NAME, IMAGE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IMAGE_STORE)) db.createObjectStore(IMAGE_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error || new Error('写真の保存領域を開けませんでした')); };
    req.onblocked = () => { dbPromise = null; reject(new Error('写真の保存領域が使用中です')); };
  });
  return dbPromise;
}

function tx(mode, work) {
  return openImageDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(IMAGE_STORE, mode);
    const store = t.objectStore(IMAGE_STORE);
    let out = null;
    try {
      out = work(store);
    } catch (e) {
      reject(e);
      return;
    }
    // IDBRequest なら結果値、それ以外はそのまま返す（get の未ヒットは undefined → null に整える）
    t.oncomplete = () => resolve(out && typeof out === 'object' && 'result' in out ? out.result : out);
    t.onerror = () => reject(t.error || new Error('写真の保存に失敗しました'));
    t.onabort = () => reject(t.error || new Error('写真の保存を中断しました'));
  }));
}

/** アイテムIDに紐づけて圧縮済み写真（Blob）を保存 */
export async function putPhoto(id, blob, meta = {}) {
  const key = String(id || '');
  if (!key) throw new Error('アイテムIDがありません');
  if (!blob) throw new Error('写真データがありません');
  await tx('readwrite', (store) => store.put({
    id: key,
    blob,
    width: Number(meta.width) || null,
    height: Number(meta.height) || null,
    bytes: Number(blob.size) || 0,
    updatedAt: new Date().toISOString(),
  }));
  return { id: key, bytes: Number(blob.size) || 0 };
}

/** アイテムIDの写真（無ければ null） */
export function getPhoto(id) {
  const key = String(id || '');
  if (!key) return Promise.resolve(null);
  return tx('readonly', (store) => store.get(key)).then((row) => row || null);
}

/** アイテムIDの写真を削除 */
export function deletePhoto(id) {
  const key = String(id || '');
  if (!key) return Promise.resolve(false);
  return tx('readwrite', (store) => store.delete(key)).then(() => true);
}

/** 保存済み写真の一覧（起動時の読み込み用） */
export function listPhotos() {
  return tx('readonly', (store) => store.getAll()).then((rows) => (Array.isArray(rows) ? rows : []));
}

/** 保存済み写真の枚数 */
export function countPhotos() {
  return tx('readonly', (store) => store.count()).then((n) => Number(n) || 0);
}

/** 全写真を削除（全データ削除用） */
export function clearPhotos() {
  return tx('readwrite', (store) => store.clear()).then(() => true);
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* 下の Image 経路へ */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('写真を読み込めませんでした'));
      img.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

/** 選んだ画像を長辺480px・JPEG 0.75 に圧縮（ブラウザ専用） */
export async function compressImageFile(file, { maxEdge = MAX_EDGE, quality = JPEG_QUALITY } = {}) {
  if (!file) throw new Error('画像ファイルを選んでください');
  if (file.type && !/^image\//.test(file.type)) throw new Error('画像ファイルを選んでください');
  const bitmap = await loadBitmap(file);
  const srcW = bitmap.naturalWidth || bitmap.width;
  const srcH = bitmap.naturalHeight || bitmap.height;
  if (!srcW || !srcH) throw new Error('写真を読み込めませんでした');
  const size = fitWithin(srcW, srcH, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('写真を変換できませんでした');
  ctx.fillStyle = '#ffffff'; // 透過PNGをJPEGにしたときの黒背景を防ぐ
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  if (typeof bitmap.close === 'function') bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('写真を変換できませんでした');
  return { blob, width: size.width, height: size.height, bytes: blob.size };
}

/* ---------------- 楽天API（JANから商品画像） ---------------- */
// 楽天市場 商品検索API（現行版 2026-07-01）。旧 app.rakuten.co.jp の 20220601 は2026年8月に廃止された。
// 自分の認証情報で直接叩く上級者向けの経路。通常は中継サーバー（下の fetchProductImage）を使う。
export const RAKUTEN_SEARCH_ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';

/**
 * 商品検索APIのURL（ブラウザから直接叩く。applicationId・accessKey は設定画面で保存したもの）。
 * ブラウザからは独自ヘッダーを付けると事前チェック（CORSのプリフライト）が走って弾かれやすいため、
 * この経路だけは accessKey もクエリに入れる（自分の端末・自分のキーの範囲。中継サーバーでは使わない）。
 */
export function rakutenSearchUrl(appId, jan, { hits = 1, accessKey = '' } = {}) {
  const params = new URLSearchParams({
    applicationId: String(appId || '').trim(),
    keyword: String(jan || '').trim(),
    hits: String(hits),
    format: 'json',
    formatVersion: '2',
  });
  const key = String(accessKey || '').trim();
  if (key) params.set('accessKey', key);
  return `${RAKUTEN_SEARCH_ENDPOINT}?${params.toString()}`;
}

/** `_ex=128x128` のサムネイル指定を 300x300 に上げる（高画質で保存するため） */
export function upgradeRakutenImage(url) {
  const s = String(url || '').trim();
  if (!/^https?:\/\//i.test(s)) return '';
  return s.replace(/([?&])_ex=\d+x\d+/g, '$1_ex=300x300');
}

/**
 * その商品が「このJANの商品」だと言い切れるか（楽天の商品検索APIはJAN完全一致の項目を持たないため、
 * itemCode・itemUrl・itemName にJANが載っているものだけを同じ商品とみなす）。
 */
export function itemMatchesJan(item, jan) {
  const code = String(jan ?? '').replace(/\s+/g, '');
  if (!/^\d{8,14}$/.test(code)) return false;
  const haystack = [item?.itemCode, item?.itemUrl, item?.itemName].map((v) => String(v ?? '')).join(' ');
  return haystack.includes(code);
}

/**
 * API応答から、JANが一致する最初の商品画像URLを取り出す（formatVersion=2 / 旧形式の両対応）。
 * JANを渡さない・一致する商品が無いときは ''（似ている別商品の画像で埋めない）。
 */
export function pickRakutenImageUrl(payload, jan) {
  const list = Array.isArray(payload?.Items) ? payload.Items : Array.isArray(payload?.items) ? payload.items : [];
  for (const raw of list) {
    const it = raw && raw.Item ? raw.Item : raw;
    if (!itemMatchesJan(it, jan)) continue;
    const urls = it?.mediumImageUrls || it?.smallImageUrls || [];
    if (!Array.isArray(urls)) continue;
    for (const u of urls) {
      const url = typeof u === 'string' ? u : u?.imageUrl;
      const fixed = upgradeRakutenImage(url);
      if (fixed) return fixed;
    }
  }
  return '';
}

/** APIエラーの文（新形式 errors.errorMessage と旧形式の両対応） */
export function rakutenErrorMessage(payload) {
  return String(payload?.errors?.errorMessage ?? payload?.error_description ?? payload?.error ?? '');
}

/** APIエラーの短い案内文 */
export function describeRakutenError(payload, status) {
  const code = rakutenErrorMessage(payload);
  if (/invalid access key|access key/i.test(code)) {
    return '楽天アクセスキーが正しくないようです（設定を確認）';
  }
  if (/referrer|not allowed|forbidden/i.test(code)) {
    return '楽天APIの許可サイト設定を確認してください';
  }
  if (/wrong_application_id|invalid_application_id|wrong_parameter|invalid_request|specify valid applicationid|api configuration not found/i.test(code)) {
    return '楽天アプリIDが正しくないようです（設定を確認）';
  }
  if (Number(status) === 429 || /rate|too_many|limit/i.test(code)) {
    return '楽天APIの回数制限に達しました（少し待って再試行）';
  }
  if (Number(status) === 404) return '商品が見つかりませんでした';
  if (Number(status) === 0 || /Failed to fetch|NetworkError/i.test(code)) {
    return '通信できませんでした（オフライン・許可ドメインを確認）';
  }
  const tail = code || (status ? `HTTP ${status}` : '通信エラー');
  return `画像を取得できませんでした（${tail}）`;
}

/** JANで楽天の商品検索APIを叩き、商品画像URLを返す（見つからなければ例外） */
export async function fetchRakutenImage(jan, appId, { accessKey = '', fetchImpl, hits = 1 } = {}) {
  const id = String(appId || '').trim();
  if (!id) throw new Error('楽天アプリIDが未設定です（設定で登録）');
  const key = String(accessKey || '').trim();
  if (!key) throw new Error('楽天アクセスキーが未設定です（設定で登録）');
  const code = String(jan || '').trim();
  if (!/^\d{8,14}$/.test(code)) throw new Error('JANコードを13桁で入力してください');
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error('この端末では画像を取得できません');
  let res;
  try {
    res = await doFetch(rakutenSearchUrl(id, code, { hits, accessKey: key }), { headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new Error('通信できませんでした（オフライン・許可ドメインを確認）');
  }
  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok || (payload && (payload.error || payload.errors))) {
    throw new Error(describeRakutenError(payload, res.status));
  }
  const url = pickRakutenImageUrl(payload, code);
  if (!url) throw new Error('商品画像が見つかりませんでした');
  return url;
}

/* ---------------- 中継サーバー（Cloudflare Workers）経由の画像取得 ---------------- */
/**
 * みんなが共通で使う中継サーバー（workers/rakuten-image-proxy）。
 * 2026年11月16日に Cloudflare Workers へデプロイ済み。このURLを入れておくと、
 * 全員がアプリID未登録のままJANから商品画像を取得できる。
 * 設定画面でURLを入れたときは、そちらが優先される。
 */
export const DEFAULT_IMAGE_PROXY_URL = 'https://rakuten-image-proxy.shodai121ueda.workers.dev';

/** URLの前後の空白と末尾スラッシュを落とし、http(s) だけ通す */
export function normalizeProxyUrl(value) {
  const s = String(value ?? '').trim().replace(/\/+$/, '');
  if (!s || !/^https?:\/\//i.test(s)) return '';
  return s;
}

/** 使う中継サーバー（設定で入れたURL → 同梱の既定URL の順） */
export function resolveImageProxyUrl(settings = {}) {
  return normalizeProxyUrl(settings?.imageProxyUrl) || normalizeProxyUrl(DEFAULT_IMAGE_PROXY_URL);
}

/** 中継サーバーに投げるURL（例: https://…workers.dev/?jan=4900669001911） */
export function imageProxyUrl(proxyBase, jan) {
  const base = normalizeProxyUrl(proxyBase);
  if (!base) return '';
  const code = String(jan ?? '').replace(/\s+/g, '');
  if (!code) return '';
  return `${base}/?jan=${encodeURIComponent(code)}`;
}

/** 中継サーバーの応答から画像URLを取り出す（https・300x300にそろえる） */
export function pickProxyImageUrl(payload) {
  const raw = String(payload?.imageUrl ?? '').trim();
  if (!/^https?:\/\//i.test(raw)) return '';
  return upgradeRakutenImage(raw.replace(/^http:\/\//i, 'https://'));
}

/** 中継サーバーが使える状態か（設定URLか既定URLがある） */
export function canUseImageProxy(settings = {}) {
  return Boolean(resolveImageProxyUrl(settings));
}

/** 取得元の表示名（中継サーバーは楽天・Yahoo!のどちらから返すかを source に入れてくる） */
export function sourceLabel(source) {
  const s = String(source ?? '').trim().toLowerCase();
  if (s === 'rakuten') return '楽天';
  if (s === 'yahoo') return 'Yahoo!';
  return '';
}

/**
 * 中継サーバーの応答を、楽天由来でもYahoo!由来でも同じ形に整える。
 * 中継サーバーは { jan, imageUrl, itemName, itemPrice, itemUrl, shopName, source } を返す。
 * 画像URLが無ければ null（source が無い古い中継サーバーの応答でも動く）。
 */
export function parseProxyProduct(payload) {
  const imageUrl = pickProxyImageUrl(payload);
  if (!imageUrl) return null;
  return {
    imageUrl,
    itemName: String(payload?.itemName ?? '').trim(),
    itemPrice: Number(payload?.itemPrice) || 0,
    itemUrl: String(payload?.itemUrl ?? '').trim(),
    shopName: String(payload?.shopName ?? '').trim(),
    source: String(payload?.source ?? '').trim(),
  };
}

function proxyError(message, code, status) {
  const err = new Error(message);
  err.code = code;
  err.status = Number(status) || 0;
  return err;
}

/** 中継サーバーのエラーを短い案内文にする */
export function describeProxyError(payload, status) {
  const code = String(payload?.error ?? '');
  const message = String(payload?.message ?? '');
  if (code === 'invalid_jan' || code === 'missing_jan') return message || 'JANコードを確認してください';
  if (code === 'image_not_found' || Number(status) === 404) return '商品画像が見つかりませんでした';
  if (code === 'rate_limited' || Number(status) === 429) return '画像取得が混み合っています（少し待って再試行）';
  if (code === 'not_configured') return '中継サーバーの設定が未完了です';
  if (Number(status) >= 500) return '中継サーバーに接続できませんでした';
  return message || `画像を取得できませんでした（HTTP ${status || '不明'}）`;
}

/**
 * 中継サーバー経由でJANから商品情報（画像URL・商品名・価格・商品URL・ショップ名・取得元）を取得。
 * 見つからなければ例外（呼び出し側の分岐用に code と status を付ける）。
 */
export async function fetchProductViaProxy(jan, proxyBase, { fetchImpl } = {}) {
  const url = imageProxyUrl(proxyBase, jan);
  if (!url) throw proxyError('中継サーバーが未設定です', 'proxy_unset', 0);
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error('この端末では画像を取得できません');
  let res;
  try {
    res = await doFetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw proxyError('通信できませんでした（オフラインを確認）', 'network', 0);
  }
  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok || (payload && payload.error)) {
    throw proxyError(describeProxyError(payload, res.status), String(payload?.error || 'proxy_error'), res.status);
  }
  const product = parseProxyProduct(payload);
  if (!product) throw proxyError('商品画像が見つかりませんでした', 'image_not_found', 404);
  return product;
}

/** 中継サーバー経由でJANから商品画像URLを取得（見つからなければ例外） */
export async function fetchRakutenImageViaProxy(jan, proxyBase, options = {}) {
  const product = await fetchProductViaProxy(jan, proxyBase, options);
  return product.imageUrl;
}

/** 中継サーバーが落ちているときだけ、自分のアプリIDでの直接取得に切り替えてよいか */
export function shouldFallbackToAppId(err) {
  if (!err) return false;
  if (err.code === 'network' || err.code === 'proxy_unset') return true;
  return Number(err.status) >= 500;
}

/**
 * JANから商品情報（画像URL・商品名など）を取得する入口。
 * 設定ゼロ（中継サーバーあり）なら誰でもそのまま取得でき、
 * 中継サーバーが無い/落ちているときは自分の楽天アプリIDで直接叩く。
 * 中継サーバーは楽天・Yahoo!のどちらから取れても同じ形で返すので、呼び出し側は取得元を気にしなくてよい。
 */
export async function fetchProductImageInfo(jan, { appId = '', accessKey = '', proxyUrl = '', fetchImpl } = {}) {
  const code = String(jan ?? '').replace(/[\s\-]/g, '');
  if (!/^\d{13}$/.test(code)) throw new Error('JANコードを13桁で入力してください');
  const proxy = normalizeProxyUrl(proxyUrl) || normalizeProxyUrl(DEFAULT_IMAGE_PROXY_URL);
  const id = String(appId ?? '').trim();
  if (proxy) {
    try {
      return await fetchProductViaProxy(code, proxy, { fetchImpl });
    } catch (err) {
      if (!id || !shouldFallbackToAppId(err)) throw err;
    }
  }
  if (!id) throw new Error('画像取得の設定がありません（設定で中継サーバーURLか楽天アプリIDを登録）');
  const imageUrl = await fetchRakutenImage(code, id, { accessKey, fetchImpl });
  return { imageUrl, itemName: '', itemPrice: 0, itemUrl: '', shopName: '', source: 'rakuten' };
}

/**
 * JANから商品画像URLだけを取得する（これまでの入口。戻り値はURL文字列のまま）。
 * 商品名なども要るときは fetchProductImageInfo を使う。
 */
export async function fetchProductImage(jan, options = {}) {
  const info = await fetchProductImageInfo(jan, options);
  return info.imageUrl;
}
