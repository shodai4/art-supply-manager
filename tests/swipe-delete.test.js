/**
 * 画材の行を左へスワイプすると、右端から赤い「削除」が出る（iOS標準の一覧と同じ）。
 *
 *   1) 在庫のタイル・リストの行・まとめカードの各場所行のどれでも使える
 *   2) 30px以上左へ払うと削除ボタンが出たままになり、右へ戻す・よそをタップ・スクロールで閉じる
 *   3) 赤い「削除」は編集シート・長押しメニューと同じ removeItem（確認＋写真の削除）
 *      まとめカードの場所行なら、その場所の1点だけが消える
 *   4) −/＋・星・フォルダチップ・鉛筆では始めない／縦スクロールとは競合しない／
 *      480ms の長押しメニューは横に動き始めたらタイマーを止める／選択モード中は無効
 *   5) スワイプ直後のタップで編集シートが開かない（1回だけ打ち消す）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankState, createItem, upsertItem, deleteItems, findItemByJanInFolder } from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const app = read('app.js');
const css = read('styles.css');
const slice = (from, to) => app.slice(app.indexOf(from), app.indexOf(to));

/* ---------------- 1) 3つの形すべてに、削除ボタンつきの行が出る ---------------- */

test('タイル・リストの行・まとめカードの場所行が、スワイプ用の入れ物と赤い削除ボタンを持つ', () => {
  const tile = slice('function itemTile(', 'function itemRow(');
  assert.match(tile, /class="tilewrap swipe/, 'タイルがスワイプの入れ物になっていない');
  assert.match(tile, /data-swipe-id="\$\{esc\(it\.id\)\}"/);
  assert.match(tile, /\$\{swipeDeleteButton\(it\.id\)\}/);
  assert.match(tile, /<div class="swipe-inner">/, 'タイルの中身が1枚にまとまっていない');

  const row = slice('function itemRow(', 'function viewBlocks(');
  assert.match(row, /class="item swipe/, 'リストの行がスワイプの入れ物になっていない');
  assert.match(row, /data-swipe-kind="item"/);
  assert.match(row, /\$\{swipeDeleteButton\(it\.id\)\}/);
  assert.match(row, /<div class="swipe-inner">/);

  const group = slice('function janGroupCard(', 'function itemsBodyHtml(');
  assert.match(group, /class="jg-row swipe/, 'まとめカードの場所行がスワイプの入れ物になっていない');
  assert.match(group, /data-swipe-id="\$\{esc\(m\.id\)\}" data-swipe-kind="place"/);
  assert.match(group, /\$\{swipeDeleteButton\(m\.id\)\}/);
  assert.match(group, /<div class="swipe-inner">/);
});

test('削除ボタンは「削除」の白文字・赤（#dc2626）で、行の右端に重ねて置く', () => {
  assert.match(app, /function swipeDeleteButton\(id\) \{\n  return `<button type="button" class="swipe-del" data-swipe-del="\$\{esc\(id\)\}" tabindex="-1" aria-label="この画材を削除">削除<\/button>`;/);
  assert.match(css, /\.swipe-del \{[^}]*position: absolute; top: 0; right: 0; bottom: 0;[^}]*width: var\(--swipe-w\);/);
  assert.match(css, /\.swipe-del \{[^}]*background: #dc2626; color: #fff;/);
  assert.match(css, /\.swipe-del:active \{ background: #b91c1c; \}/);
  // 中身はボタンの上（閉じているときは赤が見えない）、左へずらす動きはスナップする
  assert.match(css, /\.swipe > \.swipe-inner \{\n  position: relative; z-index: 1; transform: translateX\(0\);\n  transition: transform \.18s/);
  assert.match(css, /\.swipe\.dragging > \.swipe-inner \{ transition: none; \}/);
  // タイルは幅が狭いので削除ボタンも細くする
  assert.match(css, /\.tilewrap\.swipe \{ --swipe-w: 46px; \}/);
  // 縦スクロールはブラウザに任せる（横だけ自前で受ける）
  assert.match(css, /\.swipe \{ --swipe-w: 76px;[^}]*touch-action: pan-y;/);
});

/* ---------------- 2) 操作の制御 ---------------- */

test('30px以上左へ払って離すと削除ボタンが出たままになり、10px動いたら横スワイプとみなす', () => {
  assert.match(app, /const SWIPE_START_PX = 10;/);
  assert.match(app, /const SWIPE_OPEN_PX = 30;/);
  // 出ている行は、30px右へ戻せば閉じる（払った距離ではなく戻した距離で決める）
  assert.match(app, /const open = commit && \(swipeBase < 0 \? at <= -\(w - SWIPE_OPEN_PX\) : at <= -SWIPE_OPEN_PX\);/);
  // 払った分だけ中身をずらす（右へは動かさず、行の幅で止める）
  assert.match(app, /swipeSetX\(swipeEl, Math\.min\(0, Math\.max\(-w, swipeBase \+ dx\)\)\);/);
  // 出したままの行は1行だけ
  assert.match(app, /function swipeOpen\(el\) \{\n  if \(!el\) return;\n  swipeCloseAll\(el\);/);
});

test('右へ戻す・よそをタップ・スクロールのどれでも閉じる', () => {
  // よそをタップ
  assert.match(app, /if \(swipeOpenEl && !swipeOpenEl\.contains\(e\.target\)\) swipeClose\(swipeOpenEl\);/);
  // スクロール
  assert.match(app, /window\.addEventListener\('scroll', \(\) => \{ if \(swipeOpenEl\) swipeCloseAll\(\); \}, \{ passive: true \}\);/);
  // 出したままの行をタップしたら、まず閉じるだけ（編集シートは開かない）
  assert.match(app, /if \(open && open\.contains\(e\.target\)\) \{\n    e\.preventDefault\(\);\n    e\.stopPropagation\(\);\n    swipeClose\(open\);/);
});

test('−/＋・星・フォルダチップ・鉛筆・通販の上ではスワイプを始めない（タップはそのまま）', () => {
  assert.match(app, /const SWIPE_BLOCKED = '\[data-step\], \[data-fav\], \[data-fav-group\], \[data-move\], \[data-addplace\], \[data-shop-for\], \[data-select\], \.step, \.jg-pen, \.jg-add, \.folder-tag, \.swipe-del';/);
  assert.match(app, /if \(target\.closest\(SWIPE_BLOCKED\)\) return null;/);
});

test('縦スクロール（dy > dx）とは競合せず、横に動き始めたら480msの長押しタイマーを止める', () => {
  assert.match(app, /if \(Math\.abs\(dy\) > Math\.abs\(dx\)\) \{ swipeReset\(\); return; \} \/\/ 縦スクロールに任せる/);
  assert.match(app, /swipeEl\.classList\.add\('dragging'\);\n    endPress\(\); \/\/ 480msの長押しメニューとは競合させない（タイマーを止める）/);
});

test('選択モード中はスワイプしない', () => {
  assert.match(app, /function swipeRowAt\(target\) \{\n  if \(!target \|\| typeof target\.closest !== 'function'\) return null;\n  if \(ui\.selectMode\) return null;/);
});

/* ---------------- 3) 削除は共通処理 ---------------- */

test('赤い「削除」は、編集シート・長押しメニューと同じ removeItem を通す', () => {
  assert.match(app, /const del = e\.target\.closest\('\[data-swipe-del\]'\);\n  if \(del\) \{\n    e\.preventDefault\(\);\n    const id = del\.dataset\.swipeDel \|\| '';\n    swipeCloseAll\(\);\n    if \(id\) removeItem\(id\);/);
  // removeItem は確認・写真の削除・再描画（既存の共通処理）
  assert.match(app, /async function removeItem\(id, \{ fromSheet = '' \} = \{\}\) \{/);
  assert.match(app, /if \(!confirm\('この画材を削除しますか？\\n（元に戻せません）'\)\) return false;/);
});

test('まとめカードの場所行を削除すると、その場所の1点だけが消えて他のフォルダは残る', () => {
  let state = blankState();
  const [home, atelier] = state.folders;
  const jan = '4901234567891';
  state = upsertItem(state, createItem({ name: 'ウルトラマリン', maker: 'ホルベイン', category: 'oil', jan, folderId: home.id, qty: 3 }));
  state = upsertItem(state, createItem({ name: 'ウルトラマリン', maker: 'ホルベイン', category: 'oil', jan, folderId: atelier.id, qty: 1 }));
  assert.equal(state.items.length, 2);

  const atHome = findItemByJanInFolder(state.items, jan, home.id);
  const atAtelier = findItemByJanInFolder(state.items, jan, atelier.id);
  state = deleteItems(state, [atAtelier.id]);

  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].id, atHome.id);
  assert.equal(state.items[0].qty, 3);
  assert.equal(findItemByJanInFolder(state.items, jan, atelier.id), null);
});

test('スワイプ直後のタップは1回だけ打ち消す（編集シートが続けて開かない）', () => {
  assert.match(app, /suppressClickUntil = Date\.now\(\) \+ 400;\n  suppressClickEl = el;/);
  // 赤い削除ボタンのタップは、長押し直後でも通す
  assert.match(app, /if \(e\.target\.closest\('\[data-swipe-del\]'\)\) \{ suppressClickEl = null; return; \}/);
});
