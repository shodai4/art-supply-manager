/**
 * 検索タブの「シリーズ」での絞り込み。
 *
 *   1) メーカー・カテゴリ・検索語で絞ったとき、その中のシリーズを件数つきで集計する
 *   2) プルダウン（すべてのシリーズ＋各シリーズ・件数）で絞れる＝画面を縦に押し潰さない
 *   3) 絞った結果（メーカー見出し・件数）は、シリーズの分だけ減る
 *   4) メーカー・カテゴリを変えたら、無くなったシリーズの選択は残さない（自動で「すべて」へ）
 *   5) 何も絞っていないときは数えずに出さない（3.7万件でも軽い）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dictionarySeriesList, searchDictionary, groupDictionarySearch, dictionaryHaystack,
} from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const app = read('app.js');
const html = read('index.html');

/** テスト用の小さな辞書（実データと同じ形） */
const DICT = [
  { jan: '4900000000001', name: 'オイルカラー ウルトラマリン', maker: 'ホルベイン', category: 'oil', series: 'オイルカラー', colorName: 'ウルトラマリン' },
  { jan: '4900000000002', name: 'オイルカラー セルリアン', maker: 'ホルベイン', category: 'oil', series: 'オイルカラー', colorName: 'セルリアン' },
  { jan: '4900000000003', name: 'スケッチブック S', maker: 'ホルベイン', category: 'paper', series: 'スケッチ', size: 'S' },
  { jan: '4900000000004', name: 'レンブラント 赤', maker: 'ターレンス', category: 'oil', series: 'レンブラント', colorName: '赤' },
  { jan: '4900000000005', name: '平筆 12号', maker: 'ターレンス', category: 'brush', series: '', size: '12号' },
  { jan: '4900000000006', name: 'オイルカラー 白', maker: 'ターレンス', category: 'oil', series: 'オイルカラー', colorName: '白' },
];

/* ---------------- 1) 集計 ---------------- */

test('シリーズを件数つきで集計する（名前の無いものは数えない・五十音順）', () => {
  assert.deepEqual(dictionarySeriesList(DICT), [
    { name: 'オイルカラー', count: 3 },
    { name: 'スケッチ', count: 1 },
    { name: 'レンブラント', count: 1 },
  ]);
});

test('メーカー・カテゴリ・検索語で絞った中のシリーズだけを集計する', () => {
  assert.deepEqual(dictionarySeriesList(DICT, '', { maker: 'ターレンス' }), [
    { name: 'オイルカラー', count: 1 },
    { name: 'レンブラント', count: 1 },
  ]);
  assert.deepEqual(dictionarySeriesList(DICT, '', { maker: 'ターレンス', category: 'oil' }), [
    { name: 'オイルカラー', count: 1 },
    { name: 'レンブラント', count: 1 },
  ]);
  assert.deepEqual(dictionarySeriesList(DICT, '', { category: 'paper' }), [{ name: 'スケッチ', count: 1 }]);
  // 検索語（ひらがな・カタカナのゆらぎも吸収）でも効く
  assert.deepEqual(dictionarySeriesList(DICT, 'おいる'), [{ name: 'オイルカラー', count: 3 }]);
  // 索引を渡しても同じ（画面はキャッシュした hay を使う）
  assert.deepEqual(dictionarySeriesList(DICT, 'おいる', { hay: dictionaryHaystack(DICT) }), [{ name: 'オイルカラー', count: 3 }]);
  // 何も無いときは空
  assert.deepEqual(dictionarySeriesList(DICT, 'コピック'), []);
});

/* ---------------- 2) 絞り込み ---------------- */

test('シリーズで辞書を絞れる（メーカー・カテゴリ・検索語と重ねられる）', () => {
  assert.equal(searchDictionary(DICT, '', { limit: 20, series: 'オイルカラー' }).total, 3);
  assert.equal(searchDictionary(DICT, '', { limit: 20, series: 'レンブラント' }).total, 1);
  assert.deepEqual(searchDictionary(DICT, '', { limit: 20, series: 'オイルカラー', maker: 'ターレンス' }).items.map((d) => d.jan), ['4900000000006']);
  assert.equal(searchDictionary(DICT, '白', { limit: 20, series: 'レンブラント' }).total, 0);
  // シリーズ名が空の商品は、シリーズで絞ると出ない
  const noSeries = searchDictionary(DICT, '', { limit: 20, series: 'スケッチ' });
  assert.deepEqual(noSeries.items.map((d) => d.jan), ['4900000000003']);
  // シリーズを選ばなければ従来どおり全件
  assert.equal(searchDictionary(DICT, '', { limit: 20 }).total, DICT.length);
});

test('メーカー見出しの件数も、シリーズで絞った分になる', () => {
  const all = groupDictionarySearch(DICT, '', { series: '' });
  assert.equal(all.total, 6);
  const oil = groupDictionarySearch(DICT, '', { series: 'オイルカラー' });
  assert.equal(oil.total, 3);
  const tarens = oil.groups.find((g) => g.maker === 'ターレンス');
  const holbein = oil.groups.find((g) => g.maker === 'ホルベイン');
  assert.equal(holbein.items.length, 2);
  assert.equal(tarens.items.length, 1);
  // 索引つきでも同じ
  const withHay = groupDictionarySearch(DICT, '', { hay: dictionaryHaystack(DICT), series: 'レンブラント' });
  assert.equal(withHay.total, 1);
});

/* ---------------- 3) 画面 ---------------- */

test('検索タブに「シリーズ」のプルダウンがある（すべて＋各シリーズ・件数）', () => {
  for (const id of ['dictSeriesSec', 'dictSeriesSel']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} がありません`);
  }
  const section = html.slice(html.indexOf('id="dictSeriesSec"'), html.indexOf('id="dictSeriesSec"') + 500);
  assert.match(section, /<label class="dflabel" for="dictSeriesSel">シリーズ<\/label>/);
  assert.match(section, /<select id="dictSeriesSel" aria-label="シリーズで絞る"><\/select>/);
  // カテゴリの下・検索バーの上（縦に押し潰さないプルダウン）
  assert.ok(html.indexOf('id="dictCatSec"') < html.indexOf('id="dictSeriesSec"'));
  assert.ok(html.indexOf('id="dictSeriesSec"') < html.indexOf('id="dictQTab"'));

  // 選択肢は「すべてのシリーズ（件数）」＋各シリーズ（件数）
  assert.match(app, /dictionaryRowDetail, dictionarySeriesList,/);
  assert.match(app, /function dictSeriesList\(\) \{/);
  assert.match(app, /selSeries\.innerHTML = `<option value="">すべてのシリーズ（\$\{sum\.toLocaleString\('ja-JP'\)\}）<\/option>`/);
  assert.match(app, /\.map\(\(s\) => `<option value="\$\{esc\(s\.name\)\}">\$\{esc\(s\.name\)\}（\$\{s\.count\.toLocaleString\('ja-JP'\)\}）<\/option>`\)/);
  // メーカーのプルダウンと同じ見た目（横幅いっぱい・同じ高さ。1枚の枠の中の細い行）
  const css = read('styles.css');
  assert.match(css, /\.dict-filter select \{\n  flex: 1 1 auto; min-width: 0; height: 34px;/);
  // 絞った条件（メーカー・カテゴリ・検索語）が変わったときだけ作り直す
  assert.match(app, /const seriesKey = `\$\{dictTabMaker\}\\u0000\$\{dictTabCategory\}\\u0000\$\{dictTabQuery\}`;/);
  assert.match(app, /if \(selSeries\.dataset\.built !== seriesKey\)/);
});

test('シリーズは検索結果の絞り込みにそのまま効き、見出しの開閉の記憶も条件ごとに捨てる', () => {
  assert.match(app, /let dictTabSeries = '';/);
  assert.match(app, /dictGroups = groupDictionarySearch\(mergedDict, dictTabQuery, \{\n      hay: dictionaryHaystack\(mergedDict\), maker: dictTabMaker, category: dictTabCategory, series: dictTabSeries,\n    \}\);/);
  assert.match(app, /const scope = `\$\{dictTabQuery\}\\u0000\$\{dictTabMaker\}\\u0000\$\{dictTabCategory\}\\u0000\$\{dictTabSeries\}`;/);
  assert.match(app, /const groupsKey = `\$\{dictTabQuery\}\\u0000\$\{dictTabMaker\}\\u0000\$\{dictTabCategory\}\\u0000\$\{dictTabSeries\}`;/);
  // 注記は短く1行に保つ（絞った条件は上のプルダウン・チップに出ているので繰り返さない）
  assert.match(app, /\$\('dictTabNote'\)\.textContent = `内蔵辞書 \$\{mergedDict\.length\.toLocaleString\('ja-JP'\)\}件から、そのまま在庫に追加できます`;/);
  // プルダウンを変えたら描き直す
  assert.match(app, /\$\('dictSeriesSel'\)\.addEventListener\('change', \(e\) => \{\n  dictTabSeries = e\.target\.value;\n  renderSearchTab\(\);\n\}\);/);
});

test('メーカー・カテゴリを変えたら、無くなったシリーズの選択は自動で戻す', () => {
  // メーカーを変えたらカテゴリもシリーズも捨てる
  assert.match(app, /\$\('dictMakerSel'\)\.addEventListener\('change', \(e\) => \{\n  dictTabMaker = e\.target\.value;\n  \/\/ メーカーが変わるとカテゴリもシリーズも別物になるので、選んでいたものは捨てる\n  dictTabCategory = '';\n  dictTabSeries = '';/);
  // カテゴリを変えたらシリーズも戻す
  assert.match(app, /dictTabCategory = b\.dataset\.dictCat \|\| '';\n  dictTabSeries = '';/);
  // いまの条件に無いシリーズが選ばれていたら「すべて」へ
  assert.match(app, /if \(dictTabSeries && !seriesRows\.some\(\(s\) => s\.name === dictTabSeries\)\) dictTabSeries = '';/);
  // 辞書の更新で消えたシリーズも「すべて」へ
  assert.match(app, /selSeries\.value = dictTabSeries;\n    if \(selSeries\.value !== dictTabSeries\) dictTabSeries = '';/);
});

test('何も絞らずにいるときはシリーズを数えない（3.7万件の検索タブを軽く保つ）', () => {
  assert.match(app, /const narrowed = Boolean\(dictTabQuery \|\| dictTabMaker \|\| dictTabCategory\);/);
  assert.match(app, /const seriesRows = narrowed \? dictSeriesList\(\) : \[\];/);
  assert.match(app, /const showSeries = seriesRows\.length > 1;\n  \$\('dictSeriesSec'\)\.hidden = !showSeries;/);
  // 集計は条件が変わったときだけ（毎描画で数え直さない）
  assert.match(app, /if \(key !== dictSeriesKey \|\| dictSeriesDict !== mergedDict\) \{\n    dictSeriesRows = dictionarySeriesList\(mergedDict, dictTabQuery, \{/);
});
