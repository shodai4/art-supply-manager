// 画材管理アプリ コアロジック（DOM 非依存 / node --test で検証）
import { JAN_PREFIXES, JAN_DICTIONARY } from './jan-database.js';

export const STORAGE_KEY = 'art-supply-manager/v1';
export const APP_VERSION = 1;

export const CATEGORIES = [
  { id: 'oil', label: '油絵具', icon: '🖌️' },
  { id: 'acrylic', label: 'アクリル', icon: '🎨' },
  { id: 'watercolor', label: '水彩', icon: '💧' },
  { id: 'medium', label: 'メディウム/溶剤', icon: '🧪' },
  { id: 'brush', label: '筆/ナイフ', icon: '🖊️' },
  { id: 'canvas', label: 'キャンバス/パネル', icon: '🖼️' },
  { id: 'paper', label: 'スケッチブック/紙', icon: '📒' },
  { id: 'other', label: 'その他', icon: '📦' },
];

export const STATUSES = [
  { id: 'new', label: '新品', tone: 'good' },
  { id: 'enough', label: '十分', tone: 'good' },
  { id: 'low', label: '残りわずか', tone: 'warn' },
  { id: 'empty', label: '使い切り/要補充', tone: 'bad' },
];

/** 並び替え（一覧のソート）選択肢 */
export const SORT_MODES = [
  { id: 'maker', label: '並び：メーカー順' },
  { id: 'updated', label: '並び：新しい順' },
  { id: 'name', label: '並び：名前順' },
  { id: 'shortage', label: '並び：残量少ない順' },
];

/** メーカーフィルタで「未設定」を表す値 */
export const MAKER_NONE = '__none__';

export const DEFAULT_FOLDERS = [
  { id: 'home', name: '家', icon: '🏠', color: '#2f80ed' },
  { id: 'atelier', name: 'アトリエ', icon: '🎨', color: '#e07b39' },
  { id: 'carry', name: '持ち出し用', icon: '🎒', color: '#2e9e6b' },
  { id: 'stock', name: 'ストック・予備', icon: '📦', color: '#7b61c9' },
];

/** JAN のチェックディジット（モジュラス10/ウェイト3）を先頭12桁から計算 */
export function calcCheckDigit(first12) {
  const d = String(first12);
  if (!/^\d{12}$/.test(d)) throw new Error('先頭12桁の数字を渡してください');
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** 13桁JANとして妥当か（数字・チェックディジット） */
export function isValidJAN(value) {
  const d = normalizeJAN(value);
  return /^\d{13}$/.test(d) && calcCheckDigit(d.slice(0, 12)) === Number(d[12]);
}

/** 全角数字・空白・ハイフンを除去 */
export function normalizeJAN(value) {
  return String(value ?? '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-‐-―ー]/g, '');
}

/** JAN プレフィックス（事業者コード）からメーカーを判別 */
export function detectMaker(jan, prefixes = JAN_PREFIXES) {
  const d = normalizeJAN(jan);
  if (!/^\d{13}$/.test(d)) return null;
  const hit = [...prefixes]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((p) => d.startsWith(p.prefix));
  return hit ? { maker: hit.maker, brand: hit.brand, prefix: hit.prefix } : null;
}

/** 内蔵辞書から JAN 一致の商品を返す */
export function lookupJAN(jan, dict = JAN_DICTIONARY) {
  const d = normalizeJAN(jan);
  return dict.find((e) => e.jan === d) || null;
}

let seq = 0;
function uid() {
  seq += 1;
  return `i${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 新規アイテム（不足項目は初期値で補完） */
export function createItem(partial = {}) {
  const status = STATUSES.some((s) => s.id === partial.status) ? partial.status : 'enough';
  return {
    id: partial.id || uid(),
    name: String(partial.name || '').trim(),
    maker: String(partial.maker || '').trim(),
    brand: String(partial.brand || '').trim(),
    category: CATEGORIES.some((c) => c.id === partial.category) ? partial.category : 'other',
    colorName: String(partial.colorName || '').trim(),
    colorCode: String(partial.colorCode || '').trim(),
    size: String(partial.size || '').trim(),
    folderId: String(partial.folderId || DEFAULT_FOLDERS[0].id),
    qty: Number.isFinite(+partial.qty) ? Math.max(0, Math.floor(+partial.qty)) : 1,
    status,
    jan: normalizeJAN(partial.jan || ''),
    shop: String(partial.shop || '').trim(),
    price: Number.isFinite(+partial.price) && partial.price !== '' ? Math.max(0, Math.round(+partial.price)) : null,
    memo: String(partial.memo || '').trim(),
    createdAt: partial.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** 在庫数の増減（0未満にしない）。使い切り判定はステータスで保持 */
export function adjustStock(item, delta) {
  const qty = Math.max(0, (Number(item.qty) || 0) + Math.trunc(Number(delta) || 0));
  let status = item.status;
  if (qty === 0) status = 'empty';
  else if (status === 'empty') status = 'low';
  return { ...item, qty, status, updatedAt: new Date().toISOString() };
}

/** 買い物リスト（残りわずか・使い切り・在庫0） */
export function computeShoppingList(items) {
  return items
    .filter((i) => i.status === 'low' || i.status === 'empty' || Number(i.qty) === 0)
    .sort((a, b) => {
      const rank = (i) => (i.status === 'empty' || Number(i.qty) === 0 ? 0 : 1);
      return rank(a) - rank(b) || a.name.localeCompare(b.name, 'ja');
    });
}

/** 検索・絞り込み */
export function filterItems(items, filter = {}) {
  const q = String(filter.query || '').trim().toLowerCase();
  const qn = normalizeJAN(filter.query || '');
  return items.filter((it) => {
    if (filter.folderId && filter.folderId !== 'all' && it.folderId !== filter.folderId) return false;
    if (filter.category && filter.category !== 'all' && it.category !== filter.category) return false;
    if (filter.status && filter.status !== 'all' && it.status !== filter.status) return false;
    if (filter.maker && filter.maker !== 'all') {
      const m = itemMaker(it);
      if (filter.maker === MAKER_NONE ? m !== '' : m !== filter.maker) return false;
    }
    if (filter.shortageOnly && !(it.status === 'low' || it.status === 'empty' || Number(it.qty) === 0)) return false;
    if (!q) return true;
    const hay = [it.name, it.maker, it.brand, it.colorName, it.colorCode, it.size, it.jan, it.shop, it.memo]
      .join(' ')
      .toLowerCase();
    return hay.includes(q) || (qn.length > 0 && it.jan.includes(qn));
  });
}

/** 指定IDのアイテムをフォルダへ移動 */
export function moveItems(items, ids, folderId, folders) {
  const set = new Set(ids);
  if (folders && !folders.some((f) => f.id === folderId)) throw new Error('移動先フォルダがありません');
  return items.map((it) => (set.has(it.id) ? { ...it, folderId, updatedAt: new Date().toISOString() } : it));
}

/** 表示・並び替えに使うメーカー名（maker が無ければ brand） */
export function itemMaker(item) {
  return String(item?.maker || item?.brand || '').trim();
}

/** 絞り込み用のメーカー一覧（登録済みアイテムから・あいうえお順） */
export function listMakers(items) {
  return [...new Set(items.map(itemMaker).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
}

/** メーカー見出し用のグルーピング（メーカー順に並べた配列を渡す） */
export function groupByMaker(items) {
  const groups = [];
  const index = new Map();
  for (const it of items) {
    const key = itemMaker(it);
    if (!index.has(key)) {
      index.set(key, groups.length);
      groups.push({ maker: key, items: [] });
    }
    groups[index.get(key)].items.push(it);
  }
  return groups;
}

export function sortItems(items, mode = 'updated') {
  const copy = [...items];
  const byName = (a, b) => a.name.localeCompare(b.name, 'ja');
  if (mode === 'name') return copy.sort(byName);
  if (mode === 'maker') {
    return copy.sort((a, b) => {
      const am = itemMaker(a);
      const bm = itemMaker(b);
      if (!am !== !bm) return am ? -1 : 1; // メーカー未設定は最後にまとめる
      return am.localeCompare(bm, 'ja') || byName(a, b);
    });
  }
  if (mode === 'shortage') {
    const rank = (i) => ({ empty: 0, low: 1, enough: 2, new: 3 }[i.status] ?? 4);
    return copy.sort((a, b) => rank(a) - rank(b) || byName(a, b));
  }
  return copy.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function countByFolder(items) {
  const out = { all_total: items.length };
  for (const it of items) out[it.folderId] = (out[it.folderId] || 0) + 1;
  return out;
}

export function blankState() {
  return {
    version: APP_VERSION,
    folders: DEFAULT_FOLDERS.map((f) => ({ ...f })),
    items: [],
    settings: { sort: 'updated', askBeforeDelete: true },
    updatedAt: new Date().toISOString(),
  };
}

function slugId(name, folders) {
  const base = `f${Date.now().toString(36)}`;
  let id = base;
  let n = 1;
  while (folders.some((f) => f.id === id)) id = `${base}${n++}`;
  return id;
}

export function addFolder(state, folder = {}) {
  const name = String(folder.name || '').trim();
  if (!name) throw new Error('フォルダ名を入力してください');
  const f = {
    id: slugId(name, state.folders),
    name,
    icon: folder.icon || '📁',
    color: folder.color || '#5b6b7c',
  };
  return { ...state, folders: [...state.folders, f] };
}

export function renameFolder(state, id, name) {
  const next = String(name || '').trim();
  if (!next) throw new Error('フォルダ名を入力してください');
  return { ...state, folders: state.folders.map((f) => (f.id === id ? { ...f, name: next } : f)) };
}

export function updateFolder(state, id, patch = {}) {
  return {
    ...state,
    folders: state.folders.map((f) =>
      f.id === id
        ? { ...f, name: (patch.name ?? f.name).trim() || f.name, icon: patch.icon ?? f.icon, color: patch.color ?? f.color }
        : f,
    ),
  };
}

/** 並び替え（ids の順に並べ、含まれないフォルダは後ろへ） */
export function reorderFolders(state, ids) {
  const map = new Map(state.folders.map((f) => [f.id, f]));
  const ordered = ids.filter((id) => map.has(id)).map((id) => map.get(id));
  const rest = state.folders.filter((f) => !ids.includes(f.id));
  return { ...state, folders: [...ordered, ...rest] };
}

/** フォルダ削除（中身は moveToId へ移動。最後の1個は削除不可） */
export function deleteFolder(state, id, moveToId) {
  if (state.folders.length <= 1) throw new Error('フォルダは最低1つ必要です');
  const target = moveToId || state.folders.find((f) => f.id !== id)?.id;
  if (!state.folders.some((f) => f.id === target)) throw new Error('移動先フォルダがありません');
  return {
    ...state,
    folders: state.folders.filter((f) => f.id !== id),
    items: state.items.map((it) => (it.folderId === id ? { ...it, folderId: target, updatedAt: new Date().toISOString() } : it)),
  };
}

export function upsertItem(state, item) {
  const exists = state.items.some((i) => i.id === item.id);
  return {
    ...state,
    items: exists ? state.items.map((i) => (i.id === item.id ? item : i)) : [item, ...state.items],
  };
}

export function deleteItems(state, ids) {
  const set = new Set(ids);
  return { ...state, items: state.items.filter((i) => !set.has(i.id)) };
}

/** JSONエクスポート（機種変更・バックアップ用） */
export function exportState(state) {
  return JSON.stringify({
    app: 'art-supply-manager',
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    folders: state.folders,
    items: state.items,
    settings: state.settings,
  }, null, 2);
}

/** JSONインポート（検証して正規化） */
export function importState(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSONの形式が正しくありません');
  }
  if (!data || !Array.isArray(data.folders) || !Array.isArray(data.items)) {
    throw new Error('バックアップファイルの内容が想定と違います');
  }
  const folders = data.folders
    .filter((f) => f && f.id && f.name)
    .map((f) => ({ id: String(f.id), name: String(f.name), icon: f.icon || '📁', color: f.color || '#5b6b7c' }));
  if (folders.length === 0) throw new Error('フォルダが1つも含まれていません');
  const ids = new Set(folders.map((f) => f.id));
  const items = data.items.map((raw) => {
    const it = createItem(raw);
    return ids.has(it.folderId) ? it : { ...it, folderId: folders[0].id };
  });
  return { version: APP_VERSION, folders, items, settings: { ...blankState().settings, ...(data.settings || {}) } };
}

/** 集計（カテゴリ別・残量アラート数） */
export function summarize(items) {
  const byCategory = {};
  for (const c of CATEGORIES) byCategory[c.id] = 0;
  let qty = 0;
  for (const it of items) {
    byCategory[it.category] = (byCategory[it.category] || 0) + 1;
    qty += Number(it.qty) || 0;
  }
  return {
    kinds: items.length,
    qty,
    needRestock: computeShoppingList(items).length,
    byCategory,
  };
}
