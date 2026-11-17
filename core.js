// アトリコ コアロジック（DOM 非依存 / node --test で検証）
import { JAN_PREFIXES, JAN_DICTIONARY } from './jan-database.js';

export const STORAGE_KEY = 'art-supply-manager/v1';
export const APP_VERSION = 1;

export const CATEGORIES = [
  { id: 'oil', label: '油絵具' },
  { id: 'acrylic', label: 'アクリル' },
  { id: 'watercolor', label: '水彩' },
  { id: 'medium', label: 'メディウム/溶剤' },
  { id: 'brush', label: '筆/ナイフ' },
  { id: 'canvas', label: 'キャンバス/パネル' },
  { id: 'paper', label: 'スケッチブック/紙' },
  { id: 'other', label: 'その他' },
];

export const STATUSES = [
  { id: 'new', label: '新品', short: '新品', tone: 'good' },
  { id: 'enough', label: '十分', short: '十分', tone: 'good' },
  { id: 'low', label: '残りわずか', short: '少なめ', tone: 'warn' },
  { id: 'empty', label: '使い切り/要補充', short: '要補充', tone: 'bad' },
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
  { id: 'home', name: '家', color: '#2f80ed' },
  { id: 'atelier', name: 'アトリエ', color: '#e07b39' },
  { id: 'carry', name: '持ち出し用', color: '#2e9e6b' },
  { id: 'stock', name: 'ストック・予備', color: '#7b61c9' },
];

/* ---------------- フォルダの階層 ---------------- */

/**
 * フォルダの親ID。旧バージョンのデータは parentId を持たない（＝トップ階層）。
 * 空文字はトップ階層を表す（null / undefined と同じ扱い）。
 */
export function folderParentId(folder) {
  const p = folder?.parentId;
  return p === null || p === undefined || p === '' ? '' : String(p);
}

/** 指定した親の直下の子フォルダ（並び順は state.folders の順） */
export function folderChildren(folders = [], parentId = '') {
  const p = parentId === null || parentId === undefined ? '' : String(parentId);
  return folders.filter((f) => folderParentId(f) === p);
}

/** 祖先から自分までの並び（壊れた親ID・循環はそこで打ち切る） */
export function folderChain(folders = [], id) {
  const byId = new Map(folders.map((f) => [String(f.id), f]));
  const chain = [];
  const seen = new Set();
  let cur = byId.get(String(id));
  while (cur && !seen.has(String(cur.id))) {
    seen.add(String(cur.id));
    chain.unshift(cur);
    const p = folderParentId(cur);
    cur = p ? byId.get(p) : null;
  }
  return chain;
}

/** 階層の深さ（トップは0） */
export function folderDepth(folders, id) {
  return Math.max(0, folderChain(folders, id).length - 1);
}

/** 「アトリエ / 引き出し1」のような表示用の名前（区切りは変更可） */
export function folderPathLabel(folders, id, sep = ' / ') {
  return folderChain(folders, id).map((f) => f.name).join(sep);
}

/** id が ancestorId の子孫か（自分自身は含めない） */
export function isFolderDescendant(folders, ancestorId, id) {
  const a = String(ancestorId ?? '');
  const t = String(id ?? '');
  if (!a || !t || a === t) return false;
  return folderChain(folders, t).slice(0, -1).some((f) => String(f.id) === a);
}

/** 自分と配下すべてのフォルダID（表示・集計の範囲） */
export function folderSubtreeIds(folders = [], id) {
  const root = String(id ?? '');
  if (!root) return [];
  if (!folders.some((f) => String(f.id) === root)) return [];
  const out = [];
  const walk = (parentId) => {
    for (const f of folderChildren(folders, parentId)) {
      const fid = String(f.id);
      if (out.includes(fid)) continue; // 循環していても止まる
      out.push(fid);
      walk(fid);
    }
  };
  out.push(root);
  walk(root);
  return out;
}

/** 親に設定してよいか（存在・自分自身・自分の配下は不可） */
export function canSetFolderParent(folders = [], id, parentId) {
  const p = parentId === null || parentId === undefined || parentId === '' ? '' : String(parentId);
  if (!p) return { ok: true, reason: '' };
  if (!folders.some((f) => String(f.id) === p)) return { ok: false, reason: '親フォルダがありません' };
  if (String(id ?? '') === p) return { ok: false, reason: '自分自身は親にできません' };
  if (isFolderDescendant(folders, id, p)) return { ok: false, reason: '配下のフォルダは親にできません' };
  return { ok: true, reason: '' };
}

/**
 * 表示順（親のすぐ下に子）に depth 付きで並べる。
 * 壊れた親ID・循環しているフォルダも落とさず、末尾へトップとして付ける。
 */
export function folderTree(folders = []) {
  const out = [];
  const seen = new Set();
  const walk = (parentId, depth) => {
    for (const f of folderChildren(folders, parentId)) {
      const id = String(f.id);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ folder: f, depth });
      walk(id, depth + 1);
    }
  };
  walk('', 0);
  for (const f of folders) {
    const id = String(f.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ folder: f, depth: 0 });
  }
  return out;
}

/**
 * 選択肢（セレクト・移動シート用）。
 * parentId を持つフォルダは階層順に並べ、depth でインデントできるようにする。
 * exclude には「選ばせたくないID」（自分自身と配下）を渡す。
 */
export function folderOptions(folders = [], { exclude = [], noneLabel = 'なし（トップ）' } = {}) {
  const skip = new Set([...exclude].map((id) => String(id)));
  const opts = [];
  if (noneLabel !== null) opts.push({ id: '', label: noneLabel, depth: 0 });
  for (const { folder, depth } of folderTree(folders)) {
    if (skip.has(String(folder.id))) continue;
    opts.push({ id: String(folder.id), label: folder.name, depth });
  }
  return opts;
}

/** 子フォルダも含めた件数（フォルダのタイル・一覧に出す数） */
export function countByFolderDeep(folders = [], items = []) {
  const direct = countByFolder(items);
  const out = { all_total: items.length };
  for (const f of folders) {
    out[f.id] = folderSubtreeIds(folders, f.id).reduce((sum, id) => sum + (direct[id] || 0), 0);
  }
  return out;
}

/**
 * 文字列から絵文字（絵文字記号・異体字セレクタ・ZWJ結合・肌色・地域指示子）を取り除く。
 * UI から絵文字を撤去したので、旧バージョンが保存した絵文字入りの
 * フォルダ名・アイコンも読み込み時に文字だけへ整える（データは消さない）。
 */
const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\uFE0E\uFE0F\u200D\u20E3\u{E0020}-\u{E007F}]/gu;
export function stripEmoji(value) {
  return String(value ?? '')
    .replace(EMOJI_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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

/**
 * 商品画像URL（楽天APIで取得したもの・手入力）を整える。
 * http(s) 以外（javascript: など）は捨てる。
 */
export function normalizeImageUrl(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : '';
}

/** 購入ログの上限件数（古いものから落とす。localStorage を太らせない） */
export const MAX_PURCHASE_LOG = 200;

/** 保存済み・読み込み済みの購入ログを安全な形に整える */
export function normalizePurchaseLog(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((e) => e && Number.isFinite(+e.amount))
    .map((e) => ({
      at: String(e.at || ''),
      qty: Math.max(0, Math.trunc(Number(e.qty) || 0)),
      amount: Math.max(0, Math.round(Number(e.amount) || 0)),
    }))
    .slice(-MAX_PURCHASE_LOG);
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
    favorite: partial.favorite === true,
    jan: normalizeJAN(partial.jan || ''),
    shop: String(partial.shop || '').trim(),
    price: Number.isFinite(+partial.price) && partial.price !== '' ? Math.max(0, Math.round(+partial.price)) : null,
    memo: String(partial.memo || '').trim(),
    imageUrl: normalizeImageUrl(partial.imageUrl),
    purchaseLog: normalizePurchaseLog(partial.purchaseLog),
    createdAt: partial.createdAt || new Date().toISOString(),
    updatedAt: partial.updatedAt || new Date().toISOString(),
  };
}

/**
 * お気に入り（星）の切り替え。true/false を渡すとその値にそろえる。
 * 一覧の並びが勝手に動かないよう updatedAt は変えない（お気に入りは別枠で先頭に出す）。
 */
export function toggleFavorite(item, value) {
  const next = typeof value === 'boolean' ? value : item?.favorite !== true;
  return { ...item, favorite: next };
}

/** お気に入りの件数 */
export function countFavorites(items = []) {
  return (Array.isArray(items) ? items : []).filter((it) => it?.favorite === true).length;
}

/* ---------------- 削除できない特別フォルダ「お気に入り」 ---------------- */

/**
 * 特別フォルダ「お気に入り」のID。
 * state.folders には入れない「仮想フォルダ」で、星を付けた画材をその場でまとめて見せる。
 * そのため、フォルダの作成数（無料枠）・削除・改名・移動の対象にはならない。
 */
export const FAVORITE_FOLDER_ID = 'favorites';

/** 特別フォルダ「お気に入り」の見た目（名前・色）。フォルダとしては保存しない */
export const FAVORITE_FOLDER = { id: FAVORITE_FOLDER_ID, name: 'お気に入り', color: '#c98a12', parentId: null };

/** 特別フォルダ「お気に入り」か（削除・移動・改名できない） */
export function isFavoriteFolder(id) {
  return String(id ?? '') === FAVORITE_FOLDER_ID;
}

/**
 * 特別フォルダ「お気に入り」の中身（星の付いた画材）。
 * 画材の folderId は変えないので、元のフォルダにもそのまま残る（実体は1つ・複製しない）。
 */
export function favoriteItems(items = []) {
  return (Array.isArray(items) ? items : []).filter((it) => it?.favorite === true);
}

/** お気に入りを先頭に集める（それぞれの中の並びは渡された順のまま） */
export function favoritesFirst(items = []) {
  const list = Array.isArray(items) ? items : [];
  return [...list.filter((it) => it?.favorite === true), ...list.filter((it) => it?.favorite !== true)];
}

/** 在庫数の増減（0未満にしない）。使い切り判定はステータスで保持 */
export function adjustStock(item, delta) {
  const qty = Math.max(0, (Number(item.qty) || 0) + Math.trunc(Number(delta) || 0));
  let status = item.status;
  if (qty === 0) status = 'empty';
  else if (status === 'empty') status = 'low';
  return { ...item, qty, status, updatedAt: new Date().toISOString() };
}

/**
 * 在庫切れか（一覧でグレーアウトする判定）。
 * 数量0、または残量ステータスが「使い切り」のどちらでも在庫切れとして扱う。
 * 表示だけの判定で、操作（増減・編集・通販リンク）は止めない。
 */
export function isEmptyStock(item) {
  return Number(item?.qty) === 0 || item?.status === 'empty';
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

/* ---------------- 検索の下ごしらえ（ひらがな・カタカナ・全角半角・大文字小文字のゆらぎ吸収） ---------------- */

/**
 * 検索用の文字列にそろえる。
 * NFKC（全角英数→半角・半角カナ→全角カナ）→ 小文字 → カタカナをひらがなへ。
 * 「ホルベイン」「ほるべいん」「ﾎﾙﾍﾞｲﾝ」「ＨＯＬＢＥＩＮ」が同じ並びになる。
 */
export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/**
 * 検索語をスペース（半角・全角）で区切って正規化する。
 * 返した語がすべて含まれるものだけをヒットさせる（AND検索）。
 */
export function searchTokens(query) {
  return normalizeSearchText(query).split(/\s+/).filter(Boolean);
}

/** 数字だけの語（JAN の部分一致に使う）か */
function isDigitalToken(token) {
  return /^\d{2,13}$/.test(token);
}

/**
 * 正規化済みの語がすべて含まれるか（AND検索）。
 * 数字の語は、JAN の一部としても探す（従来どおりの部分一致）。
 */
function matchesAllTokens(tokens, hay, jan = '') {
  for (const t of tokens) {
    if (hay.includes(t)) continue;
    if (isDigitalToken(t) && jan.includes(t)) continue;
    return false;
  }
  return true;
}

/**
 * 検索・絞り込み。
 * folderIds（配列）を渡すと、その範囲（親フォルダ＋配下など）で絞る。
 * folderId だけのときは、そのフォルダの画材だけ（従来どおり）。
 */
export function filterItems(items, filter = {}) {
  const tokens = searchTokens(filter.query || '');
  const scope = Array.isArray(filter.folderIds) ? new Set(filter.folderIds) : null;
  return items.filter((it) => {
    if (scope) { if (!scope.has(it.folderId)) return false; }
    else if (filter.folderId && filter.folderId !== 'all' && it.folderId !== filter.folderId) return false;
    if (filter.category && filter.category !== 'all' && it.category !== filter.category) return false;
    if (filter.status && filter.status !== 'all' && it.status !== filter.status) return false;
    if (filter.maker && filter.maker !== 'all') {
      const m = itemMaker(it);
      if (filter.maker === MAKER_NONE ? m !== '' : m !== filter.maker) return false;
    }
    if (filter.shortageOnly && !(it.status === 'low' || it.status === 'empty' || Number(it.qty) === 0)) return false;
    if (filter.favoriteOnly && it.favorite !== true) return false;
    if (!tokens.length) return true;
    const hay = normalizeSearchText([it.name, it.maker, it.brand, it.colorName, it.colorCode, it.size, it.jan, it.shop, it.memo]
      .join(' '));
    return matchesAllTokens(tokens, hay, normalizeJAN(it.jan));
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

/* ---------------- 同じ画材（同じJAN）を保管場所ごとに持つ ---------------- */
// 同じJANの画材でも、保管場所（folderId）が違えば別の在庫として扱う。
// 「自宅に1本・アトリエに1本」のように場所を分けて数えたいときのため、
// JAN だけで探すのではなく「JAN × フォルダ」で探す。

/**
 * 同じJANの画材を、指定した保管場所の中から探す。
 * JAN が空の画材は対象外（JANなしの画材同士を同じ物とみなさない）。
 */
export function findItemByJanInFolder(items = [], jan = '', folderId = '') {
  const d = normalizeJAN(jan);
  if (!d) return null;
  const folder = String(folderId ?? '');
  return (Array.isArray(items) ? items : []).find((it) => normalizeJAN(it?.jan) === d && String(it?.folderId ?? '') === folder) || null;
}

/**
 * 同じJANで、指定した保管場所の外にある画材（別のフォルダにある同じ画材）。
 * 「ほかのフォルダにも〇個あり」の案内に使う。
 */
export function itemsByJanInOtherFolders(items = [], jan = '', folderId = '') {
  const d = normalizeJAN(jan);
  if (!d) return [];
  const folder = String(folderId ?? '');
  return (Array.isArray(items) ? items : [])
    .filter((it) => normalizeJAN(it?.jan) === d && String(it?.folderId ?? '') !== folder);
}

/* ---------------- 同じ画材が複数の保管場所にあるときのまとめ表示 ---------------- */
// 「1つのフォルダにしか無い画材」は、これまでどおり1行で見せる。
// 同じJANの画材が2つ以上のフォルダに分かれているときだけ、1つの親カードに畳んで
// 「計 4点」と、フォルダごとの行（┣ / └）を出す。数量は場所ごとに別で数える。

/** フォルダの並び順の索引（画面のフォルダと同じ順に並べるため） */
function folderOrderIndex(folders = []) {
  const at = new Map();
  (Array.isArray(folders) ? folders : []).forEach((f, i) => at.set(String(f?.id ?? ''), i));
  return at;
}

/** まとまりの中の合計数（数量の合計） */
export function sumItemQty(items = []) {
  return (Array.isArray(items) ? items : []).reduce((sum, it) => {
    const q = Math.floor(Number(it?.qty) || 0);
    return sum + (q > 0 ? q : 0);
  }, 0);
}

/**
 * まとまりの見出しに使う名前（いちばん多く使われている表記。同数なら先頭）。
 * 古い表記のまま登録された点が混ざっていても、多数決で見出しが安定する。
 */
export function commonItemName(items = []) {
  const counts = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const name = String(it?.name || '').trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) { best = name; bestCount = count; }
  }
  return best;
}

/**
 * 一覧に出す行を作る。同じJANの画材が2つ以上のフォルダに分かれているものだけを1つにまとめる。
 *
 *   [{ type: 'group', jan, items, total, favorite, name, sample }]  … まとめた親
 *   [{ type: 'item', item }]                                        … いつもどおりの1行
 *
 * 並びは渡された items の順（お気に入り先頭・並び順は呼び出し側のまま）。
 * JAN が空の画材、同じフォルダに2点あるだけの画材はまとめない。
 */
export function groupItemsAcrossFolders(items = [], folders = []) {
  const list = Array.isArray(items) ? items : [];
  const byJan = new Map();
  for (const it of list) {
    const d = normalizeJAN(it?.jan);
    if (!d) continue;
    if (!byJan.has(d)) byJan.set(d, []);
    byJan.get(d).push(it);
  }
  if (!byJan.size) return list.map((item) => ({ type: 'item', item }));

  const order = folderOrderIndex(folders);
  const rank = (it) => {
    const i = order.get(String(it?.folderId ?? ''));
    return i === undefined ? order.size : i;
  };
  const folderCount = (members) => new Set(members.map((m) => String(m?.folderId ?? ''))).size;

  const rows = [];
  const done = new Set();
  for (const it of list) {
    const d = normalizeJAN(it?.jan);
    const members = d ? byJan.get(d) : null;
    if (!members || members.length < 2 || folderCount(members) < 2) {
      rows.push({ type: 'item', item: it });
      continue;
    }
    if (done.has(d)) continue;
    done.add(d);
    const sorted = [...members].sort((a, b) => rank(a) - rank(b));
    rows.push({
      type: 'group',
      jan: d,
      items: sorted,
      total: sumItemQty(sorted),
      favorite: sorted.some((m) => m?.favorite === true),
      name: commonItemName(sorted),
      sample: sorted[0],
    });
  }
  return rows;
}

/** ほかに同じ画材があるフォルダの数（タイルの「他1か所」用。無ければ0） */
export function countOtherPlaces(items = [], item = null) {
  const d = normalizeJAN(item?.jan);
  if (!d) return 0;
  const here = String(item?.folderId ?? '');
  const folders = new Set();
  for (const it of Array.isArray(items) ? items : []) {
    if (normalizeJAN(it?.jan) !== d) continue;
    const fid = String(it?.folderId ?? '');
    if (fid !== here) folders.add(fid);
  }
  return folders.size;
}

/**
 * 「他：アトリエ 1点」— いま開いているフォルダの外に同じ画材があることを短く伝える。
 * フォルダを1つだけ開いているときの添え書きに使う（無ければ空文字）。
 * @param {{max?:number}} opts 何か所まで名前を出すか（残りは「ほか◯か所」）
 */
export function otherPlaceSummary(items = [], item = null, folders = [], { max = 2 } = {}) {
  const d = normalizeJAN(item?.jan);
  if (!d) return '';
  const here = String(item?.folderId ?? '');
  const names = new Map((Array.isArray(folders) ? folders : []).map((f) => [String(f?.id ?? ''), String(f?.name || '未分類')]));
  const totals = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    if (normalizeJAN(it?.jan) !== d) continue;
    const fid = String(it?.folderId ?? '');
    if (fid === here) continue;
    const q = Math.floor(Number(it?.qty) || 0);
    totals.set(fid, (totals.get(fid) || 0) + (q > 0 ? q : 0));
  }
  if (!totals.size) return '';
  const order = folderOrderIndex(folders);
  const rank = (id) => (order.get(id) === undefined ? order.size : order.get(id));
  const rows = [...totals.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
  const shown = Math.max(1, Math.trunc(Number(max) || 1));
  const parts = rows.slice(0, shown).map(([fid, qty]) => `${names.get(fid) || '未分類'} ${qty}点`);
  const rest = rows.length - parts.length;
  return `他：${parts.join('・')}${rest > 0 ? ` ほか${rest}か所` : ''}`;
}

/* ---------------- 別の場所に追加（同じ画材をもう1点、別のフォルダに置く） ---------------- */

/** 追加できなかった理由の文言（画面のトーストにそのまま出す） */
export const ADD_PLACE_ERRORS = {
  'no-source': '追加する画材が見つかりません',
  'no-folder': '追加先のフォルダを選んでください',
  'same-folder': 'この画材はもうそのフォルダにあります',
  exists: 'そのフォルダには、同じJANの画材がすでにあります',
  limit: '無料プランで登録できる点数がいっぱいです',
};

/** 追加できなかった理由を文言にする（知らない理由は無難な1行） */
export function describeAddPlaceError(error) {
  return ADD_PLACE_ERRORS[String(error || '')] || '追加できませんでした';
}

/**
 * 同じ画材を、別のフォルダへ「独立した1点」として追加する。
 *
 * - 写すのは画材の情報（商品名・メーカー・ブランド・カテゴリ・色名・色番号・号数・JAN・
 *   ショップ・画像URL）だけ。数量は qty（既定1）、メモ・価格・購入ログ・お気に入り・
 *   写真は写さない（別の在庫なので、その場所の分だけを数える）。
 * - 今のアイテムは動かさない（フォルダ移動とは別の操作）。IDは必ず新しく振る。
 * - 同じフォルダに同じJANがあれば作らない（二重登録を防ぐ）。
 * - limit（無料プランの上限）を超えるときは作らない。
 *
 * @returns {{ok:boolean, error:string, items:object[], item:object|null}}
 */
export function addItemToAnotherFolder(items = [], sourceId = '', folderId = '', { qty = 1, limit = Number.POSITIVE_INFINITY, now = new Date().toISOString() } = {}) {
  const list = Array.isArray(items) ? items : [];
  const fail = (error) => ({ ok: false, error, items: list, item: null });
  const src = list.find((it) => String(it?.id) === String(sourceId));
  if (!src) return fail('no-source');
  const target = String(folderId ?? '');
  if (!target) return fail('no-folder');
  if (String(src.folderId ?? '') === target) return fail('same-folder');
  const jan = normalizeJAN(src.jan);
  if (jan && findItemByJanInFolder(list, jan, target)) return fail('exists');
  if (list.length >= Number(limit)) return fail('limit');

  const copy = createItem({
    name: src.name,
    maker: src.maker,
    brand: src.brand,
    category: src.category,
    colorName: src.colorName,
    colorCode: src.colorCode,
    size: src.size,
    jan: src.jan,
    shop: src.shop,
    imageUrl: src.imageUrl,
    folderId: target,
    qty,
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true, error: '', items: [...list, copy], item: copy };
}

/* ---------------- 複数選択（一括移動） ---------------- */

/** 選択の切り替え（IDの配列で持つ。画面のSetからも呼べる形） */
export function toggleSelection(ids = [], id) {
  const list = Array.isArray(ids) ? ids : [...ids];
  const key = String(id ?? '');
  if (!key) return list;
  return list.includes(key) ? list.filter((x) => x !== key) : [...list, key];
}

/** 選択済みか */
export function isSelected(ids = [], id) {
  return (Array.isArray(ids) ? ids : [...ids]).includes(String(id ?? ''));
}

/** いま見えている画材をすべて選ぶ */
export function selectAllIds(items = []) {
  return items.map((i) => String(i.id));
}

/** 消えた画材のIDを選択から落とす（削除・復元のあと） */
export function pruneSelection(ids = [], items = []) {
  const alive = new Set(items.map((i) => String(i.id)));
  return (Array.isArray(ids) ? ids : [...ids]).filter((id) => alive.has(String(id)));
}

/* ---------------- 辞書の手動検索 ---------------- */

const DICT_HAY_CACHE = new WeakMap();

/**
 * 検索用の文字列（商品名・色名・メーカー・ブランド・サイズ・品番・JAN）。
 * 辞書の配列が変わったときだけ作り直す（毎打鍵で数万件を連結・正規化しない）。
 * 正規化（ひらがな・カタカナ等の統一）もこの1回だけ。
 */
export function dictionaryHaystack(dict = []) {
  if (!Array.isArray(dict)) return [];
  const cached = DICT_HAY_CACHE.get(dict);
  if (cached && cached.length === dict.length) return cached;
  const hay = dict.map((d) => normalizeSearchText(`${d.name || ''} ${d.colorName || ''} ${d.maker || ''} ${d.brand || ''} ${d.size || ''} ${d.code || ''} ${d.jan || ''}`));
  DICT_HAY_CACHE.set(dict, hay);
  return hay;
}

/**
 * 辞書を手動で検索する。描画する分だけ返し、全体の件数は total で返す。
 * スペース（半角・全角）で区切った語はすべて含むものだけ（AND検索）。
 * ひらがな・カタカナ、全角・半角、大文字・小文字のゆらぎは吸収する。
 * 数字だけの入力はJANの部分一致としても探す（4桁以上）。
 */
/**
 * 検索語と絞り込みから「この1件はヒットするか」を返す判定器。
 * 検索（上位だけ描く）とメーカー別の集計（全件を数える）で同じ条件を使うため、ここにまとめる。
 */
function dictionaryHitTester(dict = [], query = '', { hay, maker = '', category = '' } = {}) {
  const tokens = searchTokens(query);
  const qJan = normalizeJAN(query ?? '');
  const janQuery = tokens.length === 1 && /^\d{4,13}$/.test(qJan) ? qJan : '';
  const wantMaker = String(maker ?? '').trim();
  const wantCategory = String(category ?? '').trim();
  const stack = Array.isArray(hay) && hay.length === dict.length ? hay : dictionaryHaystack(dict);
  const onlyOne = tokens.length === 1 ? tokens[0] : '';
  return (d, i) => {
    if (!d) return false;
    if (wantMaker && String(d.maker || '') !== wantMaker) return false;
    if (wantCategory && String(d.category || 'other') !== wantCategory) return false;
    if (!tokens.length) return true;
    if (onlyOne) return stack[i].includes(onlyOne) || (janQuery !== '' && String(d.jan || '').includes(janQuery));
    return matchesAllTokens(tokens, stack[i], normalizeJAN(d.jan || ''));
  };
}

/**
 * 辞書を手動で検索する。描画する分だけ返し、全体の件数は total で返す。
 * スペース（半角・全角）で区切った語はすべて含むものだけ（AND検索）。
 * ひらがな・カタカナ、全角・半角、大文字・小文字のゆらぎは吸収する。
 * 数字だけの入力はJANの部分一致としても探す（4桁以上）。
 */
export function searchDictionary(dict = [], query = '', { limit = 40, hay, maker = '', category = '' } = {}) {
  const hit = dictionaryHitTester(dict, query, { hay, maker, category });
  const max = Math.max(0, Math.trunc(Number(limit) || 0));
  const items = [];
  let total = 0;
  for (let i = 0; i < dict.length; i += 1) {
    const d = dict[i];
    if (!hit(d, i)) continue;
    total += 1;
    if (items.length < max) items.push(d);
  }
  return { items, total, limit: max };
}

/**
 * 検索にヒットした全件を、メーカー見出しごとにまとめる（検索タブ用）。
 * 見出しは五十音順・件数は全件（50件などで打ち切らない）。
 * 中身（items）はメーカーごとに持たせ、画面は開いたメーカーの分だけ描く。
 */
export function groupDictionarySearch(dict = [], query = '', opts = {}) {
  const hit = dictionaryHitTester(dict, query, opts);
  const at = new Map();
  const groups = [];
  let total = 0;
  for (let i = 0; i < dict.length; i += 1) {
    const d = dict[i];
    if (!hit(d, i)) continue;
    total += 1;
    const maker = String(d.maker || 'メーカー不明');
    let g = at.get(maker);
    if (!g) {
      g = { maker, items: [] };
      at.set(maker, g);
      groups.push(g);
    }
    g.items.push(d);
  }
  groups.sort((a, b) => compareMakerName(a.maker, b.maker));
  return { groups, total };
}

/**
 * 検索タブの行に添える補足（色・容量）。
 * 商品名にすでに入っているものは繰り返さない（例:「... 59ml ウルトラマリンブルー」に
 * 色名と容量をもう一度並べない）。残るものが無ければ空文字。
 */
export function dictionaryRowDetail(entry = {}) {
  // 空白の有無でも同じ色名と見なす（「ウルトラマリン ブルー」と「ウルトラマリンブルー」）
  const key = (value) => normalizeSearchText(value).replace(/\s+/g, '');
  const name = key(entry?.name || '');
  const parts = [entry?.colorName, entry?.size].filter(Boolean)
    .filter((value) => {
      const k = key(value);
      return k !== '' && !name.includes(k);
    })
    .map((value) => String(value).trim());
  return [...new Set(parts)].join(' ・ ');
}

/* ---------------- 登録済みの表記を最新の辞書に揃える ---------------- */

/**
 * 辞書から在庫へ写す「表記」の対応表（在庫側の項目名 ← 辞書側の項目名）。
 * 数量・メモ・フォルダ・写真・価格・購入ログ・お気に入り・ID・作成日は写さない。
 */
export const DICT_SYNC_FIELDS = [
  { item: 'name', dict: 'name' },
  { item: 'maker', dict: 'maker' },
  { item: 'brand', dict: 'brand' },
  { item: 'category', dict: 'category' },
  { item: 'colorName', dict: 'colorName' },
  { item: 'colorCode', dict: 'code' },
  { item: 'size', dict: 'size' },
];

/** 表記の更新の前に出す確認の文言（数量・メモ・フォルダ・写真が残ることを伝える） */
export const SYNC_ITEMS_CONFIRM_TEXT = 'JANが一致する画材の商品名・メーカー名等を最新の辞書表記に更新します（数量・メモ・フォルダ・写真はそのまま残ります）';

/** 表記を揃えたあとの結果の文言（0件のときは「すべて最新」） */
export function describeSyncItemsResult(updatedCount) {
  const n = Math.max(0, Math.trunc(Number(updatedCount) || 0));
  return n ? `${n}件の表記を最新辞書に揃えました` : 'すべて最新の表記です';
}

/**
 * 辞書の1件から、在庫のその項目に入れる値を作る（空・不正なら空文字＝更新しない）。
 * 商品名は辞書に name が無いとき colorName で補う（辞書から登録するときと同じ扱い）。
 */
function dictionaryFieldValue(entry, key) {
  if (key === 'name') return String(entry?.name || entry?.colorName || '').trim();
  if (key === 'category') {
    const id = String(entry?.category || '').trim();
    return CATEGORIES.some((c) => c.id === id) ? id : '';
  }
  return String(entry?.[key] ?? '').trim();
}

/**
 * 登録済みアイテムの表記を、最新の内蔵辞書の内容へ揃える。
 *
 * - 対象は JAN が入っていて、辞書に同じ JAN がある在庫だけ（JAN が空の画材は触らない）。
 * - 更新するのは表記系の項目（商品名・メーカー・ブランド・カテゴリ・色名・色番号・号数）だけで、
 *   辞書側が空の項目は今の値を残す。
 * - id・folderId・数量(qty)・補充しきい値・お気に入り・メモ・価格・購入ログ・写真・画像URL・
 *   作成日は絶対に変えない（数量・メモ・フォルダ・写真は利用者のもの）。
 * - 実際に値が変わったアイテムだけ updatedAt を now に更新する。
 *
 * @returns {{ items: object[], updatedCount: number }} 新しい配列と、表記を直した件数
 */
export function syncItemsWithDictionary(items = [], dict = [], { now = new Date().toISOString() } = {}) {
  const list = Array.isArray(items) ? items : [];
  // JAN ごとの辞書1件（同じ JAN が複数あっても先頭を使う）
  const entries = new Map();
  for (const entry of Array.isArray(dict) ? dict : []) {
    const jan = normalizeJAN(entry?.jan);
    if (!jan || entries.has(jan)) continue;
    entries.set(jan, entry);
  }
  if (!entries.size) return { items: list, updatedCount: 0 };

  let updatedCount = 0;
  const next = list.map((item) => {
    const jan = normalizeJAN(item?.jan);
    if (!jan) return item;
    const entry = entries.get(jan);
    if (!entry) return item;

    const patch = {};
    for (const { item: field, dict: key } of DICT_SYNC_FIELDS) {
      const value = dictionaryFieldValue(entry, key);
      if (!value) continue; // 辞書が空の項目は今の値を残す
      if (String(item?.[field] ?? '').trim() === value) continue;
      patch[field] = value;
    }
    if (!Object.keys(patch).length) return item;

    updatedCount += 1;
    return { ...item, ...patch, updatedAt: now };
  });

  return { items: updatedCount ? next : list, updatedCount };
}

/* ---------------- メーカー名の五十音順 ---------------- */

// 小書きの仮名は、同じ行の普通の仮名として並べる（っ＝つ、ゃ＝や、ゕ＝か…）
const SMALL_KANA = {
  'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お',
  'っ': 'つ', 'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'ゎ': 'わ', 'ゕ': 'か', 'ゖ': 'け',
};

// 長音「ー」は直前の仮名の母音として数える（カー＝かあ、キー＝きい…）
const VOWEL_OF = new Map();
for (const [chars, vowel] of [
  ['あかさたなはまらや', 'あ'], ['いきしちにひみりゐ', 'い'], ['うくすつぬふむゆるゔ', 'う'],
  ['えけせてねへめれゑ', 'え'], ['おこそとのほもよろを', 'お'],
]) {
  for (const ch of chars) VOWEL_OF.set(ch, vowel);
}

/**
 * メーカー名を五十音順に並べるためのキー（「あいうえお順」の文字列）。
 * カタカナ→ひらがなに寄せ（両方が別々の固まりに分断されないように）、
 * 全角半角・大文字小文字・濁点半濁点（が＝か・ぱ＝は）・小書き・長音のゆらぎを吸収する。
 */
export function makerSortKey(name) {
  const katakana = String(name ?? '')
    .normalize('NFKC') // 半角カナ・全角英数を普通の字に
    .replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60)) // カタカナ→ひらがな
    .replace(/\u30FD/g, '\u309D') // ヽ→ゝ
    .replace(/\u30FE/g, '\u309E'); // ヾ→ゞ
  // 濁点・半濁点を落とす（が→か、パ→は、ヴ→う）。区別は同じキーのときの元の名前で付ける
  const plain = katakana.normalize('NFD').replace(/[\u3099\u309A]/g, '').normalize('NFC');
  const chars = [...plain].map((ch) => SMALL_KANA[ch] || ch);
  const out = [];
  for (const ch of chars) {
    out.push(ch === 'ー' ? (VOWEL_OF.get(out[out.length - 1]) || ch) : ch);
  }
  return out.join('').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * メーカー名の五十音順の比較。
 * かなの並び（五十音）で比べ、同じ並び（は／ば／ぱ など）は名前的に決めて毎回同じ順にする。
 */
export function compareMakerName(a, b) {
  const ka = makerSortKey(a);
  const kb = makerSortKey(b);
  if (ka !== kb) return ka < kb ? -1 : 1;
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  if (sa === sb) return 0;
  return sa < sb ? -1 : 1;
}

/**
 * 検索タブ：開いたメーカーの中で最初に描く件数と、自動展開で描く全体の上限。
 * 1社に何千件あっても、画面に出るのはここまで（残りは「もっと見る」で足す）。
 */
export const DICT_MAKER_PAGE = 50;
export const DICT_AUTO_OPEN_ROWS = 250;

/**
 * 検索タブのメーカー見出しを「どこを開いて何件描くか」の計画にする。
 * - 検索文字もメーカー選択も無いとき：全部閉じる（見出しだけを五十音順で見渡せる）
 * - 検索文字を入れた／メーカーを選んだとき：該当メーカーを自動で開く（手で閉じたものは閉じたまま）
 * - 開いたメーカーは page 件ずつ描き、残りは rest として「もっと見る」に回す
 * - 自動展開が何十社にも広がるときは budget 件で打ち切る（開いていない見出しは件数だけ出す）
 */
export function planDictGroups(groups = [], {
  query = '', maker = '', category = '',
  open = new Set(), closed = new Set(), more = new Map(),
  page = DICT_MAKER_PAGE, budget = DICT_AUTO_OPEN_ROWS,
} = {}) {
  const autoOpen = String(query ?? '').trim() !== ''
    || String(maker ?? '').trim() !== '' || String(category ?? '').trim() !== '';
  const opened = open instanceof Set ? open : new Set(open || []);
  const closedSet = closed instanceof Set ? closed : new Set(closed || []);
  const moreMap = more instanceof Map ? more : new Map(Object.entries(more || {}));
  const perPage = Math.max(1, Math.trunc(Number(page) || DICT_MAKER_PAGE));
  let left = autoOpen ? Math.max(0, Math.trunc(Number(budget) || 0)) : 0;
  return (Array.isArray(groups) ? groups : []).map((g) => {
    const name = String(g?.maker ?? '');
    const all = Array.isArray(g?.items) ? g.items : [];
    const tapped = opened.has(name);
    const auto = autoOpen && !closedSet.has(name);
    // 「もっと見る」で足された分も含めた、このメーカーで見せたい件数
    const extra = Math.max(0, Math.trunc(Number(moreMap.get(name)) || 0));
    const want = Math.min(all.length, perPage + extra);
    let show = 0;
    if (closedSet.has(name) && !tapped) show = 0; // 手で閉じた見出しは、もっと見るを押していても閉じたまま
    else if (tapped || extra > 0) show = want; // 自分で開いた・「もっと見る」を押したメーカーは予算で切らない
    else if (auto && left > 0) {
      show = Math.min(want, left);
      left -= show;
    }
    return { maker: name, total: all.length, open: show > 0, shown: all.slice(0, show), rest: all.length - show };
  });
}

/**
 * 絞り込み用のメーカー一覧（登録済みアイテムから・五十音順） */
export function listMakers(items) {
  return [...new Set(items.map(itemMaker).filter(Boolean))].sort(compareMakerName);
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

/**
 * 内蔵辞書の検索結果をメーカー見出しごとにまとめる（検索タブの「すべてのメーカー」用）。
 * 見出しはメーカー名の五十音順（カタカナ・ひらがなを混ぜてもあいうえお順。メーカータブと同じ並び）。
 * 中の並び（検索の当たり順）は変えない。
 */
export function groupDictionaryByMaker(entries = []) {
  const groups = [];
  const at = new Map();
  for (const d of Array.isArray(entries) ? entries : []) {
    const maker = String(d?.maker || 'メーカー不明');
    if (!at.has(maker)) {
      at.set(maker, groups.length);
      groups.push({ maker, items: [] });
    }
    groups[at.get(maker)].items.push(d);
  }
  return groups.sort((a, b) => compareMakerName(a.maker, b.maker));
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
      return compareMakerName(am, bm) || byName(a, b);
    });
  }
  if (mode === 'shortage') {
    const rank = (i) => ({ empty: 0, low: 1, enough: 2, new: 3 }[i.status] ?? 4);
    return copy.sort((a, b) => rank(a) - rank(b) || byName(a, b));
  }
  return copy.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/* ---------------- 一覧の分け方（すべて / フォルダ別 / メーカー別） ---------------- */

/** 一覧の上部に出す3択 */
export const VIEW_GROUPS = [
  { id: 'all', label: 'すべて' },
  { id: 'folder', label: 'フォルダ別' },
  { id: 'maker', label: 'メーカー別' },
];

/** 使える並び順か（知らない値は「新しい順」に倒す） */
function normalizeSortMode(mode) {
  return SORT_MODES.some((m) => m.id === mode) ? mode : 'updated';
}

/**
 * いまの分け方。
 * 知らない値や古いデータ（groupMode が無い）は「すべて」。
 * 以前の「メーカー順＝メーカー見出し」のデータは「メーカー別」とみなす。
 */
export function viewGroupOf(settings = {}) {
  const g = String(settings?.groupMode || '');
  if (g === 'all' || g === 'folder' || g === 'maker') return g;
  return settings?.sort === 'maker' ? 'maker' : 'all';
}

/** 「メーカー別」で分けているか（メーカー順の見出し表示） */
export function isMakerGroupOn(settings = {}) {
  return viewGroupOf(settings) === 'maker';
}

/**
 * 並び順を変える設定を作る。
 * メーカー順を選ぶと「メーカー別」もオンになり、外すと直前に見ていた並びへ戻る。
 */
export function withSortMode(settings = {}, mode = 'updated') {
  const next = normalizeSortMode(mode);
  const remembered = normalizeSortMode(settings?.sortBeforeMaker || 'updated');
  const before = remembered === 'maker' ? 'updated' : remembered;
  const current = normalizeSortMode(settings?.sort || 'updated');
  if (next === 'maker') {
    return {
      ...settings, sort: 'maker', groupMode: 'maker',
      sortBeforeMaker: current === 'maker' ? before : current,
    };
  }
  const group = viewGroupOf(settings) === 'maker' ? 'all' : viewGroupOf(settings);
  return { ...settings, sort: next, groupMode: group, sortBeforeMaker: before };
}

/**
 * 一覧の分け方（すべて / フォルダ別 / メーカー別）を変える。
 * 「メーカー別」は並びもメーカー順にする（見出しの中をメーカー順で見るため）。
 */
export function withViewGroup(settings = {}, mode = 'all') {
  const next = VIEW_GROUPS.some((g) => g.id === mode) ? mode : 'all';
  if (next === 'maker') return withSortMode(settings, 'maker');
  const current = viewGroupOf(settings);
  const base = normalizeSortMode(settings?.sort || 'updated');
  const sort = current === 'maker' ? normalizeSortMode(settings?.sortBeforeMaker || 'updated') : base;
  return {
    ...settings, groupMode: next, sort: sort === 'maker' ? 'updated' : sort,
    sortBeforeMaker: normalizeSortMode(settings?.sortBeforeMaker || 'updated'),
  };
}

/** フォルダ別のまとまり（フォルダの並び順。未分類は末尾） */
export function groupByFolder(items = [], folders = []) {
  const order = new Map((Array.isArray(folders) ? folders : []).map((f, i) => [String(f?.id ?? ''), i]));
  const groups = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const id = String(it?.folderId || '');
    if (!groups.has(id)) {
      const folder = (Array.isArray(folders) ? folders : []).find((f) => String(f?.id ?? '') === id);
      groups.set(id, { folderId: id, name: folder ? String(folder.name || '') : '', items: [] });
    }
    groups.get(id).items.push(it);
  }
  const big = Number.MAX_SAFE_INTEGER;
  return [...groups.values()].sort((a, b) => {
    const ai = order.has(a.folderId) ? order.get(a.folderId) : big;
    const bi = order.has(b.folderId) ? order.get(b.folderId) : big;
    return ai - bi;
  });
}

export function countByFolder(items) {
  const out = { all_total: items.length };
  for (const it of items) out[it.folderId] = (out[it.folderId] || 0) + 1;
  return out;
}

export function blankState() {
  return {
    version: APP_VERSION,
    folders: DEFAULT_FOLDERS.map((f) => ({ ...f, parentId: null })),
    items: [],
    settings: {
      sort: 'updated', layout: 'grid', askBeforeDelete: true, theme: 'auto',
      rakutenAppId: '', rakutenAccessKey: '', imageProxyUrl: '',
      pro: false, proPreview: false,
    },
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
  const rawParent = folder.parentId;
  const parentId = rawParent === null || rawParent === undefined || rawParent === '' ? null : String(rawParent);
  if (parentId && !state.folders.some((f) => String(f.id) === parentId)) {
    throw new Error('親フォルダがありません');
  }
  const f = {
    id: slugId(name, state.folders),
    name,
    icon: folder.icon || '',
    color: folder.color || '#5b6b7c',
    parentId,
  };
  return { ...state, folders: [...state.folders, f] };
}

export function renameFolder(state, id, name) {
  const next = String(name || '').trim();
  if (!next) throw new Error('フォルダ名を入力してください');
  return { ...state, folders: state.folders.map((f) => (f.id === id ? { ...f, name: next } : f)) };
}

export function updateFolder(state, id, patch = {}) {
  const cur = state.folders.find((f) => f.id === id);
  if (!cur) return state;
  let parentId = cur.parentId ?? null;
  if (Object.prototype.hasOwnProperty.call(patch, 'parentId')) {
    const raw = patch.parentId;
    const next = raw === null || raw === undefined || raw === '' ? '' : String(raw);
    const check = canSetFolderParent(state.folders, id, next);
    if (!check.ok) throw new Error(check.reason);
    parentId = next || null;
  }
  return {
    ...state,
    folders: state.folders.map((f) =>
      f.id === id
        ? {
          ...f,
          name: (patch.name ?? f.name).trim() || f.name,
          icon: patch.icon ?? f.icon,
          color: patch.color ?? f.color,
          parentId,
        }
        : f,
    ),
  };
}

/** 同じ親の中で上下に入れ替える（子フォルダは付いたまま動く） */
export function moveFolder(state, id, dir = 'up') {
  const f = state.folders.find((x) => x.id === id);
  if (!f) return state;
  const siblings = folderChildren(state.folders, folderParentId(f));
  const i = siblings.findIndex((x) => x.id === id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= siblings.length) return state;
  const other = siblings[j];
  const arr = [...state.folders];
  const a = arr.findIndex((x) => x.id === f.id);
  const b = arr.findIndex((x) => x.id === other.id);
  [arr[a], arr[b]] = [arr[b], arr[a]];
  return { ...state, folders: arr };
}

/** 並び替え（ids の順に並べ、含まれないフォルダは後ろへ） */
export function reorderFolders(state, ids) {
  const map = new Map(state.folders.map((f) => [f.id, f]));
  const ordered = ids.filter((id) => map.has(id)).map((id) => map.get(id));
  const rest = state.folders.filter((f) => !ids.includes(f.id));
  return { ...state, folders: [...ordered, ...rest] };
}

/**
 * フォルダ削除（中身は moveToId へ移動。最後の1個は削除不可）。
 * 子フォルダは消さず、削除したフォルダの1つ上へ移す（画材が行き場を失わない）。
 */
export function deleteFolder(state, id, moveToId) {
  if (state.folders.length <= 1) throw new Error('フォルダは最低1つ必要です');
  const victim = state.folders.find((f) => f.id === id);
  if (!victim) throw new Error('フォルダがありません');
  const target = moveToId || state.folders.find((f) => f.id !== id)?.id;
  if (target === id || !state.folders.some((f) => f.id === target)) throw new Error('移動先フォルダがありません');
  const nextParent = folderParentId(victim) || null;
  return {
    ...state,
    folders: state.folders
      .filter((f) => f.id !== id)
      .map((f) => (folderParentId(f) === String(id) ? { ...f, parentId: nextParent } : f)),
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
    .map((f) => ({
      // 旧バージョンの絵文字アイコン・絵文字入りフォルダ名を文字だけに整える（後方互換のため icon は保持）
      id: String(f.id),
      name: stripEmoji(f.name) || 'フォルダ',
      icon: stripEmoji(f.icon),
      color: f.color || '#5b6b7c',
      parentId: f.parentId === null || f.parentId === undefined || f.parentId === '' ? null : String(f.parentId),
    }));
  if (folders.length === 0) throw new Error('フォルダが1つも含まれていません');
  // 存在しない親・自分自身・循環はトップへ逃がす（読み込みでデータを壊さない）
  const folderIdSet = new Set(folders.map((f) => f.id));
  const byId = new Map(folders.map((f) => [f.id, f]));
  for (const f of folders) {
    let p = f.parentId;
    if (p && (p === f.id || !folderIdSet.has(p))) { f.parentId = null; continue; }
    const seen = new Set([f.id]);
    while (p) {
      if (seen.has(p)) { f.parentId = null; break; }
      seen.add(p);
      p = byId.get(p)?.parentId || null;
    }
  }
  const ids = new Set(folders.map((f) => f.id));
  const items = data.items.map((raw) => {
    const it = createItem(raw);
    return ids.has(it.folderId) ? it : { ...it, folderId: folders[0].id };
  });
  return { version: APP_VERSION, folders, items, settings: { ...blankState().settings, ...(data.settings || {}) } };
}

/** カテゴリIDの表示名 */
export function categoryLabel(id) {
  return CATEGORIES.find((c) => c.id === id)?.label || 'その他';
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

/* ---------------- 画材費（単価・購入ログ・CSV） ---------------- */
/** 単価が入っているか（0円も「入力済み」として扱う） */
export function hasPrice(item) {
  const p = item?.price;
  if (p === null || p === undefined || p === '') return false;
  return Number.isFinite(+p) && +p >= 0;
}

/** 参考単価（円・未入力は null） */
export function unitPrice(item) {
  return hasPrice(item) ? Math.round(+item.price) : null;
}

/** 今の在庫価値（単価 × 在庫数） */
export function stockValueOf(item) {
  const price = unitPrice(item);
  if (price === null) return 0;
  return price * Math.max(0, Number(item?.qty) || 0);
}

/**
 * 買い足し（在庫＋）を1件、購入ログに残す。単価が無い・減らす操作では何もしない。
 * 記録がまだ無い画材は、その時点の在庫ぶんを最初の購入として残してから追記する
 * （単価を後から入れた既存データでも、買い足し以降の金額が正しく積み上がる）。
 */
export function recordPurchase(item, delta, at = new Date().toISOString()) {
  const d = Math.trunc(Number(delta) || 0);
  const price = unitPrice(item);
  if (!item || d <= 0 || price === null) return item;
  const prev = Array.isArray(item.purchaseLog) ? item.purchaseLog : [];
  const seeded = prev.length === 0 && Number(item.qty) > 0
    ? [{ at: String(item.createdAt || at), qty: Number(item.qty), amount: price * Number(item.qty) }]
    : prev;
  const log = [...seeded, { at, qty: d, amount: price * d }].slice(-MAX_PURCHASE_LOG);
  return { ...item, purchaseLog: log };
}

/** 記録済みの購入金額（ログが無い既存データは、いまの在庫ぶんを購入額とみなす） */
export function purchaseTotalOf(item) {
  const log = Array.isArray(item?.purchaseLog) ? item.purchaseLog : [];
  if (log.length) return log.reduce((sum, e) => sum + Math.max(0, Number(e.amount) || 0), 0);
  return stockValueOf(item);
}

const addAmount = (map, key, amount) => {
  const cur = map.get(key) || { value: 0, count: 0 };
  cur.value += amount;
  cur.count += 1;
  map.set(key, cur);
};

/**
 * 画材費の2軸集計。
 * stockValue    = 今の在庫価値（単価 × 在庫数。使った分は減る）
 * recordedTotal = 記録済み合計金額（買い足すたびに積み上がる購入額）
 * 内訳（カテゴリ別・メーカー別）は recordedTotal 側を金額の大きい順に並べる。
 */
export function costSummary(items = []) {
  let stockValue = 0;
  let recordedTotal = 0;
  let pricedCount = 0;
  let qty = 0;
  const byCategory = new Map();
  const byMaker = new Map();
  for (const it of items) {
    qty += Math.max(0, Number(it.qty) || 0);
    if (!hasPrice(it)) continue;
    const recorded = purchaseTotalOf(it);
    pricedCount += 1;
    stockValue += stockValueOf(it);
    recordedTotal += recorded;
    addAmount(byCategory, it.category || 'other', recorded);
    addAmount(byMaker, itemMaker(it) || '未設定', recorded);
  }
  const toRows = (map, labelOf) => [...map.entries()]
    .map(([key, v]) => ({ key, label: labelOf(key), value: v.value, count: v.count }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'ja'));
  return {
    kinds: items.length,
    qty,
    pricedCount,
    unpricedCount: items.length - pricedCount,
    stockValue,
    recordedTotal,
    byCategory: toRows(byCategory, categoryLabel),
    byMaker: toRows(byMaker, (maker) => maker),
  };
}

/** 内訳リストを上位 max 件に絞り、残りは「ほか」にまとめる */
export function costRows(list = [], max = 6) {
  const rows = [...list].slice(0, Math.max(0, max));
  const rest = [...list].slice(Math.max(0, max));
  return {
    rows,
    rest: rest.length
      ? { value: rest.reduce((sum, r) => sum + (Number(r.value) || 0), 0), count: rest.length }
      : null,
  };
}

/** CSVの1セルをエスケープ（カンマ・引用符・改行を含むときだけ引用符で囲む） */
export function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 行の配列をCSV本文にする（Excel向けに改行は CRLF） */
export function toCsv(rows = []) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

/** CSVの列（この順番で出す） */
export const CSV_COLUMNS = [
  '名前', 'メーカー', 'ブランド', 'カテゴリ', '色名', '色番', 'JAN', 'フォルダ', '残量', '在庫数', '単価', '推定価値', '更新日',
];

/** Excelで文字化けしないよう、UTF-8のBOMを先頭に付ける */
export const CSV_BOM = '\uFEFF';

/** ISO日時を端末のタイムゾーンで YYYY-MM-DD に（読めない値は空） */
export function localDate(iso) {
  if (iso === null || iso === undefined || iso === '') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 画材1件ぶんのCSV行 */
export function itemCsvRow(item, folders = []) {
  const folder = folders.find((f) => f.id === item.folderId);
  const status = STATUSES.find((s) => s.id === item.status);
  const price = unitPrice(item);
  return [
    item.name,
    item.maker,
    item.brand,
    categoryLabel(item.category),
    item.colorName,
    item.colorCode,
    item.jan,
    folder ? folder.name : '',
    status ? status.label : '',
    Math.max(0, Number(item.qty) || 0),
    price === null ? '' : price,
    stockValueOf(item),
    localDate(item.updatedAt),
  ];
}

/** CSV本文（BOM付きUTF-8・CRLF）。Excelでそのまま開ける */
export function buildItemsCsvText(items = [], folders = []) {
  const rows = [CSV_COLUMNS, ...items.map((it) => itemCsvRow(it, folders))];
  return `${CSV_BOM}${toCsv(rows)}\r\n`;
}

/**
 * バックアップの「まとめる（追加）」用。
 * フォルダは足りないIDだけ足し、画材はIDが同じなら更新日時の新しいほうを残す。
 * どちらも消さないので、復元の取り違えで手持ちのデータが減らない。
 */
export function mergeStates(current, incoming) {
  const folders = [...(current?.folders || [])];
  const folderIds = new Set(folders.map((f) => f.id));
  let foldersAdded = 0;
  for (const f of incoming?.folders || []) {
    if (!f?.id || folderIds.has(f.id)) continue;
    folders.push(f);
    folderIds.add(f.id);
    foldersAdded += 1;
  }
  const fallbackFolder = folders[0]?.id || DEFAULT_FOLDERS[0].id;
  const items = [...(current?.items || [])];
  const index = new Map(items.map((it, i) => [it.id, i]));
  let added = 0;
  let updated = 0;
  for (const raw of incoming?.items || []) {
    if (!raw?.id) continue;
    const it = folderIds.has(raw.folderId) ? raw : { ...raw, folderId: fallbackFolder };
    const at = index.get(it.id);
    if (at === undefined) {
      items.push(it);
      index.set(it.id, items.length - 1);
      added += 1;
      continue;
    }
    if (String(it.updatedAt || '') > String(items[at].updatedAt || '')) {
      items[at] = it;
      updated += 1;
    }
  }
  return { ...current, folders, items, mergeStats: { added, updated, foldersAdded } };
}
