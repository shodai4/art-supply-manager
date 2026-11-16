// 商品画像の自動取得（バーコード読取・連続スキャン・辞書からの登録時に、JANだけで画像を埋める）。
// 中継サーバー（images.js の DEFAULT_IMAGE_PROXY_URL）を使うのは「画像を取得」ボタンと同じ経路。
// ここは DOM に触らない部分（判定と反映）だけを持ち、node --test から検証できる。
import { normalizeJAN, normalizeImageUrl } from './core.js';
import { fetchProductImageInfo, resolveImageProxyUrl } from './images.js';

/** 自動取得の対象になるJAN（13桁のときだけ返す。それ以外は空文字） */
export function autoImageJan(value) {
  const jan = normalizeJAN(value);
  return /^\d{13}$/.test(jan) ? jan : '';
}

/** そのアイテムに手元の写真（写真メモ）があるか（Map・Set・配列のどれでも受ける） */
export function hasLocalPhoto(photoIds, id) {
  if (!id) return false;
  if (typeof photoIds?.has === 'function') return Boolean(photoIds.has(id));
  if (Array.isArray(photoIds)) return photoIds.includes(id);
  return false;
}

/**
 * この画材に画像を自動で足してよいか。
 * JANがあり、画像URLが空で、手元写真も無いときだけ true（自分で設定したものは触らない）。
 */
export function needsAutoImage(item, { photoIds } = {}) {
  if (!item) return false;
  if (!autoImageJan(item.jan)) return false;
  if (normalizeImageUrl(item.imageUrl)) return false;
  if (hasLocalPhoto(photoIds, item.id)) return false;
  return true;
}

/**
 * 取得できた画像を画材へ入れる。
 * 取得は非同期なので、その間に削除・別JANへの変更・画像URLの入力・写真の設定があった場合は
 * 何もしない（上書きしない）。updatedAt は動かさない（一覧の並びを勝手に変えない）。
 *
 * @returns {{state: object, changed: boolean, item: object|null, reason: string}}
 */
export function applyFetchedImage(state, { itemId, jan, imageUrl, photoIds } = {}) {
  const url = normalizeImageUrl(imageUrl);
  if (!url) return { state, changed: false, item: null, reason: 'no_image' };
  const target = autoImageJan(jan);
  if (!target) return { state, changed: false, item: null, reason: 'no_jan' };
  const items = Array.isArray(state?.items) ? state.items : [];
  const item = items.find((it) => it?.id === itemId);
  if (!item) return { state, changed: false, item: null, reason: 'missing' };
  if (autoImageJan(item.jan) !== target) return { state, changed: false, item, reason: 'jan_changed' };
  if (normalizeImageUrl(item.imageUrl)) return { state, changed: false, item, reason: 'has_image' };
  if (hasLocalPhoto(photoIds, item.id)) return { state, changed: false, item, reason: 'has_photo' };
  const next = { ...item, imageUrl: url };
  return {
    state: { ...state, items: items.map((it) => (it?.id === itemId ? next : it)) },
    changed: true,
    item: next,
    reason: 'filled',
  };
}

/**
 * 編集シート: 取得した画像を「画像URL」欄へ入れてよいか。
 * 取得中にJANを変えた・画像URLを入れた・写真を選んだ・シートを開き直した（token違い）なら入れない。
 */
export function shouldApplyFormImage({
  requestJan = '', currentJan = '', currentImageUrl = '', hasPendingPhoto = false,
  hasSavedPhoto = false, token = 0, activeToken = 0,
} = {}) {
  if (Number(token) !== Number(activeToken)) return false;
  if (!autoImageJan(requestJan)) return false;
  if (autoImageJan(currentJan) !== autoImageJan(requestJan)) return false;
  if (normalizeImageUrl(currentImageUrl)) return false;
  if (hasPendingPhoto || hasSavedPhoto) return false;
  return true;
}

/**
 * JANから商品画像を取りに行く（中継サーバー経由。「画像を取得」ボタンと同じ入口）。
 * 見つからない・通信できない等は null で返す（読取や登録を止めない）。
 */
export async function fetchAutoImage(jan, { settings = {}, fetchImpl, inFlight } = {}) {
  const code = autoImageJan(jan);
  if (!code) return null;
  if (inFlight && typeof inFlight.has === 'function') {
    if (inFlight.has(code)) return null; // 同じJANを二重に取りにいかない
    inFlight.add(code);
  }
  try {
    return await fetchProductImageInfo(code, {
      appId: String(settings?.rakutenAppId || '').trim(),
      accessKey: String(settings?.rakutenAccessKey || '').trim(),
      proxyUrl: resolveImageProxyUrl(settings),
      fetchImpl,
    });
  } catch {
    return null;
  } finally {
    if (inFlight && typeof inFlight.delete === 'function') inFlight.delete(code);
  }
}

/** 取得元と商品名を1行の短い案内文にする（画像URL欄の下に出す） */
export function describeFetchedImage(info, { sourceText } = {}) {
  const name = String(info?.itemName || '').trim();
  const short = name.length > 32 ? `${name.slice(0, 32)}…` : name;
  const from = String(sourceText || '').trim();
  if (!short) return '商品画像を入れました（保存で確定）';
  return `${short}${from ? `（${from}）` : ''}の画像を入れました`;
}
