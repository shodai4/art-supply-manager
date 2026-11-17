// お試し用サンプルデータ。初回起動・空の一覧・設定の「サンプルを入れる」から入れる。
// JAN は内蔵辞書にある実在品、値段・メモは目安（サンプルなので自由に編集・削除してよい）。
// imageUrl は中継サーバー（workers/rakuten-image-proxy）に JAN を投げて実際に返ってきた画像URL
// （2026年11月16日実測）。最初から写真が並ぶので、一覧の見た目がすぐ分かる。
import { createItem } from './core.js';

/** 「サンプルを一度入れた / 初回を済ませた」印（アイテムを全部消しても復活させない） */
export const SAMPLE_FLAG_KEY = 'art-supply-manager/sample-seeded';

/** サンプル画材のID（固定。二重に入らないようにする） */
export const SAMPLE_ID_PREFIX = 'sample-';

const DAY = 24 * 60 * 60 * 1000;

/**
 * サンプルの中身。
 * purchases は [何日前, 個数] の購入履歴（単価 × 個数で金額を積む）。
 */
export const SAMPLE_SEEDS = [
  {
    id: 'sample-01',
    name: 'ホルベイン 油絵具 ウルトラマリン ライト 6号(20ml)',
    maker: 'ホルベイン', brand: 'HOLBEIN', category: 'oil',
    colorName: 'ウルトラマリン ライト', colorCode: 'H107', size: '6号(20ml)',
    folderId: 'atelier', qty: 3, status: 'enough', jan: '4900669001072',
    shop: '世界堂', price: 1100, memo: '空の混色に',
    imageUrl: 'https://item-shopping.c.yimg.jp/i/j/arcoasis2_4900669001072x3',
    purchases: [[60, 2], [20, 1]], updatedDaysAgo: 3,
  },
  {
    id: 'sample-02',
    name: 'ホルベイン 油絵具 カドミウムイエローライト 6号(20ml)',
    maker: 'ホルベイン', brand: 'HOLBEIN', category: 'oil',
    colorName: 'カドミウムイエローライト', colorCode: 'H051', size: '6号(20ml)',
    folderId: 'atelier', qty: 1, status: 'low', jan: '4900669000518',
    shop: '世界堂', price: 1450, memo: '残り少ない',
    imageUrl: 'https://item-shopping.c.yimg.jp/i/j/prezataisaku_h051',
    purchases: [[45, 1]], updatedDaysAgo: 8,
  },
  {
    id: 'sample-03',
    name: 'クサカベ 水彩絵具 ウルトラマリン 2号(5ml)',
    maker: 'クサカベ', brand: 'KUSAKABE', category: 'watercolor',
    colorName: 'ウルトラマリン', colorCode: '021', size: '2号(5ml)',
    folderId: 'carry', qty: 0, status: 'empty', jan: '4933317000219',
    shop: '世界堂', price: 380, memo: 'スケッチ用。買い足す',
    imageUrl: 'https://item-shopping.c.yimg.jp/i/j/arcoasis2_4933317000219x3',
    purchases: [[120, 2], [90, 1]], updatedDaysAgo: 30,
  },
  {
    id: 'sample-04',
    name: 'リキテックス ベーシックス ウルトラマリンブルー 118ml',
    maker: 'リキテックス', brand: 'LIQUITEX', category: 'acrylic',
    colorName: 'ウルトラマリンブルー', colorCode: '380(043)', size: '118ml',
    folderId: 'stock', qty: 2, status: 'new', jan: '0887452049562',
    shop: '', price: 980, memo: '未開封の予備',
    imageUrl: 'https://item-shopping.c.yimg.jp/i/j/e-gazai-tougei_809299',
    purchases: [[25, 2]], updatedDaysAgo: 6,
  },
  {
    id: 'sample-05',
    name: '名村大成堂 水彩筆 ラフィーネ LR 10号',
    maker: '名村大成堂', brand: 'Raffine', category: 'brush',
    colorName: '', colorCode: 'LR', size: '10号',
    folderId: 'carry', qty: 2, status: 'enough', jan: '4943668000325',
    shop: '世界堂', price: 1600, memo: '面相筆と併用',
    imageUrl: 'https://item-shopping.c.yimg.jp/i/j/kotobukiyabunguten_nfn27',
    purchases: [[70, 2]], updatedDaysAgo: 11,
  },
  {
    id: 'sample-06',
    name: 'ホルベイン ボールドキャンバス F6',
    maker: 'ホルベイン', brand: 'HOLBEIN', category: 'canvas',
    colorName: '', colorCode: '', size: 'F6',
    folderId: 'atelier', qty: 0, status: 'empty', jan: '4938331139242',
    shop: '', price: 924, memo: '張り替え用に補充',
    imageUrl: 'https://item-shopping.c.yimg.jp/i/j/art-and-craft-lab_4938331139242',
    purchases: [[100, 2]], updatedDaysAgo: 40,
  },
  {
    id: 'sample-07',
    name: 'マルマン 図案スケッチブック A4（S131）',
    maker: 'マルマン', brand: 'MARUMAN', category: 'paper',
    colorName: '', colorCode: 'S131', size: 'A4',
    folderId: 'home', qty: 1, status: 'enough', jan: '4979093000418',
    shop: 'ユザワヤ', price: 550, memo: 'デッサン用',
    imageUrl: 'https://item-shopping.c.yimg.jp/i/j/stationery-goods2_4979093000418',
    purchases: [[14, 1]], updatedDaysAgo: 2,
  },
  {
    id: 'sample-08',
    name: 'ターレンス 画用液 019べネシャンターペンタイン 75ml',
    maker: 'ターレンス', brand: 'TALENS', category: 'medium',
    colorName: '', colorCode: '019', size: '75ml',
    folderId: 'atelier', qty: 1, status: 'low', jan: '8712079016968',
    shop: '', price: 1200, memo: '換気して使う',
    imageUrl: 'https://item-shopping.c.yimg.jp/i/j/e-gazai-tougei_804192',
    purchases: [[35, 1]], updatedDaysAgo: 9,
  },
];

/**
 * 過去の版で同じIDに使っていたJAN（サンプルの中身が入れ替わったもの）。
 * 端末にこのJANのサンプルが残っていたら、画像だけでなく中身ごと最新のサンプルへ差し替えてよい。
 * 「サンプルを入れ直したい」ための措置なので、自分で別の画材へ書き換えたデータ（この表に無いJAN）は触らない。
 */
export const SAMPLE_LEGACY_JANS = {
  // v1.6 以前: カラバジオ 510 張りキャンバス F6（画像が返らず、一覧で「画像なし」に見えていた）
  'sample-06': ['4547617000178'],
};

/** サンプル1点ぶんの画材を作る（日付は today から逆算するので、いつ入れても自然な並びになる） */
function buildSeedItem(seed, base) {
  const ago = (days) => new Date(base - Math.max(0, Number(days) || 0) * DAY).toISOString();
  const purchases = Array.isArray(seed.purchases) ? seed.purchases : [];
  const first = purchases.length ? Math.max(...purchases.map(([days]) => Number(days) || 0)) : Number(seed.updatedDaysAgo) || 0;
  return createItem({
    id: seed.id,
    name: seed.name,
    maker: seed.maker,
    brand: seed.brand,
    category: seed.category,
    colorName: seed.colorName,
    colorCode: seed.colorCode,
    size: seed.size,
    folderId: seed.folderId,
    qty: seed.qty,
    status: seed.status,
    jan: seed.jan,
    shop: seed.shop,
    price: seed.price,
    memo: seed.memo,
    imageUrl: seed.imageUrl,
    purchaseLog: purchases.map(([days, qty]) => ({
      at: ago(days),
      qty: Number(qty) || 0,
      amount: (Number(seed.price) || 0) * (Number(qty) || 0),
    })),
    createdAt: ago(first),
    updatedAt: ago(seed.updatedDaysAgo),
  });
}

/** サンプルの基準時刻（today が壊れていても落ちない） */
function baseTime(today) {
  return today instanceof Date && !Number.isNaN(today.getTime()) ? today.getTime() : Date.now();
}

/**
 * 投入するサンプル画材を作る（日付は today から逆算するので、いつ入れても自然な並びになる）。
 * @param {Date} today
 */
export function sampleItems(today = new Date()) {
  const base = baseTime(today);
  return SAMPLE_SEEDS.map((seed) => buildSeedItem(seed, base));
}

/**
 * 端末に残っている（古い）サンプル1点を、最新のサンプルの中身へ差し替える。
 * IDと作成日・入れているフォルダは引き継ぐ（一覧の並びや置き場所を勝手に変えない）。
 */
export function refreshSampleItem(item, seed, today = new Date()) {
  const fresh = buildSeedItem(seed, baseTime(today));
  return {
    ...fresh,
    id: item.id,
    folderId: item.folderId || fresh.folderId,
    createdAt: item.createdAt || fresh.createdAt,
  };
}

/**
 * すでに入っているサンプルを、最新のサンプルの中身＋imageUrl へ静かに補う。
 *
 * - サンプルのID（sample-01〜08）で、画像URLも手元写真も無いものが対象。
 * - JANが今のサンプルと同じ: 画像URLだけを補う（名前・在庫など、自分で直した中身はそのまま）。
 * - JANが過去の版のサンプル（SAMPLE_LEGACY_JANS）: 商品画像が無く「画像なし」に見えていたので、
 *   名前・JAN・価格・画像まで最新のサンプルの中身へ差し替える。
 * - それ以外（自分で別の画材へ書き換えた・画像URLを入れた・写真を撮った）は絶対に触らない。
 *
 * @param {object} state
 * @param {{photoIds?: {has(id:string):boolean}|string[], today?: Date}} options 手元写真があるアイテムIDの集合
 * @returns {{state: object, filled: number, replaced: number}} filled=画像を補った数 / replaced=中身ごと差し替えた数
 */
export function backfillSampleImages(state = {}, { photoIds, today = new Date() } = {}) {
  const items = Array.isArray(state?.items) ? state.items : [];
  const hasPhoto = (id) => Boolean(id) && (typeof photoIds?.has === 'function'
    ? photoIds.has(id)
    : Array.isArray(photoIds) && photoIds.includes(id));
  const seedById = new Map(SAMPLE_SEEDS.map((seed) => [seed.id, seed]));
  const isLegacyJan = (id, jan) => (SAMPLE_LEGACY_JANS[id] || [])
    .some((known) => String(known) === String(jan));
  let filled = 0;
  let replaced = 0;
  const next = items.map((item) => {
    const seed = seedById.get(item?.id);
    if (!seed || !seed.imageUrl) return item;
    if (String(item.imageUrl || '').trim()) return item;                // 自分で画像URLを入れた
    if (hasPhoto(item.id)) return item;                                 // 自分で写真を撮った
    if (String(item.jan || '') === String(seed.jan || '')) {            // 同じ商品: 画像だけ足す
      filled += 1;
      return { ...item, imageUrl: seed.imageUrl };
    }
    if (isLegacyJan(item.id, item.jan)) {                               // 旧版のサンプル: 中身ごと差し替え
      replaced += 1;
      return refreshSampleItem(item, seed, today);
    }
    return item;                                                        // 別の画材へ書き換え済み
  });
  if (!filled && !replaced) return { state, filled: 0, replaced: 0 };
  return { state: { ...state, items: next }, filled, replaced };
}

/** 同じ画材とみなす鍵（メーカー＋商品名。空白の違いは無視） */
function itemKey(item) {
  const norm = (v) => String(v ?? '').replace(/\s+/g, '').toLowerCase();
  return `${norm(item?.maker || item?.brand)}|${norm(item?.name)}`;
}

/**
 * サンプルを今のデータへ足す（消さない・二重に入れない）。
 * 同じID、または同じメーカー＋商品名の画材がすでにあれば、その1点は飛ばす。
 * limit は足してよい上限（無料の残り枠）。足せなかったぶんは skipped に入る。
 * @returns {{state: object, added: number, skipped: number, limited: boolean}}
 */
export function mergeSampleItems(state = {}, samples = sampleItems(), { limit = Number.POSITIVE_INFINITY } = {}) {
  const items = Array.isArray(state?.items) ? [...state.items] : [];
  const ids = new Set(items.map((it) => it.id));
  const keys = new Set(items.map(itemKey));
  const max = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : Number.POSITIVE_INFINITY;
  const fresh = [];
  let added = 0;
  let skipped = 0;
  for (const sample of Array.isArray(samples) ? samples : []) {
    if (!sample?.id) continue;
    const key = itemKey(sample);
    if (ids.has(sample.id) || keys.has(key)) { skipped += 1; continue; }
    if (added >= max) { skipped += 1; continue; }
    const exists = state.folders?.some?.((f) => f.id === sample.folderId);
    const item = exists || !state.folders?.length ? sample : { ...sample, folderId: state.folders[0].id };
    fresh.push(item);
    ids.add(item.id);
    keys.add(key);
    added += 1;
  }
  const limited = skipped > 0 && added >= max && Number.isFinite(max);
  return { state: { ...state, items: [...fresh, ...items] }, added, skipped, limited };
}

/** 初回起動でサンプルを入れてよいか（0件、かつ一度も入れていない / 初回を済ませていない） */
export function shouldSeedSamples({ items = [], seeded = false } = {}) {
  if (seeded) return false;
  return !Array.isArray(items) || items.length === 0;
}

/** サンプルの画材IDか（sample-01〜08。自分で登録した画材は対象外） */
export function isSampleItemId(id) {
  const key = String(id ?? '');
  return SAMPLE_SEEDS.some((seed) => seed.id === key);
}

/** いま在庫に入っているサンプルのID（SAMPLE_SEEDS の順・重複なし） */
export function presentSampleIds(state = {}) {
  const ids = new Set((Array.isArray(state?.items) ? state.items : []).map((it) => String(it?.id ?? '')));
  return SAMPLE_SEEDS.map((seed) => seed.id).filter((id) => ids.has(id));
}

/** サンプルが入っているか（設定のボタンを「入れる／消す」で切り替える判定） */
export function hasSampleItems(state = {}) {
  return presentSampleIds(state).length > 0;
}

/**
 * サンプルの画材（sample-01〜08）だけを取り除く。
 * 自分で登録した画材は絶対に消さない。サンプルは最初からあるフォルダ（アトリエ等）に入るので、
 * フォルダ自体は片付けない（ユーザーの置き場所・空のフォルダの使い勝手を変えない）。
 * 何度でも入れ直せるよう、取り除いても「入れた印」は消さない（勝手に戻さない）。
 * @returns {{state: object, removed: number}}
 */
export function removeSampleItems(state = {}) {
  const items = Array.isArray(state?.items) ? state.items : [];
  const next = items.filter((it) => !isSampleItemId(it?.id));
  const removed = items.length - next.length;
  if (!removed) return { state, removed: 0 };
  return { state: { ...state, items: next }, removed };
}

/** 「サンプルを入れた」印を読む（localStorage が無い環境でも落ちない） */
export function readSampleSeeded(storage) {
  try {
    return storage?.getItem(SAMPLE_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/** 「サンプルを入れた」印を書く（false で消す） */
export function writeSampleSeeded(storage, value = true) {
  try {
    if (value) storage?.setItem(SAMPLE_FLAG_KEY, '1');
    else storage?.removeItem(SAMPLE_FLAG_KEY);
    return true;
  } catch {
    return false;
  }
}
