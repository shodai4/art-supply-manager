// アトリコ UI（storage + rendering + バーコード読取）
import {
  STORAGE_KEY, CATEGORIES, STATUSES, DEFAULT_FOLDERS, SORT_MODES, MAKER_NONE,
  createItem, adjustStock, computeShoppingList, filterItems, moveItems, sortItems, countByFolder,
  addFolder, updateFolder, moveFolder, reorderFolders, deleteFolder, upsertItem, deleteItems,
  exportState, importState, summarize, blankState, isEmptyStock, toggleFavorite, favoritesFirst,
  isValidJAN, normalizeJAN, detectMaker, lookupJAN, itemMaker, listMakers, groupByMaker,
  groupDictionarySearch, planDictGroups, compareMakerName, DICT_MAKER_PAGE,
  dictionaryRowDetail, dictionarySeriesList,
  splitSeriesFromName,
  normalizeImageUrl, recordPurchase, costSummary, costRows, buildItemsCsvText, mergeStates,
  folderParentId, folderChildren, folderChain, folderDepth, folderPathLabel, folderSubtreeIds,
  folderTree, folderOptions, countByFolderDeep,
  FAVORITE_FOLDER_ID, FAVORITE_FOLDER, isFavoriteFolder, favoriteItems, countFavorites,
  ALL_FOLDER_ID, ALL_FOLDER, isAllFolder, unfiledItems,
  toggleSelection, isSelected, selectAllIds, pruneSelection, searchDictionary, dictionaryHaystack,
  isMakerGroupOn, withSortMode,
  groupByFolder, findItemByJanInFolder, itemsByJanInOtherFolders,
  syncItemsWithDictionary, describeSyncItemsResult, SYNC_ITEMS_CONFIRM_TEXT,
  groupItemsAcrossFolders, otherPlaceSummary, countOtherPlaces,
  addItemToAnotherFolder, describeAddPlaceError,
} from './core.js';
import {
  FREE_ITEM_LIMIT, FREE_FOLDER_LIMIT, PRO_BENEFITS, isPro, itemQuota, folderQuota,
  canAddItem, canAddFolder, canUseFeature, describeQuota, isQuotaTight,
} from './pro.js';
import {
  PRO_PLANS, PLAN_ORDER, WEB_PURCHASE_NOTE, planVisibility, planPriceLabel,
  purchaseFromSettings, hasProPurchase, purchasedPlanName, planStatusLabel,
  settingsWithPurchase, subscriptionNoticeText, ProStore,
} from './iap.js';
import {
  sampleItems, mergeSampleItems, shouldSeedSamples, readSampleSeeded, writeSampleSeeded,
  hasSampleItems, removeSampleItems,
  backfillSampleImages,
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
  DEFAULT_FACING, toggleFacing, facingLabel, facingConstraints, scannerFacingConfig, canChooseFacing,
  nativeScanOptions, vendorScannerOptions, vendorStartConfig,
} from './scanner.js';
import { withTimeout, NATIVE_SCAN_OPEN_TIMEOUT_MS } from './scan-guard.js';
import {
  createScanSession, resetScanSession, checkCooldown, markScanned, applyScan, scanFolderId,
  scanLogCount, describeScanLog,
} from './scan-flow.js';
import { shouldOpenExternally, openInExternalBrowser, legalDocKey, LEGAL_DOCS } from './links.js';
import {
  compressImageFile, listPhotos, putPhoto, deletePhoto, clearPhotos, fetchProductImageInfo,
  resolveImageProxyUrl, normalizeProxyUrl, canUseImageProxy, sourceLabel,
} from './images.js';
import {
  autoImageJan, needsAutoImage, applyFetchedImage, shouldApplyFormImage, fetchAutoImage,
  describeFetchedImage, pendingAutoImages, shouldRunAutoFill,
  AUTO_IMAGE_FILL_GAP_MS, AUTO_IMAGE_FILL_ROUNDS,
} from './auto-image.js';
import { setupAdBanner } from './admob.js';
import { exportFile, exportFailureMessage } from './export-file.js';
import {
  THEME_MODES, normalizeTheme, resolveTheme, themeColor, themeLabel, readStoredTheme,
  writeStoredTheme, prefersDark,
} from './theme.js';

const $ = (id) => document.getElementById(id);

// iOSアプリ（Capacitor）で動いているか。Web（GitHub Pages）では課金しない。
const NATIVE_APP = isNativeShell(typeof window !== 'undefined' ? window : {});

let state = loadState();
let ui = {
  tab: 'stock',
  stockMode: 'place',  // 在庫タブの見方（'place' = 場所ごと / 'maker' = メーカーごと）
  folderId: 'all',       // 'all' = トップ（すべて） / それ以外 = 開いているフォルダ
  query: '',
  category: 'all',
  status: 'all',
  maker: 'all',
  layout: state.settings.layout === 'list' ? 'list' : 'grid',
  searchOpen: false,
  favoriteOnly: false,   // 絞込：お気に入りだけを出す
  openMakers: new Set(), // メーカー別タブで開いているまとまり
  editingId: null,
  moveIds: [],
  addPlaceId: null,      // 「別の場所に追加」で複製する元の画材
  folderEditId: null,
  costKey: 'category',   // 画材費の内訳（カテゴリ / メーカー）
  selectMode: false,     // 複数選択モード
  selected: [],          // 選択中の画材ID
  formBrand: '',         // 辞書から入れたブランド（フォームに欄は出さない）
};
let pendingRestore = null; // 復元シートで待っている読み込み内容
let scanner = null; // html5-qrcode instance
let rafId = 0;
let adBanner = null; // 最下部のAdMobバナー（起動の最後に作る）
let proStore = null; // Proの課金（iOSアプリのときだけ中身が入る）

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
  if (info) info.textContent = `対応画材数：${merged.items.length.toLocaleString('ja-JP')}件${dictSyncing ? '（更新中）' : ''}`;
  const state = $('dictSyncState');
  if (state) state.textContent = describeSyncState(dictSync, { cachedCount: extraEntries.length });
  if ($('sheetDict')?.classList.contains('open')) renderDictList($('dictQ').value);
  if (ui.tab === 'catalog') renderSearchTab();
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
    series: $('fSeries').value,
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
let photosReady = false;     // 手元写真を読めたか（読めていないうちは画像の後補完をしない）
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
/** 起動時に保存済みの手元写真をまとめて読み込む（読み込めたら true） */
async function preloadPhotos() {
  try {
    const rows = await listPhotos();
    for (const row of rows) if (row && row.id && row.blob) setPhotoUrl(row.id, row.blob);
    photoCount = rows.length;
    photosReady = true;
    render();
    return true;
  } catch (e) {
    console.warn('写真の読み込みに失敗', e);
    photosReady = false;
    return false; // 写真が読めないときはサンプルの画像補完をしない（写真を上書きしないため）
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

/** 設定の「サンプルを消す」: サンプルの画材（sample-01〜08）だけを取り除く（自分の画材は残す） */
function removeSamples() {
  const { state: next, removed } = removeSampleItems(state);
  if (!removed) { toast('サンプルは入っていません'); return; }
  state = next;
  save();
  render();
  toast(`サンプルを${removed}点消しました`);
}

/** 設定の「サンプル」カード: 入っていれば「サンプルを消す」、無ければ「サンプルを入れる」 */
function renderSampleCard() {
  const btn = $('btnAddSamples');
  if (!btn) return;
  const has = hasSampleItems(state);
  btn.textContent = has ? 'サンプルを消す' : 'サンプルを入れる';
  btn.dataset.sampleMode = has ? 'remove' : 'add';
  btn.setAttribute('aria-label', has ? 'サンプルを消す（自分で登録した画材はそのまま残ります）' : 'サンプルを入れる');
}

/**
 * 設定の「画材名を最新にする」: JANが一致する在庫の表記（商品名・メーカー・色名など）を
 * 最新の辞書の内容へ揃える。数量・メモ・フォルダ・写真・価格は触らない（core.js の純粋関数）。
 */
function syncItemNamesWithDictionary() {
  const preview = syncItemsWithDictionary(state.items, mergedDict);
  if (!preview.updatedCount) {
    toast(describeSyncItemsResult(0));
    return;
  }
  if (!confirm(SYNC_ITEMS_CONFIRM_TEXT)) return;
  state = { ...state, items: preview.items };
  save();
  render();
  toast(describeSyncItemsResult(preview.updatedCount));
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

/* ---------------- 絵具の色を推測（タイルのチューブ色） ---------------- */
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
  brush: '#8a6b4f', canvas: '#d8cbb4', paper: '#e4dccb',
  pastel: '#c58fa8', colored_pencil: '#b0653d', pencil: '#8d949c', crayon: '#d08a2e',
  charcoal: '#5b6066', pen: '#4a6f8f', copic: '#7b61c9', marker: '#c2543f',
  frame: '#a8862f', nihonga: '#3f5d54',
  other: '#9aa3ad',
};

// 絵の具はチューブ、それ以外は道具の形で棚に並べる
const GLYPH = {
  brush: { icon: 'i-brush', color: '#8a6b4f' },
  canvas: { icon: 'i-canvas', color: '#a88a5e' },
  paper: { icon: 'i-paper', color: '#8894a1' },
  frame: { icon: 'i-paper', color: '#a8862f' },
  pencil: { icon: 'i-pen', color: '#6f7780' },
  colored_pencil: { icon: 'i-pen', color: '#b0653d' },
  pen: { icon: 'i-pen', color: '#4a6f8f' },
  copic: { icon: 'i-pen', color: '#7b61c9' },
  marker: { icon: 'i-pen', color: '#c2543f' },
  pastel: { icon: 'i-tube', color: '#c58fa8' },
  crayon: { icon: 'i-tube', color: '#d08a2e' },
  charcoal: { icon: 'i-tube', color: '#5b6066' },
  nihonga: { icon: 'i-brush', color: '#3f5d54' },
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
// 在庫タブは「お気に入り → フォルダ → 画材」を上から1つの流れで並べる（ファイル／メモ型）。
// 下部の2段ドックは無くし、操作は右上の検索と「⋯」メニューにまとめている。
function render() {
  applyTheme();
  renderHeader();
  renderHeaderActions();
  renderCrumb();
  renderSmartGrid();
  renderFolderGrid();
  renderItemSection();
  renderMakerView();
  renderShopping();
  renderSearchTab();
  renderFolders();
  renderSettings();
  renderFilterSheet();
  renderSelectBar();
  document.querySelectorAll('#tabbar button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab));
  });
  // 在庫タブの中の「場所 / メーカー」
  const stockMode = ui.stockMode === 'maker' ? 'maker' : 'place';
  document.querySelectorAll('#stockSeg button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.stockMode === stockMode));
  });
  $('stockPlaceView').hidden = ui.tab !== 'stock' || stockMode !== 'place';
  $('stockMakerView').hidden = ui.tab !== 'stock' || stockMode !== 'maker';
  placeStockSeg();
  for (const t of ['stock', 'shopping', 'catalog', 'settings']) $(`view-${t}`).hidden = t !== ui.tab;
  const fabVisible = (ui.tab === 'stock' || ui.tab === 'shopping') && !ui.selectMode;
  $('btnAdd').style.visibility = fabVisible ? 'visible' : 'hidden';
  $('btnScan').style.visibility = fabVisible ? 'visible' : 'hidden'; // 右下の＋の上（読取）
  syncBottomMetrics();
}

/**
 * 下部UI（タブバー・FAB）の高さを実測してCSS変数に入れる。
 * AdMob バナーは --ad-h（ネイティブで出ている間だけJSが入れる）で、FABはその上に乗る。
 * ドックは無くなったので --dock-h は常に0（既定値のまま）。
 */
function syncBottomMetrics() {
  document.documentElement.style.setProperty('--dock-h', '0px');
  // FABは「＋」とその上の「読取」の2段分（52 + 8 + 44）＋余白。選択中は隠すので0
  const fabH = (ui.tab === 'stock' || ui.tab === 'shopping') && !ui.selectMode ? 118 : 0;
  document.documentElement.style.setProperty('--fab-h', `${fabH}px`);
}
window.addEventListener('resize', syncBottomMetrics);

function renderHeader() {
  const s = summarize(state.items);
  $('hdrTotal').textContent = `全${s.kinds}種`;
}

/** 右上の検索と⋯（絞込・並替・表示・選択・フォルダの並びをここに集約） */
function renderHeaderActions() {
  const searchOpen = Boolean(ui.searchOpen);
  $('btnSearch').setAttribute('aria-pressed', String(searchOpen));
  $('searchRow').hidden = !searchOpen;
  const filtering = hasFilters();
  const sorting = state.settings.sort !== 'updated';
  // 絞込・並びが入っているときは、⋯に小さな点を出して気づけるようにする
  $('btnMore').classList.toggle('has-dot', filtering || sorting);
  $('moreFilterState').textContent = filtering ? 'あり' : '';
  $('moreSortState').textContent = String(SORT_MODES.find((m) => m.id === state.settings.sort)?.label || '').replace(/^並び：/, '');
  $('moreLayoutState').textContent = ui.layout === 'list' ? 'リスト' : 'グリッド';
  $('moreSelectLabel').textContent = ui.selectMode ? '選択をやめる' : '複数選択';
}

/** 検索以外の絞り込みが入っているか */
function hasFilters() {
  return ui.category !== 'all' || ui.status !== 'all' || ui.maker !== 'all' || ui.favoriteOnly;
}

/** フォルダを開いているときだけ、ヘッダーの下に現在地のパンくず（家 › 親 › 子 › 孫）を出す */
function renderCrumb() {
  const fav = isFavoriteFolder(ui.folderId);
  const all = isAllFolder(ui.folderId);
  const open = ui.folderId !== 'all';
  $('crumb').hidden = !open || ui.tab !== 'stock' || ui.stockMode === 'maker';
  // 途中の階層をタップすると、そこへ一気に移動できる（幅が足りないときはCSSで折り返す）
  const chain = open && !fav && !all ? folderChain(state.folders, ui.folderId) : [];
  // 特別フォルダ（お気に入り・すべての画材）は階層を持たないので、現在地だけを出す
  $('crumbTrail').innerHTML = (fav
    ? [{ id: FAVORITE_FOLDER_ID, name: FAVORITE_FOLDER.name }]
    : all
      ? [{ id: ALL_FOLDER_ID, name: ALL_FOLDER.name }]
      : chain
  ).map((f, i, arr) => {
    const here = i === arr.length - 1;
    const label = here ? ' aria-current="page"' : ` aria-label="${esc(f.name)}へ移動"`;
    // 区切りの › と階層名は1つのまとまりにして、折り返しで離ればなれにならないようにする
    return '<span class="step"><span class="sep" aria-hidden="true">›</span>'
      + `<button class="cbtn name${here ? ' here' : ''}" data-crumb="${esc(f.id)}"${label}>${esc(f.name)}</button></span>`;
  }).join('');
  // 残り枠は数字だけ（例: 12 / 100点）
  const q = itemQuota(state, state.settings);
  $('quotaNote').textContent = describeQuota(q);
  $('quotaNote').classList.toggle('tight', isQuotaTight(q));
}

/**
 * 「場所 / メーカー」の小さな切り替えを、いま出ている見出しの右横へ置く。
 * 場所ごと＝フォルダの見出し（フォルダ欄が出ないときは画材の見出し）／メーカーごと＝メーカーの見出し。
 * 要素は1つだけ作って移すので、選ばれている状態は常に1か所だけになる。
 */
function placeStockSeg() {
  const seg = $('stockSeg');
  const slot = ui.stockMode === 'maker' ? $('segSlotMaker')
    : ($('folderGrid').hidden ? $('segSlotItems') : $('segSlotFolder'));
  if (slot && seg.parentElement !== slot) slot.appendChild(seg);
}

/**
 * ルートの上段「スマートフォルダ」（お気に入り・すべての画材）。
 * フォルダをまたいで集める仮想の見方なので、フォルダの一覧とは別の行に横2つで並べる。
 */
function renderSmartGrid() {
  const root = ui.folderId === 'all';
  const show = ui.tab === 'stock' && ui.stockMode !== 'maker' && !ui.query && !hasFilters() && root;
  $('smartGrid').hidden = !show;
  if (!show) { $('smartGrid').innerHTML = ''; return; }
  const favCount = countFavorites(state.items);
  const allCount = state.items.length;
  $('smartGrid').innerHTML = `
    <button class="stile" data-folder="${esc(FAVORITE_FOLDER_ID)}">
      <span class="sico" style="--c:${esc(FAVORITE_FOLDER.color)};--cs:${rgba(FAVORITE_FOLDER.color, 0.13)}">
        <svg class="ic" aria-hidden="true"><use href="#i-star-solid"/></svg>
      </span>
      <span class="stxt"><span class="sname">${esc(FAVORITE_FOLDER.name)}</span><span class="scnt">${favCount}点</span></span>
    </button>
    <button class="stile" data-folder="${esc(ALL_FOLDER_ID)}">
      <span class="sico" style="--c:${esc(ALL_FOLDER.color)};--cs:${rgba(ALL_FOLDER.color, 0.13)}">
        <svg class="ic" aria-hidden="true"><use href="#i-grid"/></svg>
      </span>
      <span class="stxt"><span class="sname">${esc(ALL_FOLDER.name)}</span><span class="scnt">${allCount}点</span></span>
    </button>`;
}

/** 今いる場所のフォルダ（ルートなら最上位、フォルダの中ならその子フォルダ）＋「＋ フォルダ」 */
function renderFolderGrid() {
  // 特別フォルダ（お気に入り・すべての画材）の中にはフォルダを作らない（子を持たない）
  const fav = isFavoriteFolder(ui.folderId);
  const all = isAllFolder(ui.folderId);
  const show = ui.tab === 'stock' && ui.stockMode !== 'maker' && !ui.query && !hasFilters() && !fav && !all;
  $('folderGrid').hidden = !show;
  // フォルダの一覧を出さないときは見出しごと畳む（現在地はすぐ下のパンくずが伝える）
  $('folderSecHead').hidden = !show;
  $('folderSecTitle').hidden = !show;
  if (!show) { $('folderGrid').innerHTML = ''; return; }
  const parentId = ui.folderId === 'all' ? '' : ui.folderId;
  const kids = folderChildren(state.folders, parentId);
  const counts = countByFolderDeep(state.folders, state.items);
  $('folderSecTitle').textContent = parentId ? 'この中のフォルダ' : 'フォルダ';
  // ルートでは「お気に入り」と「すべての画材」を上の段（#smartGrid）に出しているのでここには並べない
  const tiles = kids.map((f) => {
    const color = f.color || '#5b6b7c';
    const children = folderChildren(state.folders, f.id).length;
    return `
    <button class="ftile" data-folder="${esc(f.id)}" style="--c:${esc(color)};--cs:${rgba(color, 0.13)}">
      <span class="fico">
        <svg class="ic" aria-hidden="true"><use href="#i-folder-solid"/></svg>
        <span class="fcnt">${counts[f.id] || 0}</span>
        ${children ? `<span class="fsub">子${children}</span>` : ''}
      </span>
      <span class="fname">${esc(f.name)}</span>
    </button>`;
  });
  // フォルダが無くても「＋ フォルダ」だけは出す（作り始められるように）
  tiles.push(`
    <button class="ftile add" data-add-folder="1" aria-label="フォルダを作る">
      <span class="fico"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg></span>
      <span class="fname">フォルダ</span>
    </button>`);
  $('folderGrid').innerHTML = tiles.join('');
}

/** 画材一覧（今いる場所のすべて。検索中は全体から探す） */
function renderItemSection() {
  // 「メーカーごと」を見ている間は場所の一覧を作らない（隠れているうえ、行数が多いと重い）
  if (ui.stockMode === 'maker') return;
  const fav = isFavoriteFolder(ui.folderId);
  const all = isAllFolder(ui.folderId);
  const root = ui.folderId === 'all';
  const list = currentList();
  // ルートは「未分類」だけ（フォルダに入れた画材はフォルダを開いて見る）。
  // 検索中は場所をまたいでいるので、未分類の見出しにはしない。
  const unfiledOnly = root && !ui.query;
  $('itemSec').hidden = unfiledOnly && !hasFilters() && list.length === 0;
  $('itemSecTitle').textContent = ui.query ? '検索結果'
    : (fav ? FAVORITE_FOLDER.name
      : all ? ALL_FOLDER.name
        : (root ? '未分類' : folderOf(ui.folderId).name));
  $('itemCount').textContent = String(list.length);
  // 「お気に入り」「すべての画材」はどのフォルダから来たかが分かるよう、フォルダの色の点を出す
  renderTilesInto($('itemList'), list, {
    emptyKey: fav ? 'favorites' : (unfiledOnly ? 'unfiled' : 'items'),
    // お気に入り・すべての画材・未分類は、どのフォルダのものか分かるようにする
    showFolder: all || fav || unfiledOnly,
    // フォルダを1つだけ開いているときは、まとめずに「他：アトリエ1」を添える
    otherPlaces: ui.folderId !== 'all' && !fav && !all && !ui.query,
  });
}

/** メーカー別: メーカーごとに開いて中を見る（見出しに件数。在庫タブの「メーカーごと」） */
function renderMakerView() {
  if (!$('makerGroups')) return;
  const items = state.items;
  const makers = listMakers(items);
  const groups = makers.map((m) => ({ key: m, label: m, items: items.filter((it) => itemMaker(it) === m) }));
  const unfiled = items.filter((it) => !itemMaker(it));
  if (unfiled.length) groups.push({ key: MAKER_NONE, label: '未設定', items: unfiled });
  if (!groups.length) {
    $('makerGroups').innerHTML = '<div class="empty"><b>まだ画材がありません</b>右下の＋ か 読取 から登録できます</div>';
    return;
  }
  $('makerGroups').innerHTML = groups.map((g) => {
    const open = ui.openMakers.has(g.key);
    const sorted = favoritesFirst(sortItems(g.items, state.settings.sort));
    // メーカーの中は複数のフォルダが混ざるので、同じJANは「計 N点 ＋ /└」にまとめる
    const body = !open ? '' : (ui.layout === 'list'
      ? `<div class="mlist">${itemsBodyHtml(sorted, { showFolder: true, forceList: true })}</div>`
      : itemsBodyHtml(sorted, { showFolder: true }));
    return `<section class="mg${open ? ' open' : ''}">
      <button type="button" class="mghead" data-maker-group="${esc(g.key)}" aria-expanded="${open ? 'true' : 'false'}">
        <svg class="ic chev" aria-hidden="true"><use href="#i-chevron"/></svg>
        <span class="mgname">${esc(g.label)}</span>
        <b>${g.items.length}</b>
      </button>
      ${body}
    </section>`;
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

// 実画像が読み込めたら、枠に hasimg を付ける（背景の「画像なし」アイコンと棚の影をCSSで完全に隠す）。
// 画像が壊れていた／読み込めなかったときは付けないので、これまでどおりアイコン表示に戻る。
document.addEventListener('load', (e) => {
  const img = e.target;
  if (!img || img.tagName !== 'IMG') return;
  if (!img.classList.contains('shelfimg')) return;
  if (img.classList.contains('imgfail')) return;
  img.classList.add('imgloaded');
  // グリッドの棚（.sw）・リストのサムネイル（.thumb）のどちらでも親が枠
  img.parentElement?.classList.add('hasimg');
}, true);

/**
 * 左スワイプで右端から出る赤い「削除」ボタン。
 * 行の中身（.swipe-inner）より前に置き、中身が左へずれた分だけ見えるようにする（重なりはCSS）。
 * 押すと編集シート・長押しメニューの削除と同じ removeItem（確認＋写真の削除）を通す。
 */
function swipeDeleteButton(id) {
  return `<button type="button" class="swipe-del" data-swipe-del="${esc(id)}" tabindex="-1" aria-label="この画材を削除">削除</button>`;
}

/**
 * 画材タイル1枚（在庫切れはグレー表示。操作は通常どおり）。
 * カードの下に「お気に入りの星」と「− 数 ＋」を並べる（編集シートを開かずにその場で増減できる）。
 * 画像の上には何も載せない（星は写真を隠さず、下のボタンで押す）。
 * HTML のボタンは入れ子にできないので、カード（タップで編集を開くボタン）と星・ステッパーは
 * 同じ枠（.tilewrap）の中できょうだいとして並べる。
 */
function itemTile(it, opts = {}) {
  const st = statusMeta(it.status);
  const isEmpty = isEmptyStock(it);
  const out = isEmpty;
  const low = !out && st.id === 'low';
  const glyph = GLYPH[it.category];
  const base = glyph ? glyph.color : guessColor(it);
  const icon = glyph ? glyph.icon : 'i-tube';
  const f = folderOf(it.folderId);
  // フォルダの色の点は、全体をまとめて見ているとき（または指定されたとき）だけ出す
  const showFolder = opts.showFolder ?? (ui.folderId === 'all');
  const dot = showFolder ? `<span class="fdot" style="background:${esc(f.color)}"></span>` : '';
  const qty = Number(it.qty) || 0;
  const fav = it.favorite === true;
  const label = `${displayName(it)} ${qty}点${out ? ' 要補充' : low ? ' 少なめ' : ''}${fav ? ' お気に入り' : ''}`;
  // フォルダを1つだけ開いているときの添え書き（タイルは幅が狭いので「他1か所」だけ）
  const otherPlaces = opts.otherPlaces ? countOtherPlaces(state.items, it) : 0;
  const otherNote = otherPlaces ? `他${otherPlaces}か所` : '';
  const selected = ui.selectMode && isSelected(ui.selected, it.id);
  const selectAttrs = ui.selectMode
    ? ` data-select="${esc(it.id)}" aria-pressed="${selected ? 'true' : 'false'}"`
    : ` data-edit="${esc(it.id)}"`;
  const star = `<button type="button" class="fav${fav ? ' on' : ''}" data-fav="${esc(it.id)}" aria-pressed="${fav ? 'true' : 'false'}" aria-label="${fav ? 'お気に入りをはずす' : 'お気に入りにする'}"><svg class="ic" aria-hidden="true"><use href="#${fav ? 'i-star-solid' : 'i-star'}"/></svg></button>`;
  const stepper = `<span class="tstep" role="group" aria-label="在庫数">
      <button type="button" class="step" data-step="-1" data-id="${esc(it.id)}" aria-label="1減らす"><svg class="ic" aria-hidden="true"><use href="#i-minus"/></svg></button>
      <b class="n">${qty}</b>
      <button type="button" class="step" data-step="1" data-id="${esc(it.id)}" aria-label="1増やす"><svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg></button>
    </span>`;
  return `
  <div class="tilewrap swipe${low ? ' low' : ''}${out ? ' out' : ''}${ui.selectMode ? ' selecting' : ''}" data-swipe-id="${esc(it.id)}" data-swipe-kind="item" style="--c:${esc(base)};--c2:${esc(shade(base))};--cs:${rgba(base, 0.1)}">
    ${swipeDeleteButton(it.id)}
    <div class="swipe-inner">
    <button class="tile${low ? ' low' : ''}${out ? ' out' : ''}${isEmpty ? ' item-card--empty' : ''}${ui.selectMode ? ' selecting' : ''}${selected ? ' sel' : ''}" data-empty="${isEmpty ? '1' : '0'}"${selectAttrs} aria-label="${esc(label)}">
      <span class="sw">
        ${dot}
        <svg class="inh" aria-hidden="true"><use href="#${icon}"/></svg>
        ${shelfImage(it)}
        ${ui.selectMode ? '<span class="selmark" aria-hidden="true"></span>' : ''}
      </span>
      <span class="tname">${esc(displayName(it))}</span>
      ${otherNote ? `<span class="tother" title="${esc(otherPlaceSummary(state.items, it, state.folders))}">${esc(otherNote)}</span>` : ''}
    </button>
    ${ui.selectMode ? '' : `<span class="tilefoot">${star}${stepper}</span>`}
    </div>
  </div>`;
}

/** 1件＝2行の高密度リスト行（ステッパー付き） */
function itemRow(it, opts = {}) {
  const st = statusMeta(it.status);
  const isEmpty = isEmptyStock(it);
  const f = folderOf(it.folderId);
  const glyph = GLYPH[it.category];
  const thumbColor = glyph ? glyph.color : guessColor(it);
  const thumbIcon = glyph ? glyph.icon : 'i-tube';
  const selected = ui.selectMode && isSelected(ui.selected, it.id);
  const selectAttrs = ui.selectMode ? ` data-select="${esc(it.id)}" aria-pressed="${selected ? 'true' : 'false'}"` : '';
  const fav = it.favorite === true;
  // 補充リスト（通販ボタンでフォルダチップの場所を使う行）は、どのフォルダの分が足りないのかが
  // 分かるよう、場所の名前を小さなバッジで出す（同じ画材が複数フォルダにあっても見分けられる）。
  const placeChip = opts.shopChip
    ? `<span class="badge place" title="${esc(folderPathLabel(state.folders, it.folderId, ' › '))}"><span class="pdot" style="background:${esc(f.color)}"></span>${esc(f.name)}</span>`
    : '';
  const first = opts.shopChip
    ? `${placeChip}<button class="folder-tag shop-chip" data-shop-for="${esc(it.id)}">通販</button>`
    : `<button class="folder-tag" data-move="${esc(it.id)}">${esc(f.name)} ▾</button>`;
  // 右端のボタンは鉛筆（編集）ではなくお気に入りの星。編集は商品名のタップから開く
  const star = ui.selectMode ? '' : `<button type="button" class="icon-btn favbtn${fav ? ' on' : ''}" data-fav="${esc(it.id)}" aria-pressed="${fav ? 'true' : 'false'}" aria-label="${fav ? 'お気に入りをはずす' : 'お気に入りにする'}"><svg class="ic" aria-hidden="true"><use href="#${fav ? 'i-star-solid' : 'i-star'}"/></svg></button>`;
  // フォルダを1つだけ開いているときの「他：アトリエ 1点」（行の幅は使わず、次の行に小さく）
  const others = opts.otherPlaces ? otherPlaceSummary(state.items, it, state.folders) : '';
  return `
  <article class="item swipe${isEmpty ? ' item-card--empty' : ''}${ui.selectMode ? ' selecting' : ''}${selected ? ' sel' : ''}" data-empty="${isEmpty ? '1' : '0'}" data-id="${esc(it.id)}" data-swipe-id="${esc(it.id)}" data-swipe-kind="item"${selectAttrs}>
    ${swipeDeleteButton(it.id)}
    <div class="swipe-inner">
    <span class="thumb"><svg class="ic" aria-hidden="true" style="color:${esc(thumbColor)}"><use href="#${thumbIcon}"/></svg>${shelfImage(it)}${ui.selectMode ? '<span class="selmark" aria-hidden="true"></span>' : ''}</span>
    <div class="it-main" data-edit="${esc(it.id)}">
      <h3 class="it-name" title="タップで編集">${esc(displayName(it))}</h3>
      <div class="it-sub">
        ${first}
        <span class="badge ${st.tone}" title="${esc(st.label)}">${esc(st.short || st.label)}</span>
      </div>
      ${others ? `<div class="it-other">${esc(others)}</div>` : ''}
    </div>
    <div class="it-side">
      <button class="step" data-step="-1" data-id="${esc(it.id)}" aria-label="1減らす">−</button>
      <span class="qty">${Number(it.qty) || 0}<small>点</small></span>
      <button class="step" data-step="1" data-id="${esc(it.id)}" aria-label="1増やす">＋</button>
      ${star}
    </div>
    </div>
  </article>`;
}

/**
 * 一覧の見出しのまとまり（すべて / フォルダ別 / メーカー別）。
 * 見出しの右の数字は、そのまとまりの点数。
 */
function viewBlocks(items, group) {
  if (group === 'maker') {
    return [...groupByMaker(items)].sort((a, b) => compareMakerName(a.maker || '未設定', b.maker || '未設定'))
      .map((g) => ({ label: g.maker || '未設定', items: g.items }));
  }
  if (group === 'folder') {
    // 見出しのフォルダでも長押しメニューを開けるよう、フォルダIDを持たせる
    return groupByFolder(items, state.folders).map((g) => ({ label: g.name || '未分類', items: g.items, folderId: g.folderId }));
  }
  return [{ label: '', items }];
}

/**
 * 同じ画材が複数のフォルダにあるときの親カード。
 * 見出しに画材名・画像・合計数（計 4点）・星（どれかお気に入りなら点灯）を出し、
 * 中に各フォルダの行を ┣ / └ のツリーで並べる。行からは、そのまま数量の増減・
 * フォルダ移動（移動＝この1点を移す）・詳細編集ができる。
 * 親の星は、そのJANの点をまとめてお気に入りにする（どれか1つでも入っていれば外す）。
 */
function janGroupCard(g, opts = {}) {
  const it = g.sample || g.items[0] || {};
  const glyph = GLYPH[it.category];
  const thumbColor = glyph ? glyph.color : guessColor(it);
  const thumbIcon = glyph ? glyph.icon : 'i-tube';
  const isEmpty = !(g.total > 0);
  const fav = g.favorite === true;
  const star = `<button type="button" class="icon-btn favbtn${fav ? ' on' : ''}" data-fav-group="${esc(g.jan)}" aria-pressed="${fav ? 'true' : 'false'}" aria-label="${fav ? 'この画材のお気に入りをすべて外す' : 'この画材をすべてお気に入りにする'}"><svg class="ic" aria-hidden="true"><use href="#${fav ? 'i-star-solid' : 'i-star'}"/></svg></button>`;
  const rows = g.items.map((m, i) => {
    const f = folderOf(m.folderId);
    const last = i === g.items.length - 1;
    const qty = Number(m.qty) || 0;
    return `
      <div class="jg-row swipe${qty === 0 ? ' zero' : ''}" data-swipe-id="${esc(m.id)}" data-swipe-kind="place">
        ${swipeDeleteButton(m.id)}
        <div class="swipe-inner">
        <span class="jg-branch" aria-hidden="true">${last ? '└' : '┣'}</span>
        <button type="button" class="folder-tag jg-folder" data-move="${esc(m.id)}" aria-label="${esc(f.name)}から別のフォルダへ移す">${esc(f.name)} ▾</button>
        <button type="button" class="icon-btn jg-pen" data-edit="${esc(m.id)}" aria-label="詳細を編集"><svg class="ic" aria-hidden="true"><use href="#i-pen"/></svg></button>
        <span class="jg-step" role="group" aria-label="${esc(f.name)}の在庫数">
          <button type="button" class="step" data-step="-1" data-id="${esc(m.id)}" aria-label="1減らす">−</button>
          <b class="qty">${qty}<small>点</small></b>
          <button type="button" class="step" data-step="1" data-id="${esc(m.id)}" aria-label="1増やす">＋</button>
        </span>
        </div>
      </div>`;
  }).join('');
  const name = displayName({ ...it, name: g.name || it.name });
  return `
  <article class="jg${isEmpty ? ' item-card--empty' : ''}" data-jan="${esc(g.jan)}" style="--c:${esc(thumbColor)}">
    <div class="jg-head">
      <span class="thumb"><svg class="ic" aria-hidden="true" style="color:${esc(thumbColor)}"><use href="#${thumbIcon}"/></svg>${shelfImage(it)}</span>
      <div class="it-main">
        <h3 class="it-name">${esc(name)}</h3>
        <div class="it-sub">
          <span class="badge jg-total">計 ${g.total}点</span>
          <span class="jg-places">${g.items.length}か所</span>
        </div>
      </div>
      <div class="it-side">${star}</div>
    </div>
    <div class="jg-tree">${rows}</div>
    <button type="button" class="jg-add" data-addplace="${esc(it.id)}">＋ 別の場所に追加</button>
  </article>`;
}

/**
 * 画材群の中身（タイル／行／まとめカード）を作る。
 * 同じJANが2つ以上のフォルダに分かれている画材だけを「計 N点 ＋ ┣/└」にまとめる
 * （画面で複数のフォルダが混ざって並んでいる一覧でのみ意味がある。
 * 選択中・買い物リストではまとめない）。
 */
function itemsBodyHtml(items, opts = {}) {
  const plain = opts.noJanGroup || ui.selectMode;
  const rows = plain
    ? items.map((item) => ({ type: 'item', item }))
    : groupItemsAcrossFolders(items, state.folders);
  const list = opts.forceList || ui.layout === 'list';
  const body = rows.map((row) => (row.type === 'group'
    ? janGroupCard(row, opts)
    : (list ? itemRow(row.item, opts) : itemTile(row.item, opts)))).join('');
  return list ? body : `<div class="tgrid">${body}</div>`;
}

/** アイテム群をグリッド／リストで描画（見出しつきのグループ対応） */
function renderTilesInto(el, items, opts = {}) {
  if (!items.length) {
    el.innerHTML = opts.emptyKey === 'shopping'
      ? '<div class="empty"><b>補充はありません</b>残りわずか・使い切りがここに集まります</div>'
      : opts.emptyKey === 'favorites'
        ? '<div class="empty"><b>お気に入りはまだありません</b>カードの星を押すと、ここに集まります（元のフォルダにも残ります）</div>'
        : opts.emptyKey === 'unfiled'
          ? '<div class="empty"><b>未分類の画材はありません</b>フォルダに入れた画材は、各フォルダから見られます</div>'
        : (state.items.length
          ? '<div class="empty"><b>見つかりません</b>検索や絞込を変えてみてください</div>'
          : '<div class="empty"><b>まだ画材がありません</b>右下の＋ か 読取 から登録できます<button class="btn mini wide" data-add-samples>サンプルを入れる</button></div>');
    return;
  }
  const blocks = viewBlocks(items, opts.group);
  el.innerHTML = blocks.map((g) => {
    const head = g.label
      ? `<div class="mhead"${g.folderId ? ` data-folder-head="${esc(g.folderId)}"` : ''}><span>${esc(g.label)}</span><b>${g.items.length}</b></div>`
      : '';
    return head + itemsBodyHtml(g.items, opts);
  }).join('');
}

function renderShopping() {
  renderTilesInto($('shoppingList'), computeShoppingList(state.items), {
    group: false, emptyKey: 'shopping', shopChip: true, forceList: true, noJanGroup: true,
  });
}

function currentList() {
  // 親フォルダを開くと、配下のフォルダの画材もまとめて見る（直感的な挙動）
  // 検索のときは場所をまたいで全体から探す
  // ルートは「未分類」だけ（フォルダに入れた画材は各フォルダ・「すべての画材」から見る）
  // 「お気に入り」「すべての画材」は仮想フォルダで、フォルダをまたいで集める（実体は移動しない）
  const fav = isFavoriteFolder(ui.folderId);
  const all = isAllFolder(ui.folderId);
  const root = ui.folderId === 'all';
  const anywhere = Boolean(ui.query) || all || fav;
  const scope = anywhere ? null : folderSubtreeIds(state.folders, ui.folderId);
  let list = filterItems(state.items, {
    query: ui.query, folderId: anywhere ? 'all' : ui.folderId, folderIds: scope,
    category: ui.category, status: ui.status, maker: ui.maker,
    favoriteOnly: ui.favoriteOnly || fav,
  });
  if (root && !ui.query) list = unfiledItems(list, state.folders);
  return favoritesFirst(sortItems(list, state.settings.sort));
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
  // 商品画像の設定欄は画面から外した（中継サーバー経由の自動取得はそのまま動く）。
  // 入力欄がある版のHTMLでも動くよう、要素があるときだけ値を入れる。
  $('fRakuten') && ($('fRakuten').value = String(state.settings.rakutenAppId || ''));
  renderPlan();
  renderCost();
  renderSampleCard();
  renderDictionaryState();
}

/* ---------------- プラン（無料上限・Proプレビュー） ---------------- */
function yen(n) {
  return Math.max(0, Math.round(Number(n) || 0)).toLocaleString('ja-JP');
}

function renderPlan() {
  const q = itemQuota(state, state.settings);
  const fq = folderQuota(state, state.settings);
  // フォルダの枠は「あとから作った分」だけ数える（最初からある4つは数えない）
  $('proState').textContent = `${planStatusLabel(state.settings)} ・ 画材 ${describeQuota(q)} ・ フォルダ ${describeQuota(fq, 'つ')}`;
  $('proBenefits').innerHTML = PRO_BENEFITS.map((b) => `<span class="pro-chip">${esc(b.label)}</span>`).join('');
  renderProOffer();
  $('btnProToggle').textContent = isPro(state.settings) ? 'Proプレビューを終了' : 'Proプレビューを試す';
}

/**
 * プランの購入導線（買い切り・月額）と注記。
 * 買い切りを買った人には月額を出さない。Webでは購入できないので案内だけ出す。
 */
function renderProOffer() {
  // 購入状態は保存している設定から毎回読む（バックアップ復元などで設定が変わっても追従する）
  const purchase = purchaseFromSettings(state.settings);
  const visible = planVisibility(purchase);
  const cards = PLAN_ORDER.filter((key) => visible[key]).map((key) => {
    const plan = PRO_PLANS[key];
    const disabled = NATIVE_APP ? '' : ' disabled aria-disabled="true"';
    return `<button class="btn planbtn" data-pro-plan="${esc(plan.key)}"${disabled}>`
      + `<b>${esc(plan.title)}</b><span>${esc(planPriceLabel(plan.key))}</span></button>`;
  });
  const owned = hasProPurchase(purchase);
  const cardsHtml = cards.length
    ? cards.join('')
    : `<p class="planowned">${esc(purchasedPlanName(purchase))}プランが有効です</p>`;
  if ($('proPlans')) $('proPlans').innerHTML = cardsHtml;
  if ($('proSheetPlans')) $('proSheetPlans').innerHTML = cardsHtml;

  const links = '<a href="terms.html" target="_blank" rel="noopener noreferrer">利用規約</a> ・ '
    + '<a href="privacy.html" target="_blank" rel="noopener noreferrer">プライバシー</a>';
  // Webでも注記は出す（課金できないことと、月額の自動更新を短く）
  const rows = [];
  if (!NATIVE_APP) rows.push(esc(WEB_PURCHASE_NOTE));
  rows.push(owned ? 'Proが有効です' : esc(subscriptionNoticeText()));
  rows.push(links);
  const note = rows.map((row) => `<span class="pro-line">${row}</span>`).join('');
  if ($('proNote')) $('proNote').innerHTML = note;
  if ($('proSheetNote')) $('proSheetNote').innerHTML = note;

  // プレビューはWebの動作確認用（iOSアプリでは出さず、購入と復元だけで解放する）
  if ($('btnProToggle')) $('btnProToggle').hidden = NATIVE_APP;
  if ($('btnProStart')) $('btnProStart').hidden = NATIVE_APP || owned;
  for (const id of ['btnProRestore', 'btnProSheetRestore']) {
    if ($(id)) $(id).hidden = !NATIVE_APP;
  }
}

/** Proの案内シート（上限・Pro機能のどちらからでも同じ画面） */
function openProSheet(what = 'item') {
  const lead = {
    item: `無料は${FREE_ITEM_LIMIT}点まで`,
    folder: `無料で追加できるフォルダは${FREE_FOLDER_LIMIT}つまで`,
    cost: '画材費とCSVはPro',
  }[what] || 'Proで全部使えます';
  $('proLead').textContent = lead;
  $('proQuota').textContent = what === 'folder'
    ? `フォルダ ${describeQuota(folderQuota(state, state.settings), 'つ')}`
    : `画材 ${describeQuota(itemQuota(state, state.settings))}`;
  $('proSheetBenefits').innerHTML = PRO_BENEFITS.map((b) => `<span class="pro-chip">${esc(b.label)}</span>`).join('');
  renderProOffer();
  openSheet('sheetPro');
}

/** Pro機能かどうかを確かめ、使えなければ案内を出す */
function requirePro(feature) {
  if (canUseFeature(state.settings, feature)) return true;
  openProSheet(feature);
  return false;
}

function setProPreview(on) {
  if (NATIVE_APP) return; // iOSアプリでは購入と復元だけで解放する
  state = { ...state, settings: { ...state.settings, proPreview: Boolean(on) } };
  save();
  closeSheet('sheetPro');
  render();
  // Proの間は広告を出さない（終了したら戻す）
  adBanner?.sync();
  toast(on ? 'Proプレビューを有効にしました' : 'Proプレビューを終了しました');
}

/**
 * StoreKit の購入状態を設定へ反映する（上限・画材費・広告が即座に切り替わる）。
 * 呼び出し元は ProStore（購入・復元・期限切れの検知）。
 */
function applyPurchaseState(next) {
  const purchase = { lifetime: Boolean(next?.lifetime), monthly: Boolean(next?.monthly) };
  const settings = settingsWithPurchase(state.settings, purchase);
  const changed = settings.pro !== state.settings.pro
    || settings.proPlan !== state.settings.proPlan
    || settings.proLifetime !== state.settings.proLifetime
    || settings.proPreview !== state.settings.proPreview;
  if (changed) {
    state = { ...state, settings };
    save();
  }
  render();
  adBanner?.sync();
}

$('btnProToggle').addEventListener('click', () => setProPreview(!isPro(state.settings)));
$('btnProStart').addEventListener('click', () => setProPreview(true));
$('btnCostPro').addEventListener('click', () => openProSheet('cost'));

// 購入・復元のボタン（プラン画面と設定の両方。データ属性でまとめて受ける）
document.addEventListener('click', (e) => {
  const plan = e.target.closest && e.target.closest('[data-pro-plan]');
  if (plan) {
    e.preventDefault();
    if (!NATIVE_APP) { toast(WEB_PURCHASE_NOTE); return; }
    proStore?.purchase(plan.dataset.proPlan);
    return;
  }
  const restore = e.target.closest && e.target.closest('[data-pro-restore]');
  if (restore) {
    e.preventDefault();
    if (!NATIVE_APP) { toast(WEB_PURCHASE_NOTE); return; }
    proStore?.restore();
  }
});

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

/** 画材一覧をCSV（BOM付きUTF-8・Excelでそのまま開ける）で保存
 *  iOSアプリでは共有シート（“ファイル”に保存 等）、Webではダウンロード。 */
async function downloadCsv() {
  if (!requirePro('cost')) return;
  const text = buildItemsCsvText(sortItems(state.items, 'maker'), state.folders);
  const count = state.items.length;
  const result = await exportFile({ kind: 'csv', content: text });
  if (result.ok) {
    // 共有シート（“ファイル”に保存 等）で書き出したときも、Webのダウンロードと同じ言い方にそろえる
    toast(result.method === 'share' ? `${count}件をCSVで書き出しました` : `${count}件をCSVで保存しました`);
    return;
  }
  // 共有シートを閉じただけ（キャンセル）のときは何も出さない
  const message = exportFailureMessage(result);
  if (message) toast(message);
}

$('btnCsv').addEventListener('click', downloadCsv);

// 設定の「画材名を最新にする」（JAN辞書カード）
$('btnSyncItems').addEventListener('click', syncItemNamesWithDictionary);

/* ---------------- 画像取得の設定（画面からは外した。値はバックアップから引き継げる） ---------------- */
// 設定画面の「商品画像」カードは廃止したので、保存ボタンは無い版がある。
// 中継サーバー（同梱の既定URL）経由の自動取得はそのまま動く。
if ($('btnSaveImageSettings')) {
  $('btnSaveImageSettings').addEventListener('click', () => {
    const appId = $('fRakuten')?.value.trim().replace(/\s+/g, '') || '';
    const rakutenAccessKey = $('fAccessKey')?.value.trim().replace(/\s+/g, '') || '';
    const rawProxy = $('fProxyUrl')?.value.trim() || '';
    const imageProxyUrl = normalizeProxyUrl(rawProxy);
    if (rawProxy && !imageProxyUrl) { toast('中継サーバーURLは https:// から始まる形で入れてください'); return; }
    state = { ...state, settings: { ...state.settings, rakutenAppId: appId, rakutenAccessKey, imageProxyUrl } };
    save();
    render();
    toast('画像取得の設定を保存しました');
  });
}

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
  // お気に入りだけを出す（星の付いた画材を探しやすくする）
  $('favChips').innerHTML = chip('favonly', 'all', 'すべて', !ui.favoriteOnly)
    + chip('favonly', 'fav', 'お気に入り', ui.favoriteOnly);

  $('sortChips').innerHTML = SORT_MODES.map((m) =>
    `<button class="fchip" data-sort="${esc(m.id)}" aria-pressed="${state.settings.sort === m.id ? 'true' : 'false'}">${esc(m.label.replace(/^並び：/, ''))}</button>`).join('');
}

$('sheetFilter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-maker],[data-cat],[data-status],[data-favonly]');
  if (!b) return;
  if (b.dataset.maker !== undefined) ui.maker = b.dataset.maker;
  if (b.dataset.cat !== undefined) ui.category = b.dataset.cat;
  if (b.dataset.status !== undefined) ui.status = b.dataset.status;
  if (b.dataset.favonly !== undefined) ui.favoriteOnly = b.dataset.favonly === 'fav';
  render();
});
$('sheetSort').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sort]');
  if (!b) return;
  // 並び順はここで決める（メーカー別は下の「メーカー」タブで見る）
  state = { ...state, settings: withSortMode(state.settings, b.dataset.sort) };
  save();
  closeSheet('sheetSort');
  render();
});

/* ---------------- ナビゲーション・右上の操作 ---------------- */
// 家アイコンはフォルダのトップ（すべて）へ戻る
$('btnHome').addEventListener('click', () => {
  ui.folderId = 'all';
  ui.tab = 'stock';
  exitSelect();
  render();
  window.scrollTo({ top: 0 });
});
// パンくず（家 › 親 › 子 › 孫）の途中の階層をタップしたら、その階層へ移動する
$('crumbTrail').addEventListener('click', (e) => {
  const b = e.target.closest('[data-crumb]');
  if (!b) return;
  const id = b.dataset.crumb;
  if (!id || id === ui.folderId) return;
  ui.folderId = id;
  if (ui.selectMode) exitSelect();
  render();
  window.scrollTo({ top: 0 });
});
$('btnSearch').addEventListener('click', () => {
  ui.searchOpen = !ui.searchOpen;
  // 検索は在庫から探す（他のタブ・メーカーごとで押したら、場所ごとの在庫へ戻す）
  if (ui.searchOpen) { ui.tab = 'stock'; ui.stockMode = 'place'; }
  if (!ui.searchOpen) { ui.query = ''; $('q').value = ''; }
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
  if (ui.query && ui.folderId !== 'all') ui.folderId = 'all'; // 検索は全体から
  render();
});

/* ---------------- ⋯メニュー（絞込・並替・表示・複数選択・フォルダの並び） ---------------- */
$('btnMore').addEventListener('click', () => {
  renderHeaderActions();
  openSheet('sheetMore');
});
$('btnMoreFilter').addEventListener('click', () => {
  closeSheet('sheetMore');
  renderFilterSheet();
  openSheet('sheetFilter');
});
$('btnMoreSort').addEventListener('click', () => {
  closeSheet('sheetMore');
  renderFilterSheet();
  openSheet('sheetSort');
});
$('btnMoreLayout').addEventListener('click', () => {
  setLayout(ui.layout === 'list' ? 'grid' : 'list');
  closeSheet('sheetMore');
});
$('btnMoreSelect').addEventListener('click', () => {
  closeSheet('sheetMore');
  toggleSelectMode();
});
$('btnMoreFolders').addEventListener('click', () => {
  closeSheet('sheetMore');
  renderFolders();
  openSheet('sheetFolderOrder');
});

/** グリッド／リストの切替（設定に保存する） */
function setLayout(layout) {
  ui.layout = layout === 'list' ? 'list' : 'grid';
  state = { ...state, settings: { ...state.settings, layout: ui.layout } };
  save();
  render();
}

/** メーカー別タブ: 見出しをタップして開け閉める */
document.addEventListener('click', (e) => {
  const head = e.target.closest('[data-maker-group]');
  if (!head) return;
  const key = head.dataset.makerGroup;
  if (ui.openMakers.has(key)) ui.openMakers.delete(key);
  else ui.openMakers.add(key);
  render();
});

$('tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  const tab = b.dataset.tab;
  ui.tab = tab;
  if (tab !== 'stock') { exitSelect(); ui.searchOpen = false; ui.query = ''; $('q').value = ''; }
  stopScanner();
  render();
  window.scrollTo({ top: 0 });
});

// 在庫タブの中の「場所ごと ↔ メーカーごと」
$('stockSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-stock-mode]');
  if (!b) return;
  const mode = b.dataset.stockMode === 'maker' ? 'maker' : 'place';
  if (ui.stockMode === mode) return;
  ui.stockMode = mode;
  exitSelect(); // 複数選択は場所ごとの並びで使う
  render();
  window.scrollTo({ top: 0 });
});

// フォルダ（特別フォルダを含む）を開く
function openFolder(id) {
  ui.folderId = id;
  ui.tab = 'stock';
  ui.stockMode = 'place'; // フォルダの中は場所ごとの並びで開く
  exitSelect();
  render();
  window.scrollTo({ top: 0 });
}

// ルートの上段「お気に入り / すべての画材」をタップして中へ
$('smartGrid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-folder]');
  if (b) openFolder(b.dataset.folder);
});

// フォルダをタップして中へ／「＋ フォルダ」で作る
$('folderGrid').addEventListener('click', (e) => {
  const add = e.target.closest('[data-add-folder]');
  if (add) { addFolderAt(ui.folderId === 'all' ? '' : ui.folderId); return; }
  const b = e.target.closest('[data-folder]');
  if (b) openFolder(b.dataset.folder);
});

/* ---------------- 複数選択（一括移動） ---------------- */
function exitSelect() {
  ui.selectMode = false;
  ui.selected = [];
}
/** 選択モードの入/切（⋯メニューから） */
function toggleSelectMode() {
  if (ui.selectMode) { exitSelect(); render(); return; }
  ui.tab = 'stock';
  ui.stockMode = 'place'; // まとめて選ぶのは場所ごとの並びから
  ui.selectMode = true;
  ui.selected = [];
  render();
  toast('移動する画材を選んでください');
}
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
  if (goto) { ui.folderId = goto.dataset.gotoFolder; exitSelect(); render(); return; }
  // 子フォルダを作る
  const addChild = e.target.closest('[data-add-child]');
  if (addChild) { addFolderAt(addChild.dataset.addChild); return; }
  // まとめカードの星: 同じJANの点をまとめてお気に入りにする／外す
  const favGroup = e.target.closest('[data-fav-group]');
  if (favGroup) {
    e.preventDefault();
    e.stopPropagation();
    const jan = normalizeJAN(favGroup.dataset.favGroup);
    const members = state.items.filter((i) => normalizeJAN(i.jan) === jan);
    if (!jan || !members.length) return;
    const next = !members.every((m) => m.favorite === true);
    state = { ...state, items: state.items.map((i) => (normalizeJAN(i.jan) === jan ? toggleFavorite(i, next) : i)) };
    save();
    render();
    toast(next ? 'お気に入りにしました（お気に入りフォルダに入ります）' : 'お気に入りをはずしました');
    return;
  }
  // お気に入り（星）の切り替え。カードのタップ（編集シート）へは伝えない
  const favBtn = e.target.closest('[data-fav]');
  if (favBtn) {
    e.preventDefault();
    e.stopPropagation();
    const target = state.items.find((i) => i.id === favBtn.dataset.fav);
    if (!target) return;
    const next = toggleFavorite(target);
    state = upsertItem(state, next);
    save();
    render();
    toast(next.favorite ? 'お気に入りにしました（お気に入りフォルダに入ります）' : 'お気に入りをはずしました');
    return;
  }
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
    // カード上の −/＋ は、カードのタップ（編集シート）に伝えない
    e.preventDefault();
    e.stopPropagation();
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
  // 同じ画材を別のフォルダにも置く（移動ではない。今の1点は残る）
  const addPlace = e.target.closest('[data-addplace]');
  if (addPlace) { e.preventDefault(); e.stopPropagation(); openAddPlaceSheet(addPlace.dataset.addplace); return; }
  const edit = e.target.closest('[data-edit]');
  // フォルダ移動・通販のチップは、行全体のタップ（編集）より先に見る
  const mv = e.target.closest('[data-move]');
  if (mv) { openMoveSheet([mv.dataset.move]); return; }
  const shopBtn = e.target.closest('[data-shop-for]');
  if (shopBtn) {
    const item = state.items.find((i) => i.id === shopBtn.dataset.shopFor);
    if (item) openShopSheet(item);
    return;
  }
  if (edit) { openItemSheet(edit.dataset.edit); return; }
});

function openItemSheet(id, preset = {}) {
  const it = id ? state.items.find((i) => i.id === id) : null;
  // 新規登録だけ無料上限を見る（既存の画材は点数が上限を超えていても編集できる）
  if (!it && !canAddItem(state, state.settings).ok) { openProSheet('item'); return; }
  ui.editingId = it ? it.id : null;
  $('sheetItemTitle').firstChild.textContent = it ? '画材を編集' : '画材を追加';
  const data = it || createItem({ folderId: scanFolderId(state, ui.folderId), ...preset });
  $('fName').value = data.name || '';
  $('fMaker').value = data.maker || '';
  $('fCategoryInput').innerHTML = CATEGORIES.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
  $('fCategoryInput').value = data.category;
  $('fSeries').value = data.series || '';
  $('fColorName').value = data.colorName || '';
  $('fColorCode').value = data.colorCode || '';
  $('fSize').value = data.size || '';
  $('fQty').value = data.qty ?? 1;
  $('fStatusInput').innerHTML = STATUSES.map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
  $('fStatusInput').value = data.status;
  // 保管場所は階層をインデントで見せる（値はIDのまま）
  $('fFolderInput').innerHTML = folderOptions(state.folders, { noneLabel: null })
    .map((o) => `<option value="${esc(o.id)}">${'　'.repeat(o.depth)}${esc(o.label)}</option>`).join('');
  // 「＋ 別の場所に追加」は、保存済みの画材を編集しているときだけ出す
  $('addPlaceField').hidden = !it;
  $('fFolderInput').value = data.folderId;
  // お気に入り（特別フォルダ）への登録も編集シートから入/切できる
  setFormFavorite(data.favorite === true);
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
  $('btnSaveItem').textContent = it ? '保存' : '追加する';
  // 開くたびは「もっと詳しく」を閉じた状態から（中身があるときはバッジで知らせる）
  $('itemMore').open = false;
  refreshMoreBadge();
  updateJanHint();
  refreshFormShopLinks();
  openSheet('sheetItem');
  // 前回のスクロール位置が残ると、開いた瞬間に中ほどが見えてしまう
  $('sheetItemBody').scrollTop = 0;
  setTimeout(() => $('fName').focus({ preventScroll: true }), 120);
  // JANが入っていて画像・写真が未設定なら、そのまま画像を取りに行く（読取・辞書から開いたとき）
  autoFetchFormImage();
}

/**
 * 「もっと詳しく」を閉じていても中身があると分かるよう、入っている項目を短く添える。
 * （閉じていても値は消さない。保存は入力欄をそのまま読む）
 */
function refreshMoreBadge() {
  const badge = $('moreBadge');
  if (!badge) return;
  const parts = [];
  if (normalizeJAN($('fJan').value)) parts.push('JAN');
  const hasPhoto = (pendingPhoto && pendingPhoto.kind === 'set')
    || (!(pendingPhoto && pendingPhoto.kind === 'delete') && Boolean(ui.editingId && photoUrls.has(ui.editingId)));
  if (hasPhoto) parts.push('写真');
  if ($('fShop').value.trim()) parts.push('購入店');
  if (String($('fPrice').value).trim()) parts.push('単価');
  if ($('fMemo').value.trim()) parts.push('メモ');
  if (normalizeImageUrl($('fImageUrl').value)) parts.push('画像URL');
  badge.textContent = parts.length > 2 ? `${parts.length}件` : parts.join('・');
  badge.hidden = parts.length === 0;
}
for (const id of ['fJan', 'fShop', 'fPrice', 'fMemo', 'fImageUrl']) {
  $(id).addEventListener('input', refreshMoreBadge);
}

/** 編集シートの「お気に入り」ボタンの状態をそろえる */
function setFormFavorite(on) {
  const fav = on === true;
  const btn = $('fFav');
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(fav));
  btn.classList.toggle('on', fav);
  btn.querySelector('use').setAttribute('href', fav ? '#i-star-solid' : '#i-star');
  $('fFavLabel').textContent = fav ? 'お気に入りをはずす' : 'お気に入りにする';
}
$('fFav').addEventListener('click', () => {
  setFormFavorite($('fFav').getAttribute('aria-pressed') !== 'true');
});

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
  refreshMoreBadge();
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

/* ---------------- 商品画像の自動取得（読取・連続スキャン・辞書から） ---------------- */
// 「画像を取得」ボタンを押さなくても、JANが入った時点で静かに画像を取りに行く。
// 失敗（未ヒット・通信不可）は何も出さずにあきらめる（登録・読取・UI操作は止めない）。
let formImageToken = 0;              // 編集シートの自動取得が古くなっていないかを見る番号
const autoImageInFlight = new Set(); // 同じJANを二重に取りにいかない

/** 編集シートに画像を自動で入れる（JANがあり、画像URL・手元写真が未設定のときだけ） */
async function autoFetchFormImage() {
  formImageToken += 1;
  const token = formImageToken;
  const jan = autoImageJan($('fJan').value);
  if (!jan) return;
  if (normalizeImageUrl($('fImageUrl').value)) return;
  if (pendingPhoto) return;
  if (ui.editingId && photoUrls.has(ui.editingId)) return;
  const info = await fetchAutoImage(jan, { settings: state.settings, inFlight: autoImageInFlight });
  if (!info || !info.imageUrl) return; // 未ヒット・通信不可は静かにスキップ
  const ok = shouldApplyFormImage({
    requestJan: jan,
    currentJan: $('fJan').value,
    currentImageUrl: $('fImageUrl').value,
    hasPendingPhoto: Boolean(pendingPhoto),
    hasSavedPhoto: Boolean(ui.editingId && photoUrls.has(ui.editingId)),
    token,
    activeToken: formImageToken,
  });
  if (!ok) return; // 取得中にJAN・画像・写真が変わっていたら入れない
  $('fImageUrl').value = info.imageUrl;
  $('imageUrlHint').textContent = describeFetchedImage(info, { sourceText: sourceLabel(info.source) });
  renderPhotoPreview();
}

/** 連続スキャンで登録した画材へ、画像を後から静かに足す（一覧を描き直す） */
async function autoFillScannedImage(item) {
  if (!needsAutoImage(item, { photoIds: photoUrls })) return;
  const info = await fetchAutoImage(item.jan, { settings: state.settings, inFlight: autoImageInFlight });
  if (!info || !info.imageUrl) return;
  const out = applyFetchedImage(state, {
    itemId: item.id, jan: item.jan, imageUrl: info.imageUrl, photoIds: photoUrls,
  });
  if (!out.changed) return; // 削除・別画像・写真の設定があったら上書きしない
  state = out.state;
  save();
  render();
}

/** すでに入っているサンプルに、定義の画像を静かに補う（自分で設定した画像・写真は残す） */
function backfillSampleImagesInState() {
  const out = backfillSampleImages(state, { photoIds: photoUrls });
  if (!out.filled && !out.replaced) return;
  state = out.state;
  save();
  render();
}

/* ---------------- 画像の後補完（オフライン登録の画材・起動時と復帰時） ---------------- */
// オフライン中にスキャン・辞書登録すると、商品画像の取得が見送られて画像なしのまま残る。
// 起動時と online 復帰時に、JANがあって画像URLも手元写真も無い画材だけを、
// 少し間をあけて（1まとまり AUTO_IMAGE_FILL_LIMIT 件ずつ）裏で静かに補う。
let imageFillRunning = false; // 二重に走らせない

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

/** オンラインか（判定できない環境では「オンライン」とみなす） */
function isOnline() {
  return !(typeof navigator !== 'undefined' && navigator.onLine === false);
}

/**
 * 画像の後補完を1回ぶん走らせる（静かに。失敗は何も出さない）。
 * すでにユーザーが設定した画像・写真は絶対に上書きしない（applyFetchedImage が判定する）。
 * @returns {Promise<number>} 補えた件数
 */
async function fillMissingImages() {
  if (!photosReady) return 0; // 写真の所在が分からないうちは触らない（写真を上書きしないため）
  const first = pendingAutoImages(state.items, { photoIds: photoUrls });
  if (!shouldRunAutoFill({ online: isOnline(), running: imageFillRunning, count: first.length })) return 0;
  imageFillRunning = true;
  let filled = 0;
  const failed = new Set(); // 今回取れなかったJANは、この回ではもう狙わない
  try {
    for (let round = 0; round < AUTO_IMAGE_FILL_ROUNDS; round += 1) {
      if (!isOnline()) break;
      const targets = pendingAutoImages(state.items, { photoIds: photoUrls })
        .filter((t) => !failed.has(t.jan));
      if (!targets.length) break;
      for (let i = 0; i < targets.length; i += 1) {
        if (!isOnline()) break;
        if (i > 0 || round > 0) await wait(AUTO_IMAGE_FILL_GAP_MS); // 短時間の連続リクエストを避ける
        const t = targets[i];
        const info = await fetchAutoImage(t.jan, { settings: state.settings, inFlight: autoImageInFlight });
        if (!info || !info.imageUrl) { failed.add(t.jan); continue; }
        const out = applyFetchedImage(state, {
          itemId: t.id, jan: t.jan, imageUrl: info.imageUrl, photoIds: photoUrls,
        });
        if (!out.changed) { failed.add(t.jan); continue; } // 削除・別画像・写真の設定があったら触らない
        state = out.state;
        filled += 1;
      }
    }
    if (filled) {
      save();
      render();
      toast(`画像のなかった画材${filled}点に商品画像を入れました`);
    }
  } finally {
    imageFillRunning = false;
  }
  return filled;
}

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
    series: $('fSeries').value,
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
    favorite: $('fFav').getAttribute('aria-pressed') === 'true',
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
  ui.folderId = savedFolder;
  render();
});

$('btnDeleteItem').addEventListener('click', async () => {
  if (!ui.editingId) return;
  const id = ui.editingId;
  await removeItem(id, { fromSheet: 'sheetItem' });
});

/**
 * 確認のうえ画材を1件削除する（編集シートと長押しメニューの共通処理）。
 * 写真も一緒に消し、削除したらシートを閉じて一覧を描き直す。
 * @returns {Promise<boolean>} 消したら true（確認でキャンセルしたら false）
 */
async function removeItem(id, { fromSheet = '' } = {}) {
  const it = state.items.find((i) => i.id === id);
  if (!it) return false;
  if (!confirm('この画材を削除しますか？\n（元に戻せません）')) return false;
  state = deleteItems(state, [id]);
  save();
  try {
    await deletePhoto(id);
    dropPhotoUrl(id);
  } catch (err) { console.warn('写真の削除に失敗', err); }
  if (fromSheet) closeSheet(fromSheet);
  render();
  toast('削除しました');
  return true;
}

$('btnAdd').addEventListener('click', () => openItemSheet(null));

// 空の一覧の「サンプルを入れる」・設定の「サンプルを入れる／消す」（ボタンは描き直されるので文書全体で受ける）
document.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-sample-toggle]');
  if (toggle) {
    if (hasSampleItems(state)) removeSamples();
    else addSamples();
    return;
  }
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
/**
 * フォルダを確認のうえ削除する（編集シート・長押しメニューの共通処理）。
 * 中の画材は残る別のフォルダ（ふつうは「家」）へ、子フォルダは親の位置へ移す。
 * @returns {{ok:boolean, movedTo?:string}}
 */
function removeFolder(id) {
  const f = state.folders.find((x) => x.id === id);
  if (!f) return { ok: false };
  const fallback = state.folders.find((x) => x.id !== id);
  if (!fallback) { toast('フォルダは最低1つ必要です'); return { ok: false }; }
  const kids = folderChildren(state.folders, id).length;
  const upName = folderParentId(f) ? folderOf(folderParentId(f)).name : 'トップ';
  const note = kids ? `子フォルダ${kids}つは「${upName}」へ移します。` : '';
  // 長い確認文は伝えたい単位で改行する（端末の幅で中途半端に折り返されないように）
  const message = [
    `「${f.name}」を削除します。`,
    `中の画材は「${fallback.name}」へ移動します。`,
    ...(note ? [note] : []),
    'よろしいですか？',
  ].join('\n');
  if (!confirm(message)) return { ok: false };
  const parent = folderParentId(f);
  state = deleteFolder(state, id, fallback.id);
  save();
  // いま開いていたフォルダを消したら、親（無ければ保管場所）へ戻す
  if (ui.folderId === id) ui.folderId = parent || 'all';
  return { ok: true, movedTo: fallback.name };
}

$('btnDeleteFolder').addEventListener('click', () => {
  if (!ui.folderEditId) return;
  const id = ui.folderEditId;
  const res = removeFolder(id);
  if (!res.ok) return;
  closeSheet('sheetFolder'); render();
  toast(`「${res.movedTo}」へ中身を移動しました`);
});

/* ---------------- 長押しメニュー（フォルダ・画材とも同じ 480ms） ---------------- */
const LONG_PRESS_MS = 480;       // 長押しとみなす時間
const LONG_PRESS_MOVE_PX = 10;   // これ以上動いたらスクロール扱い（メニューは出さない）
let folderMenuId = '';           // 長押しで選んだフォルダ
let itemMenuId = '';             // 長押しで選んだ画材
let pressTimer = 0;
let pressStart = null;
let pressEl = null;
let suppressClickUntil = 0;      // 長押し直後の「タップ」を1回だけ打ち消す
let suppressClickEl = null;      // 打ち消す相手（長押しした要素。別のフォルダのタップは通す）

/** 長押し対象の要素からフォルダIDを読む（グリッド・子フォルダ・場所一覧・フォルダ別見出し） */
function folderIdFromPress(el) {
  if (!el || !el.closest) return '';
  const tile = el.closest('#folderGrid [data-folder]');
  if (tile) return tile.dataset.folder === 'all' ? '' : tile.dataset.folder; // 「すべて」はフォルダではない
  const chip = el.closest('[data-goto-folder]');
  if (chip) return chip.dataset.gotoFolder;
  const row = el.closest('#folderList [data-fid]');
  if (row) return row.dataset.fid;
  const head = el.closest('[data-folder-head]');
  if (head) return head.dataset.folderHead;
  return '';
}

/**
 * 長押し対象の要素から画材IDを読む（グリッドのタイル・リストの行・まとめカードの各場所行）。
 * カードの中の操作ボタン（−/＋・星・フォルダチップ・鉛筆・別の場所に追加）と、
 * 選択モードのカードは普通のタップに任せて、メニューを出さない。
 */
function itemIdFromPress(el) {
  if (!el || !el.closest) return '';
  if (el.closest('[data-step], [data-fav], [data-fav-group], [data-move], [data-addplace], [data-shop-for], [data-select], .jg-pen, .jg-add')) return '';
  // まとめカードの各場所行（行のどこを押しても、その場所の画材を選ぶ）
  const row = el.closest('.jg-row');
  if (row) {
    const btn = row.querySelector('[data-edit], [data-move], [data-step]');
    return btn ? (btn.dataset.edit || btn.dataset.move || btn.dataset.id || '') : '';
  }
  // グリッドのタイル・リストの行
  const card = el.closest('.tilewrap, .item');
  if (!card) return '';
  const btn = card.querySelector('[data-edit]');
  return btn ? (btn.dataset.edit || '') : '';
}

function endPress() {
  if (pressTimer) { clearTimeout(pressTimer); pressTimer = 0; }
  pressEl?.classList?.remove('pressing');
  pressEl = null;
  pressStart = null;
}

function startPress(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  // 行の中の小さなボタン（並べ替え・編集）は普通のタップに任せる
  if (e.target.closest('[data-up], [data-down], [data-fedit]')) return;
  const folderId = folderIdFromPress(e.target);
  // 特別フォルダ「お気に入り」「すべての画材」は削除・移動・改名できないので、長押しメニューは出さない
  if (folderId && (isFavoriteFolder(folderId) || isAllFolder(folderId))) return;
  // フォルダの上でなければ、画材カードかどうかを見る（フォルダの長押しを優先）
  const itemId = folderId ? '' : itemIdFromPress(e.target);
  if (!folderId && !itemId) return;
  endPress();
  pressStart = { x: e.clientX, y: e.clientY };
  pressEl = folderId
    ? e.target.closest('[data-folder], [data-goto-folder], [data-fid], [data-folder-head]')
    : e.target.closest('.tilewrap, .jg-row, .item');
  pressEl?.classList?.add('pressing');
  pressTimer = setTimeout(() => {
    pressTimer = 0;
    const pressedEl = pressEl;
    pressedEl?.classList?.remove('pressing');
    pressEl = null;
    pressStart = null;
    // 指を離したあとに続く「タップ」でフォルダを開いたり編集シートを開いたりしないよう、同じ要素の1回だけ打ち消す
    suppressClickUntil = Date.now() + 600;
    suppressClickEl = pressedEl;
    if (folderId) openFolderMenu(folderId);
    else openItemMenu(itemId);
  }, LONG_PRESS_MS);
}

function movePress(e) {
  if (!pressStart) return;
  const dx = Math.abs(e.clientX - pressStart.x);
  const dy = Math.abs(e.clientY - pressStart.y);
  if (dx > LONG_PRESS_MOVE_PX || dy > LONG_PRESS_MOVE_PX) endPress(); // 指を動かした＝スクロール
}

document.addEventListener('pointerdown', startPress, { passive: true });
document.addEventListener('pointermove', movePress, { passive: true });
document.addEventListener('pointerup', endPress, { passive: true });
document.addEventListener('pointercancel', endPress, { passive: true });
// iOS の長押しメニュー・文字選択は出さない（CSSの touch-callout と両方で抑える）
document.addEventListener('contextmenu', (e) => {
  if (folderIdFromPress(e.target) || itemIdFromPress(e.target)) e.preventDefault();
});

// 長押しで開いた直後のタップでフォルダを開いたり編集シートを出したりしない
// （打ち消すのは長押しした要素の1回だけ。別のフォルダのタップはそのまま通す）
document.addEventListener('click', (e) => {
  if (Date.now() >= suppressClickUntil) { suppressClickEl = null; return; }
  // スワイプで出た赤い削除ボタンのタップは、長押し直後でもそのまま通す
  if (e.target.closest('[data-swipe-del]')) { suppressClickEl = null; return; }
  if (!suppressClickEl || !suppressClickEl.contains(e.target)) return;
  suppressClickEl = null;
  e.preventDefault();
  e.stopPropagation();
}, true);

/* ---------------- 左スワイプで出る赤い「削除」（iOS標準の一覧と同じ） ---------------- */
// 在庫のタイル・リストの行・まとめカードの各場所行を左へ横に払うと、右端から赤い「削除」が
// スッと出てそのまま止まる（右へ戻す・別のところをタップ・スクロールで閉じる）。
// 押すと編集シート・長押しメニューの削除と同じ removeItem（確認＋写真の削除）を通す。
// 縦スクロール（touch-action: pan-y）・−/＋・星・フォルダチップ・480msの長押しメニュー
// （横に動き始めたら長押しタイマーを止める）とは競合させない。選択モード中は使わない。
const SWIPE_START_PX = 10;   // これ以上横へ動いたら「横スワイプ」（縦スクロールとは分ける）
const SWIPE_OPEN_PX = 30;    // これ以上左へ払って離したら「削除ボタンを出したまま」
const SWIPE_DEFAULT_W = 76;  // 削除ボタンの幅（CSS の --swipe-w が無いとき）
// この上でスワイプを始めない（タップはこれまでどおり効く）
const SWIPE_BLOCKED = '[data-step], [data-fav], [data-fav-group], [data-move], [data-addplace], [data-shop-for], [data-select], .step, .jg-pen, .jg-add, .folder-tag, .swipe-del';
let swipeEl = null;      // いま指を置いている行
let swipeOpenEl = null;  // 削除ボタンを出している行（同時に1行だけ）
let swipeStart = null;   // 指を置いた位置
let swipeBase = 0;       // 掴んだときの位置（閉じていれば0、出ていれば -幅）
let swipeDx = 0;         // 掴んでからの横の移動
let swipeMoved = false;  // 横スワイプとして動き始めたか

/** 行の中身（左へずらす層） */
function swipeInner(el) {
  return el ? el.querySelector(':scope > .swipe-inner') : null;
}

/** 削除ボタンの幅（タイルはCSSで狭くしてある） */
function swipeWidth(el) {
  const raw = parseFloat(getComputedStyle(el).getPropertyValue('--swipe-w'));
  return Number.isFinite(raw) && raw > 0 ? raw : SWIPE_DEFAULT_W;
}

/** 中身を x px だけずらす（transition はCSS。.dragging の間だけ切る） */
function swipeSetX(el, x) {
  const inner = swipeInner(el);
  if (inner) inner.style.transform = `translateX(${x}px)`;
}

function swipeClose(el) {
  if (!el) return;
  el.classList.remove('open', 'dragging');
  swipeSetX(el, 0);
  if (swipeOpenEl === el) swipeOpenEl = null;
}

function swipeCloseAll(except = null) {
  document.querySelectorAll('.swipe.open, .swipe.dragging').forEach((el) => {
    if (el !== except) swipeClose(el);
  });
  if (swipeOpenEl && !swipeOpenEl.isConnected) swipeOpenEl = null;
}

function swipeOpen(el) {
  if (!el) return;
  swipeCloseAll(el);
  el.classList.add('open');
  el.classList.remove('dragging');
  swipeSetX(el, -swipeWidth(el));
  swipeOpenEl = el;
}

/** スワイプ対象の行（操作ボタンの上・選択モード中は何もしない） */
function swipeRowAt(target) {
  if (!target || typeof target.closest !== 'function') return null;
  if (ui.selectMode) return null;
  const el = target.closest('[data-swipe-id]');
  if (!el) return null;
  if (target.closest(SWIPE_BLOCKED)) return null;
  return el;
}

function swipeReset() {
  if (swipeEl) swipeEl.classList.remove('dragging');
  swipeEl = null;
  swipeStart = null;
  swipeDx = 0;
  swipeMoved = false;
}

document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const el = swipeRowAt(e.target);
  if (!el) {
    // 出したままの行の外を押したら閉じる（削除ボタン自身は除く）
    if (swipeOpenEl && !swipeOpenEl.contains(e.target)) swipeClose(swipeOpenEl);
    return;
  }
  swipeEl = el;
  swipeStart = { x: e.clientX, y: e.clientY };
  swipeBase = el.classList.contains('open') ? -swipeWidth(el) : 0;
  swipeDx = 0;
  swipeMoved = false;
}, { passive: true });

document.addEventListener('pointermove', (e) => {
  if (!swipeEl || !swipeStart) return;
  const dx = e.clientX - swipeStart.x;
  const dy = e.clientY - swipeStart.y;
  if (!swipeMoved) {
    if (Math.abs(dx) < SWIPE_START_PX) return;
    if (Math.abs(dy) > Math.abs(dx)) { swipeReset(); return; } // 縦スクロールに任せる
    if (dx > 0 && swipeBase === 0) { swipeReset(); return; }    // 閉じている行を右へ＝何もしない
    swipeMoved = true;
    swipeEl.classList.add('dragging');
    endPress(); // 480msの長押しメニューとは競合させない（タイマーを止める）
  }
  swipeDx = dx;
  const w = swipeWidth(swipeEl);
  swipeSetX(swipeEl, Math.min(0, Math.max(-w, swipeBase + dx)));
}, { passive: true });

/** 指を離したときの後始末（払った距離で出したまま／閉じるを決める） */
function swipeEnd(commit = true) {
  if (!swipeEl) return;
  const el = swipeEl;
  const moved = swipeMoved;
  const at = swipeBase + swipeDx;
  swipeReset();
  if (!moved) return;
  const w = swipeWidth(el);
  // 閉じている行は30px左へ払えば出し、出ている行は30px右へ戻せば閉じる
  const open = commit && (swipeBase < 0 ? at <= -(w - SWIPE_OPEN_PX) : at <= -SWIPE_OPEN_PX);
  if (open) swipeOpen(el);
  else swipeClose(el);
  // スワイプ直後の「タップ」で編集シートやフォルダ移動が開かないよう、1回だけ打ち消す
  suppressClickUntil = Date.now() + 400;
  suppressClickEl = el;
}

document.addEventListener('pointerup', () => swipeEnd(true), { passive: true });
document.addEventListener('pointercancel', () => swipeEnd(false), { passive: true });

// スクロールし始めたら閉じる（開いたまま画面が動いて残らないように）
window.addEventListener('scroll', () => { if (swipeOpenEl) swipeCloseAll(); }, { passive: true });

// 赤い「削除」→ 共通の削除処理（確認＋写真の削除＋再描画）。
// 出したままの行をタップしたときは、まず閉じるだけ（編集シートは開かない）。
document.addEventListener('click', (e) => {
  const del = e.target.closest('[data-swipe-del]');
  if (del) {
    e.preventDefault();
    const id = del.dataset.swipeDel || '';
    swipeCloseAll();
    if (id) removeItem(id);
    return;
  }
  const open = swipeOpenEl && swipeOpenEl.isConnected ? swipeOpenEl : null;
  if (open && open.contains(e.target)) {
    e.preventDefault();
    e.stopPropagation();
    swipeClose(open);
  }
}, true);

/** フォルダの長押しメニューを開く */
function openFolderMenu(id) {
  const f = state.folders.find((x) => x.id === id);
  if (!f) return;
  folderMenuId = id;
  $('folderMenuTitle').firstChild.textContent = f.name;
  // 今の場所（トップ階層なら「最上位」と書く）
  const parent = folderParentId(f);
  $('folderMenuPath').textContent = parent
    ? `${folderPathLabel(state.folders, parent, ' › ')} の中`
    : '最上位のフォルダ';
  openSheet('sheetFolderMenu');
}

$('btnFolderRename').addEventListener('click', () => {
  if (!folderMenuId) return;
  const id = folderMenuId;
  closeSheet('sheetFolderMenu');
  openFolderSheet(id);
});

$('btnFolderReparent').addEventListener('click', () => {
  if (!folderMenuId) return;
  openFolderMoveSheet(folderMenuId);
});

$('btnFolderRemove').addEventListener('click', () => {
  if (!folderMenuId) return;
  const id = folderMenuId;
  closeSheet('sheetFolderMenu');
  const res = removeFolder(id);
  if (!res.ok) return;
  render();
  toast(`「${res.movedTo}」へ中身を移動しました`);
});

/* ---------------- 画材の長押しメニュー（移動 / 別の場所 / 編集 / 星 / 削除） ---------------- */
/** 画材の長押しメニューを開く */
function openItemMenu(id) {
  const it = state.items.find((i) => i.id === id);
  if (!it) return;
  itemMenuId = id;
  $('itemMenuTitle').firstChild.textContent = displayName(it);
  $('itemMenuSub').textContent = `${folderOf(it.folderId).name} ・ ${Number(it.qty) || 0}点`;
  setItemMenuFav(it.favorite === true);
  openSheet('sheetItemMenu');
}

/** メニューの星を、その画材のいまの状態に合わせる（入/切・文字・アイコン） */
function setItemMenuFav(on) {
  const b = $('btnItemFav');
  if (!b) return;
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.innerHTML = `<svg class="ic" aria-hidden="true"><use href="#${on ? 'i-star-solid' : 'i-star'}"/></svg>${on ? 'お気に入りを解除' : 'お気に入り'}`;
}

$('btnItemMove').addEventListener('click', () => {
  if (!itemMenuId) return;
  const id = itemMenuId;
  closeSheet('sheetItemMenu');
  openMoveSheet([id]);
});

$('btnItemAddPlace').addEventListener('click', () => {
  if (!itemMenuId) return;
  const id = itemMenuId;
  closeSheet('sheetItemMenu');
  openAddPlaceSheet(id);
});

$('btnItemEdit').addEventListener('click', () => {
  if (!itemMenuId) return;
  const id = itemMenuId;
  closeSheet('sheetItemMenu');
  openItemSheet(id);
});

$('btnItemFav').addEventListener('click', () => {
  const it = state.items.find((i) => i.id === itemMenuId);
  if (!it) return;
  const next = toggleFavorite(it);
  state = upsertItem(state, next);
  save();
  render();
  setItemMenuFav(next.favorite === true);
  toast(next.favorite ? 'お気に入りにしました（お気に入りフォルダに入ります）' : 'お気に入りをはずしました');
});

$('btnItemRemove').addEventListener('click', () => {
  if (!itemMenuId) return;
  removeItem(itemMenuId, { fromSheet: 'sheetItemMenu' });
});

/**
 * フォルダの移動先を、1行1フォルダの縦ツリーにする（深さはインデント・親子は └ で表す）。
 * 親でも子でも孫でも、その行をタップすればそのままそこへ移動できる。
 * @param {Array<{id:string,label:string,depth:number}>} options folderOptions() の結果
 * @param {{selected?:string, attr?:string}} opts いまいる場所（ハイライト）とタップを受ける属性名
 */
function folderTreeHtml(options, { selected = '', attr = 'data-tomove' } = {}) {
  return options.map((o) => {
    const depth = Math.max(0, Number(o.depth) || 0);
    const on = String(o.id) === String(selected);
    const guide = depth > 0 ? '<span class="ftree-guide" aria-hidden="true">└</span>' : '';
    const here = on ? '<span class="ftree-here">いまここ</span>' : '';
    return `<button class="ftree-row" ${attr}="${esc(o.id)}" style="--d:${depth}" aria-pressed="${on}">${guide}<span class="ftree-name">${esc(o.label)}</span>${here}</button>`;
  }).join('');
}

/** フォルダの移動先（最上位＋各フォルダ。自分と自分の配下は選べない） */
function openFolderMoveSheet(id) {
  const f = state.folders.find((x) => x.id === id);
  if (!f) return;
  folderMenuId = id;
  const exclude = folderSubtreeIds(state.folders, id); // 循環を防ぐ
  const cur = folderParentId(f);
  $('folderMoveNote').textContent = `「${f.name}」の移動先を選んでください（自分の中には移せません）`;
  $('folderMoveOptions').innerHTML = folderTreeHtml(
    folderOptions(state.folders, { exclude, noneLabel: '最上位（トップ）' }),
    { selected: cur, attr: 'data-folder-parent' },
  );
  closeSheet('sheetFolderMenu');
  openSheet('sheetFolderMove');
}

$('folderMoveOptions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-folder-parent]');
  if (!b || !folderMenuId) return;
  const id = folderMenuId;
  try {
    state = updateFolder(state, id, { parentId: b.dataset.folderParent || null });
    save();
    closeSheet('sheetFolderMove');
    render();
    const parent = folderParentId(folderOf(id));
    toast(parent ? `「${folderOf(parent).name}」の中へ移動しました` : '最上位へ移動しました');
  } catch (err) { toast(err.message); }
});

/* ---------------- 移動（1件・複数選択とも同じシート） ---------------- */
function openMoveSheet(ids) {
  ui.moveIds = [...ids];
  $('moveTitle').firstChild.textContent = ui.moveIds.length > 1 ? `${ui.moveIds.length}件を移動` : 'フォルダへ移動';
  $('moveOptions').innerHTML = folderTreeHtml(folderOptions(state.folders, { noneLabel: null }));
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

/* ---------------- 別の場所に追加（同じ画材を別のフォルダにも置く） ---------------- */
/**
 * 追加先のフォルダを、1行1フォルダの縦ツリーで出す。
 * 既にこの画材（同じJAN）があるフォルダと、いまいるフォルダは選べない（登録済み・いまここ）。
 */
function addPlaceTreeHtml(source) {
  const jan = normalizeJAN(source?.jan);
  return folderOptions(state.folders, { noneLabel: null }).map((o) => {
    const depth = Math.max(0, Number(o.depth) || 0);
    const guide = depth > 0 ? '<span class="ftree-guide" aria-hidden="true">└</span>' : '';
    const here = String(o.id) === String(source?.folderId ?? '');
    const has = !here && jan ? Boolean(findItemByJanInFolder(state.items, jan, o.id)) : false;
    const note = here ? '<span class="ftree-here">いまここ</span>' : has ? '<span class="ftree-here">登録済み</span>' : '';
    const off = here || has;
    return `<button class="ftree-row" data-addplace-folder="${esc(o.id)}" style="--d:${depth}"${off ? ' disabled' : ''}>${guide}<span class="ftree-name">${esc(o.label)}</span>${note}</button>`;
  }).join('');
}

function openAddPlaceSheet(id) {
  const src = state.items.find((i) => i.id === id);
  if (!src) return;
  // 新しく1点増えるので、無料プランの上限はここで見る
  if (!canAddItem(state, state.settings).ok) { openProSheet('item'); return; }
  const jan = normalizeJAN(src.jan);
  // JANがあるときは、置けるフォルダが残っていなければその旨を伝える
  const targets = folderOptions(state.folders, { noneLabel: null })
    .filter((o) => String(o.id) !== String(src.folderId) && !(jan && findItemByJanInFolder(state.items, jan, o.id)));
  if (!targets.length) { toast('置ける別のフォルダがありません（フォルダを追加すると選べます）'); return; }
  ui.addPlaceId = src.id;
  $('addPlaceNote').textContent = `「${displayName(src)}」を別のフォルダにも1点置きます（数量は場所ごとに別で数えます）`;
  $('addPlaceOptions').innerHTML = addPlaceTreeHtml(src);
  openSheet('sheetAddPlace');
}

$('addPlaceOptions').addEventListener('click', (e) => {
  const b = e.target.closest('[data-addplace-folder]');
  if (!b || b.disabled || !ui.addPlaceId) return;
  const res = addItemToAnotherFolder(state.items, ui.addPlaceId, b.dataset.addplaceFolder, {
    limit: isPro(state.settings) ? Number.POSITIVE_INFINITY : FREE_ITEM_LIMIT,
  });
  if (!res.ok) { toast(describeAddPlaceError(res.error)); return; }
  const name = folderOf(b.dataset.addplaceFolder).name;
  state = { ...state, items: res.items };
  save();
  closeSheet('sheetAddPlace');
  render();
  toast(`${name} にも追加しました`);
});

$('btnAddPlace').addEventListener('click', () => {
  if (!ui.editingId) return;
  closeSheet('sheetItem');
  openAddPlaceSheet(ui.editingId);
});

/* ---------------- バーコード読取 ---------------- */
let scanSession = createScanSession();
let scanContinuous = false; // 連続スキャン（スキャン画面を開いている間の設定）
let scanLog = [];           // 今回の読み取りログ（新しいものが先頭）
let scanLimitHit = false;   // 新規登録が無料上限で止まっているか
let scannerLive = false;    // カメラ（またはネイティブ読取）が動いているか
let scanFacing = DEFAULT_FACING; // 使っているカメラの向き（外=environment / 内=user）
let scanSwitchBusy = false; // カメラ切り替えの再起動中
const SCAN_STOP_TIMEOUT_MS = 800; // スキャナの停止を待つ上限（止まらないときに詰まらせない）
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

/* --- カメラの内／外切り替え（連続スキャンの状態とログはそのまま） --- */
$('btnFacing').addEventListener('click', async () => {
  if (scanSwitchBusy) return;
  scanSwitchBusy = true;
  scanFacing = toggleFacing(scanFacing);
  renderScanFacing();
  $('btnFacing').disabled = true;
  showScanStatus(`${facingLabel(scanFacing)}に切り替えます`, '');
  try {
    await restartScanner(); // 先にカメラを止めてから、新しい向きで開き直す
  } finally {
    scanSwitchBusy = false;
    $('btnFacing').disabled = false;
  }
});

/** 今どちらのカメラかが分かる表示にする（ボタンの文字・読み上げ・案内） */
function renderScanFacing() {
  const label = facingLabel(scanFacing);
  $('facingLabel').textContent = label;
  $('btnFacing').setAttribute('aria-label', `カメラを切り替え（いま${label}）`);
  $('btnFacing').title = `カメラを切り替え（いま${label}）`;
}

/** カメラを止めてから、同じ向き設定で開き直す（連続スキャンON/OFF・ログはそのまま） */
async function restartScanner() {
  await stopScanner();
  if (!openSheets.has('sheetScan')) return; // 閉じていたら開け直さない
  await startScanner();
}

/* --- 連続スキャンの表示（トグル・ログ・status） --- */
function renderScanMode() {
  $('btnContinuous').setAttribute('aria-pressed', String(scanContinuous));
  $('btnContinuous').textContent = `連続スキャン ${scanContinuous ? 'ON' : 'OFF'}`;
  $('scanModeNote').textContent = scanContinuous ? '閉じずに続けて登録します' : '1本読むと閉じます';
  $('scanLog').hidden = !scanContinuous;
  renderScanFacing();
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
  // ネイティブ読取中はカメラ画面がアプリの上に出ているので、同じ文をカメラ側にも渡す
  const native = scannerLive ? nativeScannerPlugin(window) : null;
  if (native?.setStatus) {
    try {
      const sent = native.setStatus({ message: msg, count: scanLogCount(scanLog) });
      if (sent && typeof sent.catch === 'function') sent.catch(() => {});
    } catch (e) { /* カメラが閉じているときの失敗は無視 */ }
  }
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
  $('scanReticle').hidden = true; // 映像が無いときは枠も出さない
}

/**
 * 起動の通し番号。カメラの切り替えや再起動が重なったとき、古い起動の続きが
 * 画面の案内や向きの表示をあとから書き換えないようにする（最後の1回だけが有効）。
 */
let scanStartToken = 0;

async function startScanner() {
  const token = (scanStartToken += 1);
  await stopScanner();
  if (token !== scanStartToken) return; // もっと新しい起動が始まっていたら降りる
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
  // カメラの向きを選べない方式（ネイティブ読取・手入力）では切り替えボタンを出さない
  $('btnFacing').hidden = !canChooseFacing(strategy);
  renderScanFacing();
  showScanMsg('カメラ起動中');
  if (strategy === 'manual') {
    showScanMsg('カメラを使えません。下の手入力をどうぞ');
    return;
  }

  // 1) Capacitor のネイティブスキャナ（iOSアプリで最優先）
  if (strategy === 'native') {
    // ネイティブのスキャナはカメラ画面を開いたまま、読み取るたびに1本を返す。
    // 連続モードでは同じ画面で待ち受け直すので、読み取るたびに開き直さない（速い）。
    const runNative = async () => {
      scannerLive = true;
      while (scannerLive) {
        let value = '';
        try {
          // カメラ画面が開かないまま resolve も reject も返ってこないときに固まらないよう、上限を置く
          const { barcodes } = await withTimeout(
            native.startScan(nativeScanOptions(scanFacing)),
            NATIVE_SCAN_OPEN_TIMEOUT_MS,
            () => { native.stopScan?.()?.catch?.(() => {}); },
          );
          value = barcodes?.[0]?.rawValue || '';
        } catch (e) {
          const cancelled = e?.code === 'cancelled' || e?.code === 'stopped';
          console.warn('ネイティブスキャナ終了', e);
          scannerLive = false;
          // 自分で閉じるボタンを押した（キャンセル）ときは、エラー扱いにしない
          if (cancelled) return;
          // カメラ画面を開けない（タイムアウト・別画面が邪魔など）→ アプリ内カメラ（html5-qrcode）へ切り替える
          try { native.stopScan?.()?.catch?.(() => {}); } catch (err) { /* 開いていなければ失敗してよい */ }
          if (token !== scanStartToken) return;
          await startInlineScanner(token, 'カメラ画面を開けませんでした。アプリ内カメラで読み取ります');
          return;
        }
        if (!value) { scannerLive = false; showScanMsg('読み取れませんでした'); return; }
        onScan(value);
        if (scanContinuous) continue; // 連続モードは開いたまま次の1本を待つ
        if (scannerLive) continue;    // 受け付けなかった（13桁でない等）→ 開いたカメラで待ち受け直す
        return;
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
      const stream = await navigator.mediaDevices.getUserMedia({ video: facingConstraints(scanFacing) });
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

  await startInlineScanner(token);
}

/**
 * 3) 同梱の html5-qrcode（iOS WKWebView を含む。CDNは使わない）を、いまのシートの中で開く。
 * ネイティブのカメラ画面が開かなかったときの受け皿も兼ねる。
 * @param {number} token 起動の通し番号（古い起動の続きは何もしない）
 * @param {string} [note] 切り替えた理由を画面の上に添える文
 */
async function startInlineScanner(token, note = '') {
  if (token !== scanStartToken) return;
  showScanMsg('スキャナ準備中');
  try {
    const Html5Qrcode = await loadVendorScanner(document, VENDOR_SCANNER_PATH);
    if (!Html5Qrcode) throw new Error('スキャナを読み込めません');
    if (token !== scanStartToken) return; // 待っている間に切り替えが始まった
    $('scanMsg').hidden = true;
    const holder = document.createElement('div');
    holder.id = 'qrReader';
    $('scanBox').appendChild(holder);
    const inst = new Html5Qrcode('qrReader', vendorScannerOptions(window));
    scanner = inst;
    // qrbox（ライブラリが描く枠）は使わない。映像を切り取らずに枠の中央へ収めるため、
    // ガイド枠は自前の .reticle（.scan-box の中央）で出す。
    await inst.start(scannerFacingConfig(scanFacing), vendorStartConfig(),
      (text) => { onScan(text); }, () => {});
    if (token !== scanStartToken) return;
    scannerLive = true;
    $('scanReticle').hidden = false;
    if (note) showScanStatus(note, 'warn'); else hideScanStatus();
  } catch (e) {
    console.warn('html5-qrcode失敗', e);
    document.getElementById('qrReader')?.remove();
    if (token !== scanStartToken) return; // 古い起動の失敗で新しい表示を壊さない
    // 内カメラしか無い端末などで開けなかったときは、外カメラへ戻して一度だけ試す
    if (scanFacing !== DEFAULT_FACING) {
      scanFacing = DEFAULT_FACING;
      renderScanFacing();
      showScanStatus('内カメラを開けませんでした（外カメラに戻しました）', 'warn');
      return startScanner();
    }
    showScanMsg(note ? `${note}\nカメラも開けません。下の手入力をどうぞ` : 'カメラを起動できません。手入力をどうぞ');
  }
}

/**
 * カメラ（またはネイティブ読取）を止める。
 * 同梱スキャナの stop() は非同期なので、Promise を返して再起動側が待てるようにしている
 * （向きの切り替えで、古いストリームと新しいストリームが重ならないようにする）。
 */
/** 同梱スキャナの停止を待つ上限（ミリ秒）。止まらない版でも切り替えを詰まらせない */
function stopScanner() {
  scannerLive = false;
  // ネイティブ読取中ならカメラ画面も閉じる（開いていないときは何もしない）
  const nativeNow = nativeScannerPlugin(window);
  if (nativeNow?.stopScan) {
    try {
      const closing = nativeNow.stopScan();
      if (closing && typeof closing.catch === 'function') closing.catch(() => {});
    } catch (e) { console.warn('ネイティブカメラの停止に失敗', e); }
  }
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
  rafId = 0;
  const video = $('scanVideo');
  if (video?.srcObject) {
    try { video.srcObject.getTracks().forEach((t) => t.stop()); } catch (e) { console.warn('カメラ停止に失敗', e); }
    video.srcObject = null;
  }
  video.hidden = true;
  const holder = document.getElementById('qrReader');
  const s = scanner;
  scanner = null;
  if (!s) {
    holder?.remove();
    return Promise.resolve();
  }
  let stopping;
  try {
    stopping = s.stop(); // まだ開始していない等で同期的に投げる版もある
  } catch (e) {
    stopping = Promise.reject(e);
  }
  const settled = Promise.resolve(stopping)
    .then(() => { try { s.clear?.(); } catch (e) { /* 後片付けの失敗は無視 */ } })
    .catch(() => {});
  const timeout = new Promise((resolve) => setTimeout(resolve, SCAN_STOP_TIMEOUT_MS));
  // stop() が返ってこない版でも、古いカメラを確実に手放してから次を開く
  return Promise.race([settled, timeout]).then(() => {
    holder?.querySelectorAll?.('video').forEach((v) => {
      try {
        v.srcObject?.getTracks?.().forEach((t) => t.stop());
        v.srcObject = null;
      } catch (e) { /* 参照の異なる実装でも落ちない */ }
    });
    holder?.remove();
  });
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
  // 登録した画材に画像を後から足す（辞書ヒットの自動登録・未収録の仮登録が対象）
  if (result.item && (result.kind === 'added' || result.kind === 'drafted')) autoFillScannedImage(result.item);
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

/**
 * JAN からフォームを開く（辞書一致なら自動補完、未収録なら新規登録へ）。
 *
 * 同じJANでも保管場所（フォルダ）が違えば別の在庫として扱う：
 * - いまのフォルダに同じJANがあれば、その1点を＋1（編集したいときは一覧から）
 * - 別のフォルダにしか無いときは、そちらは触らず、いまのフォルダへ新しく登録する
 */
function applyJAN(jan) {
  const hit = lookupJAN(jan, mergedDict);
  const maker = detectMaker(jan);
  const targetFolder = scanFolderId(state, ui.folderId);
  const existing = findItemByJanInFolder(state.items, jan, targetFolder);
  const others = itemsByJanInOtherFolders(state.items, jan, targetFolder).length;
  const elsewhereNote = others ? `（ほかのフォルダに${others}点・ここに新しく登録）` : '';
  if (existing) {
    toast(`登録済み: ${existing.name}（在庫を＋しました）`);
    state = upsertItem(state, adjustStock(recordPurchase(existing, 1), 1));
    save(); render();
    return;
  }
  if (hit) {
    toast(`辞書で見つかりました: ${hit.name}${elsewhereNote}`);
    openItemSheet(null, {
      name: hit.name, maker: hit.maker, brand: hit.brand, category: hit.category, series: hit.series,
      colorName: hit.colorName, colorCode: hit.code, size: hit.size, jan: hit.jan, qty: 1,
      folderId: targetFolder,
    });
  } else {
    toast(others
      ? `ほかのフォルダに${others}点あります。このフォルダに新規登録できます`
      : '辞書に未収録のJANです。新規登録できます');
    openItemSheet(null, { jan, maker: maker?.maker || '', qty: 1, folderId: targetFolder });
  }
}

/* ---------------- 設定: 入出力 ---------------- */
$('btnExport').addEventListener('click', async () => {
  const result = await exportFile({ kind: 'json', content: exportState(state) });
  if (!result.ok) {
    // 共有シートを閉じただけ（キャンセル）のときは何も出さない
    const message = exportFailureMessage(result);
    if (message) toast(message);
    return;
  }
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
  if (!confirm('いまのデータを、読み込むファイルの内容で置き換えます。\nよろしいですか？')) return;
  state = pendingRestore;
  pendingRestore = null;
  save();
  await prunePhotos();
  closeSheet('sheetRestore');
  render();
  toast(`置き換えました（${state.items.length}件）`);
});
$('btnWipe').addEventListener('click', async () => {
  if (!confirm('この端末の画材データをすべて削除します。\n元に戻せません。')) return;
  if (!confirm('本当に削除しますか？\n（バックアップは書き出し済みですか？）')) return;
  localStorage.removeItem(STORAGE_KEY);
  state = blankState();
  save();
  try { await clearPhotos(); } catch (e) { console.warn('写真の削除に失敗', e); }
  [...photoUrls.keys()].forEach(dropPhotoUrl);
  photoCount = 0;
  render();
  toast('全データを削除しました');
});
// 辞書の一覧・更新ボタンは設定から外した（起動時の自動同期はそのまま続く）。
// 画材を辞書で探すのはカタログタブ（とバーコード読取）にまとめた。

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
    <div>${esc([f.maker, f.series, f.colorName, f.size].filter(Boolean).join(' ') || f.name || '商品名未入力')}</div>`;
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

/* ---------------- 法務・サポート（同梱ページをアプリ内で読む） ---------------- */
/** 公開している同じページ（同梱ページを読めなかったときの逃げ道） */
const LEGAL_DOC_HOST = 'https://shodai4.com/art-supply-manager/';
let legalDocOpen = '';   // いま開いているページ（読み込み中に別のページを選んだら古い結果を捨てる）

/**
 * 法務・サポートのページを、アプリを離れずに読めるシートで開く。
 * 同梱の HTML をそのまま読み、本文（main）だけをシートへ入れる（アプリ内なので通信が無くても読める）。
 * 読めなかったときは、公開している同じページを Safari（SFSafariViewController）で開く。
 */
async function openLegalDoc(key) {
  const doc = LEGAL_DOCS.find((d) => d.key === key);
  if (!doc) return false;
  legalDocOpen = key;
  $('legalTitle').firstChild.textContent = doc.title;
  $('legalBody').innerHTML = '<p class="hint legal-loading">読み込み中…</p>';
  openSheet('sheetLegal');
  try {
    const res = await fetch(new URL(doc.file, location.href).href, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = new DOMParser().parseFromString(await res.text(), 'text/html');
    const main = parsed.querySelector('main') || parsed.body;
    // ページ内の「アプリに戻る」は、シートを閉じれば済むので出さない
    main.querySelectorAll('a.back').forEach((a) => a.remove());
    // 中のリンクは、このシートの中で開き直す（別タブは開けないため target を外す）
    main.querySelectorAll('a[href]').forEach((a) => {
      a.removeAttribute('target');
      a.setAttribute('rel', 'noopener noreferrer');
    });
    if (legalDocOpen !== key) return true; // 読み込み中に別のページが選ばれた
    $('legalBody').innerHTML = main.innerHTML;
    $('legalBody').scrollTop = 0;
    return true;
  } catch (err) {
    console.warn('法務ページを読めませんでした', err);
    legalDocOpen = '';
    closeSheet('sheetLegal');
    // 最後の手段は外部ブラウザ（Safari）。それもだめならURLをコピーする
    return openExternal(`${LEGAL_DOC_HOST}${doc.file}`);
  }
}

/* アプリ内（iOS）では外部リンクをSafariで開く（WebViewに閉じ込めない） */
document.addEventListener('click', (e) => {
  if (!isNativeShell(window)) return;
  const a = e.target?.closest?.('a[href]');
  if (!a) return;
  const href = a.getAttribute('href') || a.href || '';
  // 同梱の法務・サポートページは、WKWebViewでは target="_blank" で開けないためアプリ内のシートで読む
  const legal = legalDocKey(href, location.href);
  if (legal) {
    e.preventDefault();
    e.stopPropagation();
    openLegalDoc(legal);
    return;
  }
  if (!shouldOpenExternally(href, { native: true, base: location.href })) return;
  e.preventDefault();
  openExternal(a.href || href);
}, true);

const DICT_RENDER_LIMIT = 300;

function renderDictList(query) {
  const merged = mergeDictionaries(JAN_DICTIONARY, extraEntries);
  $('dictNote').textContent = describeCounts(merged);
  const { items: hit, total } = searchDictionary(mergedDict, query, {
    limit: DICT_RENDER_LIMIT, hay: dictionaryHaystack(mergedDict),
  });
  $('dictList').innerHTML = hit.map((d) => `
    <div style="padding:8px 0;border-bottom:1px solid var(--line)">
      <b>${esc(d.name || d.colorName)}</b> <span class="dic-meta">${esc([d.maker, d.code].filter(Boolean).join(' '))}</span>
      ${extraJanSet.has(d.jan) ? '<span class="dict-badge">追加</span>' : ''}<br>
      <span class="dic-jan">${esc(d.jan)}</span>
      <a href="${esc(d.source)}" target="_blank" rel="noopener noreferrer" class="dic-src">出典</a>
    </div>`).join('') + (total > hit.length
    ? `<p class="hint" style="margin:10px 0 0">ほか ${total - hit.length}件</p>`
    : '');
}
$('dictQ').addEventListener('input', (e) => renderDictList(e.target.value));

/* ---------------- 検索タブ（内蔵JAN辞書のカタログ検索） ---------------- */
// 3.7万件を相手にするので、入力は少し待ってから（デバウンス）絞る。
// 描くのは「メーカーの見出し（五十音順・全件）」と、「開いたメーカーの中身」だけ。
// 閉じたメーカーの中身はDOMに置かないので、全メーカーの見出しを並べても軽い。
const DICT_TAB_DEBOUNCE_MS = 180;
const DICT_AUTO_OPEN_ROWS = 250; // 検索語やメーカー選択で自動展開するときに描く行の上限
let dictTabQuery = '';
let dictTabMaker = '';
let dictTabCategory = '';
let dictTabSeries = '';
let dictTabTimer = 0;
let dictTabBuiltFor = null; // メーカーの選択肢を作った辞書（辞書が変わったら作り直す）
let dictOpenScope = ''; // 手で開け閉めした状態を覚えている検索条件（条件が変わったら捨てる）
const dictOpenMakers = new Set(); // タップで開いたメーカー
const dictClosedMakers = new Set(); // タップで閉じたメーカー（自動展開より優先する）
const dictMoreShown = new Map(); // 「もっと見る」で足した件数（メーカーごと）
// 同じ条件の描き直し（見出しの開閉・もっと見る）で数万件を数え直さないよう、直前の集計を使い回す
let dictGroups = { groups: [], total: 0 };
let dictGroupsKey = null;
let dictGroupsDict = null;
// シリーズの選択肢（検索語・メーカー・カテゴリで決まる。シリーズ自身の選択は見ない）
let dictSeriesRows = [];
let dictSeriesKey = null;
let dictSeriesDict = null;

/** 検索タブで選べるメーカー（五十音順） */
function dictMakerList() {
  const counts = new Map();
  for (const d of mergedDict) {
    const name = String(d.maker || 'メーカー不明');
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => compareMakerName(a[0], b[0]))
    .map(([name, count]) => ({ name, count }));
}

/** いま選んでいるメーカーにあるカテゴリと件数（全体を見るときは出さない） */
function dictCategoryList() {
  const counts = new Map();
  for (const d of mergedDict) {
    if (String(d.maker || 'メーカー不明') !== dictTabMaker) continue;
    const id = String(d.category || 'other');
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return CATEGORIES.filter((c) => counts.get(c.id)).map((c) => ({ id: c.id, label: c.label, count: counts.get(c.id) }));
}

/**
 * いまの条件（検索語・メーカー・カテゴリ）で選べるシリーズと件数。
 * 数万件を毎描画で数え直さないよう、条件が変わったときだけ作る。
 */
function dictSeriesList() {
  const key = `${dictTabQuery}\u0000${dictTabMaker}\u0000${dictTabCategory}`;
  if (key !== dictSeriesKey || dictSeriesDict !== mergedDict) {
    dictSeriesRows = dictionarySeriesList(mergedDict, dictTabQuery, {
      hay: dictionaryHaystack(mergedDict), maker: dictTabMaker, category: dictTabCategory,
    });
    dictSeriesKey = key;
    dictSeriesDict = mergedDict;
  }
  return dictSeriesRows;
}

/** 辞書の1件を、画材の登録フォーム／在庫に使う形へ */
function dictPreset(d) {
  return {
    name: d.name || d.colorName || '',
    maker: d.maker || '',
    brand: d.brand || '',
    category: CATEGORIES.some((c) => c.id === d.category) ? d.category : 'other',
    series: d.series || '',
    colorName: d.colorName || '',
    colorCode: d.code || '',
    size: d.size || '',
    jan: d.jan || '',
  };
}

/** 辞書の商品を、そのまま自分の在庫へ入れる（入れ先はいま見ているフォルダ） */
function addDictToStock(d) {
  if (!d) return;
  if (!canAddItem(state, state.settings).ok) { openProSheet('item'); return; }
  const folderId = scanFolderId(state, ui.folderId);
  // 別のフォルダに同じJANがあっても、このフォルダの在庫として独立して追加する
  const others = itemsByJanInOtherFolders(state.items, d.jan, folderId).length;
  const item = createItem({
    ...dictPreset(d),
    folderId,
    qty: 1,
  });
  state = upsertItem(state, item);
  save();
  render();
  toast(`「${item.name}」を在庫に追加しました${others ? '（別のフォルダにもあり）' : ''}`);
}

/** 検索タブ（カタログ）の描画（メーカー・カテゴリで絞り、結果からそのまま在庫へ追加） */
function renderSearchTab() {
  if (ui.tab !== 'catalog') return;
  // メーカーの選択肢（辞書が変わったときだけ作り直す）
  const sel = $('dictMakerSel');
  if (dictTabBuiltFor !== mergedDict) {
    dictTabBuiltFor = mergedDict;
    sel.innerHTML = `<option value="">すべてのメーカー（${mergedDict.length.toLocaleString('ja-JP')}件）</option>`
      + dictMakerList().map((m) => `<option value="${esc(m.name)}">${esc(m.name)}（${m.count.toLocaleString('ja-JP')}）</option>`).join('');
  }
  sel.value = dictTabMaker;
  if (sel.value !== dictTabMaker) { dictTabMaker = ''; dictTabCategory = ''; } // 辞書の更新で消えたメーカーは「すべて」へ

  // メーカーを選ぶと、そのメーカーにあるカテゴリでさらに絞れる
  const cats = dictTabMaker ? dictCategoryList() : [];
  const showCats = cats.length > 1;
  $('dictCatSec').hidden = !showCats;
  if (showCats) {
    $('dictCatChips').innerHTML = [
      `<button class="fchip" data-dict-cat="" aria-pressed="${dictTabCategory === ''}">すべて</button>`,
      ...cats.map((c) => `<button class="fchip" data-dict-cat="${esc(c.id)}" aria-pressed="${dictTabCategory === c.id}">${esc(c.label)}（${c.count}）</button>`),
    ].join('');
    if (dictTabCategory && !cats.some((c) => c.id === dictTabCategory)) dictTabCategory = '';
  }

  // シリーズでも絞れる（メーカー・カテゴリ・検索語で絞ったときのシリーズを、縦につぶさないプルダウンで）
  // 何も絞っていないときは数万件を数えずに隠す（絞り込んでから出す）
  const narrowed = Boolean(dictTabQuery || dictTabMaker || dictTabCategory);
  const seriesRows = narrowed ? dictSeriesList() : [];
  // メーカー・カテゴリ・検索語を変えて、もう無いシリーズが選ばれていたら「すべて」へ戻す
  if (dictTabSeries && !seriesRows.some((s) => s.name === dictTabSeries)) dictTabSeries = '';
  const showSeries = seriesRows.length > 1;
  $('dictSeriesSec').hidden = !showSeries;
  if (showSeries) {
    const selSeries = $('dictSeriesSel');
    const seriesKey = `${dictTabMaker}\u0000${dictTabCategory}\u0000${dictTabQuery}`;
    if (selSeries.dataset.built !== seriesKey) {
      const sum = seriesRows.reduce((n, s) => n + s.count, 0);
      selSeries.innerHTML = `<option value="">すべてのシリーズ（${sum.toLocaleString('ja-JP')}）</option>`
        + seriesRows.map((s) => `<option value="${esc(s.name)}">${esc(s.name)}（${s.count.toLocaleString('ja-JP')}）</option>`).join('');
      selSeries.dataset.built = seriesKey;
    }
    selSeries.value = dictTabSeries;
    if (selSeries.value !== dictTabSeries) dictTabSeries = '';
  }

  // 検索条件が変わったら、手で開け閉めした状態と「もっと見る」は捨てる（新しい条件で自動展開し直す）
  const scope = `${dictTabQuery}\u0000${dictTabMaker}\u0000${dictTabCategory}\u0000${dictTabSeries}`;
  if (scope !== dictOpenScope) {
    dictOpenScope = scope;
    dictOpenMakers.clear();
    dictClosedMakers.clear();
    dictMoreShown.clear();
  }

  // ヒットした全件をメーカー見出しにまとめる（50件で打ち切らないので、全メーカーが見渡せる）
  const groupsKey = `${dictTabQuery}\u0000${dictTabMaker}\u0000${dictTabCategory}\u0000${dictTabSeries}`;
  if (groupsKey !== dictGroupsKey || dictGroupsDict !== mergedDict) {
    dictGroups = groupDictionarySearch(mergedDict, dictTabQuery, {
      hay: dictionaryHaystack(mergedDict), maker: dictTabMaker, category: dictTabCategory, series: dictTabSeries,
    });
    dictGroupsKey = groupsKey;
    dictGroupsDict = mergedDict;
  }
  const { groups, total } = dictGroups;
  const cond = [dictTabMaker, dictTabCategory ? (CATEGORIES.find((c) => c.id === dictTabCategory)?.label || '') : '', dictTabSeries].filter(Boolean).join(' / ');
  $('dictTabNote').textContent = `内蔵辞書 ${mergedDict.length.toLocaleString('ja-JP')}件から探して、そのまま在庫に追加できます${cond ? `（${cond}）` : ''}`;
  $('dictResCount').textContent = `${total.toLocaleString('ja-JP')}件`;

  const ownedFolder = scanFolderId(state, ui.folderId);
  const ownedJan = (it) => Boolean(it.jan);
  const owned = new Set(state.items.filter((i) => ownedJan(i) && String(i.folderId) === ownedFolder).map((i) => i.jan));
  // 同じJANが別のフォルダにあるか（このフォルダにも足せることを軽く伝えるためだけに使う）
  const elsewhere = new Set(state.items.filter((i) => ownedJan(i) && String(i.folderId) !== ownedFolder).map((i) => i.jan));
  // 1件の行は「商品名＋色・容量」だけ。メーカーは見出しに出すので繰り返さず、JANも出さない。
  // シリーズ名があるものは淡く（シリーズ名＋色名＋号数の順に読めるように）し、商品名の残りを濃く出す
  const nameOf = (d) => displayName({ name: d.name || d.colorName || '', maker: d.maker || '', brand: d.brand || '' });
  const nameHtml = (d) => {
    const full = nameOf(d);
    const parts = splitSeriesFromName(full, d.series);
    if (!parts) return esc(full);
    return `<span class="dres-series">${esc(parts.head)}</span>${parts.rest ? ` ${esc(parts.rest)}` : ''}`;
  };
  const rowOf = (d) => {
    const sub = dictionaryRowDetail(d);
    const btn = owned.has(d.jan)
      ? '<span class="dres-have">登録済み</span>'
      : `<button class="dres-add" data-dict-add="${esc(d.jan)}" aria-label="${esc(nameOf(d) || 'この商品')}を在庫に追加${elsewhere.has(d.jan) ? '（ほかのフォルダにあり）' : ''}">追加</button>`;
    return `
    <div class="dres">
      <button class="dres-main" data-dict-pick="${esc(d.jan)}">
        <span class="dres-name">${nameHtml(d)}</span>
        ${sub ? `<span class="dres-sub">${esc(sub)}</span>` : ''}
      </button>
      ${btn}
    </div>`;
  };
  // メーカー見出しごとに、開いているメーカーだけ中身を描く（閉じている見出しは行をDOMに置かない）
  const plan = planDictGroups(groups, {
    query: dictTabQuery, maker: dictTabMaker, category: dictTabCategory,
    open: dictOpenMakers, closed: dictClosedMakers, more: dictMoreShown,
    page: DICT_MAKER_PAGE, budget: DICT_AUTO_OPEN_ROWS,
  });
  const rows = plan.map((g) => `
      <section class="dgroup${g.open ? ' open' : ''}">
        <button type="button" class="dgrouphead" data-dict-group="${esc(g.maker)}" aria-expanded="${g.open ? 'true' : 'false'}">
          <svg class="ic chev" aria-hidden="true"><use href="#i-chevron"/></svg>
          <span>${esc(g.maker)}</span><b>${g.total.toLocaleString('ja-JP')}</b>
        </button>
        ${g.open ? `${g.shown.map(rowOf).join('')}${g.rest > 0
          ? `<button type="button" class="dgroupmore" data-dict-more="${esc(g.maker)}">もっと見る（残り ${g.rest.toLocaleString('ja-JP')}件）</button>`
          : ''}` : ''}
      </section>`).join('');
  $('dictResults').innerHTML = rows
    ? rows
    : '<p class="hint" style="margin:12px">見つかりません。商品名・メーカー・JANの一部で探してみてください</p>';
}

$('dictQTab').addEventListener('input', (e) => {
  const value = e.target.value;
  clearTimeout(dictTabTimer);
  dictTabTimer = setTimeout(() => { dictTabQuery = value; renderSearchTab(); }, DICT_TAB_DEBOUNCE_MS);
});
$('dictQTabClear').addEventListener('click', () => {
  clearTimeout(dictTabTimer);
  dictTabQuery = '';
  $('dictQTab').value = '';
  renderSearchTab();
});
$('dictMakerSel').addEventListener('change', (e) => {
  dictTabMaker = e.target.value;
  // メーカーが変わるとカテゴリもシリーズも別物になるので、選んでいたものは捨てる
  dictTabCategory = '';
  dictTabSeries = '';
  render(); // カテゴリ・シリーズ欄の出し分けも含めて描き直す
  window.scrollTo({ top: 0 });
});
$('dictCatChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-dict-cat]');
  if (!b) return;
  dictTabCategory = b.dataset.dictCat || '';
  dictTabSeries = ''; // カテゴリを変えたら、そのカテゴリに無いシリーズの選択は残さない
  renderSearchTab();
});
$('dictSeriesSel').addEventListener('change', (e) => {
  dictTabSeries = e.target.value;
  renderSearchTab();
});
$('dictResults').addEventListener('click', (e) => {
  // メーカー見出しをタップ → そのメーカーの中身を開け閉め（自動展開より手で閉じたほうを優先）
  const head = e.target.closest('[data-dict-group]');
  if (head) {
    const maker = head.dataset.dictGroup || '';
    if (head.getAttribute('aria-expanded') === 'true') {
      dictOpenMakers.delete(maker);
      dictClosedMakers.add(maker);
    } else {
      dictClosedMakers.delete(maker);
      dictOpenMakers.add(maker);
    }
    renderSearchTab();
    return;
  }
  // 「もっと見る」 → そのメーカーの続きを DICT_MAKER_PAGE 件ずつ描く
  const more = e.target.closest('[data-dict-more]');
  if (more) {
    const maker = more.dataset.dictMore || '';
    dictMoreShown.set(maker, (dictMoreShown.get(maker) || 0) + DICT_MAKER_PAGE);
    renderSearchTab();
    return;
  }
  const add = e.target.closest('[data-dict-add]');
  if (add) { addDictToStock(mergedDict.find((d) => d.jan === add.dataset.dictAdd)); return; }
  const pick = e.target.closest('[data-dict-pick]');
  if (!pick) return;
  const d = mergedDict.find((x) => x.jan === pick.dataset.dictPick);
  if (d) openItemSheet(null, dictPreset(d));
});

/* ---------------- チュートリアル（使い方） ---------------- */
$('btnGuide').addEventListener('click', () => openSheet('sheetGuide'));

/* ---------------- PWA（アプリ内では Service Worker を使わない） ---------------- */
if ('serviceWorker' in navigator && !isNativeShell(window)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

/* ---------------- 画面サイズの固定（ダブルタップ・ピンチで拡大しない） ---------------- */
// iOS WKWebView は viewport の user-scalable=no を無視してピンチで拡大することがあるため、
// 2本指のジェスチャーだけを止める（1本指のスクロール・文字入力・ボタン操作はそのまま）。
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

// iOSアプリでは Pro プレビュー（Webの動作確認用）を無効にする。解放は購入と復元だけ。
if (NATIVE_APP && state.settings.proPreview) {
  state = { ...state, settings: { ...state.settings, proPreview: false } };
  save();
}

seedSamplesOnFirstRun();
render();
preloadPhotos().then((ok) => {
  if (!ok) return;
  backfillSampleImagesInState();
  // オフラインで登録して画像が入っていない画材を、起動時に裏で静かに補う
  fillMissingImages();
});
renderDictionaryState();
syncDictionary();

// オンラインへ戻ったら（オフライン登録の画材の画像を、束にならないよう少しずつ補う）
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { fillMissingImages(); });
}

// iOSアプリの最下部に AdMob バナー（本番ID）。Webブラウザでは何もしない。
// バナーの高さは CSS 変数 --ad-h に入り、タブバー・ドック・FAB・一覧の下端を押し上げる。
// Pro（購入・復元で解放）の間は広告を出さず、その分だけタブバーとFABを下げる。
adBanner = setupAdBanner({ isPro: () => isPro(state.settings) });

// Proの課金（StoreKit）。iOSアプリのときだけストアを初期化し、
// 買い切り・月額の購入と復元の結果を settings へ反映する。Webでは何もしない。
proStore = new ProStore({
  win: window,
  native: NATIVE_APP,
  onPurchase: (purchase) => applyPurchaseState(purchase),
  onMessage: (message) => toast(message.detail ? `${message.title}（${message.detail}）` : message.title),
  log: (...args) => console.log(...args),
});
proStore.start();
renderProOffer();
