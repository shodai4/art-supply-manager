// 画材管理アプリ UI（storage + rendering + バーコード読取）
import {
  STORAGE_KEY, CATEGORIES, STATUSES, DEFAULT_FOLDERS, SORT_MODES, MAKER_NONE,
  createItem, adjustStock, computeShoppingList, filterItems, moveItems, sortItems, countByFolder,
  addFolder, updateFolder, reorderFolders, deleteFolder, upsertItem, deleteItems,
  exportState, importState, summarize, blankState, isEmptyStock,
  isValidJAN, normalizeJAN, detectMaker, lookupJAN, itemMaker, listMakers, groupByMaker,
  normalizeImageUrl,
} from './core.js';
import { JAN_DICTIONARY } from './jan-database.js';
import {
  EXTRA_DICT_URL, mergeDictionaries, syncExtraDictionary, describeCounts, describeSyncState,
  buildIssueUrl, buildProposalClipboardText,
} from './jan-extra.js';
import {
  SHOP_AFFILIATE_CONFIG, AFFILIATE_NOTE, shopSearchLinks, buildSearchQuery, describeSearchQuery,
} from './shops.js';
import {
  chooseScanStrategy, isNativeShell, nativeScannerPlugin, loadVendorScanner, VENDOR_SCANNER_PATH,
} from './scanner.js';
import {
  compressImageFile, listPhotos, putPhoto, deletePhoto, clearPhotos, fetchProductImageInfo,
  resolveImageProxyUrl, normalizeProxyUrl, canUseImageProxy, sourceLabel,
} from './images.js';

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
};
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
      base: JAN_DICTIONARY, storage: safeStorage(), url: EXTRA_DICT_URL,
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

/** 外部URLを開く（Capacitorでは Safari、ブラウザでは新規タブ） */
function openExternal(url) {
  if (!url) return false;
  const browser = window.Capacitor?.Plugins?.Browser;
  if (browser && typeof browser.open === 'function') {
    browser.open({ url });
    return true;
  }
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    copyText(url);
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

/* ---------------- storage ---------------- */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return blankState();
    const next = importState(raw);
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
  renderHeader();
  renderTools();
  renderCrumb();
  const folderMode = isFolderMode();
  $('folderGrid').hidden = !folderMode;
  $('itemList').hidden = folderMode;
  if (folderMode) renderFolderGrid();
  else renderTilesInto($('itemList'), currentList(), { group: state.settings.sort === 'maker', emptyKey: 'items' });
  renderShopping();
  renderFolders();
  renderSettings();
  renderFilterSheet();
  document.querySelectorAll('#tabbar button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab));
  });
  for (const t of ['stock', 'shopping', 'folders', 'settings']) $(`view-${t}`).hidden = t !== ui.tab;
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
}

function renderCrumb() {
  const folderMode = isFolderMode();
  const crumb = $('crumb');
  crumb.classList.toggle('root', folderMode);
  $('crumbName').textContent = folderMode ? '' : (ui.folderId === 'all' ? 'すべて' : folderOf(ui.folderId).name);
  $('btnUp').disabled = folderMode;
}

/** 保管場所フォルダのグリッド（＋すべて） */
function renderFolderGrid() {
  const counts = countByFolder(state.items);
  const tiles = [{ id: 'all', name: 'すべて', all: true, count: counts.all_total || 0 }]
    .concat(state.folders.map((f) => ({ ...f, count: counts[f.id] || 0 })));
  $('folderGrid').innerHTML = tiles.map((t) => {
    const color = t.all ? '#2f6fd0' : (t.color || '#5b6b7c');
    return `
    <button class="ftile${t.all ? ' is-all' : ''}" data-folder="${esc(t.id)}" style="--c:${esc(color)};--cs:${rgba(color, t.all ? 0.1 : 0.13)}">
      <span class="fico">
        <svg class="ic" aria-hidden="true"><use href="#${t.all ? 'i-grid' : 'i-folder-solid'}"/></svg>
        <span class="fcnt">${t.count}</span>
      </span>
      <span class="fname">${esc(t.name)}</span>
    </button>`;
  }).join('');
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
  if (img.classList.contains('shelfimg') || img.classList.contains('previewimg')) img.classList.add('imgfail');
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
  return `
  <button class="tile${low ? ' low' : ''}${out ? ' out' : ''}${isEmpty ? ' item-card--empty' : ''}" data-empty="${isEmpty ? '1' : '0'}" data-edit="${esc(it.id)}" aria-label="${esc(label)}" style="--c:${esc(base)};--c2:${esc(shade(base))};--cs:${rgba(base, 0.1)}">
    <span class="sw">
      ${dot}<span class="qbadge">${Number(it.qty) || 0}</span>
      <svg class="inh" aria-hidden="true"><use href="#${icon}"/></svg>
      ${shelfImage(it)}
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
  return `
  <article class="item${isEmpty ? ' item-card--empty' : ''}" data-empty="${isEmpty ? '1' : '0'}" data-id="${esc(it.id)}">
    <span class="thumb"><svg class="ic" aria-hidden="true" style="color:${esc(thumbColor)}"><use href="#${thumbIcon}"/></svg>${shelfImage(it)}</span>
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
        : '<div class="empty"><b>まだ画材がありません</b>右下の＋ か 読取 から登録できます</div>');
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
  return sortItems(filterItems(state.items, {
    query: ui.query, folderId: ui.folderId, category: ui.category, status: ui.status, maker: ui.maker,
  }), state.settings.sort);
}

function renderFolders() {
  const counts = countByFolder(state.items);
  $('folderList').innerHTML = state.folders.map((f, i) => `
    <div class="folder-row" data-fid="${esc(f.id)}">
      <span class="folder-dot" style="background:${esc(f.color)}"></span>
      <span class="name">${esc(f.name)}<span class="cnt"> ・${counts[f.id] || 0}件</span></span>
      <button data-up="${esc(f.id)}" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
      <button data-down="${esc(f.id)}" ${i === state.folders.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
      <button data-fedit="${esc(f.id)}" aria-label="編集"><svg class="pencil" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4l5 5-9.5 9.5L4 20l1.5-6.5z"/><path d="M13 6l5 5"/></svg></button>
    </div>`).join('');
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
  renderDictionaryState();
}

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
  render();
});
$('btnHome').addEventListener('click', () => {
  ui.mode = 'folders';
  ui.folderId = 'all';
  ui.tab = 'stock';
  render();
});
$('btnUp').addEventListener('click', () => {
  ui.mode = 'folders';
  ui.folderId = 'all';
  render();
});
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
  ui.tab = b.dataset.tab;
  stopScanner();
  render();
});

$('folderGrid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-folder]');
  if (!b) return;
  ui.folderId = b.dataset.folder;
  ui.mode = 'items';
  ui.tab = 'stock';
  render();
  window.scrollTo({ top: 0 });
});

/* ---------------- アイテム操作 ---------------- */
document.addEventListener('click', (e) => {
  const step = e.target.closest('[data-step]');
  if (step) {
    const it = state.items.find((i) => i.id === step.dataset.id);
    if (!it) return;
    const next = adjustStock(it, Number(step.dataset.step));
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
  $('fFolderInput').innerHTML = state.folders.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('');
  $('fFolderInput').value = data.folderId;
  $('fJan').value = data.jan || '';
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
    state = upsertItem(state, createItem({ ...partial, id: prev.id, createdAt: prev.createdAt }));
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
    const ids = state.folders.map((f) => f.id);
    const i = ids.indexOf(id);
    const j = up ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    state = reorderFolders(state, ids);
    save(); render();
  } else if (ed) {
    ui.folderEditId = ed.dataset.fedit;
    const f = folderOf(ui.folderEditId);
    $('fFolderName').value = f.name;
    $('fFolderColor').value = /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : '#2f6fd0';
    openSheet('sheetFolder');
  }
});
$('btnAddFolder').addEventListener('click', () => {
  const name = prompt('新しいフォルダ名（例：スタジオ、実家、教室）');
  if (!name) return;
  try {
    state = addFolder(state, { name });
    save(); render();
    toast('フォルダを追加しました');
  } catch (err) { toast(err.message); }
});
$('btnSaveFolder').addEventListener('click', () => {
  if (!ui.folderEditId) return;
  try {
    state = updateFolder(state, ui.folderEditId, {
      name: $('fFolderName').value, color: $('fFolderColor').value,
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
  if (!confirm(`「${f.name}」を削除します。中の画材は「${fallback.name}」へ移動します。よろしいですか？`)) return;
  state = deleteFolder(state, ui.folderEditId, fallback.id);
  save(); closeSheet('sheetFolder'); render();
  toast(`「${fallback.name}」へ中身を移動しました`);
});

/* ---------------- 移動 ---------------- */
function openMoveSheet(ids) {
  ui.moveIds = ids;
  $('moveOptions').innerHTML = state.folders.map((f) => `<button class="pill" data-tomove="${esc(f.id)}">${esc(f.name)}</button>`).join('');
  openSheet('sheetMove');
}
$('moveOptions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tomove]');
  if (!b) return;
  try {
    state = { ...state, items: moveItems(state.items, ui.moveIds, b.dataset.tomove, state.folders) };
    save(); closeSheet('sheetMove'); render();
    toast(`${folderOf(b.dataset.tomove).name} へ移動しました`);
  } catch (err) { toast(err.message); }
});

/* ---------------- バーコード読取 ---------------- */
$('btnScan').addEventListener('click', () => {
  openSheet('sheetScan');
  $('manualJan').value = '';
  startScanner();
});
$('btnRescan').addEventListener('click', () => { stopScanner(); startScanner(); });

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
    try {
      const { barcodes } = await native.startScan({ formats: ['EAN_13', 'EAN_8', 'UPC_A', 'CODE_128'] });
      const value = barcodes?.[0]?.rawValue;
      if (value) onScan(value);
      else showScanMsg('読み取れませんでした');
    } catch (e) {
      console.warn('ネイティブスキャナ失敗', e);
      showScanMsg('カメラを起動できません。手入力をどうぞ');
    }
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
      const tick = async () => {
        if (video.readyState === 4) {
          try {
            const codes = await detector.detect(video);
            if (codes && codes.length) { onScan(codes[0].rawValue); return; }
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
      (text) => onScan(text), () => {});
  } catch (e) {
    console.warn('html5-qrcode失敗', e);
    showScanMsg('カメラを起動できません。手入力をどうぞ');
  }
}

function stopScanner() {
  cancelAnimationFrame(rafId);
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

function onScan(raw) {
  const jan = normalizeJAN(String(raw).replace(/\D/g, '').slice(0, 13));
  if (!/^\d{13}$/.test(jan)) { toast('13桁のJANとして読めませんでした'); return; }
  if (!isValidJAN(jan)) toast('読取値のチェックディジットが合いません（手入力をお試しください）');
  stopScanner();
  closeSheet('sheetScan');
  applyJAN(jan);
}

$('btnManualLookup').addEventListener('click', () => {
  const jan = normalizeJAN($('manualJan').value);
  if (!/^\d{13}$/.test(jan)) { toast('13桁で入力してください'); return; }
  if (!isValidJAN(jan)) { toast('チェックディジットが合いません'); return; }
  stopScanner(); closeSheet('sheetScan'); applyJAN(jan);
});

/** JAN からフォームを開く（辞書一致なら自動補完、未収録なら新規登録へ） */
function applyJAN(jan) {
  const hit = lookupJAN(jan, mergedDict);
  const maker = detectMaker(jan);
  const existing = state.items.find((i) => i.jan === jan);
  if (existing) {
    toast(`登録済み: ${existing.name}（在庫を＋しました）`);
    state = upsertItem(state, adjustStock(existing, 1));
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
  if (!file) return;
  if (!confirm('現在のデータを、読み込むファイルの内容で置き換えます。よろしいですか？')) { e.target.value = ''; return; }
  try {
    const text = await file.text();
    state = importState(text);
    save();
    await prunePhotos();
    render();
    toast(`読み込みました（${state.items.length}件）`);
  } catch (err) {
    toast(`読み込めませんでした: ${err.message}`);
  } finally {
    e.target.value = '';
  }
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

/* アプリ内（iOS）では外部リンクをSafariで開く */
document.addEventListener('click', (e) => {
  const a = e.target.closest('a.shop-link');
  if (!a || !isNativeShell(window)) return;
  e.preventDefault();
  openExternal(a.href);
});

const DICT_RENDER_LIMIT = 300;
// 絞り込み用の検索文字列は辞書が変わったときだけ作り直す（2万件超を毎打鍵で連結しない）
let dictHayCache = { dict: null, hay: [] };
function dictHaystack(dict) {
  if (dictHayCache.dict !== dict || dictHayCache.hay.length !== dict.length) {
    dictHayCache = {
      dict,
      hay: dict.map((d) => `${d.name} ${d.colorName} ${d.maker} ${d.size} ${d.code} ${d.jan}`.toLowerCase()),
    };
  }
  return dictHayCache.hay;
}
function renderDictList(query) {
  const q = String(query || '').trim().toLowerCase();
  const merged = mergeDictionaries(JAN_DICTIONARY, extraEntries);
  $('dictNote').textContent = describeCounts(merged);
  const hay = dictHaystack(mergedDict);
  const hit = q ? mergedDict.filter((d, i) => hay[i].includes(q)) : mergedDict;
  const shown = hit.slice(0, DICT_RENDER_LIMIT);
  $('dictList').innerHTML = shown.map((d) => `
    <div style="padding:8px 0;border-bottom:1px solid #eef2f7">
      <b>${esc(d.colorName || d.name)}</b> <span style="color:#5b6b7c">${esc(d.maker)} ${esc(d.size)}</span>
      ${extraJanSet.has(d.jan) ? '<span class="dict-badge">追加</span>' : ''}<br>
      <span style="font-family:ui-monospace,monospace">${esc(d.jan)}</span>
      <a href="${esc(d.source)}" target="_blank" rel="noopener noreferrer" style="font-size:11px">出典</a>
    </div>`).join('') + (hit.length > shown.length
      ? `<p class="hint" style="margin:10px 0 0">ほか ${hit.length - shown.length}件</p>`
      : '');
}
$('dictQ').addEventListener('input', (e) => renderDictList(e.target.value));

/* ---------------- PWA ---------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

render();
preloadPhotos();
renderDictionaryState();
syncDictionary();
