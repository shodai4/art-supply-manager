/**
 * 一覧のカードから直接の在庫増減（−/＋）と、お気に入り（星）で上に固定する。
 *
 *   1) 画材データにお気に入りフラグ（favorite・既定 false）を持ち、1タップで切り替わる
 *   2) 一覧はお気に入りが先頭にまとまる（中の並びは今までどおり）
 *   3) カード上の −/＋ で在庫が増減し、0で「要補充」になり 0未満にならない
 *   4) 星と −/＋ はカードのタップ（編集シート）に伝わらない（入れ子のボタンを作らない）
 *   5) 375pxで崩れないコンパクトな置き方（CSS）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createItem, toggleFavorite, favoritesFirst, countFavorites, filterItems, adjustStock, isEmptyStock,
  sortItems, blankState, importState, exportState,
} from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

/* ---------------- データ（favorite） ---------------- */

test('お気に入りフラグは既定で false。付けた画材だけ true になる', () => {
  const plain = createItem({ name: 'ホルベイン 油絵具' });
  assert.equal(plain.favorite, false);
  assert.equal(createItem({ name: 'x', favorite: true }).favorite, true);
  // 文字列の 'true' などは受け付けない（保存データの取り違えを防ぐ）
  assert.equal(createItem({ name: 'x', favorite: 'true' }).favorite, false);
  // 0件の状態から作っても favorite を持つ（バックアップの往復で落ちない）
  const state = blankState();
  assert.equal(state.items.length, 0);
  const back = importState(exportState({ ...state, items: [plain] }));
  assert.equal(back.items[0].favorite, false);
});

test('星は1タップで入/切が入れ替わる（並びが動かないよう updatedAt は変えない）', () => {
  const item = createItem({ name: 'x', updatedAt: '2026-11-01T00:00:00.000Z' });
  const on = toggleFavorite(item);
  assert.equal(on.favorite, true);
  assert.equal(on.updatedAt, item.updatedAt);
  assert.equal(toggleFavorite(on).favorite, false);
  // 値を明示することもできる
  assert.equal(toggleFavorite(on, false).favorite, false);
  assert.equal(toggleFavorite(item, true).favorite, true);
  // 元のオブジェクトは変えない
  assert.equal(item.favorite, false);
});

test('お気に入りは一覧の先頭にまとまり、中の並び順は元のまま', () => {
  const a = createItem({ name: 'A' });
  const b = createItem({ name: 'B', favorite: true });
  const c = createItem({ name: 'C' });
  const d = createItem({ name: 'D', favorite: true });
  const sorted = favoritesFirst([a, b, c, d]);
  assert.deepEqual(sorted.map((it) => it.name), ['B', 'D', 'A', 'C']);
  assert.equal(countFavorites([a, b, c, d]), 2);
  assert.equal(countFavorites([]), 0);
  // 並び替え（新しい順など）を先にかけても、その順番の中のお気に入りが前に来る
  const byName = sortItems([a, b, c, d], 'name');
  assert.deepEqual(favoritesFirst(byName).map((it) => it.name), ['B', 'D', 'A', 'C']);
});

test('絞込で「お気に入りだけ」を出せる', () => {
  const items = [
    createItem({ name: 'A' }),
    createItem({ name: 'B', favorite: true }),
  ];
  assert.deepEqual(filterItems(items, { favoriteOnly: true }).map((it) => it.name), ['B']);
  assert.equal(filterItems(items, {}).length, 2);
  assert.equal(filterItems(items, { favoriteOnly: false }).length, 2);
});

test('−で0になると「要補充」に切り替わり、それ以上は減らない', () => {
  const one = createItem({ name: 'x', qty: 1, status: 'enough' });
  const zero = adjustStock(one, -1);
  assert.equal(zero.qty, 0);
  assert.equal(zero.status, 'empty');
  assert.equal(isEmptyStock(zero), true);
  const below = adjustStock(zero, -1);
  assert.equal(below.qty, 0, '0未満にならない');
  const back = adjustStock(below, 1);
  assert.equal(back.qty, 1);
  assert.equal(back.status, 'low', '補充したら要補充から外れる');
});

/* ---------------- 画面（カードのマークアップ） ---------------- */

test('一覧のカードに星と −/＋ があり、カードのタップ（編集）と分かれている', () => {
  const app = read('app.js');
  const tile = app.slice(app.indexOf('function itemTile('), app.indexOf('/**\n * 1件＝2行の高密度リスト行'));
  // 星と在庫ステッパー
  assert.match(tile, /data-fav="\$\{esc\(it\.id\)\}"/);
  assert.match(tile, /data-step="-1" data-id="\$\{esc\(it\.id\)\}"/);
  assert.match(tile, /data-step="1" data-id="\$\{esc\(it\.id\)\}"/);
  assert.match(tile, /class="tstep"/);
  assert.match(tile, /i-star-solid|i-star/);
  // カード（編集を開くボタン）の中にボタンを入れ子にしない（HTMLとして壊れる）
  const cardAt = tile.indexOf('<button class="tile');
  const cardEnd = tile.indexOf('</button>', cardAt);
  assert.ok(cardAt > 0 && cardEnd > cardAt, 'カードのボタンが見つかりません');
  assert.equal(/<button/.test(tile.slice(cardAt + 20, cardEnd)), false, 'カードの中にボタンが入れ子になっている');
  // 星とステッパーはカードの外（同じ枠の中のきょうだい）に、1行にまとめて差し込む
  const tpl = tile.slice(tile.indexOf('return `'));
  assert.match(tpl, /<\/button>\s*\$\{ui\.selectMode \? '' : `<span class="tilefoot">\$\{star\}\$\{stepper\}<\/span>`\}/, '星とステッパーはカードの外の1行に置く');
  // 画像（.sw）の上に星を重ねない（写真を隠さない）
  assert.equal(/\.sw[\s\S]{0,120}\$\{star\}/.test(tpl), false, '星が画像の上に重なっている');
  assert.equal(/class="qbadge"[^`]*\$\{star\}/.test(tpl), false, '星が画像の上に重なっている');
  // リスト表示でも星を出し、右端の鉛筆（編集）は星に置き換える
  const row = app.slice(app.indexOf('function itemRow('), app.indexOf('/**\n * 一覧の見出しのまとまり'));
  assert.match(row, /data-fav=/);
  assert.match(row, /class="icon-btn favbtn/);
  assert.equal(/<svg class="pencil"/.test(row), false, 'リストの鉛筆（編集）が残っている');
});

test('星と −/＋ のタップは編集シートに伝わらない（stopPropagation）', () => {
  const app = read('app.js');
  const body = app.slice(app.indexOf("document.addEventListener('click', (e) => {\n  // 子フォルダのチップ"));
  const favAt = body.indexOf("closest('[data-fav]')");
  const stepAt = body.indexOf("closest('[data-step]')");
  assert.ok(favAt > 0 && stepAt > favAt, '星と −/＋ の処理がありません');
  for (const [from, to] of [[favAt, stepAt], [stepAt, body.indexOf("closest('[data-edit]')")]]) {
    const block = body.slice(from, to);
    assert.match(block, /e\.stopPropagation\(\)/, 'イベントを伝えない');
    assert.match(block, /e\.preventDefault\(\)/);
  }
  // 星は保存して描き直す（お気に入りが上部へ移る）
  assert.match(body, /const next = toggleFavorite\(target\);[\s\S]{0,160}save\(\);\s*render\(\);/);
  // ＋は購入ログにも積む（画材費の記録済みに反映）
  assert.match(body, /recordPurchase\(it, delta\)/);
});

test('お気に入りだけを絞れる入口が絞込シートにある（専用ボタンは作らない）', () => {
  const html = read('index.html');
  const app = read('app.js');
  assert.match(html, /id="favChips"/);
  assert.match(app, /chip\('favonly', 'fav', 'お気に入り', ui\.favoriteOnly\)/);
  assert.match(app, /ui\.favoriteOnly = b\.dataset\.favonly === 'fav'/);
  // 「今描いてる作品」のような余計な専用ボタンは無い
  assert.equal(/今描いてる/.test(html), false);
  assert.equal(/今描いてる/.test(app), false);
});

/* ---------------- 見た目（375pxで崩れない） ---------------- */

test('星とステッパーは375pxのカードに収まる（等分・小さいボタン）', () => {
  const css = read('styles.css');
  assert.match(css, /\.tilewrap\s*\{[^}]*position:\s*relative[^}]*min-width:\s*0/);
  // 星とステッパーは画像の下の1行（tilefoot）に並べる
  assert.match(css, /\.tilefoot\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center/);
  assert.match(css, /\.tilefoot \.tstep\s*\{[^}]*flex:\s*1 1 auto[^}]*min-width:\s*0/);
  // 星は画像に重ねず、小さな枠のボタン（−/＋ の幅を残すため横は控えめ）
  assert.match(css, /\.fav\s*\{[^}]*width:\s*20px[^}]*height:\s*22px/);
  assert.equal(/\.fav\s*\{[^}]*position:\s*absolute/.test(css), false, '星が画像の上に重なっている');
  assert.match(css, /\.fav\.on\s*\{[^}]*color:/);
  // −/＋は等分・折り返さない
  assert.match(css, /\.tstep\s*\{[^}]*display:\s*flex[^}]*height:\s*22px/);
  assert.match(css, /\.tstep \.step\s*\{[^}]*flex:\s*1 1 0[^}]*min-width:\s*0/);
  assert.match(css, /\.tstep \.n\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  // 在庫切れの色
  assert.match(css, /\.tilewrap\.out \.tstep \.n\s*\{[^}]*color:\s*var\(--bad\)/);
});
