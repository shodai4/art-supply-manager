/**
 * 補充タブの「＋」→「補充を確定」の約束ごと（v1.35.0）。
 *
 *   1) 補充タブの＋は、押した場でステータスを「十分」にしない（一覧から消さない）
 *   2) ＋した分だけ在庫を増やし、何個増やしたかを「＋N」で出す（−で戻せる）
 *   3) 確定待ちがあるときだけ「補充を確定」を出し、押すとまとめて「十分」へ
 *   4) タブを移ってもアプリを閉じても（保存・復元しても）確定待ちは残る
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  adjustStock, computeShoppingList, normalizeRestockPending, bumpRestockPending,
  restockSummary, confirmRestock, blankState, exportState, importState, upsertItem,
} from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const app = read('app.js');
const html = read('index.html');
const css = read('styles.css');

const item = (id, { qty = 1, status = 'low', name = id } = {}) => ({
  id, name, maker: 'ホルベイン', series: 'アーティスト色鉛筆', folderId: 'atelier',
  category: 'pencil', qty, status, favorite: false, jan: '', price: 200, purchaseLog: [],
});
const ITEMS = [item('a'), item('b', { qty: 0, status: 'empty' }), item('c', { qty: 3, status: 'enough' })];

/* ---------------- 1) 数え ---------------- */

test('確定待ちは正の整数だけを残し、補充リストから外れた画材は捨てる', () => {
  assert.deepEqual(normalizeRestockPending(null), {});
  assert.deepEqual(normalizeRestockPending([1, 2]), {}, '配列は数えとして扱わない');
  assert.deepEqual(normalizeRestockPending({ a: 2, b: 0, c: -1, '': 3, d: 'x' }), { a: 2 });
  // 実在して、まだ補充リストに残っている画材だけ（十分になった・消した分は捨てる）
  assert.deepEqual(normalizeRestockPending({ a: 2, c: 1, zz: 1 }, ITEMS), { a: 2 });
});

test('＋で数え、−で戻す（0になったら消える）', () => {
  let p = bumpRestockPending({}, 'a');
  assert.deepEqual(p, { a: 1 });
  p = bumpRestockPending(p, 'a');
  assert.deepEqual(p, { a: 2 });
  p = bumpRestockPending(p, 'a', -1);
  assert.deepEqual(p, { a: 1 });
  p = bumpRestockPending(p, 'a', -1);
  assert.deepEqual(p, {}, '押し過ぎてもマイナスにしない');
});

test('確定待ちのまとめ（件数と、増やした合計）', () => {
  assert.deepEqual(restockSummary({}), { items: 0, added: 0, pending: {} });
  const sum = restockSummary({ a: 2, b: 1 });
  assert.equal(sum.items, 2);
  assert.equal(sum.added, 3);
});

/* ---------------- 2) ＋は即座に「十分」にしない ---------------- */

test('＋してもステータスは「十分」にならず、充足数だけが増える（一覧に残る）', () => {
  const before = ITEMS[0];
  const after = adjustStock(before, 1);
  assert.equal(after.qty, 2);
  assert.equal(after.status, 'low', '＋で「十分」になって一覧から消えてしまう');
  assert.equal(computeShoppingList([after]).length, 1, '＋で補充リストから消えてしまう');
});

test('−で戻すと、増やした分が消えて元の在庫数に戻る', () => {
  const bought = adjustStock(ITEMS[0], 1);
  const back = adjustStock(bought, -1);
  assert.equal(back.qty, 1);
  assert.equal(back.status, 'low');
});

/* ---------------- 3) 確定でまとめて「十分」 ---------------- */

test('「補充を確定」で確定待ちの画材だけが「十分」になり、補充リストから外れる', () => {
  const items = [...ITEMS, item('d', { qty: 2, status: 'low' })];
  const pending = { a: 2, d: 1 };
  const { items: after, confirmed, kept } = confirmRestock(items, pending);
  assert.equal(confirmed, 2);
  assert.equal(kept, 0);
  const byId = new Map(after.map((i) => [i.id, i]));
  assert.equal(byId.get('a').status, 'enough');
  assert.equal(byId.get('d').status, 'enough');
  assert.equal(byId.get('b').status, 'empty', '確定待ちでない画材は触らない');
  assert.equal(byId.get('c').status, 'enough');
  // 補充リストからは、確定した2件が外れる（在庫0の b は最初から入っている）
  assert.deepEqual(computeShoppingList(after).map((i) => i.id), ['b']);
});

test('在庫が0のままの画材は「十分」にせず、補充リストに残す', () => {
  const zero = [item('z', { qty: 0, status: 'low' })];
  const { items, confirmed, kept } = confirmRestock(zero, { z: 1 });
  assert.equal(confirmed, 0);
  assert.equal(kept, 1);
  assert.equal(items[0].status, 'low');
  assert.equal(computeShoppingList(items).length, 1);
});

/* ---------------- 4) 保存・復元（タブ移動・再起動） ---------------- */

test('確定待ちは保存され、読み直しても残る（実在する画材だけ）', () => {
  const state = { ...blankState(), items: ITEMS, restockPending: { a: 2, zz: 9 } };
  const saved = exportState(state);
  assert.match(saved, /"restockPending"/);
  const restored = importState(saved);
  assert.deepEqual(restored.restockPending, { a: 2 }, '消えた画材の数えは持ち越さない');
  // 空の状態からは空
  assert.deepEqual(importState(exportState({ ...blankState(), items: ITEMS })).restockPending, {});
});

test('＋のあと保存しても、画材のステータスは「十分」になっていない', () => {
  const state = { ...blankState(), items: ITEMS };
  const next = upsertItem(state, adjustStock(ITEMS[0], 1));
  const saved = JSON.parse(exportState({ ...next, restockPending: bumpRestockPending({}, 'a') }));
  const savedItem = saved.items.find((i) => i.id === 'a');
  assert.equal(savedItem.qty, 2);
  assert.equal(savedItem.status, 'low');
  assert.deepEqual(saved.restockPending, { a: 1 });
});

/** 補助: 在庫0で「十分」のまま残っている画材も、＋で一覧から消えない */
test('在庫0の「十分」も、＋したら確定まで一覧に残す（ステータスを「十分」にしない）', () => {
  const state = { ...blankState(), items: [item('zero', { qty: 0, status: 'enough' })] };
  assert.equal(computeShoppingList(state.items).length, 1, '在庫0なら補充リストに入る');
  // アプリは＋のあと、充足のままなら「残りわずか」にそろえて一覧に残す
  assert.match(app, /const staying = \(next\.status === 'low' \|\| next\.status === 'empty'\) \? next : \{ \.\.\.next, status: 'low' \};/);
});

/* ---------------- 5) 画面の組み立て（app.js / index.html / styles.css） ---------------- */

test('補充タブの＋/−は確定待ちを通す（他の一覧の＋は今までどおり）', () => {
  assert.match(app, /if \(step\.closest\('#shoppingList'\)\) \{ stepRestock\(it, delta\); return; \}/);
  assert.match(app, /function stepRestock\(it, delta\) \{/);
  // 確定待ちでない行の−は、今までどおり在庫を減らす
  assert.match(app, /if \(delta < 0 && !\(pending\[it\.id\] > 0\)\) \{/);
  // ＋は買い足しとして購入ログにも残す
  assert.match(app, /const next = adjustStock\(delta > 0 \? recordPurchase\(it, delta\) : it, delta\);/);
  assert.match(app, /restockPending: bumpRestockPending\(pending, it\.id, delta\),/);
});

test('確定待ちのときだけ「補充を確定」バーを出し、押すとまとめて確定する', () => {
  assert.match(html, /<div class="restockbar" id="restockBar" hidden>/);
  assert.match(html, /<button type="button" class="btn primary" id="restockConfirm">補充を確定<\/button>/);
  assert.match(app, /function renderRestockBar\(pending = normalizeRestockPending\(state\.restockPending, state\.items\)\) \{/);
  assert.match(app, /const show = ui\.tab === 'shopping' && sum\.items > 0;/);
  assert.match(app, /function confirmRestockAction\(\) \{/);
  assert.match(app, /\$\('restockConfirm'\)\.addEventListener\('click', confirmRestockAction\);/);
  // バーはタブバーの上に固定し、出ている間は右下の＋／読取を逃がす
  assert.match(css, /\.restockbar\s*\{[^}]*position: fixed;[^}]*bottom: calc\(var\(--tabbar-h\)/);
  assert.match(css, /body\[data-restock-bar="true"\] \.fab\s*\{/);
});

test('増やした数は行に出し、充足のバッジと入れ替える（幅が足りなくなるため）', () => {
  assert.match(app, /const bump = Math\.max\(0, Math\.trunc\(Number\(opts\.pending\?\.\[it\.id\]\) \|\| 0\)\);/);
  assert.match(app, /\$\{bump\s*\?\s*`<span class="badge bump" title="「補充を確定」で十分になります">＋\$\{bump\}<\/span>`/);
  assert.match(css, /\.badge\.bump \{ background: var\(--accent-soft\); color: var\(--accent\); \}/);
  assert.match(css, /\.item\.pending \{/);
});
