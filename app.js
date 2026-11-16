// 画材管理アプリ UI（storage + rendering + バーコード読取）
import {
  STORAGE_KEY, CATEGORIES, STATUSES, DEFAULT_FOLDERS, SORT_MODES, MAKER_NONE,
  createItem, adjustStock, computeShoppingList, filterItems, moveItems, sortItems, countByFolder,
  addFolder, updateFolder, moveFolder, reorderFolders, deleteFolder, upsertItem, deleteItems,
  exportState, importState, summarize, blankState, isEmptyStock,
  isValidJAN, normalizeJAN, detectMaker, lookupJAN, itemMaker, listMakers, groupByMaker,
  normalizeImageUrl, recordPurchase, costSummary, costRows, buildItemsCsvText, mergeStates,
  folderParentId, folderChildren, folderChain, folderDepth, folderPathLabel, folderSubtreeIds,
  folderTree, folderOptions, countByFolderDeep,
  toggleSelection, isSelected, selectAllIds, pruneSelection, searchDictionary, dictionaryHaystack,
} from './core.js';
import {
  FREE_ITEM_LIMIT, FREE_FOLDER_LIMIT, PRO_BENEFITS, isPro, itemQuota, folderQuota,
  canAddItem, canAddFolder, canUseFeature, describeQuota, isQuotaTight,
} from './pro.js';
import {
  sampleItems, mergeSampleItems, shouldSeedSamples, readSampleSeeded, writeSampleSeeded,
} from './samples.js';
import { JAN_DICTIONARY } from './jan-database.js';
import {
  resolveDictionaryUrl, mergeDictionaries, syncExtraDictionary, describeCounts, describeSyncState,
  buildIssueUrl, buildProposalClipboardText,
} from './jan-extra.js';
import {
  SHOP_AFFILIATE_CONFIG, AFFILIATE_NOTE, shopSearchLinks, buildSearchQuery, describeSearchQuery,
} from './shops.js';
import {
  chooseScanStrategy, isNativeShell, nativeScannerPlugin, loadVendorScanner, VENDOR_SCANNER_PATH,
} from './scanner.js';
import {
  createScanSession, resetScanSession, checkCooldown, markScanned, applyScan,
  scanLogCount, describeScanLog,
} from './scan-flow.js';
import { shouldOpenExternally, openInExternalBrowser } from './links.js';
import {
  compressImageFile, listPhotos, putPhoto, deletePhoto, clearPhotos, fetchProductImageInfo,
  resolveImageProxyUrl, normalizeProxyUrl, canUseImageProxy, sourceLabel,
} from './images.js';
import {
  THEME_MODES, normalizeTheme, resolveTheme, themeColor, themeLabel, readStoredTheme,
  writeStoredTheme, prefersDark,
} from './theme.js';

const $ = (id) => document.getElementById(id);

let state = loadState();
let ui = {
  tab: 'stock',
  mode: 'folders',       // 'folders' = 保管場所グリッド / 'items' = 画材グリッド
  folderId: 'all',
  query: '',
  category: 'all',
  status: 'all',
  maker: 'all',
  layout: state.settings.layout === 'list' ? 'list' : 'grid',
  searchOpen: false,
  editingId: null,
  moveIds: [],
  folderEditId: null,
  costKey: 'category',   // 画材費の内訳（カテゴリ / メーカー）
  selectMode: false,     // 複数選択モード
  selected: [],          // 選択中の画材ID
  formBrand: '',         // 辞書から入れたブランド（フォームに欄は出さない）
};
let pendingRestore = null; // 復元シートで待っている読み込み内容
let scanner = null; // html5-qrcode instance
let rafId = 0;

/* ---------------- JAN辞書（内蔵＋追加配信） ---------------- */
let extraEntries = [];          // 配信辞書の項目（キャッシュ由来も含む）
let mergedDict = JAN_DICTIONARY; // 画面・照合で使う合成済み辞書
let extraJanSet = new Set();     // 追加配信で増えたJAN
let mergedJanSet = new Set(JAN_DICTIONARY.map((d) => d.jan));
let dictSync = null;             // 直近の同期結果
let dictSyncing = false;
let selectedShopItem = null;
let proposeItem = null;

function safeStorage() {
  try {
    const s = window.localStorage;
    s.getItem('__probe__');
    return s;
  } catch {
    return null;
  }
}

/* ---------------- テーマ（自動 / ライト / ダーク） ---------------- */
let themeMediaBound = false;

/** 設定値（無ければ保存値）からテーマを決めて画面へ適用する */
function applyTheme() {
  const mode = normalizeTheme(state.settings.theme ?? readStoredTheme(safeStorage()));
  const resolved = resolveTheme(mode, prefersDark(window));
  document.documentElement.setAttribute('data-theme', resolved);
  // 描画前に読む値（別キー）も設定に合わせる（バックアップ復元後もずれない）
  writeStoredTheme(safeStorage(), mode);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', themeColor(resolved));
  const chips = $('themeChips');
  if (chips) {
    if (!chips.children.length) {
      chips.innerHTML = THEME_MODES.map((m) =>
        `<button class="fchip" data-theme-mode="${esc(m.id)}" aria-pressed="false">${esc(m.label)}</button>`).join('');
    }
    chips.querySelectorAll('[data-theme-mode]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.themeMode === mode));
    });
  }
  // 端末の設定が変わったとき（自動のときだけ見た目が変わる）
  if (!themeMediaBound) {
    themeMediaBound = true;
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme());
    } catch { /* 古いブラウザでは追従しない */ }
  }
  return resolved;
}

/** テーマを選んで保存する（再起動しても残る） */
function setTheme(mode) {
  const next = normalizeTheme(mode);
  state = { ...state, settings: { ...state.settings, theme: next } };
  writeStoredTheme(safeStorage(), next);
  save();
  applyTheme();
  render();
  toast(`表示：${themeLabel(next)}`);
}

/** 同期結果を辞書と画面に反映する */
function applyDictionarySync(result) {
  dictSync = result || null;
  extraEntries = Array.isArray(result?.items) ? result.items : [];
  const merged = mergeDictionaries(JAN_DICTIONARY, extraEntries);
  mergedDict = merged.items;
  extraJanSet = new Set(merged.extraJans);
  mergedJanSet = new Set(mergedDict.map((d) => d.jan));
  renderDictionaryState();
}

/** 設定・辞書シートの件数表示を更新 */
function renderDictionaryState() {
  const merged = mergeDictionaries(JAN_DICTIONARY, extraEntries);
  const info = $('dictInfo');
  if (info) info.textContent = `${describeCounts(merged)}・油絵具 ${mergedDict.filter((d) => d.category === 'oil').length}件`;
  const state = $('dictSyncState');
  if (state) state.textContent = describeSyncState(dictSync, { cachedCount: extraEntries.length });
  const btn = $('btnDictSync');
  if (btn) {
    btn.disabled = dictSyncing;
    btn.textContent = dictSyncing ? '更新中' : '辞書を更新';
  }
  if ($('sheetDict')?.classList.contains('open')) renderDictList($('dictQ').value);
}

/** jan-extra.json を取りに行って合成する（起動時・「辞書を更新」） */
async function syncDictionary({ announce = false } = {}) {
  if (dictSyncing) return;
  dictSyncing = true;
  renderDictionaryState();
  try {
    const result = await syncExtraDictionary({
      base: JAN_DICTIONARY, storage: safeStorage(),
      url: resolveDictionaryUrl({ native: isNativeShell(window) }),
    });
    applyDictionarySync(result);
    if (announce) {
      if (result.status === 'updated') {
        toast(result.items.length ? `辞書を更新（追加 ${result.items.length}件）` : '辞書は最新です');
      } else if (result.status === 'cached') {
        toast(`オフライン（保存済み 追加${result.items.length}件で動作）`);
      } else {
        toast('辞書を取得できません。内蔵辞書で動作します');
      }
    }
  } finally {
    dictSyncing = false;
    renderDictionaryState();
  }
}

/** 外部URLを開く（アプリ内ではSafari、ブラウザでは新規タブ。開けなければURLをコピー） */
async function openExternal(url) {
  const href = String(url == null ? '' : url).trim();
  if (!href) return false;
  if (await openInExternalBrowser(href)) return true;
  const opened = window.open(href, '_blank', 'noopener,noreferrer');
  if (!opened) {
    copyText(href);
    toast('リンクを開けません。URLをコピーしました');
    return false;
  }
  return true;
}

/** クリップボードへコピー（両方の手段を順に試す） */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* 下の execCommand 経路へ */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:-1000px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** 通販検索リンク（短いボタン1行） */
function renderShopLinks(node, item) {
  if (!node) return [];
  const links = shopSearchLinks(item, SHOP_AFFILIATE_CONFIG);
  node.innerHTML = links.map((l) =>
    `<a class="shop-link" data-shop="${esc(l.id)}" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`).join('');
  return links;
}

/** 編集シートの入力値から、通販・提案で使う画材1件を作る */
function formItem() {
  return {
    jan: $('fJan').value,
    name: $('fName').value,
    maker: $('fMaker').value,
    category: $('fCategoryInput').value,
    colorName: $('fColorName').value,
    colorCode: $('fColorCode').value,
    size: $('fSize').value,
  };
}

/** 編集シートの通販ボタンを入力に合わせて作り直す */
function refreshFormShopLinks() {
  const item = formItem();
  renderShopLinks($('shopLinks'), item);
  const q = buildSearchQuery(item);
  $('shopQuery').textContent = q ? '' : 'JANか商品名を入れると検索できます';
  updateProposeBox();
}

/** 辞書に無いJANのときだけ「辞書に提案」を出す */
function updateProposeBox() {
  const box = $('proposeBox');
  if (!box) return;
  const jan = normalizeJAN($('fJan').value);
  const known = mergedJanSet.has(jan);
  box.hidden = !(/^\d{13}$/.test(jan) && isValidJAN(jan) && !known);
}

/* ---------------- 写真（IndexedDBのBlobを表示用URLに） ---------------- */
const photoUrls = new Map(); // itemId -> objectURL
let photoCount = 0;
let pendingPhoto = null;     // { kind:'set', blob, url, width, height, bytes } | { kind:'delete' }

function setPhotoUrl(id, blob) {
  const prev = photoUrls.get(id);
  if (prev) URL.revokeObjectURL(prev);
  photoUrls.set(id, URL.createObjectURL(blob));
}
function dropPhotoUrl(id) {
  const prev = photoUrls.get(id);
  if (prev) URL.revokeObjectURL(prev);
  photoUrls.delete(id);
}
/** 起動時に保存済みの手元写真をまとめて読み込む */
async function preloadPhotos() {
  try {
    const rows = await listPhotos();
    for (const row of rows) if (row && row.id && row.blob) setPhotoUrl(row.id, row.blob);
    photoCount = rows.length;
    render();
  } catch (e) {
    console.warn('写真の読み込みに失敗', e);
  }
}

/* ---------------- サンプル（お試し用） ---------------- */
/** 0件のときに入れるサンプルの導線（初回起動・空の一覧・設定）。残り枠を超えるぶんは入れない */
function addSamples() {
  const q = itemQuota(state, state.settings);
  const remaining = q.unlimited ? Number.POSITIVE_INFINITY : Math.max(0, q.limit - q.used);
  if (remaining <= 0) { openProSheet('item'); return; }
  const { state: next, added } = mergeSampleItems(state, sampleItems(), { limit: remaining });
  if (!added) { toast('サンプルはもう入っています'); return; }
  state = next;
  writeSampleSeeded(safeStorage(), true);
  save();
  render();
  toast(`サンプルを${added}点入れました`);
}

/** 初回起動（0件・まだ入れたことがない）ときだけ、最初からサンプルが入った状態にする */
function seedSamplesOnFirstRun() {
  if (!shouldSeedSamples({ items: state.items, seeded: readSampleSeeded(safeStorage()) })) return;
  const { state: next, added } = mergeSampleItems(state, sampleItems());
  if (!added) return;
  state = next;
  writeSampleSeeded(safeStorage(), true);
  save();
  toast('サンプルを入れました（設定からも入れられます）');
}

/* ---------------- storage ---------------- */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return blankState();
    const next = importState(raw);
    // テーマは設定に無ければ端末の保存値（テーマだけ別キーにも持つ）
    if (!next.settings.theme) next.settings.theme = readStoredTheme(safeStorage());
    // 旧バージョンの絵文字入りデータを読み込み時に文字だけへ整え、そのまま保存し直す
    try { localStorage.setItem(STORAGE_KEY, exportState(next)); } catch { /* 容量不足等は無視 */ }
    return next;
  } catch (e) {
    console.warn('読み込み失敗', e);
    return blankState();
  }
}
function save() {
  state.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE_KEY, exportState(state));
  } catch (e) {
    toast('保存できませんでした（容量不足？）');
  }
}

/* ---------------- utils ---------------- */
let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
function folderOf(id) {
  return state.folders.find((f) => f.id === id) || { id, name: '未分類', color: '#5b6b7c' };
}
function statusMeta(id) {
  return STATUSES.find((s) => s.id === id) || STATUSES[1];
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- 色見本の色を推測 ---------------- */
// 色名に含まれる語から絵具の色を推測する（長い語を優先）
const COLOR_HINTS = [
  ['カドミウムレモン', '#f4cf3c'], ['カドミウムイエロー', '#f0b400'], ['カドミウムオレンジ', '#ef8b2c'],
  ['カドミウムレッド', '#c2302a'], ['ウルトラマリンバイオレット', '#4a4aa0'], ['ウルトラマリン', '#2f4fa8'],
  ['アリザリンクリムゾン', '#a3243c'], ['イエローオーカー', '#c99a3f'], ['ネープルスイエロー', '#eccf8a'],
  ['バーントシェンナ', '#9a4a30'], ['バーントアンバー', '#6a3a29'], ['ローシェンナ', '#b4683c'], ['ローアンバー', '#8a6440'],
  ['チタニウムホワイト', '#f8f8f5'], ['パーマネントホワイト', '#f8f8f5'], ['シルバーホワイト', '#f4f4f0'],
  ['アイボリーブラック', '#2b2b2b'], ['マースブラック', '#26262a'], ['ニュートラルグレー', '#8d949c'],
  ['プルシアンブルー', '#1d3a6b'], ['セルリアンブルー', '#3f8fc4'], ['コバルトブルー', '#2a5db0'],
  ['スカイブルー', '#7fb6dd'], ['ピロールレッド', '#b32a2a'], ['サップグリーン', '#2b5f3f'],
  ['レモンイエロー', '#f6d64a'], ['オリーブグリーン', '#6f7a3a'], ['バーントグリーン', '#54603a'],
  ['ホワイト', '#f8f8f5'], ['ブラック', '#23262b'], ['イエロー', '#f2c81e'], ['オレンジ', '#ee8a2b'],
  ['レッド', '#c0342c'], ['ピンク', '#e58aa0'], ['ローズ', '#e0798f'], ['マゼンタ', '#b1357a'],
  ['バイオレット', '#6b4b9e'], ['パープル', '#6b4b9e'], ['ブルー', '#2f4fa8'], ['ネイビー', '#22355e'],
  ['シアン', '#2f9fb5'], ['ターコイズ', '#2f9fb5'], ['グリーン', '#2f7d4f'], ['エメラルド', '#2f9e6b'],
  ['ビリジアン', '#2f7d4f'], ['オリーブ', '#6f7a3a'], ['ブラウン', '#7a5230'], ['セピア', '#5a4632'],
  ['テラコッタ', '#b6603f'], ['アンバー', '#8a6440'], ['シェンナ', '#b4683c'], ['オーカー', '#c99a3f'],
  ['ゴールド', '#c9a227'], ['シルバー', '#c6ccd2'], ['グレー', '#8d949c'], ['アイボリー', '#efe6cf'],
  ['クリーム', '#f2e7c9'], ['ベージュ', '#e3d6bf'], ['ラベンダー', '#c3b4dd'], ['ミント', '#a9d9c3'],
  ['ワイン', '#6d2a3a'], ['ボルドー', '#5e2230'], ['スカーレット', '#cf3a27'], ['バーミリオン', '#d1482c'],
  ['レモン', '#f6d64a'], ['ゴールデン', '#dfa72c'], ['ネープルス', '#eccf8a'], ['山吹', '#e8b23a'],
  ['白', '#f8f8f5'], ['黒', '#23262b'], ['灰', '#8d949c'], ['銀', '#c6ccd2'], ['金', '#c9a227'],
  ['黄', '#f2c81e'], ['橙', '#ee8a2b'], ['朱', '#d1482c'], ['赤', '#c0342c'], ['桃', '#e58aa0'],
  ['紫', '#6b4b9e'], ['青', '#2f4fa8'], ['紺', '#1d3a6b'], ['緑', '#2f7d4f'], ['茶', '#7a5230'],
].sort((a, b) => b[0].length - a[0].length);

const CATEGORY_COLOR = {
  oil: '#c0703f', acrylic: '#3d8f8f', watercolor: '#5a86c4', medium: '#9a8f7a',
  brush: '#8a6b4f', canvas: '#d8cbb4', paper: '#e4dccb', other: '#9aa3ad',
};

// 絵の具はチューブ、それ以外は道具の形で棚に並べる
const GLYPH = {
  brush: { icon: 'i-brush', color: '#8a6b4f' },
  canvas: { icon: 'i-canvas', color: '#a88a5e' },
  paper: { icon: 'i-paper', color: '#8894a1' },
};

function guessColor(item) {
  const hay = [item.colorName, item.name].filter(Boolean).join(' ');
  const hit = COLOR_HINTS.find(([key]) => hay.includes(key));
  if (hit) return hit[1];
  return CATEGORY_COLOR[item.category] || CATEGORY_COLOR.other;
}
function shade(hex, amt = -0.13) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return hex;
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.max(0, Math.min(255, Math.round(v + 255 * amt))))
    .map((v) => v.toString(16).padStart(2, '0'));
  return `#${ch.join('')}`;
}
function rgba(hex, a) {
  const n = parseInt(String(hex).slice(1), 16);
  if (!Number.isFinite(n)) return `rgba(91,107,124,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
/** タイル用の短い名前（先頭のメーカー名の重複を落とす） */
function displayName(item) {
  const name = String(item.name || '').trim();
  const maker = itemMaker(item);
  if (maker && name !== maker) {
    const stripped = name.replace(new RegExp(`^${maker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s　]*`), '').trim();
    if (stripped) return stripped;
  }
  return name;
}

/* ---------------- rendering ---------------- */
function render() {
  applyTheme();
  renderHeader();
  renderTools();
  renderCrumb();
  const folderMode = isFolderMode();
  $('folderGrid').hidden = !folderMode;
  $('subFolderRow').hidden = folderMode;
  $('itemList').hidden = folderMode;
  if (folderMode) { renderFolderGrid(); $('subFolderRow').innerHTML = ''; }
  else {
    renderSubFolders();
    renderTilesInto($('itemList'), currentList(), { group: state.settings.sort === 'maker', emptyKey: 'items' });
  }
  if (ui.tab === 'swatch') renderSwatches();
  renderShopping();
  renderFolders();
  renderSettings();
  renderFilterSheet();
  renderSelectBar();
  document.querySelectorAll('#tabbar button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab));
  });
  for (const t of ['stock', 'swatch', 'shopping', 'folders', 'settings']) $(`view-${t}`).hidden = t !== ui.tab;
  $('tools').hidden = ui.tab !== 'stock';
  $('crumb').hidden = ui.tab !== 'stock';
  $('searchRow').hidden = !ui.searchOpen || ui.tab !== 'stock';
  $('btnAdd').style.visibility = ui.tab === 'stock' || ui.tab === 'shopping' ? 'visible' : 'hidden';
}

function isFolderMode() {
  return ui.tab === 'stock' && ui.mode === 'folders';
}

function renderHeader() {
  const s = summarize(state.items);
  $('hdrTotal').textContent = `全${s.kinds}種`;
}

function renderTools() {
  $('btnFolders').setAttribute('aria-pressed', String(isFolderMode()));
  const searchOpen = ui.searchOpen && ui.tab === 'stock';
  $('btnSearch').setAttribute('aria-pressed', String(searchOpen));
  const filtering = ui.category !== 'all' || ui.status !== 'all' || ui.maker !== 'all';
  $('btnFilter').setAttribute('aria-pressed', String(filtering));
  const listMode = ui.layout === 'list';
  $('layoutIcon').querySelector('use').setAttribute('href', listMode ? '#i-grid' : '#i-list');
  $('btnLayout').setAttribute('aria-label', listMode ? 'グリッド表示に切り替え' : 'リスト表示に切り替え');
  $('btnLayout').hidden = isFolderMode();
  // 複数選択は一覧（画材）でだけ使う
  $('btnSelect').hidden = isFolderMode();
  $('btnSelect').setAttribute('aria-pressed', String(ui.selectMode));
  $('btnSelect').setAttribute('aria-label', ui.selectMode ? '選択をやめる' : '複数選択');
}

function renderCrumb() {
  const folderMode = isFolderMode();
  const crumb = $('crumb');
  crumb.classList.toggle('root', folderMode);
  $('crumbName').textContent = folderMode
    ? ''
    : (ui.folderId === 'all' ? 'すべて' : folderPathLabel(state.folders, ui.folderId, ' › '));
  $('btnUp').disabled = folderMode;
  // 残り枠は数字だけ（例: 12 / 100点）
  const q = itemQuota(state, state.settings);
  $('quotaNote').textContent = describeQuota(q);
  $('quotaNote').classList.toggle('tight', isQuotaTight(q));
}

/** 上へ: 子フォルダなら親へ、トップのフォルダなら保管場所へ */
function goUp() {
  if (isFolderMode()) return;
  const parent = ui.folderId === 'all' ? '' : folderParentId(folderOf(ui.folderId));
  if (parent) {
    ui.folderId = parent;
    ui.mode = 'items';
  } else {
    ui.mode = 'folders';
    ui.folderId = 'all';
  }
  render();
}

/** 保管場所フォルダのグリッド（＋すべて）。トップのフォルダだけを並べ、中は子フォルダの行で辿る */
function renderFolderGrid() {
  const counts = countByFolderDeep(state.folders, state.items);
  const roots = folderChildren(state.folders, '');
  const tiles = [{ id: 'all', name: 'すべて', all: true, count: counts.all_total || 0 }]
    .concat(roots.map((f) => ({
      ...f,
      count: counts[f.id] || 0,
      children: folderChildren(state.folders, f.id).length,
    })));
  $('folderGrid').innerHTML = tiles.map((t) => {
    const color = t.all ? '#2f6fd0' : (t.color || '#5b6b7c');
    return `
    <button class="ftile${t.all ? ' is-all' : ''}" data-folder="${esc(t.id)}" style="--c:${esc(color)};--cs:${rgba(color, t.all ? 0.1 : 0.13)}">
      <span class="fico">
        <svg class="ic" aria-hidden="true"><use href="#${t.all ? 'i-grid' : 'i-folder-solid'}"/></svg>
        <span class="fcnt">${t.count}</span>
        ${t.children ? `<span class="fsub">子${t.children}</span>` : ''}
      </span>
      <span class="fname">${esc(t.name)}</span>
    </button>`;
  }).join('');
}

/** いま開いているフォルダの子フォルダ（タップで中へ、末尾の＋で作成） */
function renderSubFolders() {
  const row = $('subFolderRow');
  if (ui.tab !== 'stock' || ui.mode !== 'items' || ui.folderId === 'all') {
    row.hidden = true;
    row.innerHTML = '';
    return;
  }
  const kids = folderChildren(state.folders, ui.folderId);
  const counts = countByFolderDeep(state.folders, state.items);
  const chips = kids.map((f) =>
    `<button class="pill sub" data-goto-folder="${esc(f.id)}">${esc(f.name)}<b>${counts[f.id] || 0}</b></button>`).join('');
  row.innerHTML = chips + `<button class="pill sub add" data-add-child="${esc(ui.folderId)}" aria-label="子フォルダを追加">＋</button>`;
  row.hidden = false;
}

/** 色見本アルバムに並べる画材（色名か写真があるもの） */
function swatchItems() {
  return sortItems(state.items.filter((it) => it.colorName || photoUrls.has(it.id) || normalizeImageUrl(it.imageUrl)), 'maker');
}

/** 色見本1枚（写真があれば写真、無ければ色名から推測した色） */
function swatchTile(it) {
  const src = photoUrls.get(it.id) || normalizeImageUrl(it.imageUrl);
  const color = guessColor(it);
  const st = statusMeta(it.status);
  const isEmpty = isEmptyStock(it);
  const name = it.colorName || displayName(it);
  const sub = itemMaker(it) || folderOf(it.folderId).name;
  return `
  <button class="swt${isEmpty ? ' item-card--empty' : ''}" data-edit="${esc(it.id)}" data-empty="${isEmpty ? '1' : '0'}" aria-label="${esc(`${name} ${Number(it.qty) || 0}点`)}">
    <span class="swc" style="--c:${esc(color)}">
      ${src ? `<img class="swimg" src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '<span class="swfill"></span>'}
      <span class="swq">${Number(it.qty) || 0}</span>
    </span>
    <span class="swn">${esc(name)}</span>
    <span class="swm">${esc(sub)}<span class="badge ${st.tone}">${esc(st.short || st.label)}</span></span>
  </button>`;
}

function renderSwatches() {
  const list = swatchItems();
  if (!list.length) {
    $('swatchGrid').innerHTML = '<div class="empty"><b>色見本はまだありません</b>画材を編集して、色名か写真を入れると並びます</div>';
    return;
  }
  $('swatchGrid').innerHTML = `<div class="sgrid">${list.map(swatchTile).join('')}</div>`;
}

/** アイテムの実物画像（手元写真 → 画像URL の順。無ければ空文字でアイコン表示） */
function shelfImage(it) {
  const src = photoUrls.get(it.id) || normalizeImageUrl(it.imageUrl);
  if (!src) return '';
  return `<img class="shelfimg" src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
}

// 画像の読み込みに失敗したら自動でチューブSVG／アイコン表示へ戻す（インライン属性は使わない）
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!img || img.tagName !== 'IMG') return;
  if (img.classList.contains('shelfimg') || img.classList.contains('previewimg') || img.classList.contains('swimg')) img.classList.add('imgfail');
}, true);

/** 画材タイル1枚（在庫切れはグレー表示。操作は通常どおり） */
function itemTile(it) {
  const st = statusMeta(it.status);
  const isEmpty = isEmptyStock(it);
  const out = isEmpty;
  const low = !out && st.id === 'low';
  const glyph = GLYPH[it.category];
  const base = glyph ? glyph.color : guessColor(it);
  const icon = glyph ? glyph.icon : 'i-tube';
  const f = folderOf(it.folderId);
  const dot = ui.folderId === 'all' ? `<span class="fdot" style="background:${esc(f.color)}"></span>` : '';
  const label = `${displayName(it)} ${Number(it.qty) || 0}点${out ? ' 要補充' : low ? ' 少なめ' : ''}`;
  const selected = ui.selectMode && isSelected(ui.selected, it.id);
  const selectAttrs = ui.selectMode
    ? ` data-select="${esc(it.id)}" aria-pressed="${selected ? 'true' : 'false'}"`
    : ` data-edit="${esc(it.id)}"`;
  return `
  <button class="tile${low ? ' low' : ''}${out ? ' out' : ''}${isEmpty ? ' item-card--empty' : ''}${ui.selectMode ? ' selecting' : ''}${selected ? ' sel' : ''}" data-empty="${isEmpty ? '1' : '0'}"${selectAttrs} aria-label="${esc(label)}" style="--c:${esc(base)};--c2:${esc(shade(base))};--cs:${rgba(base, 0.1)}">
    <span class="sw">
      ${dot}<span class="qbadge">${Number(it.qty) || 0}</span>
      <svg class="inh" aria-hidden="true"><use href="#${icon}"/></svg>
      ${shelfImage(it)}
      ${ui.selectMode ? '<span class="selmark" aria-hidden="true"></span>' : ''}
    </span>
    <span class="tname">${esc(displayName(it))}</span>
  </button>`;
}

/** 1件＝2行の高密度リスト行（ステッパー付き） */
function itemRow(it, opts = {}) {
  const st = statusMeta(it.status);
  const isEmpty = isEmptyStock(it);
  const f = folderOf(it.folderId);
  const meta = [itemMaker(it), it.colorName, it.size, it.colorCode].filter(Boolean).map(esc).join(' ・ ');
  const glyph = GLYPH[it.category];
  const thumbColor = glyph ? glyph.color : guessColor(it);
  const thumbIcon = glyph ? glyph.icon : 'i-tube';
  const first = opts.shopChip
    ? `<button class="folder-tag shop-chip" data-shop-for="${esc(it.id)}">通販</button>`
    : `<button class="folder-tag" data-move="${esc(it.id)}">${esc(f.name)} ▾</button>`;
  const selected = ui.selectMode && isSelected(ui.selected, it.id);
  const selectAttrs = ui.selectMode ? ` data-select="${esc(it.id)}" aria-pressed="${selected ? 'true' : 'false'}"` : '';
  return `
  <article class="item${isEmpty ? ' item-card--empty' : ''}${ui.selectMode ? ' selecting' : ''}${selected ? ' sel' : ''}" data-empty="${isEmpty ? '1' : '0'}" data-id="${esc(it.id)}"${selectAttrs}>
    <span class="thumb"><svg class="ic" aria-hidden="true" style="color:${esc(thumbColor)}"><use href="#${thumbIcon}"/></svg>${shelfImage(it)}${ui.selectMode ? '<span class="selmark" aria-hidden="true"></span>' : ''}</span>
    <div class="it-main">
      <h3 class="it-name" data-edit="${esc(it.id)}" title="タップで編集">${esc(displayName(it))}</h3>
      <div class="it-sub">
        ${first}
        <span class="badge ${st.tone}" title="${esc(st.label)}">${esc(st.short || st.label)}</span>
        ${meta ? `<span class="it-meta">${meta}</span>` : ''}
      </div>
    </div>
    <div class="it-side">
      <button class="step" data-step="-1" data-id="${esc(it.id)}" aria-label="1減らす">−</button>
      <span class="qty">${Number(it.qty) || 0}<small>点</small></span>
      <button class="step" data-step="1" data-id="${esc(it.id)}" aria-label="1増やす">＋</button>
      <button class="icon-btn" data-edit="${esc(it.id)}" aria-label="編集"><svg class="pencil" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4l5 5-9.5 9.5L4 20l1.5-6.5z"/><path d="M13 6l5 5"/></svg></button>
    </div>
  </article>`;
}

/** アイテム群をグリッド／リストで描画（メーカー見出し対応） */
function renderTilesInto(el, items, opts = {}) {
  if (!items.length) {
    el.innerHTML = opts.emptyKey === 'shopping'
      ? '<div class="empty"><b>補充はありません</b>残りわずか・使い切りがここに集まります</div>'
      : (state.items.length
        ? '<div class="empty"><b>見つかりません</b>検索や絞込を変えてみてください</div>'
        : '<div class="empty"><b>まだ画材がありません</b>右下の＋ か 読取 から登録できます<button class="btn mini wide" data-add-samples>サンプルを入れる</button></div>');
    return;
  }
  const blocks = opts.group ? groupByMaker(items) : [{ maker: '', items }];
  el.innerHTML = blocks.map((g) => {
    const head = opts.group
      ? `<div class="mhead"><span>${esc(g.maker || '未設定')}</span><b>${g.items.length}</b></div>`
      : '';
    const body = (opts.forceList || ui.layout === 'list')
      ? g.items.map((it) => itemRow(it, opts)).join('')
      : `<div class="tgrid">${g.items.map(itemTile).join('')}</div>`;
    return head + body;
  }).join('');
}

function renderShopping() {
  renderTilesInto($('shoppingList'), computeShoppingList(state.items), {
    group: false, emptyKey: 'shopping', shopChip: true, forceList: true,
  });
}

function currentList() {
  // 親フォルダを開くと、配下のフォルダの画材もまとめて見る（直感的な挙動）
  const scope = ui.folderId && ui.folderId !== 'all' ? folderSubtreeIds(state.folders, ui.folderId) : null;
  return sortItems(filterItems(state.items, {
    query: ui.query, folderId: ui.folderId, folderIds: scope,
    category: ui.category, status: ui.status, maker: ui.maker,
  }), state.settings.sort);
}

function renderFolders() {
  const counts = countByFolderDeep(state.folders, state.items);
  $('folderList').innerHTML = folderTree(state.folders).map(({ folder: f, depth }) => {
    const siblings = folderChildren(state.folders, folderParentId(f));
    const i = siblings.findIndex((x) => x.id === f.id);
    return `
    <div class="folder-row" data-fid="${esc(f.id)}" style="--d:${depth}">
      <span class="folder-dot" style="background:${esc(f.color)}"></span>
      <span class="name">${esc(f.name)}<span class="cnt"> ・${counts[f.id] || 0}件</span></span>
      <button data-up="${esc(f.id)}" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
      <button data-down="${esc(f.id)}" ${i === siblings.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
      <button data-fedit="${esc(f.id)}" aria-label="編集"><svg class="pencil" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4l5 5-9.5 9.5L4 20l1.5-6.5z"/><path d="M13 6l5 5"/></svg></button>
    </div>`;
  }).join('');
}

/** 複数選択の操作バー（件数・全選択・移動・やめる） */
function renderSelectBar() {
  const bar = $('selBar');
  const on = ui.selectMode && ui.tab === 'stock';
  bar.hidden = !on;
  document.body.classList.toggle('selecting', on);
  if (!on) return;
  ui.selected = pruneSelection(ui.selected, state.items);
  const list = currentList();
  const allSelected = list.length > 0 && list.every((it) => isSelected(ui.selected, it.id));
  $('selCount').textContent = `${ui.selected.length}件`;
  $('btnSelAll').textContent = allSelected ? '解除' : '全選択';
  $('btnSelMove').disabled = ui.selected.length === 0;
}

function renderSettings() {
  const s = summarize(state.items);
  $('stKinds').textContent = s.kinds;
  $('stQty').textContent = s.qty;
  $('stRestock').textContent = s.needRestock;
  const appId = String(state.settings.rakutenAppId || '');
  const accessKey = String(state.settings.rakutenAccessKey || '');
  const proxyUrl = String(state.settings.imageProxyUrl || '');
  if (document.activeElement !== $('fRakuten')) $('fRakuten').value = appId;
  if (document.activeElement !== $('fAccessKey')) $('fAccessKey').value = accessKey;
  if (document.activeElement !== $('fProxyUrl')) $('fProxyUrl').value = proxyUrl;
  // 中継サーバーがあれば設定ゼロで使える。無ければ自分のアプリIDが要る
  if (canUseImageProxy(state.settings)) {
    $('rakutenState').textContent = appId
      ? 'JANで商品画像を取得できます（中継サーバー経由・自分のアプリIDは予備）'
      : 'JANで商品画像を取得できます（設定は不要です）';
  } else if (appId && accessKey) {
    $('rakutenState').textContent = `JANで商品画像を取得できます（自分の認証情報・末尾 ${appId.slice(-4)}）`;
  } else {
    $('rakutenState').textContent = 'JANからの画像取得は未設定です（下の設定から）';
  }
  $('backupNote').textContent = `機種変更・データ消失対策。書き出したファイルは Google ドライブ等に保存してください。手元写真は端末内に保存され、JSONには含まれません（${photoCount}枚）。`;
  renderPlan();
  renderCost();
  renderDictionaryState();
}

/* ---------------- プラン（無料上限・Proプレビュー） ---------------- */
function yen(n) {
  return Math.max(0, Math.round(Number(n) || 0)).toLocaleString('ja-JP');
}

function renderPlan() {
  const pro = isPro(state.settings);
  const q = itemQuota(state, state.settings);
  const fq = folderQuota(state, state.settings);
  // フォルダは既定4つ（無料上限3）で始まるので、個数だけ出す（4 / 3つ と書かない）
  $('proState').textContent = `${pro ? 'Pro（プレビュー）' : '無料'} ・ 画材 ${describeQuota(q)} ・ フォルダ ${fq.used}つ`;
  $('proBenefits').innerHTML = PRO_BENEFITS.map((b) => `<span class="pro-chip">${esc(b.label)}</span>`).join('');
  $('btnProToggle').textContent = pro ? 'Proプレビューを終了' : 'Proプレビューを試す';
}

/** Proの案内シート（上限・Pro機能のどちらからでも同じ画面） */
function openProSheet(what = 'item') {
  const lead = {
    item: `無料は${FREE_ITEM_LIMIT}点まで`,
    folder: `無料はフォルダ${FREE_FOLDER_LIMIT}つまで`,
    swatch: '色見本アルバムはPro',
    cost: '画材費とCSVはPro',
  }[what] || 'Proで全部使えます';
  $('proLead').textContent = lead;
  $('proQuota').textContent = what === 'folder'
    ? `フォルダ ${folderQuota(state, state.settings).used}つ`
    : `画材 ${describeQuota(itemQuota(state, state.settings))}`;
  $('proSheetBenefits').innerHTML = PRO_BENEFITS.map((b) => `<span class="pro-chip">${esc(b.label)}</span>`).join('');
  $('btnProStart').hidden = isPro(state.settings);
  openSheet('sheetPro');
}

/** Pro機能かどうかを確かめ、使えなければ案内を出す */
function requirePro(feature) {
  if (canUseFeature(state.settings, feature)) return true;
  openProSheet(feature);
  return false;
}

function setProPreview(on) {
  state = { ...state, settings: { ...state.settings, proPreview: Boolean(on) } };
  save();
  closeSheet('sheetPro');
  render();
  toast(on ? 'Proプレビューを有効にしました' : 'Proプレビューを終了しました');
}

$('btnProToggle').addEventListener('click', () => setProPreview(!isPro(state.settings)));
$('btnProStart').addEventListener('click', () => setProPreview(true));
$('btnCostPro').addEventListener('click', () => openProSheet('cost'));

/* ---------------- 画材費（2軸集計 ＋ CSV） ---------------- */
function renderCost() {
  const pro = isPro(state.settings);
  $('costBody').hidden = !pro;
  $('costLock').hidden = pro;
  if (!pro) return;
  const cost = costSummary(state.items);
  $('costStock').textContent = yen(cost.stockValue);
  $('costRecorded').textContent = yen(cost.recordedTotal);
  $('costNote').textContent = `単価入力 ${cost.pricedCount} / ${cost.kinds}点 ・ 未入力 ${cost.unpricedCount}点`;
  renderCostBars(cost);
}

function renderCostBars(cost) {
  const key = ui.costKey === 'maker' ? 'maker' : 'category';
  $('costTabs').querySelectorAll('[data-costkey]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.costkey === key));
  });
  const list = key === 'maker' ? cost.byMaker : cost.byCategory;
  const { rows, rest } = costRows(list, 6);
  if (!rows.length) {
    $('costBars').innerHTML = '<p class="micro" style="margin-top:8px">単価を入れると内訳が出ます</p>';
    return;
  }
  const max = Math.max(1, ...rows.map((r) => Number(r.value) || 0));
  const bars = rows.map((r) => `
    <div class="bar">
      <span class="bl">${esc(r.label)}</span>
      <span class="bt"><span class="bf" style="width:${Math.max(2, Math.round(((Number(r.value) || 0) / max) * 100))}%"></span></span>
      <span class="bv">${yen(r.value)}</span>
    </div>`).join('');
  const restRow = rest
    ? `<div class="bar rest"><span class="bl">ほか ${rest.count}件</span><span class="bt"></span><span class="bv">${yen(rest.value)}</span></div>`
    : '';
  $('costBars').innerHTML = bars + restRow;
}

$('costTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-costkey]');
  if (!b) return;
  ui.costKey = b.dataset.costkey === 'maker' ? 'maker' : 'category';
  renderCost();
});

/** 画材一覧をCSV（BOM付きUTF-8・Excelでそのまま開ける）で保存 */
function downloadCsv() {
  if (!requirePro('cost')) return;
  const text = buildItemsCsvText(sortItems(state.items, 'maker'), state.folders);
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `art-supply-${stamp}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast(`${state.items.length}件をCSVで保存しました`);
}

$('btnCsv').addEventListener('click', downloadCsv);

/* ---------------- 画像取得の設定（中継サーバーURL・楽天アプリID） ---------------- */
$('btnSaveImageSettings').addEventListener('click', () => {
  const appId = $('fRakuten').value.trim().replace(/\s+/g, '');
  const rakutenAccessKey = $('fAccessKey').value.trim().replace(/\s+/g, '');
  const rawProxy = $('fProxyUrl').value.trim();
  const imageProxyUrl = normalizeProxyUrl(rawProxy);
  if (rawProxy && !imageProxyUrl) { toast('中継サーバーURLは https:// から始まる形で入れてください'); return; }
  state = { ...state, settings: { ...state.settings, rakutenAppId: appId, rakutenAccessKey, imageProxyUrl } };
  save();
  render();
  toast('画像取得の設定を保存しました');
});

/** JANコードから商品画像を取得して「画像URL」に入れる（中継サーバー経由。楽天・Yahoo!どちらでも） */
$('btnFetchImage').addEventListener('click', async () => {
  const jan = normalizeJAN($('fJan').value);
  if (!/^\d{13}$/.test(jan)) { toast('JANを13桁で入力してください'); return; }
  const btn = $('btnFetchImage');
  btn.disabled = true;
  btn.textContent = '取得しています…';
  try {
    const info = await fetchProductImageInfo(jan, {
      appId: String(state.settings.rakutenAppId || '').trim(),
      accessKey: String(state.settings.rakutenAccessKey || '').trim(),
      proxyUrl: resolveImageProxyUrl(state.settings),
    });
    $('fImageUrl').value = info.imageUrl;
    // どの商品に当たったか（別の商品の画像が付かないよう、商品名と取得元を出す）
    const name = info.itemName.length > 32 ? `${info.itemName.slice(0, 32)}…` : info.itemName;
    const from = sourceLabel(info.source);
    $('imageUrlHint').textContent = name
      ? `${name}${from ? `（${from}）` : ''}の画像をセットしました`
      : '商品画像をセットしました（保存で確定）';
    renderPhotoPreview();
    toast('商品画像をセットしました（保存で確定）');
  } catch (err) {
    toast(err.message || '画像を取得できませんでした');
  } finally {
    btn.disabled = false;
    btn.textContent = '画像を取得';
  }
});

/* ---------------- 絞込・並替 ---------------- */
function chip(kind, value, label, active) {
  return `<button class="fchip" data-${kind}="${esc(value)}" aria-pressed="${active ? 'true' : 'false'}">${esc(label)}</button>`;
}
function renderFilterSheet() {
  const makers = listMakers(state.items);
  const hasNone = state.items.some((it) => !itemMaker(it));
  if (ui.maker !== 'all' && (ui.maker === MAKER_NONE ? !hasNone : !makers.includes(ui.maker))) ui.maker = 'all';

  $('makerChips').innerHTML = chip('maker', 'all', 'すべて', ui.maker === 'all')
    + makers.map((m) => chip('maker', m, m, ui.maker === m)).join('')
    + (hasNone ? chip('maker', MAKER_NONE, '未設定', ui.maker === MAKER_NONE) : '');
  $('catChips').innerHTML = chip('cat', 'all', 'すべて', ui.category === 'all')
    + CATEGORIES.map((c) => chip('cat', c.id, c.label, ui.category === c.id)).join('');
  $('statusChips').innerHTML = chip('status', 'all', 'すべて', ui.status === 'all')
    + STATUSES.map((s) => chip('status', s.id, s.short || s.label, ui.status === s.id)).join('');

  $('sortChips').innerHTML = SORT_MODES.map((m) =>
    `<button class="fchip" data-sort="${esc(m.id)}" aria-pressed="${state.settings.sort === m.id ? 'true' : 'false'}">${esc(m.label.replace(/^並び：/, ''))}</button>`).join('');
}

$('sheetFilter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-maker],[data-cat],[data-status]');
  if (!b) return;
  if (b.dataset.maker !== undefined) ui.maker = b.dataset.maker;
  if (b.dataset.cat !== undefined) ui.category = b.dataset.cat;
  if (b.dataset.status !== undefined) ui.status = b.dataset.status;
  if (ui.mode === 'folders') { ui.mode = 'items'; ui.folderId = 'all'; }
  render();
});
$('sheetSort').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sort]');
  if (!b) return;
  state = { ...state, settings: { ...state.settings, sort: b.dataset.sort } };
  save();
  closeSheet('sheetSort');
  render();
});

/* ---------------- ツールバー・ナビ ---------------- */
$('btnFolders').addEventListener('click', () => {
  ui.mode = 'folders';
  ui.folderId = 'all';
  ui.tab = 'stock';
  exitSelect();
  render();
});
$('btnHome').addEventListener('click', () => {
  ui.mode = 'folders';
  ui.folderId = 'all';
  ui.tab = 'stock';
  exitSelect();
  render();
});
$('btnUp').addEventListener('click', () => goUp());
$('btnSearch').addEventListener('click', () => {
  ui.searchOpen = !ui.searchOpen;
  render();
  if (ui.searchOpen) setTimeout(() => $('q').focus({ preventScroll: true }), 30);
});
$('btnSearchClear').addEventListener('click', () => {
  $('q').value = '';
  ui.query = '';
  ui.searchOpen = false;
  render();
});
$('q').addEventListener('input', (e) => {
  ui.query = e.target.value;
  if (ui.query && ui.mode === 'folders') { ui.mode = 'items'; ui.folderId = 'all'; }
  render();
});
$('btnFilter').addEventListener('click', () => { renderFilterSheet(); openSheet('sheetFilter'); });
$('btnSort').addEventListener('click', () => { renderFilterSheet(); openSheet('sheetSort'); });
$('btnLayout').addEventListener('click', () => {
  ui.layout = ui.layout === 'list' ? 'grid' : 'list';
  state = { ...state, settings: { ...state.settings, layout: ui.layout } };
  save();
  render();
});

$('tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  const tab = b.dataset.tab;
  // 色見本アルバムはPro（無料では案内を出して、いまのタブに留まる）
  if (tab === 'swatch' && !requirePro('swatch')) return;
  ui.tab = tab;
  if (tab !== 'stock') exitSelect();
  stopScanner();
  render();
  window.scrollTo({ top: 0 });
});

$('folderGrid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-folder]');
  if (!b) return;
  ui.folderId = b.dataset.folder;
  ui.mode = 'items';
  ui.tab = 'stock';
  exitSelect();
  render();
  window.scrollTo({ top: 0 });
});

/* ---------------- 複数選択（一括移動） ---------------- */
function exitSelect() {
  ui.selectMode = false;
  ui.selected = [];
}
$('btnSelect').addEventListener('click', () => {
  if (ui.selectMode) { exitSelect(); render(); return; }
  if (isFolderMode()) { ui.mode = 'items'; ui.folderId = 'all'; }
  ui.selectMode = true;
  ui.selected = [];
  render();
  toast('移動する画材を選んでください');
});
$('btnSelCancel').addEventListener('click', () => { exitSelect(); render(); });
$('btnSelAll').addEventListener('click', () => {
  const list = currentList();
  const allSelected = list.length > 0 && list.every((it) => isSelected(ui.selected, it.id));
  ui.selected = allSelected ? [] : selectAllIds(list);
  render();
});
$('btnSelMove').addEventListener('click', () => {
  if (!ui.selected.length) return;
  openMoveSheet(ui.selected);
});

/* ---------------- テーマの切替 ---------------- */
$('themeChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme-mode]');
  if (!b) return;
  setTheme(b.dataset.themeMode);
});

/* ---------------- アイテム操作 ---------------- */
document.addEventListener('click', (e) => {
  // 子フォルダのチップ（タップで中へ）
  const goto = e.target.closest('[data-goto-folder]');
  if (goto) { ui.folderId = goto.dataset.gotoFolder; ui.mode = 'items'; exitSelect(); render(); return; }
  // 子フォルダを作る
  const addChild = e.target.closest('[data-add-child]');
  if (addChild) { addFolderAt(addChild.dataset.addChild); return; }
  // 選択モード中は、タップで選択の切り替えだけ（編集・増減は開けない）
  if (ui.selectMode) {
    const sel = e.target.closest('[data-select]');
    if (sel) {
      ui.selected = toggleSelection(ui.selected, sel.dataset.select);
      render();
      return;
    }
  }
  const step = e.target.closest('[data-step]');
  if (step) {
    const it = state.items.find((i) => i.id === step.dataset.id);
    if (!it) return;
    const delta = Number(step.dataset.step) || 0;
    // 買い足し（＋）は、単価があれば購入ログにも残す（画材費の「記録済み」に積まれる）
    const next = adjustStock(delta > 0 ? recordPurchase(it, delta) : it, delta);
    state = upsertItem(state, next);
    save(); render();
    if (next.qty === 0) toast('使い切りました。補充リストに入れています');
    return;
  }
  const edit = e.target.closest('[data-edit]');
  if (edit) { openItemSheet(edit.dataset.edit); return; }
  const mv = e.target.closest('[data-move]');
  if (mv) { openMoveSheet([mv.dataset.move]); return; }
  const shopBtn = e.target.closest('[data-shop-for]');
  if (shopBtn) {
    const item = state.items.find((i) => i.id === shopBtn.dataset.shopFor);
    if (item) openShopSheet(item);
    return;
  }
});

function openItemSheet(id, preset = {}) {
  const it = id ? state.items.find((i) => i.id === id) : null;
  // 新規登録だけ無料上限を見る（既存の画材は点数が上限を超えていても編集できる）
  if (!it && !canAddItem(state, state.settings).ok) { openProSheet('item'); return; }
  ui.editingId = it ? it.id : null;
  $('sheetItemTitle').firstChild.textContent = it ? '画材を編集' : '画材を追加';
  const data = it || createItem({ folderId: ui.folderId === 'all' ? state.folders[0].id : ui.folderId, ...preset });
  $('fName').value = data.name || '';
  $('fMaker').value = data.maker || '';
  $('fCategoryInput').innerHTML = CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
  $('fCategoryInput').value = data.category;
  $('fColorName').value = data.colorName || '';
  $('fColorCode').value = data.colorCode || '';
  $('fSize').value = data.size || '';
  $('fQty').value = data.qty ?? 1;
  $('fStatusInput').innerHTML = STATUSES.map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
  $('fStatusInput').value = data.status;
  // 保管場所は階層をインデントで見せる（値はIDのまま）
  $('fFolderInput').innerHTML = folderOptions(state.folders, { noneLabel: null })
    .map((o) => `<option value="${esc(o.id)}">${'　'.repeat(o.depth)}${esc(o.label)}</option>`).join('');
  $('fFolderInput').value = data.folderId;
  $('fJan').value = data.jan || '';
  ui.formBrand = data.brand || '';
  $('fShop').value = data.shop || '';
  $('fPrice').value = data.price ?? '';
  $('fMemo').value = data.memo || '';
  $('fImageUrl').value = (it && it.imageUrl) || '';
  $('imageUrlHint').textContent = '画像URLを貼り付け';
  if (pendingPhoto && pendingPhoto.url) URL.revokeObjectURL(pendingPhoto.url);
  pendingPhoto = null;
  $('photoHint').textContent = '端末内に保存（外部送信なし）';
  renderPhotoPreview();
  $('makerList').innerHTML = [...new Set([...mergedDict.map((d) => d.maker), 'ターナー', 'リキテックス', 'ウィンザー＆ニュートン', 'マツダ', '名村大成堂', 'クサカベ', 'ホルベイン'])].map((m) => `<option value="${esc(m)}">`).join('');
  $('btnDeleteItem').hidden = !it;
  updateJanHint();
  refreshFormShopLinks();
  openSheet('sheetItem');
  $('sheetItem').scrollTop = 0;
  setTimeout(() => $('fName').focus({ preventScroll: true }), 120);
}

// 数量ステッパー（編集シート内）
$('sheetItem').addEventListener('click', (e) => {
  const b = e.target.closest('[data-qstep]');
  if (!b) return;
  const input = $('fQty');
  const next = Math.max(0, (Number(input.value) || 0) + Number(b.dataset.qstep));
  input.value = String(next);
});

/* ---------------- 写真（追加・変更・削除）と画像URL ---------------- */
/** 編集シートのプレビューに出す画像（保存前の選択 → 保存済み写真 → 画像URL の順） */
function previewSource() {
  if (pendingPhoto && pendingPhoto.kind === 'set') return pendingPhoto.url;
  if (pendingPhoto && pendingPhoto.kind === 'delete') return normalizeImageUrl($('fImageUrl').value);
  if (ui.editingId && photoUrls.has(ui.editingId)) return photoUrls.get(ui.editingId);
  return normalizeImageUrl($('fImageUrl').value);
}
function renderPhotoPreview() {
  const src = previewSource();
  $('photoPrev').innerHTML = src
    ? `<img class="previewimg" src="${esc(src)}" alt="写真プレビュー" decoding="async" referrerpolicy="no-referrer">`
    : '<span class="ph-txt">写真なし<br>アイコン表示</span>';
  const exists = (pendingPhoto && pendingPhoto.kind === 'set')
    || (!(pendingPhoto && pendingPhoto.kind === 'delete') && Boolean(ui.editingId && photoUrls.has(ui.editingId)));
  $('btnPhotoClear').hidden = !exists;
}

$('btnPhotoPick').addEventListener('click', () => $('fPhoto').click());
$('fPhoto').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  $('photoHint').textContent = '写真を圧縮しています…';
  try {
    const out = await compressImageFile(file);
    if (pendingPhoto && pendingPhoto.url) URL.revokeObjectURL(pendingPhoto.url);
    pendingPhoto = { kind: 'set', ...out, url: URL.createObjectURL(out.blob) };
    $('photoHint').textContent = `約${Math.round(out.bytes / 1024)}KB`;
    renderPhotoPreview();
  } catch (err) {
    $('photoHint').textContent = '写真を読み込めませんでした。別の画像で試してください';
    toast(err.message || '写真を読み込めませんでした');
  }
});
$('btnPhotoClear').addEventListener('click', () => {
  if (pendingPhoto && pendingPhoto.url) URL.revokeObjectURL(pendingPhoto.url);
  pendingPhoto = { kind: 'delete' };
  $('photoHint').textContent = '保存で写真を削除';
  renderPhotoPreview();
});
$('fImageUrl').addEventListener('input', renderPhotoPreview);

/** 読み込み後、存在しない画材の写真を端末内から片付ける */
async function prunePhotos() {
  try {
    const rows = await listPhotos();
    const ids = new Set(state.items.map((i) => i.id));
    let kept = 0;
    for (const row of rows) {
      if (!row || !row.id) continue;
      if (ids.has(row.id)) { kept += 1; continue; }
      await deletePhoto(row.id);
      dropPhotoUrl(row.id);
    }
    photoCount = kept;
  } catch (e) {
    console.warn('写真の片付けに失敗', e);
  }
}

/** 保存時に手元写真をIndexedDBへ反映する（新規は採番されたIDで保存） */
async function applyPendingPhoto(id) {
  const p = pendingPhoto;
  pendingPhoto = null;
  if (!p || !id) return;
  try {
    const had = photoUrls.has(id);
    if (p.kind === 'delete') {
      await deletePhoto(id);
      dropPhotoUrl(id);
      if (had) photoCount = Math.max(0, photoCount - 1);
      return;
    }
    await putPhoto(id, p.blob, { width: p.width, height: p.height });
    setPhotoUrl(id, p.blob);
    if (!had) photoCount += 1;
  } catch (err) {
    console.warn('写真の保存に失敗', err);
    toast(`写真を保存できませんでした（${err.message}）`);
  } finally {
    if (p.kind === 'set' && p.url) URL.revokeObjectURL(p.url);
  }
}

function updateJanHint() {
  const v = normalizeJAN($('fJan').value);
  const hint = $('janHint');
  updateProposeBox();
  if (!v) { hint.textContent = 'JANは後からでも入れられます'; hint.style.color = ''; return; }
  if (!/^\d{13}$/.test(v)) { hint.textContent = `${v.length}桁（13桁で入力）`; hint.style.color = 'var(--warn)'; return; }
  const hit = lookupJAN(v, mergedDict);
  const maker = detectMaker(v);
  hint.style.color = 'var(--good)';
  hint.textContent = `${maker ? `${maker.maker} ` : ''}${hit ? hit.colorName || hit.name : '辞書に未収録'}`;
}
$('fJan').addEventListener('input', () => { updateJanHint(); refreshFormShopLinks(); });
for (const id of ['fName', 'fMaker', 'fColorName']) $(id).addEventListener('input', refreshFormShopLinks);
// メーカーを自分で書き換えたら、辞書から入れたブランドは使わない
$('fMaker').addEventListener('input', () => { ui.formBrand = ''; });

$('itemForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const janRaw = $('fJan').value.trim();
  const jan = normalizeJAN(janRaw);
  if (janRaw && !/^\d{13}$/.test(jan)) { toast('JANは13桁で入力してください'); return; }
  if (jan && !isValidJAN(jan)) { toast('JANのチェックディジットが合いません'); return; }
  const imageUrlRaw = $('fImageUrl').value.trim();
  const imageUrl = normalizeImageUrl(imageUrlRaw);
  if (imageUrlRaw && !imageUrl) { toast('画像URLは http(s):// で始まるURLを入れてください'); return; }
  const partial = {
    name: $('fName').value,
    maker: $('fMaker').value,
    brand: ui.formBrand,
    category: $('fCategoryInput').value,
    colorName: $('fColorName').value,
    colorCode: $('fColorCode').value,
    size: $('fSize').value,
    qty: $('fQty').value,
    status: $('fStatusInput').value,
    folderId: $('fFolderInput').value,
    jan,
    shop: $('fShop').value,
    price: $('fPrice').value,
    memo: $('fMemo').value,
    imageUrl,
  };
  let savedFolder = partial.folderId;
  let targetId = '';
  if (ui.editingId) {
    const prev = state.items.find((i) => i.id === ui.editingId);
    targetId = prev.id;
    state = upsertItem(state, createItem({
      ...partial, id: prev.id, createdAt: prev.createdAt, purchaseLog: prev.purchaseLog,
      updatedAt: new Date().toISOString(), // 編集した画材は「新しい順」の先頭に来る
    }));
    toast('保存しました');
  } else {
    const created = createItem(partial);
    targetId = created.id;
    state = upsertItem(state, created);
    savedFolder = created.folderId;
    toast('画材を追加しました');
  }
  save();
  await applyPendingPhoto(targetId);
  closeSheet('sheetItem');
  ui.tab = 'stock';
  ui.mode = 'items';
  ui.folderId = savedFolder;
  render();
});

$('btnDeleteItem').addEventListener('click', async () => {
  if (!ui.editingId) return;
  if (!confirm('この画材を削除しますか？（元に戻せません）')) return;
  const id = ui.editingId;
  state = deleteItems(state, [id]);
  save();
  try {
    await deletePhoto(id);
    dropPhotoUrl(id);
  } catch (err) { console.warn('写真の削除に失敗', err); }
  closeSheet('sheetItem');
  render();
  toast('削除しました');
});

$('btnAdd').addEventListener('click', () => openItemSheet(null));

// 空の一覧・設定の「サンプルを入れる」（ボタンは描き直されるので文書全体で受ける）
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-add-samples]')) addSamples();
});

/* ---------------- シート開閉 ---------------- */
const openSheets = new Set();
function openSheet(id) {
  openSheets.add(id);
  $('mask').classList.add('open');
  $(id).classList.add('open');
}
function closeSheet(id) {
  openSheets.delete(id);
  $(id).classList.remove('open');
  if (!openSheets.size) $('mask').classList.remove('open');
  if (id === 'sheetScan') stopScanner();
}
$('mask').addEventListener('click', () => [...openSheets].forEach(closeSheet));
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-close]');
  if (c) closeSheet(c.dataset.close);
});

/* ---------------- フォルダ管理 ---------------- */
$('folderList').addEventListener('click', (e) => {
  const up = e.target.closest('[data-up]');
  const down = e.target.closest('[data-down]');
  const ed = e.target.closest('[data-fedit]');
  if (up || down) {
    const id = (up || down).dataset[up ? 'up' : 'down'];
    state = moveFolder(state, id, up ? 'up' : 'down');
    save(); render();
  } else if (ed) {
    openFolderSheet(ed.dataset.fedit);
  }
});

/** フォルダ編集シート（名前・色・親フォルダ） */
function openFolderSheet(id) {
  ui.folderEditId = id;
  const f = folderOf(id);
  $('fFolderName').value = f.name;
  $('fFolderColor').value = /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : '#2f6fd0';
  // 自分自身と配下は親に選べない（循環を防ぐ）
  const exclude = folderSubtreeIds(state.folders, id);
  $('fFolderParent').innerHTML = folderOptions(state.folders, { exclude, noneLabel: 'なし（トップ）' })
    .map((o) => `<option value="${esc(o.id)}">${'　'.repeat(o.depth)}${esc(o.label)}</option>`).join('');
  $('fFolderParent').value = folderParentId(f);
  openSheet('sheetFolder');
}

/** フォルダを作る（parentId を渡すと子フォルダ） */
function addFolderAt(parentId = '') {
  if (!canAddFolder(state, state.settings).ok) { openProSheet('folder'); return; }
  const parent = parentId ? folderOf(parentId) : null;
  const name = prompt(parent
    ? `「${parent.name}」の中に作るフォルダ名（例：引き出し1）`
    : '新しいフォルダ名（例：スタジオ、実家、教室）');
  if (!name) return;
  try {
    state = addFolder(state, { name, parentId: parentId || null });
    save(); render();
    toast(parent ? `「${parent.name}」の中に追加しました` : 'フォルダを追加しました');
  } catch (err) { toast(err.message); }
}

$('btnAddFolder').addEventListener('click', () => addFolderAt(''));
$('btnSaveFolder').addEventListener('click', () => {
  if (!ui.folderEditId) return;
  try {
    state = updateFolder(state, ui.folderEditId, {
      name: $('fFolderName').value, color: $('fFolderColor').value,
      parentId: $('fFolderParent').value || null,
    });
    save(); closeSheet('sheetFolder'); render();
    toast('フォルダを更新しました');
  } catch (err) { toast(err.message); }
});
$('btnDeleteFolder').addEventListener('click', () => {
  if (!ui.folderEditId) return;
  const f = folderOf(ui.folderEditId);
  const fallback = state.folders.find((x) => x.id !== ui.folderEditId);
  if (!fallback) { toast('フォルダは最低1つ必要です'); return; }
  const kids = folderChildren(state.folders, ui.folderEditId).length;
  const upName = folderParentId(f) ? folderOf(folderParentId(f)).name : 'トップ';
  const note = kids ? `子フォルダ${kids}つは「${upName}」へ移します。` : '';
  if (!confirm(`「${f.name}」を削除します。中の画材は「${fallback.name}」へ移動します。${note}よろしいですか？`)) return;
  state = deleteFolder(state, ui.folderEditId, fallback.id);
  save(); closeSheet('sheetFolder'); render();
  toast(`「${fallback.name}」へ中身を移動しました`);
});

/* ---------------- 移動（1件・複数選択とも同じシート） ---------------- */
function openMoveSheet(ids) {
  ui.moveIds = [...ids];
  $('moveTitle').firstChild.textContent = ui.moveIds.length > 1 ? `${ui.moveIds.length}件を移動` : 'フォルダへ移動';
  $('moveOptions').innerHTML = folderOptions(state.folders, { noneLabel: null })
    .map((o) => {
      const parents = folderChain(state.folders, o.id).slice(0, -1).map((f) => f.name).join(' / ');
      return `<button class="pill move" data-tomove="${esc(o.id)}" style="--d:${o.depth}">${esc(o.label)}${parents ? ` <span class="mpath">${esc(parents)}</span>` : ''}</button>`;
    }).join('');
  openSheet('sheetMove');
}
$('moveOptions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tomove]');
  if (!b) return;
  try {
    const count = ui.moveIds.length;
    const fromSelect = ui.selectMode;
    state = { ...state, items: moveItems(state.items, ui.moveIds, b.dataset.tomove, state.folders) };
    save();
    closeSheet('sheetMove');
    const name = folderOf(b.dataset.tomove).name;
    ui.moveIds = [];
    if (fromSelect) { exitSelect(); toast(`${count}件を${name}へ移動しました`); }
    else toast(`${name} へ移動しました`);
    render();
  } catch (err) { toast(err.message); }
});

/* ---------------- バーコード読取 ---------------- */
let scanSession = createScanSession();
let scanContinuous = false; // 連続スキャン（スキャン画面を開いている間の設定）
let scanLog = [];           // 今回の読み取りログ（新しいものが先頭）
let scanLimitHit = false;   // 新規登録が無料上限で止まっているか
let scannerLive = false;    // カメラ（またはネイティブ読取）が動いているか
const SCAN_LOG_MAX = 5;     // 画面に出す直近件数

$('btnScan').addEventListener('click', () => {
  openSheet('sheetScan');
  $('manualJan').value = '';
  resetScanSession(scanSession);
  clearScanLog();
  renderScanMode();
  startScanner();
});
$('btnRescan').addEventListener('click', () => { stopScanner(); startScanner(); });

/* --- 連続スキャンの表示（トグル・ログ・status） --- */
function renderScanMode() {
  $('btnContinuous').setAttribute('aria-pressed', String(scanContinuous));
  $('btnContinuous').textContent = `連続スキャン ${scanContinuous ? 'ON' : 'OFF'}`;
  $('scanModeNote').textContent = scanContinuous ? '閉じずに続けて登録します' : '1本読むと閉じます';
  $('scanLog').hidden = !scanContinuous;
  renderScanLog();
}

function setContinuousScan(on) {
  scanContinuous = Boolean(on);
  if (!scanContinuous) { // 通常モードに戻したら次のスキャンは1本で閉じる
    scanLog = [];
    scanLimitHit = false;
    resetScanSession(scanSession);
  }
  hideScanStatus();
  renderScanMode();
}

function clearScanLog() {
  scanLog = [];
  scanLimitHit = false;
  hideScanStatus();
  renderScanLog();
}

function renderScanLog() {
  $('scanLogCount').textContent = `${scanLogCount(scanLog)}件`;
  $('scanLogList').innerHTML = scanLog.slice(0, SCAN_LOG_MAX).map((e) =>
    `<li data-k="${esc(e.kind)}"><span class="k">${esc(e.label)}</span><span class="n">${esc(e.name || e.jan)}</span></li>`).join('');
  $('scanLimitNote').hidden = !scanLimitHit;
}

function showScanStatus(msg, tone = '') {
  const el = $('scanStatus');
  el.hidden = false;
  el.className = `scan-status${tone ? ` ${tone}` : ''}`;
  el.textContent = msg;
}

function hideScanStatus() {
  const el = $('scanStatus');
  el.hidden = true;
  el.className = 'scan-status';
  el.textContent = '';
}

$('btnContinuous').addEventListener('click', () => setContinuousScan(!scanContinuous));
$('btnScanDone').addEventListener('click', () => {
  const read = scanLogCount(scanLog);
  const summary = describeScanLog(scanLog);
  stopScanner();
  closeSheet('sheetScan');
  if (read > 0) toast(`連続スキャン: ${summary}`);
});

function showScanMsg(msg) {
  $('scanMsg').hidden = false;
  $('scanMsg').textContent = msg;
}

async function startScanner() {
  stopScanner();
  const video = $('scanVideo');
  video.hidden = true;
  $('scanReticle').hidden = true;
  const secure = window.isSecureContext || location.hostname === 'localhost';
  const native = nativeScannerPlugin(window);
  const strategy = chooseScanStrategy({
    hasNativePlugin: Boolean(native),
    hasBarcodeDetector: 'BarcodeDetector' in window,
    secureContext: secure,
  });
  showScanMsg('カメラ起動中');
  if (strategy === 'manual') {
    showScanMsg('カメラは https で使えます。下の手入力をどうぞ');
    return;
  }

  // 1) Capacitor のネイティブスキャナ（iOSアプリで最優先）
  if (strategy === 'native') {
    // ネイティブのスキャナは1回で閉じるので、連続モードでは読み取るたびに開き直す
    const runNative = async () => {
      scannerLive = true;
      while (scannerLive) {
        let value = '';
        try {
          const { barcodes } = await native.startScan({ formats: ['EAN_13', 'EAN_8', 'UPC_A', 'CODE_128'] });
          value = barcodes?.[0]?.rawValue || '';
        } catch (e) {
          console.warn('ネイティブスキャナ失敗', e);
          scannerLive = false;
          // 連続モードの途中で閉じた（キャンセル）ときは、エラー扱いにしない
          if (!scanContinuous || scanLogCount(scanLog) === 0) showScanMsg('カメラを起動できません。手入力をどうぞ');
          return;
        }
        if (!value) { scannerLive = false; showScanMsg('読み取れませんでした'); return; }
        onScan(value);
        if (!scanContinuous) { scannerLive = false; return; }
      }
    };
    runNative();
    return;
  }

  // 2) Web の BarcodeDetector（Chrome/Android）
  if (strategy === 'barcode-detector') {
    try {
      const supported = (await window.BarcodeDetector.getSupportedFormats?.()) || [];
      const formats = ['ean_13', 'ean_8', 'upc_a', 'code_128'].filter((f) => !supported.length || supported.includes(f));
      const detector = new window.BarcodeDetector({ formats });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      video.hidden = false;
      $('scanReticle').hidden = false;
      $('scanMsg').hidden = true;
      await video.play();
      scannerLive = true;
      const tick = async () => {
        if (!scannerLive) return;
        if (video.readyState === 4) {
          try {
            const codes = await detector.detect(video);
            // 通常モードは1本で閉じる。連続モードは止めずに読み続ける（同じJANはクールダウンで間引く）
            if (codes && codes.length) {
              onScan(codes[0].rawValue);
              if (!scanContinuous) return;
            }
          } catch (e) { /* 連続検出時の失敗は無視 */ }
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      return;
    } catch (e) {
      console.warn('BarcodeDetector失敗', e);
    }
  }

  // 3) 同梱の html5-qrcode（iOS WKWebView を含む。CDNは使わない）
  showScanMsg('スキャナ準備中');
  try {
    const Html5Qrcode = await loadVendorScanner(document, VENDOR_SCANNER_PATH);
    if (!Html5Qrcode) throw new Error('スキャナを読み込めません');
    $('scanMsg').hidden = true;
    const holder = document.createElement('div');
    holder.id = 'qrReader';
    holder.style.cssText = 'width:100%;height:100%';
    $('scanBox').appendChild(holder);
    const inst = new Html5Qrcode('qrReader', { verbose: false });
    scanner = inst;
    await inst.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 140 } },
      (text) => { onScan(text); }, () => {});
    scannerLive = true;
  } catch (e) {
    console.warn('html5-qrcode失敗', e);
    showScanMsg('カメラを起動できません。手入力をどうぞ');
  }
}

function stopScanner() {
  scannerLive = false;
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
  rafId = 0;
  const video = $('scanVideo');
  if (video?.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
  if (scanner) {
    const s = scanner;
    scanner = null;
    s.stop().then(() => s.clear?.()).catch(() => {});
  }
  document.getElementById('qrReader')?.remove();
}

/** 読み取った値の受け口（通常モード／連続モードの分岐）。受け付けたら true */
function onScan(raw) {
  const jan = normalizeJAN(String(raw).replace(/\D/g, '').slice(0, 13));
  if (!scanContinuous) {
    if (!/^\d{13}$/.test(jan)) { toast('13桁のJANとして読めませんでした'); return false; }
    if (!isValidJAN(jan)) toast('読取値のチェックディジットが合いません（手入力をお試しください）');
    stopScanner();
    closeSheet('sheetScan');
    applyJAN(jan);
    return true;
  }
  return continuousScan(jan);
}

/**
 * 連続モードの1本。クールダウン→在庫へ反映→ログ、までを行い、カメラは閉じない。
 * 同じJANがカメラの前に残っている間は何もしない（連続の誤爆防止）。
 */
function continuousScan(jan, { skipCooldown = false } = {}) {
  if (!skipCooldown) {
    const gate = checkCooldown(scanSession, jan, Date.now());
    if (!gate.accepted) return false;
  }
  const { state: next, result } = applyScan(state, jan, { dict: mergedDict, folderId: ui.folderId });
  if (result.kind === 'invalid') {
    showScanStatus(result.message, 'bad');
    return false;
  }
  markScanned(scanSession, jan, Date.now());
  if (result.kind === 'limit') { // 新規登録だけ止める（登録済みの＋1は通る）
    scanLimitHit = true;
    showScanStatus(result.message, 'warn');
    renderScanLog();
    return true;
  }
  state = next;
  save();
  showScanStatus(result.message, result.kind === 'drafted' ? '' : 'good');
  scanLog = [result, ...scanLog];
  renderScanLog();
  render();
  return true;
}

$('btnManualLookup').addEventListener('click', () => {
  const jan = normalizeJAN($('manualJan').value);
  if (!/^\d{13}$/.test(jan)) { toast('13桁で入力してください'); return; }
  if (!isValidJAN(jan)) { toast('チェックディジットが合いません'); return; }
  if (scanContinuous) { // 手入力は誤読ではないのでクールダウンを見ない
    $('manualJan').value = '';
    continuousScan(jan, { skipCooldown: true });
    return;
  }
  stopScanner(); closeSheet('sheetScan'); applyJAN(jan);
});

/** JAN からフォームを開く（辞書一致なら自動補完、未収録なら新規登録へ） */
function applyJAN(jan) {
  const hit = lookupJAN(jan, mergedDict);
  const maker = detectMaker(jan);
  const existing = state.items.find((i) => i.jan === jan);
  if (existing) {
    toast(`登録済み: ${existing.name}（在庫を＋しました）`);
    state = upsertItem(state, adjustStock(recordPurchase(existing, 1), 1));
    save(); render();
    return;
  }
  if (hit) {
    toast(`辞書で見つかりました: ${hit.name}`);
    openItemSheet(null, {
      name: hit.name, maker: hit.maker, brand: hit.brand, category: hit.category,
      colorName: hit.colorName, colorCode: hit.code, size: hit.size, jan: hit.jan, qty: 1,
    });
  } else {
    toast('辞書に未収録のJANです。新規登録できます');
    openItemSheet(null, { jan, maker: maker?.maker || '', qty: 1 });
  }
}

// テスト用ボタンは、馴染みのあるメーカーの色名付き品を1社1件ずつ出す（読取→自動入力の確認用）
const SAMPLE_MAKERS = ['ホルベイン', 'クサカベ', 'コピック', 'ターナー', 'サクラクレパス', 'リキテックス'];
const TEST_SAMPLES = SAMPLE_MAKERS.map((m) =>
  JAN_DICTIONARY.find((d) => d.maker === m && d.category === 'oil' && d.colorName)
  || JAN_DICTIONARY.find((d) => d.maker === m && d.colorName)).filter(Boolean);
$('testPills').innerHTML = TEST_SAMPLES.map((d) =>
  `<button class="pill" data-testjan="${esc(d.jan)}">${esc(d.colorName || d.name)}<br><span style="font-size:10px;color:#5b6b7c">${esc(d.jan)}</span></button>`).join('');
$('testPills').addEventListener('click', (e) => {
  const b = e.target.closest('[data-testjan]');
  if (!b) return;
  if (scanContinuous) { onScan(b.dataset.testjan); return; } // 連続モードは閉じずに数える
  stopScanner(); closeSheet('sheetScan');
  applyJAN(b.dataset.testjan);
});

/* ---------------- 設定: 入出力 ---------------- */
$('btnExport').addEventListener('click', () => {
  const blob = new Blob([exportState(state)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  a.href = URL.createObjectURL(blob);
  a.download = `art-supply-backup-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast(photoCount
    ? `バックアップを書き出しました（手元写真${photoCount}枚は端末内のみ・JSONに含みません）`
    : 'バックアップを書き出しました');
});
$('btnImport').addEventListener('click', () => $('fileImport').click());
$('fileImport').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    pendingRestore = importState(text);
    $('restoreNote').textContent = `${pendingRestore.items.length}件・フォルダ${pendingRestore.folders.length}つ。まとめる＝いまの画材は消しません。`;
    openSheet('sheetRestore');
  } catch (err) {
    toast(`読み込めませんでした: ${err.message}`);
  }
});
$('btnRestoreMerge').addEventListener('click', async () => {
  if (!pendingRestore) return;
  state = mergeStates(state, pendingRestore);
  const stats = state.mergeStats || { added: 0, updated: 0 };
  pendingRestore = null;
  save();
  await prunePhotos();
  closeSheet('sheetRestore');
  render();
  toast(`まとめました（追加 ${stats.added}・更新 ${stats.updated}件）`);
});
$('btnRestoreReplace').addEventListener('click', async () => {
  if (!pendingRestore) return;
  if (!confirm('いまのデータを、読み込むファイルの内容で置き換えます。よろしいですか？')) return;
  state = pendingRestore;
  pendingRestore = null;
  save();
  await prunePhotos();
  closeSheet('sheetRestore');
  render();
  toast(`置き換えました（${state.items.length}件）`);
});
$('btnWipe').addEventListener('click', async () => {
  if (!confirm('この端末の画材データをすべて削除します。元に戻せません。')) return;
  if (!confirm('本当に削除しますか？（バックアップは書き出し済みですか？）')) return;
  localStorage.removeItem(STORAGE_KEY);
  state = blankState();
  save();
  try { await clearPhotos(); } catch (e) { console.warn('写真の削除に失敗', e); }
  [...photoUrls.keys()].forEach(dropPhotoUrl);
  photoCount = 0;
  render();
  toast('全データを削除しました');
});
$('btnDict').addEventListener('click', () => {
  $('dictQ').value = '';
  openSheet('sheetDict');
  renderDictList('');
});
$('btnDictSync').addEventListener('click', () => syncDictionary({ announce: true }));

/* ---------------- 通販で探す（アフィリエイト土台） ---------------- */
function openShopSheet(item) {
  selectedShopItem = item || null;
  $('shopItemName').textContent = item ? displayName(item) : '通販';
  const links = renderShopLinks($('shopSheetLinks'), item || {});
  $('shopNote').textContent = links.length ? '' : 'JANか商品名を入れると検索できます';
  openSheet('sheetShop');
}
/* ---------------- 辞書に提案 ---------------- */
function openProposeSheet(item) {
  proposeItem = item || null;
  const f = item || {};
  $('proposeSum').innerHTML = `
    <div><b>${esc(normalizeJAN(f.jan))}</b></div>
    <div>${esc([f.maker, f.colorName || f.name, f.size].filter(Boolean).join(' ') || '商品名未入力')}</div>`;
  openSheet('sheetPropose');
}
$('btnPropose').addEventListener('click', () => openProposeSheet(formItem()));
$('btnProposeGithub').addEventListener('click', () => {
  openExternal(buildIssueUrl(proposeItem || {}));
  closeSheet('sheetPropose');
});
$('btnProposeCopy').addEventListener('click', async () => {
  const ok = await copyText(buildProposalClipboardText(proposeItem || {}));
  toast(ok ? '文面をコピーしました' : 'コピーできませんでした');
});

/* アプリ内（iOS）では外部リンクをSafariで開く（WebViewに閉じ込めない） */
document.addEventListener('click', (e) => {
  if (!isNativeShell(window)) return;
  const a = e.target?.closest?.('a[href]');
  if (!a) return;
  const href = a.getAttribute('href') || a.href || '';
  if (!shouldOpenExternally(href, { native: true, base: location.href })) return;
  e.preventDefault();
  openExternal(a.href || href);
}, true);

const DICT_RENDER_LIMIT = 300;
/** 「辞書から探す」シートに出す件数（34,365件でも軽いよう、描画はこの数だけ） */
const DICT_FIND_LIMIT = 40;

function renderDictList(query) {
  const merged = mergeDictionaries(JAN_DICTIONARY, extraEntries);
  $('dictNote').textContent = describeCounts(merged);
  const { items: hit, total } = searchDictionary(mergedDict, query, {
    limit: DICT_RENDER_LIMIT, hay: dictionaryHaystack(mergedDict),
  });
  $('dictList').innerHTML = hit.map((d) => `
    <div style="padding:8px 0;border-bottom:1px solid var(--line)">
      <b>${esc(d.colorName || d.name)}</b> <span class="dic-meta">${esc(d.maker)} ${esc(d.size)}</span>
      ${extraJanSet.has(d.jan) ? '<span class="dict-badge">追加</span>' : ''}<br>
      <span class="dic-jan">${esc(d.jan)}</span>
      <a href="${esc(d.source)}" target="_blank" rel="noopener noreferrer" class="dic-src">出典</a>
    </div>`).join('') + (total > hit.length
    ? `<p class="hint" style="margin:10px 0 0">ほか ${total - hit.length}件</p>`
    : '');
}
$('dictQ').addEventListener('input', (e) => renderDictList(e.target.value));

/* ---------------- 辞書から探す（登録フォームへ自動入力） ---------------- */
/** 辞書の検索結果（タップでフォームに入る） */
function renderDictFind(query) {
  const q = String(query || '').trim();
  if (!q) {
    $('dictFindList').innerHTML = `<p class="hint" style="margin:8px 0 0">色名・メーカー・品番・JANで探せます（内蔵${mergedDict.length}件）</p>`;
    return;
  }
  const { items: hit, total } = searchDictionary(mergedDict, q, {
    limit: DICT_FIND_LIMIT, hay: dictionaryHaystack(mergedDict),
  });
  const rows = hit.map((d) => {
    const sub = [d.maker, d.colorName && d.colorName !== d.name ? d.colorName : '', d.size, d.code].filter(Boolean).join(' ');
    return `
    <button type="button" class="dfind" data-dict-jan="${esc(d.jan)}">
      <span class="dfind-name">${esc(d.name || d.colorName)}</span>
      <span class="dfind-sub">${esc(sub)}</span>
      <span class="dfind-jan">${esc(d.jan)}</span>
    </button>`;
  }).join('');
  $('dictFindList').innerHTML = rows
    ? rows + (total > hit.length ? `<p class="hint" style="margin:10px 0 0">ほか ${total - hit.length}件（言葉を足すと絞れます）</p>` : '')
    : '<p class="hint" style="margin:8px 0 0">見つかりません。別の言葉かJANで探してください</p>';
}

/** 辞書の1件を登録フォームへ入れる（商品名・メーカー・カテゴリ・色名・色番号・JAN・号数） */
function applyDictEntry(d) {
  if (!d) return;
  $('fName').value = d.name || d.colorName || '';
  $('fMaker').value = d.maker || '';
  $('fCategoryInput').value = CATEGORIES.some((c) => c.id === d.category) ? d.category : 'other';
  $('fColorName').value = d.colorName || '';
  $('fColorCode').value = d.code || '';
  $('fSize').value = d.size || '';
  $('fJan').value = d.jan || '';
  ui.formBrand = d.brand || '';
  updateJanHint();
  refreshFormShopLinks();
  closeSheet('sheetDictFind');
  toast('辞書の商品を入れました');
}

$('btnDictFind').addEventListener('click', () => {
  $('dictFindQ').value = '';
  renderDictFind('');
  openSheet('sheetDictFind');
  setTimeout(() => $('dictFindQ').focus({ preventScroll: true }), 120);
});
$('dictFindQ').addEventListener('input', (e) => renderDictFind(e.target.value));
$('dictFindList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-dict-jan]');
  if (!b) return;
  const d = mergedDict.find((x) => x.jan === b.dataset.dictJan);
  applyDictEntry(d);
});

/* ---------------- PWA（アプリ内では Service Worker を使わない） ---------------- */
if ('serviceWorker' in navigator && !isNativeShell(window)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

seedSamplesOnFirstRun();
render();
preloadPhotos();
renderDictionaryState();
syncDictionary();
