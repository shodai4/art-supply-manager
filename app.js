// 画材管理アプリ UI（storage + rendering + バーコード読取）
import {
  STORAGE_KEY, CATEGORIES, STATUSES, DEFAULT_FOLDERS, SORT_MODES, MAKER_NONE,
  createItem, adjustStock, computeShoppingList, filterItems, moveItems, sortItems, countByFolder,
  addFolder, updateFolder, reorderFolders, deleteFolder, upsertItem, deleteItems,
  exportState, importState, summarize, blankState,
  isValidJAN, normalizeJAN, detectMaker, lookupJAN, itemMaker, listMakers, groupByMaker,
} from './core.js';
import { JAN_DICTIONARY, JAN_PREFIXES } from './jan-database.js';

const $ = (id) => document.getElementById(id);
const clone = (v) => JSON.parse(JSON.stringify(v));

let state = loadState();
let ui = { tab: 'stock', folderId: 'all', query: '', category: 'all', status: 'all', maker: 'all', editingId: null, moveIds: [], folderEditId: null, scannedJAN: '' };
let scanner = null; // html5-qrcode instance
let rafId = 0;

/* ---------------- storage ---------------- */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return blankState();
    return importState(raw);
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
  return state.folders.find((f) => f.id === id) || { id, name: '未分類', icon: '📁', color: '#5b6b7c' };
}
function statusMeta(id) {
  return STATUSES.find((s) => s.id === id) || STATUSES[1];
}
function categoryLabel(id) {
  return CATEGORIES.find((c) => c.id === id)?.label || 'その他';
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- rendering ---------------- */
function render() {
  renderHeader();
  renderChips();
  renderFilters();
  renderList(currentList());
  renderShopping();
  renderFolders();
  renderSettings();
  document.querySelectorAll('#tabbar button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab));
  });
  for (const t of ['stock', 'shopping', 'folders', 'settings']) $(`view-${t}`).hidden = t !== ui.tab;
  $('btnAdd').style.visibility = ui.tab === 'stock' || ui.tab === 'shopping' ? 'visible' : 'hidden';
}

function renderHeader() {
  const s = summarize(state.items);
  $('hdrKinds').textContent = s.kinds;
  $('hdrQty').textContent = s.qty;
  $('hdrSub').textContent = ui.folderId === 'all' ? 'すべての保管場所' : `${folderOf(ui.folderId).icon} ${folderOf(ui.folderId).name}`;
}

function renderChips() {
  const counts = countByFolder(state.items);
  const chips = [{ id: 'all', icon: '🗂️', name: 'すべて', count: counts.all_total }]
    .concat(state.folders.map((f) => ({ ...f, count: counts[f.id] || 0 })));
  $('folderChips').innerHTML = chips.map((c) => `
    <button class="chip" data-folder="${esc(c.id)}" aria-pressed="${String(ui.folderId === c.id)}">
      <span aria-hidden="true">${esc(c.icon)}</span>${esc(c.name)}<span class="n">${c.count}</span>
    </button>`).join('');
}

function renderFilters() {
  const catSel = $('fCategory');
  if (!catSel.dataset.ready) {
    catSel.innerHTML = '<option value="all">カテゴリ：すべて</option>' +
      CATEGORIES.map((c) => `<option value="${c.id}">${esc(c.icon)} ${esc(c.label)}</option>`).join('');
    $('fStatus').innerHTML = '<option value="all">残量：すべて</option>' +
      STATUSES.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('');
    $('fSort').innerHTML = SORT_MODES.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join('');
    catSel.dataset.ready = '1';
  }
  catSel.value = ui.category;
  $('fStatus').value = ui.status;

  // メーカー（登録内容から作る。未設定アイテムがある時だけ「未設定」を出す）
  const makers = listMakers(state.items);
  const hasNone = state.items.some((it) => !itemMaker(it));
  if (ui.maker !== 'all' && (ui.maker === MAKER_NONE ? !hasNone : !makers.includes(ui.maker))) ui.maker = 'all';
  const makerSel = $('fMakerFilter');
  makerSel.innerHTML = '<option value="all">メーカー：すべて</option>' +
    makers.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('') +
    (hasNone ? `<option value="${MAKER_NONE}">メーカー未設定</option>` : '');
  makerSel.value = ui.maker;
  makerSel.disabled = !makers.length;

  const sortSel = $('fSort');
  sortSel.value = SORT_MODES.some((m) => m.id === state.settings.sort) ? state.settings.sort : 'updated';
  $('q').value = ui.query;
}

/** 絞り込み＋並び替え済みの一覧 */
function currentList() {
  return sortItems(filterItems(state.items, {
    query: ui.query, folderId: ui.folderId, category: ui.category, status: ui.status, maker: ui.maker,
  }), state.settings.sort);
}

function itemCard(it, opts = {}) {
  const st = statusMeta(it.status);
  const f = folderOf(it.folderId);
  const maker = opts.hideMaker ? '' : itemMaker(it);
  const meta = [maker, it.colorName, it.size, it.colorCode].filter(Boolean).map(esc).join(' ・ ');
  return `
  <article class="item" data-id="${esc(it.id)}">
    <div class="it-main">
      <h3 class="it-name" data-edit="${esc(it.id)}" title="タップで編集">${esc(it.name)}</h3>
      <div class="it-sub">
        <button class="folder-tag" data-move="${esc(it.id)}">${esc(f.icon)} ${esc(f.name)} ▾</button>
        <span class="badge ${st.tone}">${st.label}</span>
        ${meta ? `<span class="it-meta">${meta}</span>` : ''}
      </div>
    </div>
    <div class="it-side">
      <button class="step" data-step="-1" data-id="${esc(it.id)}" aria-label="1減らす">−</button>
      <span class="qty">${Number(it.qty) || 0}<small>点</small></span>
      <button class="step" data-step="1" data-id="${esc(it.id)}" aria-label="1増やす">＋</button>
      <button class="icon-btn" data-edit="${esc(it.id)}" aria-label="編集">✎</button>
    </div>
  </article>`;
}

function makerHeading(maker, count) {
  return `<div class="maker-head"><span class="mh-name">${esc(maker || 'メーカー未設定')}</span><span class="mh-n">${count}</span></div>`;
}

function renderList(items) {
  if (!items.length) {
    $('itemList').innerHTML = state.items.length
      ? `<div class="empty"><b>条件に合う画材がありません</b>絞り込みや検索語を変えてみてください。</div>`
      : '<div class="empty"><b>まだ画材がありません</b>右下の＋から登録、または📷読取でJANから追加できます。<br>（はじめての登録は「🎒 持ち出し用」などフォルダを選んで）</div>';
    return;
  }
  if (state.settings.sort === 'maker') {
    $('itemList').innerHTML = groupByMaker(items)
      .map((g) => makerHeading(g.maker, g.items.length) + g.items.map((it) => itemCard(it, { hideMaker: true })).join(''))
      .join('');
    return;
  }
  $('itemList').innerHTML = items.map((it) => itemCard(it)).join('');
}

function renderShopping() {
  const list = computeShoppingList(state.items);
  $('shoppingList').innerHTML = list.length
    ? list.map((it) => itemCard(it)).join('')
    : '<div class="empty"><b>補充の必要はありません</b>残量「残りわずか」「使い切り」の画材がここに自動で集まります。</div>';
}

function renderFolders() {
  const counts = countByFolder(state.items);
  $('folderList').innerHTML = state.folders.map((f, i) => `
    <div class="folder-row" data-fid="${esc(f.id)}">
      <span class="folder-dot" style="background:${esc(f.color)}22;color:${esc(f.color)}">${esc(f.icon)}</span>
      <span class="name">${esc(f.name)}<span class="cnt"> ・${counts[f.id] || 0}件</span></span>
      <button data-up="${esc(f.id)}" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
      <button data-down="${esc(f.id)}" ${i === state.folders.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
      <button data-fedit="${esc(f.id)}" aria-label="編集">✎</button>
    </div>`).join('');
}

function renderSettings() {
  const s = summarize(state.items);
  $('stKinds').textContent = s.kinds;
  $('stQty').textContent = s.qty;
  $('stRestock').textContent = s.needRestock;
  $('dictInfo').textContent = `収録 ${JAN_DICTIONARY.length}件 / メーカー判別 ${JAN_PREFIXES.length}件（実在確認済みのみ・2026-11-15時点）`;
}

/* ---------------- タブ・絞り込み ---------------- */
$('tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  ui.tab = b.dataset.tab;
  stopScanner();
  render();
});
$('q').addEventListener('input', (e) => { ui.query = e.target.value; renderListSafely(); });
function renderListSafely() {
  renderList(currentList());
}
$('fCategory').addEventListener('change', (e) => { ui.category = e.target.value; render(); });
$('fStatus').addEventListener('change', (e) => { ui.status = e.target.value; render(); });
$('fMakerFilter').addEventListener('change', (e) => { ui.maker = e.target.value; render(); });
$('fSort').addEventListener('change', (e) => {
  state = { ...state, settings: { ...state.settings, sort: e.target.value } };
  save();
  render();
});
$('folderChips').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-folder]');
  if (!b) return;
  ui.folderId = b.dataset.folder;
  render();
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
    if (next.qty === 0) toast('使い切りました。買い物リストに入れています🛒');
    return;
  }
  const edit = e.target.closest('[data-edit]');
  if (edit) { openItemSheet(edit.dataset.edit); return; }
  const mv = e.target.closest('[data-move]');
  if (mv) { openMoveSheet([mv.dataset.move]); return; }
});

function openItemSheet(id, preset = {}) {
  const it = id ? state.items.find((i) => i.id === id) : null;
  ui.editingId = it ? it.id : null;
  $('sheetItemTitle').firstChild.textContent = it ? '画材を編集' : '画材を追加';
  const data = it || createItem({ folderId: ui.folderId === 'all' ? state.folders[0].id : ui.folderId, ...preset });
  $('fName').value = data.name || '';
  $('fMaker').value = data.maker || '';
  $('fCategoryInput').innerHTML = CATEGORIES.map((c) => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join('');
  $('fCategoryInput').value = data.category;
  $('fColorName').value = data.colorName || '';
  $('fColorCode').value = data.colorCode || '';
  $('fSize').value = data.size || '';
  $('fQty').value = data.qty ?? 1;
  $('fStatusInput').innerHTML = STATUSES.map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
  $('fStatusInput').value = data.status;
  $('fFolderInput').innerHTML = state.folders.map((f) => `<option value="${f.id}">${esc(f.icon)} ${esc(f.name)}</option>`).join('');
  $('fFolderInput').value = data.folderId;
  $('fJan').value = data.jan || '';
  $('fShop').value = data.shop || '';
  $('fPrice').value = data.price ?? '';
  $('fMemo').value = data.memo || '';
  $('makerList').innerHTML = [...new Set([...JAN_DICTIONARY.map((d) => d.maker), 'ターナー', 'リキテックス', 'ウィンザー＆ニュートン', 'マツダ', '名村大成堂', 'クサカベ', 'ホルベイン'])].map((m) => `<option value="${esc(m)}">`).join('');
  $('btnDeleteItem').hidden = !it;
  updateJanHint();
  openSheet('sheetItem');
  setTimeout(() => $('fName').focus({ preventScroll: true }), 120);
}

function updateJanHint() {
  const v = normalizeJAN($('fJan').value);
  const hint = $('janHint');
  if (!v) { hint.textContent = '未入力でも保存できます（後から読取で補完できます）'; hint.style.color = ''; return; }
  if (!/^\d{13}$/.test(v)) { hint.textContent = `${v.length}桁（13桁で入力してください）`; hint.style.color = 'var(--warn)'; return; }
  const hit = lookupJAN(v);
  const maker = detectMaker(v);
  hint.style.color = 'var(--good)';
  hint.textContent = `✓ JAN妥当${maker ? ` ・ メーカー判別: ${maker.maker}` : ''}${hit ? ` ・ 辞書一致: ${hit.name}` : ' ・ 辞書に未収録（新規登録できます）'}`;
}
$('fJan').addEventListener('input', updateJanHint);

$('itemForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const janRaw = $('fJan').value.trim();
  const jan = normalizeJAN(janRaw);
  if (janRaw && !/^\d{13}$/.test(jan)) { toast('JANは13桁で入力してください'); return; }
  if (jan && !isValidJAN(jan)) { toast('JANのチェックディジットが合いません'); return; }
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
  };
  if (ui.editingId) {
    const prev = state.items.find((i) => i.id === ui.editingId);
    state = upsertItem(state, createItem({ ...partial, id: prev.id, createdAt: prev.createdAt }));
    toast('保存しました');
  } else {
    state = upsertItem(state, createItem(partial));
    toast('画材を追加しました');
  }
  save();
  closeSheet('sheetItem');
  ui.tab = 'stock';
  render();
});

$('btnDeleteItem').addEventListener('click', () => {
  if (!ui.editingId) return;
  if (!confirm('この画材を削除しますか？（元に戻せません）')) return;
  state = deleteItems(state, [ui.editingId]);
  save();
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
    $('fFolderIcon').value = f.icon;
    $('fFolderColor').value = /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : '#2f6fd0';
    openSheet('sheetFolder');
  }
});
$('btnAddFolder').addEventListener('click', () => {
  const name = prompt('新しいフォルダ名（例：スタジオ、実家、教室）');
  if (!name) return;
  try {
    state = addFolder(state, { name, icon: '📁' });
    save(); render();
    toast('フォルダを追加しました');
  } catch (err) { toast(err.message); }
});
$('btnSaveFolder').addEventListener('click', () => {
  if (!ui.folderEditId) return;
  try {
    state = updateFolder(state, ui.folderEditId, {
      name: $('fFolderName').value, icon: $('fFolderIcon').value || '📁', color: $('fFolderColor').value,
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
  $('moveOptions').innerHTML = state.folders.map((f) => `<button class="pill" data-tomove="${esc(f.id)}">${esc(f.icon)} ${esc(f.name)}</button>`).join('');
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
  showScanMsg('カメラを起動しています…');
  if (!window.isSecureContext && location.hostname !== 'localhost') {
    showScanMsg('カメラは https または localhost でのみ使えます。下の手入力・テスト用ボタンをご利用ください。');
    return;
  }
  const hasDetector = 'BarcodeDetector' in window;
  if (hasDetector) {
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
  // フォールバック: html5-qrcode（CDN・オフライン時は手入力へ）
  showScanMsg('内蔵検出器が使えないため、軽量スキャナを読み込んでいます…');
  try {
    const mod = await import('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js');
    const Html5Qrcode = mod.Html5Qrcode || window.Html5Qrcode;
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
    showScanMsg('カメラを起動できませんでした。下の手入力、またはテスト用ボタンをお使いください。');
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
  const hit = lookupJAN(jan);
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

$('testPills').innerHTML = JAN_DICTIONARY.slice(0, 6).map((d) =>
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
  toast('バックアップを書き出しました');
});
$('btnImport').addEventListener('click', () => $('fileImport').click());
$('fileImport').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!confirm('現在のデータを、読み込むファイルの内容で置き換えます。よろしいですか？')) { e.target.value = ''; return; }
  try {
    const text = await file.text();
    state = importState(text);
    save(); render();
    toast(`読み込みました（${state.items.length}件）`);
  } catch (err) {
    toast(`読み込めませんでした: ${err.message}`);
  } finally {
    e.target.value = '';
  }
});
$('btnWipe').addEventListener('click', () => {
  if (!confirm('この端末の画材データをすべて削除します。元に戻せません。')) return;
  if (!confirm('本当に削除しますか？（バックアップは書き出し済みですか？）')) return;
  localStorage.removeItem(STORAGE_KEY);
  state = blankState();
  save(); render();
  toast('全データを削除しました');
});
$('btnDict').addEventListener('click', () => {
  $('dictNote').textContent = `実在確認済み ${JAN_DICTIONARY.length}件（2026-11-15時点・チェックディジット検証済み）。出典は各商品ページ。`;
  $('dictList').innerHTML = JAN_DICTIONARY.map((d) => `
    <div style="padding:8px 0;border-bottom:1px solid #eef2f7">
      <b>${esc(d.colorName || d.name)}</b> <span style="color:#5b6b7c">${esc(d.maker)} ${esc(d.size)}</span><br>
      <span style="font-family:ui-monospace,monospace">${esc(d.jan)}</span>
      <a href="${esc(d.source)}" target="_blank" rel="noopener" style="font-size:11px">出典</a>
    </div>`).join('');
  openSheet('sheetDict');
});

/* ---------------- PWA ---------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

render();
