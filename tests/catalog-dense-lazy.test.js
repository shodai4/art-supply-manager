// カタログ（内蔵辞書）の絞り込みを高密度にし、下の検索結果を広く見せる（2026-11-19 の依頼）。
//  - メーカー・カテゴリ・シリーズ・検索を1枚の枠にまとめ、見出しの行を重ねない
//  - 補足は1行に収める（「（マツダ）」で折り返して「ダ）」が出ていた）
//  - 大量の結果は画面の近くだけを描く（遅延描画）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const html = read('index.html');
const app = read('app.js');
const css = read('styles.css');

const catalog = html.slice(html.indexOf('id="view-catalog"'), html.indexOf('id="view-settings"'));

test('絞り込みは1枚の枠（.dict-filter）にまとまっている', () => {
  assert.equal((catalog.match(/<div class="card dict-filter">/g) || []).length, 1);
  // メーカー・カテゴリ・シリーズは、見出しの行（sechead）を重ねず、左の小さなラベルだけ
  for (const [label, forId] of [['メーカー', 'dictMakerSel'], ['シリーズ', 'dictSeriesSel']]) {
    assert.match(catalog, new RegExp(`<label class="dflabel" for="${forId}">${label}</label>`));
  }
  assert.match(catalog, /<span class="dflabel">カテゴリ<\/span>/);
  assert.equal(/<span>メーカー<\/span>/.test(catalog), false, 'メーカーの見出し行が残っている');
  assert.equal(/<span>シリーズ<\/span>/.test(catalog), false, 'シリーズの見出し行が残っている');
  assert.equal(/<span>カテゴリ<\/span><\/div>/.test(catalog), false, 'カテゴリの見出し行が残っている');
  // 並びは メーカー → カテゴリ（選んだとき）→ シリーズ（絞ったとき）→ 検索
  const at = (id) => catalog.indexOf(`id="${id}"`);
  assert.ok(at('dictMakerSel') > 0);
  assert.ok(at('dictMakerSel') < at('dictCatSec'));
  assert.ok(at('dictCatSec') < at('dictSeriesSec'));
  assert.ok(at('dictSeriesSec') < at('dictQTab'));
});

test('補足の文は短く、1行に収める（折り返して「ダ）」を出さない）', () => {
  // 絞った条件は上のプルダウン・チップに出ているので、文では繰り返さない
  assert.match(app, /内蔵辞書 \$\{mergedDict\.length\.toLocaleString\('ja-JP'\)\}件から、そのまま在庫に追加できます/);
  assert.equal(/そのまま在庫に追加できます（/.test(app), false, '条件を後ろに足す文が残っている');
  assert.match(css, /\.dict-note \{[^}]*white-space: nowrap;/);
  assert.match(css, /\.dict-note \{[^}]*text-overflow: ellipsis;/);
});

test('見た目: 細い行・小さいチップで、縦幅を詰める（片手で押せる大きさは残す）', () => {
  assert.match(css, /\.dict-filter \{\n  display: flex; flex-direction: column; gap: 5px;\n  padding: 8px 10px; margin: 8px 12px;\n\}/);
  assert.match(css, /\.dict-filter select \{\n  flex: 1 1 auto; min-width: 0; height: 34px;/);
  assert.match(css, /\.dict-filter \.dict-search input \{ height: 34px;/);
  assert.match(css, /\.dflabel \{\n  flex: 0 0 auto; width: 50px; font-size: 11px;/);
  // カテゴリは1行だけ横に流す（カテゴリが14個あるメーカーでも縦幅が増えない）
  assert.match(css, /\.chiprow \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/);
  assert.match(css, /\.chiprow \.fchip \{[^}]*padding: 5px 11px;/);
  // 右端はカードの色でぼかし、横に続きがあることを示す
  assert.match(css, /#dictCatSec::after \{[^}]*linear-gradient\(to right, rgba\(0, 0, 0, 0\), var\(--card\)\)/);
});

test('大量の結果は画面の近くだけを描く（遅延描画の約束）', () => {
  // メーカーの中身は入れ物だけ置き、画面に近づいたら少しずつ描く
  assert.match(app, /lazyMaker: \(g\) => `<div class="lazybody" data-lazy-maker="\$\{esc\(g\.maker\)\}"><\/div>`/);
  assert.match(app, /const DICT_LAZY_SERIES_CHUNK = 24;/);
  assert.match(app, /const DICT_LAZY_MS = 8;/);
  // 1社に1,400シリーズある所でも、続きの目印で次のぶんだけ置く
  assert.match(app, /data-lazy-more=/);
  // 行はシリーズ見出しが近づいたら置く（初回は DICT_MAKER_PAGE 行まで）
  assert.match(app, /const limit = Math\.min\(items\.length, Number\(el\.dataset\.limit \|\| 0\) \|\| DICT_MAKER_PAGE\);/);
  // 描き足しは1フレーム DICT_LAZY_MS まで
  assert.match(app, /while \(catalogLazyQueue\.length && performance\.now\(\) - start < DICT_LAZY_MS\)/);
  // 一覧を描き直すたびに、前の監視を止める
  assert.match(app, /catalogLazyObserver\?\.disconnect\(\);\n  \$\('dictResults'\)\.innerHTML = tree/);
});

test('「すべて開く／すべて閉じる」は件数で隠さない（未絞り込みでも押せる）', () => {
  assert.match(app, /function catalogGroupToggle\(\) \{\n  if \(!dictToggleGroups\.length\) return null;/);
  assert.equal(/GROUP_EXPAND_LIMITS/.test(app + read('core.js')), false);
  // ボタンは最初は隠しておき、一覧を描いたときに出す（空の一覧では出さない）
  assert.match(html, /<button type="button" class="allbtn" id="allToggleCatalog" data-all-surface="catalog" hidden>/);
});

test('行を選んだ（在庫に追加した）ときは、一覧を描き直さず押した行だけ変える', () => {
  assert.match(app, /function addDictToStock\(d, \{ keepList = false \} = \{\}\) \{/);
  assert.match(app, /render\(\{ keepCatalogList: keepList \}\)/);
  assert.match(app, /if \(!keepCatalogList\) renderSearchTab\(\);/);
  // 設定（辞書の件数）からの描き直しも、行を選んだ直後は止める
  assert.match(app, /if \(ui\.tab === 'catalog' && !renderSkipCatalog\) renderSearchTab\(\);/);
  // 押した行のボタンだけ「登録済み」に差し替える
  assert.match(app, /addDictToStock\(mergedDict\.find\(\(d\) => d\.jan === add\.dataset\.dictAdd\), \{ keepList: true \}\);/);
  assert.match(app, /have\.className = 'dres-have';/);
});

test('見出しの開け閉めは描き直さず、その場だけ（スクロール位置を飛ばさない）', () => {
  assert.match(app, /if \(surface === 'catalog'\) \{ catalogToggleInPlace\(head, isSeries, open\); return; \}/);
  assert.match(app, /function catalogShowMore\(btn\) \{/);
  assert.match(app, /el\.dataset\.limit = String\(limit\);\n  el\.dataset\.done = '';\n  fillCatalogSeriesBody\(el\);/);
  // 描き直す経路（テーマ変更・辞書の更新）でも、見ていた見出しへ戻す
  assert.match(app, /const anchor = catalogScrollAnchor\(\);/);
  assert.match(app, /if \(anchor\) restoreCatalogAnchor\(anchor\);/);
});
