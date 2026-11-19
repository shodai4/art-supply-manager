/**
 * カタログの「追加」でスクロール位置が飛ばないこと。
 *
 * 症状（iOS実機）: カタログを下までスクロールして「追加」を押すと、
 * 一覧がシリーズの先頭まで戻ってしまう。
 * 原因: 追加のあと裏で走る商品画像の取得が `render()` を丸ごと呼び、
 * カタログ一覧（#dictResults）を作り直していた。行は遅延描画なので
 * 作り直すと高さが変わり、iOS ではスクロール位置が飛ぶ。
 *
 * ここでは「追加のときも、画像が入ったあとも、一覧を作り直さない」ことと、
 * 「どうしても描き直すときは scrollTop で位置を合わせる」ことを固定する。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const app = read('app.js');

/** 関数の中身（`function 名前(` から、次の行頭 `}` まで）を取り出す */
function body(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} が見つからない`);
  const end = app.indexOf('\n}', start);
  assert.ok(end > start, `${name} の終わりが見つからない`);
  return app.slice(start, end);
}

test('カタログの「追加」は、一覧を作り直さない（押した行のボタンだけ差し替える）', () => {
  const add = body('addDictToStock');
  // 一覧を描き直さない指定で render する
  assert.match(add, /render\(\{ keepCatalogList: keepList \}\);/);
  // 念のため、描き直しでずれても元の scrollTop へ戻す
  assert.match(add, /const savedScroll = keepList \? captureCatalogScroll\(\) : null;/);
  assert.match(add, /restoreCapturedCatalogScroll\(savedScroll\);/);

  // 呼び出し側は「押した行のボタン」だけを置き換える
  assert.match(app, /const added = addDictToStock\(mergedDict\.find\(\(d\) => d\.jan === add\.dataset\.dictAdd\), \{ keepList: true \}\);/);
  assert.match(app, /add\.replaceWith\(have\);/);
  assert.match(app, /have\.className = 'dres-have';/);
});

test('商品画像の後入れ（追加の直後に走る）で、カタログの一覧と位置を動かさない', () => {
  // 追加の直後に走る autoFillItemImage は、丸ごとの render() を呼ばない
  const fill = body('autoFillItemImage');
  assert.equal(/[^.\w]render\(\);/.test(fill), false, 'autoFillItemImage が render() を丸ごと呼んでいる');
  assert.match(fill, /redrawKeepingPlace\(\);/);

  // 復帰時の画像の後補完も同じ
  const fillMissing = body('fillMissingImages');
  assert.match(fillMissing, /redrawKeepingPlace\(\); \/\/ カタログを見ているときは、その一覧とスクロール位置を動かさない/);
  assert.equal(/[^.\w]render\(\);/.test(fillMissing), false, 'fillMissingImages が render() を丸ごと呼んでいる');

  // 裏の処理からの描き直しは「カタログを見ているときだけ一覧を残す」
  const redraw = body('redrawKeepingPlace');
  assert.match(redraw, /const saved = captureCatalogScroll\(\);/);
  assert.match(redraw, /render\(\{ keepCatalogList: Boolean\(saved\) \}\);/);
  assert.match(redraw, /restoreCapturedCatalogScroll\(saved\);/);
});

test('一覧のスクロール位置は、その一覧の scrollTop で覚えて戻す', () => {
  const capture = body('captureCatalogScroll');
  assert.match(capture, /if \(ui\.tab !== 'catalog'\) return null;/);
  assert.match(capture, /const root = \$\('dictResults'\);/);
  assert.match(capture, /return \{ root, top: root\.scrollTop, winY: Number\(window\.scrollY\) \|\| 0 \};/);

  const restore = body('restoreCapturedCatalogScroll');
  assert.match(restore, /if \(Math\.abs\(root\.scrollTop - top\) >= 1\) root\.scrollTop = top;/);
  // ページ自体がずれた環境（iOS）にも備える
  assert.match(restore, /window\.scrollTo\(0, winY\);/);
  // 描き直しの直後にもう一度合わせる
  assert.match(restore, /requestAnimationFrame\(pin\)/);
});

test('見出しを覚えて戻すときも、一覧の scrollTop だけで合わせる（scrollIntoView を使わない）', () => {
  const restore = body('restoreCatalogAnchor');
  assert.match(restore, /const delta = target\.getBoundingClientRect\(\)\.top - root\.getBoundingClientRect\(\)\.top;/);
  assert.match(restore, /root\.scrollTop = Math\.max\(0, root\.scrollTop \+ delta - 4\);/);
  // scrollIntoView は iOS でページごと動かすことがあるので使わない
  assert.equal(/scrollIntoView\s*\(/.test(app), false, 'scrollIntoView を使っている');
});

test('「登録済み」は「追加」ボタンと同じ高さ（押した瞬間に行の高さが変わらない）', () => {
  const css = read('styles.css');
  const add = /\.dres-add \{([^}]*)\}/.exec(css);
  const have = /\.dres-have \{([^}]*)\}/.exec(css);
  assert.ok(add && have, '.dres-add / .dres-have の指定がない');
  assert.match(add[1], /min-height: 30px;/);
  assert.match(have[1], /min-height: 30px;/, '「登録済み」の高さが「追加」とそろっていない');
});
