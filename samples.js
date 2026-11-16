// お試し用サンプルデータ。初回起動・空の一覧・設定の「サンプルを入れる」から入れる。
// JAN は内蔵辞書にある実在品、値段・メモは目安（サンプルなので自由に編集・削除してよい）。
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
    purchases: [[60, 2], [20, 1]], updatedDaysAgo: 3,
  },
  {
    id: 'sample-02',
    name: 'ホルベイン 油絵具 カドミウムイエローライト 6号(20ml)',
    maker: 'ホルベイン', brand: 'HOLBEIN', category: 'oil',
    colorName: 'カドミウムイエローライト', colorCode: 'H051', size: '6号(20ml)',
    folderId: 'atelier', qty: 1, status: 'low', jan: '4900669000518',
    shop: '世界堂', price: 1450, memo: '残り少ない',
    purchases: [[45, 1]], updatedDaysAgo: 8,
  },
  {
    id: 'sample-03',
    name: 'クサカベ 水彩絵具 ウルトラマリン 2号(5ml)',
    maker: 'クサカベ', brand: 'KUSAKABE', category: 'watercolor',
    colorName: 'ウルトラマリン', colorCode: '021', size: '2号(5ml)',
    folderId: 'carry', qty: 0, status: 'empty', jan: '4933317000219',
    shop: '世界堂', price: 380, memo: 'スケッチ用。買い足す',
    purchases: [[120, 2], [90, 1]], updatedDaysAgo: 30,
  },
  {
    id: 'sample-04',
    name: 'リキテックス ベーシックス ウルトラマリンブルー 118ml',
    maker: 'リキテックス', brand: 'LIQUITEX', category: 'acrylic',
    colorName: 'ウルトラマリンブルー', colorCode: '380(043)', size: '118ml',
    folderId: 'stock', qty: 2, status: 'new', jan: '0887452049562',
    shop: '', price: 980, memo: '未開封の予備',
    purchases: [[25, 2]], updatedDaysAgo: 6,
  },
  {
    id: 'sample-05',
    name: '名村大成堂 水彩筆 ラフィーネ LR 10号',
    maker: '名村大成堂', brand: 'Raffine', category: 'brush',
    colorName: '', colorCode: 'LR', size: '10号',
    folderId: 'carry', qty: 2, status: 'enough', jan: '4943668000325',
    shop: '世界堂', price: 1600, memo: '面相筆と併用',
    purchases: [[70, 2]], updatedDaysAgo: 11,
  },
  {
    id: 'sample-06',
    name: 'カラバジオ 510 張りキャンバス F6',
    maker: 'カラバジオ', brand: '', category: 'canvas',
    colorName: '', colorCode: '510', size: 'F6',
    folderId: 'atelier', qty: 0, status: 'empty', jan: '4547617000178',
    shop: '', price: 900, memo: '張り替え用に補充',
    purchases: [[100, 2]], updatedDaysAgo: 40,
  },
  {
    id: 'sample-07',
    name: 'マルマン 図案スケッチブック A4（S131）',
    maker: 'マルマン', brand: 'MARUMAN', category: 'paper',
    colorName: '', colorCode: 'S131', size: 'A4',
    folderId: 'home', qty: 1, status: 'enough', jan: '4979093000418',
    shop: 'ユザワヤ', price: 550, memo: 'デッサン用',
    purchases: [[14, 1]], updatedDaysAgo: 2,
  },
  {
    id: 'sample-08',
    name: 'ターレンス 画用液 019べネシャンターペンタイン 75ml',
    maker: 'ターレンス', brand: 'TALENS', category: 'medium',
    colorName: '', colorCode: '019', size: '75ml',
    folderId: 'atelier', qty: 1, status: 'low', jan: '8712079016968',
    shop: '', price: 1200, memo: '換気して使う',
    purchases: [[35, 1]], updatedDaysAgo: 9,
  },
];

/**
 * 投入するサンプル画材を作る（日付は today から逆算するので、いつ入れても自然な並びになる）。
 * @param {Date} today
 */
export function sampleItems(today = new Date()) {
  const base = today instanceof Date && !Number.isNaN(today.getTime()) ? today.getTime() : Date.now();
  const ago = (days) => new Date(base - Math.max(0, Number(days) || 0) * DAY).toISOString();
  return SAMPLE_SEEDS.map((seed) => {
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
      purchaseLog: purchases.map(([days, qty]) => ({
        at: ago(days),
        qty: Number(qty) || 0,
        amount: (Number(seed.price) || 0) * (Number(qty) || 0),
      })),
      createdAt: ago(first),
      updatedAt: ago(seed.updatedDaysAgo),
    });
  });
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
