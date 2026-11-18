/**
 * カタログ上部の固定。
 *
 *   - 絞り込み（.dict-filter）〜「検索結果」の行までは動かさず、下の一覧だけがスクロールする
 *   - 重ねて固定（sticky）しない: 一覧を別のスクロール面にして、後ろの文字が透けないようにする
 *   - 一覧のスクロール位置は、描き直し（見出しの開閉・絞り込み）でも飛ばない
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('絞り込みから検索結果の行までが、一覧の外（固定側）にある', () => {
  const html = read('index.html');
  const start = html.indexOf('id="view-catalog"');
  const end = html.indexOf('id="view-settings"');
  const catalog = html.slice(start, end);
  assert.match(catalog, /<div class="catalog-sticky" id="catalogSticky">/);
  const head = catalog.slice(catalog.indexOf('class="catalog-sticky"'), catalog.indexOf('<div id="dictResults"'));
  assert.ok(head.indexOf('class="card dict-filter"') > 0, '絞り込みが一覧の中');
  assert.ok(head.indexOf('id="allToggleCatalog"') > 0, '「すべて開く」の行が一覧の中');
  assert.ok(head.indexOf('id="favMakers"') > 0, 'お気に入りメーカーが一覧の中');
  // 一覧は固定側の外（別のスクロール面）
  assert.match(head, /<\/div>\s*<\/div>\s*$/, '一覧まで固定側に入っている');
});

test('一覧だけがスクロールする（重ねないので透けない）', () => {
  const css = read('styles.css');
  const view = /#view-catalog:not\(\[hidden\]\) \{([^}]*)\}/.exec(css);
  assert.ok(view, '#view-catalog の高さ指定がない');
  assert.match(view[1], /display: flex; flex-direction: column;/);
  assert.match(view[1], /height: calc\(var\(--view-h, 100dvh\) - var\(--app-header-h, 40px\) - var\(--tabbar-h\)/);
  // 古いiOS向けに vh の行も先に置く
  assert.match(view[1], /height: calc\(100vh - var\(--app-header-h, 40px\)/);
  const list = /#dictResults \{([^}]*)\}/.exec(css);
  assert.ok(list, '#dictResults のスクロール指定がない');
  assert.match(list[1], /overflow-y: auto;/);
  assert.match(list[1], /min-height: 0;/);
  // カタログではページ自体を動かさない
  assert.match(css, /body\.catalog-mode \{ overflow: hidden; \}/);
  // 重ねて固定する指定は残っていない（透けの原因）
  assert.equal(/\.catalog-sticky \{[^}]*position: sticky/.test(css), false);
  assert.match(css, /\.catalog-sticky \{[^}]*background: var\(--bg\);/, '固定側に背景がない');
});

test('画面: カタログのときだけページを止め、一覧は内側でスクロールする', () => {
  const app = read('app.js');
  assert.match(app, /document\.body\.classList\.toggle\('catalog-mode', ui\.tab === 'catalog'\);/);
  // 遅延描画の判定も一覧のスクロール面を基準にする
  assert.match(app, /root: typeof document !== 'undefined' \? \$\('dictResults'\) : null/);
  // スクロール位置の記憶は一覧の scrollTop から
  assert.match(app, /const root = \$\('dictResults'\);\n  if \(ui\.tab !== 'catalog' \|\| !root \|\| root\.scrollTop <= 0\) return null;/);
});

test('貼り付く位置は、上部バーの高さを実測して合わせる（検索行の開閉にも追従）', () => {
  const app = read('app.js');
  assert.match(app, /const header = document\.querySelector\('\.app-header'\);/);
  assert.match(app, /document\.documentElement\.style\.setProperty\('--app-header-h', `\$\{Math\.ceil\(header\.getBoundingClientRect\(\)\.height\)\}px`\);/);
  assert.match(app, /new ResizeObserver\(\(\) => syncBottomMetrics\(\)\)\.observe\(header\)/);
});

test('ダークでも背景・線の変数が切り替わる（色を直書きしない）', () => {
  const css = read('styles.css');
  assert.match(css, /:root \{[^}]*--bg: #f1efe9;/);
  assert.match(css, /:root\[data-theme="dark"\] \{[^}]*--bg: #0f141a;/);
  assert.match(css, /:root\[data-theme="dark"\] \{[^}]*--line: #313b48;/);
  const block = /\.catalog-sticky \{([^}]*)\}/.exec(css)[1];
  assert.equal(/#[0-9a-f]{3,8}/i.test(block), false, '.catalog-sticky に色を直書きしている');
});
