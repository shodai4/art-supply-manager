/**
 * 画材カードの長押しメニュー（フォルダと同じ 480ms）。
 *
 *   1) 在庫のグリッド・リスト・まとめカードの各場所行を長押しすると、画材メニューが出る
 *   2) メニューは「保管場所を移動 / 別の場所にも追加 / 編集 / お気に入り（解除） / 削除」
 *   3) −/＋・☆・フォルダチップ・鉛筆・別の場所に追加の上では長押しメニューを出さない
 *      （タップはこれまでどおり効く。選択モードのカードも通常のタップに任せる）
 *   4) 長押し直後の「タップ」を1回だけ打ち消す（編集シートやフォルダ移動を開かない）
 *   5) 削除の確認・写真の削除は、編集シートの「削除」と同じ処理を通す
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

/* ---------------- 1) メニューの用意 ---------------- */

test('画材メニューのシートが5項目を持つ（移動 / 別の場所 / 編集 / お気に入り / 削除）', () => {
  const html = read('index.html');
  for (const id of ['sheetItemMenu', 'itemMenuTitle', 'itemMenuSub',
    'btnItemMove', 'btnItemAddPlace', 'btnItemEdit', 'btnItemFav', 'btnItemRemove']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} がありません`);
  }
  const menu = html.slice(html.indexOf('id="sheetItemMenu"'), html.indexOf('id="sheetItemMenu"') + 1600);
  for (const label of ['保管場所を移動', '別の場所にも追加', '編集', 'お気に入り', '削除']) {
    assert.ok(menu.includes(label), `${label} がありません`);
  }
  // 削除は赤（フォルダメニューと同じ menubtn danger）
  assert.match(menu, /class="menubtn danger" id="btnItemRemove"/);
  // 星は押すたびに入/切するので、状態を持つ
  assert.match(menu, /id="btnItemFav" aria-pressed="false"/);
  assert.match(menu, /<svg class="ic" aria-hidden="true"><use href="#i-star"\/><\/svg>お気に入り/);
});

test('フォルダの長押しと同じ 480ms・同じ打ち消しで画材メニューを開く', () => {
  const app = read('app.js');
  assert.match(app, /const LONG_PRESS_MS = 480;/);
  assert.match(app, /const LONG_PRESS_MOVE_PX = 10;/);
  // フォルダを優先し、そうでなければ画材として長押しを受ける
  assert.match(app, /function itemIdFromPress\(el\)/);
  assert.match(app, /const itemId = folderId \? '' : itemIdFromPress\(e\.target\);/);
  assert.match(app, /if \(!folderId && !itemId\) return;/);
  assert.match(app, /pressTimer = setTimeout\(\(\) => \{[\s\S]{0,600}if \(folderId\) openFolderMenu\(folderId\);\n    else openItemMenu\(itemId\);/);
  // 長押し直後のタップは1回だけ打ち消す（編集中シートや移動シートが続けて開かない）
  assert.match(app, /suppressClickUntil = Date\.now\(\) \+ 600;/);
  assert.match(app, /pressEl = folderId\n    \? e\.target\.closest\('\[data-folder\], \[data-goto-folder\], \[data-fid\], \[data-folder-head\]'\)\n    : e\.target\.closest\('\.tilewrap, \.jg-row, \.item'\);/);
  // iOS の文字選択・画像の長押しメニューは出さない
  assert.match(app, /if \(folderIdFromPress\(e\.target\) \|\| itemIdFromPress\(e\.target\)\) e\.preventDefault\(\);/);
});

test('グリッド・リスト・まとめカードの行のどれでも、その場所の画材を選ぶ', () => {
  const css = read('styles.css');
  const app = read('app.js');
  // 対象の3つの形（タイル／リスト行／まとめカードの各場所行）
  assert.match(app, /const row = el\.closest\('\.jg-row'\);/);
  assert.match(app, /const card = el\.closest\('\.tilewrap, \.item'\);/);
  assert.match(app, /const btn = card\.querySelector\('\[data-edit\]'\);/);
  // まとめカードの行は、行の中の画材ID（編集・移動・増減のどれか）から読む
  assert.match(app, /const btn = row\.querySelector\('\[data-edit\], \[data-move\], \[data-step\]'\);/);
  assert.match(app, /btn\.dataset\.edit \|\| btn\.dataset\.move \|\| btn\.dataset\.id \|\| ''/);
  // 長押し中の見た目と、文字選択の抑止
  assert.match(css, /\.tilewrap, \.item, \.jg-row \{\n  -webkit-touch-callout: none; -webkit-user-select: none; user-select: none;\n\}/);
  assert.match(css, /\.tilewrap\.pressing \.tile, \.item\.pressing, \.jg-row\.pressing \{ filter: brightness\(\.96\); \}/);
});

test('カードの中の操作ボタン（−/＋・☆・チップ・鉛筆・別の場所）では長押しメニューを出さない', () => {
  const app = read('app.js');
  assert.match(app, /if \(el\.closest\('\[data-step\], \[data-fav\], \[data-fav-group\], \[data-move\], \[data-addplace\], \[data-shop-for\], \[data-select\], \.jg-pen, \.jg-add'\)\) return '';/);
  // まとめカードの星（data-fav-group）は、そのまま「まとめて入/切」のタップ
  assert.match(app, /const favGroup = e\.target\.closest\('\[data-fav-group\]'\);/);
  // −/＋ のタップも今までどおり（長押しの判定は pointerdown のみ、click は止めない）
  assert.match(app, /const step = e\.target\.closest\('\[data-step\]'\);/);
});

/* ---------------- 2) 各項目の動き ---------------- */

test('メニューは、その画材の名前・場所・点数を出し、星をいまの状態に合わせる', () => {
  const app = read('app.js');
  assert.match(app, /function openItemMenu\(id\)/);
  assert.match(app, /\$\('itemMenuTitle'\)\.firstChild\.textContent = displayName\(it\);/);
  assert.match(app, /\$\('itemMenuSub'\)\.textContent = `\$\{folderOf\(it\.folderId\)\.name\} ・ \$\{Number\(it\.qty\) \|\| 0\}点`;/);
  assert.match(app, /setItemMenuFav\(it\.favorite === true\);/);
  assert.match(app, /function setItemMenuFav\(on\)/);
  assert.match(app, /b\.setAttribute\('aria-pressed', on \? 'true' : 'false'\);/);
  assert.match(app, /<use href="#\$\{on \? 'i-star-solid' : 'i-star'\}"\/><\/svg>\$\{on \? 'お気に入りを解除' : 'お気に入り'\}/);
  assert.match(app, /openSheet\('sheetItemMenu'\);/);
});

test('「保管場所を移動」「別の場所にも追加」「編集」は、これまでのシートをそのまま使う', () => {
  const app = read('app.js');
  const move = app.slice(app.indexOf("$('btnItemMove')"), app.indexOf("$('btnItemAddPlace')"));
  assert.match(move, /closeSheet\('sheetItemMenu'\);/);
  assert.match(move, /openMoveSheet\(\[id\]\);/);

  const add = app.slice(app.indexOf("$('btnItemAddPlace')"), app.indexOf("$('btnItemEdit')"));
  assert.match(add, /closeSheet\('sheetItemMenu'\);/);
  assert.match(add, /openAddPlaceSheet\(id\);/);

  const edit = app.slice(app.indexOf("$('btnItemEdit')"), app.indexOf("$('btnItemFav').addEventListener"));
  assert.match(edit, /closeSheet\('sheetItemMenu'\);/);
  assert.match(edit, /openItemSheet\(id\);/);
});

test('「お気に入り」は押すたびに入/切し、シートを開いたまま表示も切り替える', () => {
  const app = read('app.js');
  const fav = app.slice(app.indexOf("$('btnItemFav').addEventListener"), app.indexOf("$('btnItemRemove')"));
  assert.match(fav, /const next = toggleFavorite\(it\);/);
  assert.match(fav, /state = upsertItem\(state, next\);/);
  assert.match(fav, /save\(\);/);
  assert.match(fav, /render\(\);/);
  assert.match(fav, /setItemMenuFav\(next\.favorite === true\);/);
  assert.match(fav, /toast\(next\.favorite \? 'お気に入りにしました（お気に入りフォルダに入ります）' : 'お気に入りをはずしました'\);/);
});

test('「削除」は確認のうえ、写真も消して一覧を描き直す（編集シートと同じ処理）', () => {
  const app = read('app.js');
  // 共通処理にまとめ、編集シートの削除もメニューの削除も同じ道を通る
  assert.match(app, /async function removeItem\(id, \{ fromSheet = '' \} = \{\}\)/);
  assert.match(app, /if \(!confirm\('この画材を削除しますか？\\n（元に戻せません）'\)\) return false;/);
  assert.match(app, /state = deleteItems\(state, \[id\]\);/);
  assert.match(app, /await deletePhoto\(id\);\n    dropPhotoUrl\(id\);/);
  assert.match(app, /if \(fromSheet\) closeSheet\(fromSheet\);/);
  assert.ok(app.includes("$('btnDeleteItem').addEventListener('click', async () => {\n  if (!ui.editingId) return;\n  const id = ui.editingId;\n  await removeItem(id, { fromSheet: 'sheetItem' });\n});"), '編集シートの削除が共通処理を通っていない');
  assert.ok(app.includes("$('btnItemRemove').addEventListener('click', () => {\n  if (!itemMenuId) return;\n  removeItem(itemMenuId, { fromSheet: 'sheetItemMenu' });\n});"), 'メニューの削除が共通処理を通っていない');
});

test('長押しで開くメニューは、フォルダのメニューと同じ並び（menulist / menubtn）で出す', () => {
  const html = read('index.html');
  const menu = html.slice(html.indexOf('id="sheetItemMenu"'), html.indexOf('id="sheetItemMenu"') + 1600);
  assert.match(menu, /<div class="menulist">/);
  assert.equal((menu.match(/class="menubtn/g) || []).length, 5);
  // 絵文字は使わない（アイコンはSVGスプライト）
  assert.equal(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(menu), false);
});
