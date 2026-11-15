// 商品画像まわり（手元写真の圧縮・IndexedDB保存／楽天APIからの画像取得）
// 端末内で完結する処理だけを行う。外部へ画像を送らない。
// DOMに触れるのは compressImageFile の中だけなので、純粋関数は node --test からも読める。

/* ---------------- 手元写真：圧縮と保存 ---------------- */
export const IMAGE_DB_NAME = 'art-supply-images';
export const IMAGE_DB_VERSION = 1;
export const IMAGE_STORE = 'photos';
export const MAX_EDGE = 320;      // 長辺の上限(px)
export const JPEG_QUALITY = 0.75; // 1枚 15〜30KB 前後になる設定

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

/** 選んだ画像を長辺320px・JPEG 0.75 に圧縮（ブラウザ専用） */
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
export const RAKUTEN_SEARCH_ENDPOINT = 'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601';

/** 商品検索APIのURL（ブラウザから直接叩く。applicationId は設定画面で保存したもの） */
export function rakutenSearchUrl(appId, jan, { hits = 1 } = {}) {
  const params = new URLSearchParams({
    applicationId: String(appId || '').trim(),
    keyword: String(jan || '').trim(),
    hits: String(hits),
    formatVersion: '2',
  });
  return `${RAKUTEN_SEARCH_ENDPOINT}?${params.toString()}`;
}

/** `_ex=128x128` のサムネイル指定を 300x300 に上げる（高画質で保存するため） */
export function upgradeRakutenImage(url) {
  const s = String(url || '').trim();
  if (!/^https?:\/\//i.test(s)) return '';
  return s.replace(/([?&])_ex=\d+x\d+/g, '$1_ex=300x300');
}

/** API応答から最初の商品画像URLを取り出す（formatVersion=2 / 旧形式の両対応） */
export function pickRakutenImageUrl(payload) {
  const list = Array.isArray(payload?.Items) ? payload.Items : Array.isArray(payload?.items) ? payload.items : [];
  for (const raw of list) {
    const it = raw && raw.Item ? raw.Item : raw;
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

/** APIエラーの短い案内文 */
export function describeRakutenError(payload, status) {
  const code = String(payload?.error || payload?.error_description || '');
  if (/wrong_application_id|invalid_application_id|wrong_parameter|invalid_request/i.test(code)) {
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
export async function fetchRakutenImage(jan, appId, { fetchImpl, hits = 1 } = {}) {
  const id = String(appId || '').trim();
  if (!id) throw new Error('楽天アプリIDが未設定です（設定で登録）');
  const code = String(jan || '').trim();
  if (!/^\d{8,14}$/.test(code)) throw new Error('JANコードを13桁で入力してください');
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error('この端末では画像を取得できません');
  let res;
  try {
    res = await doFetch(rakutenSearchUrl(id, code, { hits }), { headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new Error('通信できませんでした（オフライン・許可ドメインを確認）');
  }
  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok || (payload && payload.error)) {
    throw new Error(describeRakutenError(payload, res.status));
  }
  const url = pickRakutenImageUrl(payload);
  if (!url) throw new Error('商品画像が見つかりませんでした');
  return url;
}
