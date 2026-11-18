/**
 * 検索タブをメーカー別に見やすくする。
 *
 *   1) メーカー絞り込みが「すべてのメーカー」のときは、結果をメーカー見出しごとにまとめる（五十音順）
 *   2) メーカーを選んでいるときも、そのメーカーの見出しの下にまとめる
 *   3) 各アイテムから、グレーのメーカー名・JANコードを消して「商品名＋色・容量」だけにする
 *   4) 件数（見出しの件数・「もっと見る」の残り）と在庫への追加は今までどおり
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupDictionaryByMaker, searchDictionary, dictionaryHaystack, dictionaryRowDetail, compareMakerName } from '../core.js';
import { JAN_DICTIONARY } from '../jan-database.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

const DICT = [
  { jan: '4901234567891', name: 'ウルトラマリン', maker: 'ホルベイン', category: 'oil', colorName: 'ウルトラマリン', size: '20ml', code: 'H001' },
  { jan: '4901234567892', name: 'ウルトラマリン', maker: 'ホルベイン', category: 'oil', colorName: 'ウルトラマリン', size: '10ml', code: 'H002' },
  { jan: '4901234567893', name: 'ウルトラマリン', maker: 'ターレンス', category: 'watercolor', colorName: 'ウルトラマリン', size: '10ml', code: 'T010' },
  { jan: '4901234567894', name: '平筆 12号', maker: 'ターレンス', category: 'brush', colorName: '', size: '12号', code: 'B012' },
  { jan: '4901234567895', name: '平筆 6号', maker: 'ホルベイン', category: 'brush', colorName: '', size: '6号', code: 'B006' },
];

test('メーカー見出しごとにまとまり、あいうえお順に並ぶ（中の順は当たり順のまま）', () => {
  const groups = groupDictionaryByMaker(DICT);
  assert.deepEqual(groups.map((g) => g.maker), ['ターレンス', 'ホルベイン']);
  assert.deepEqual(groups.map((g) => g.items.length), [2, 3]);
  // 中の並びは渡した順
  assert.deepEqual(groups[1].items.map((d) => d.jan), ['4901234567891', '4901234567892', '4901234567895']);
  // 合計は元の件数と一致（取りこぼさない）
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), DICT.length);
  // メーカー未設定は「メーカー不明」にまとまる
  const withUnknown = groupDictionaryByMaker([{ jan: '1', name: 'x' }, { jan: '2', name: 'y', maker: 'A' }]);
  assert.deepEqual(withUnknown.map((g) => g.maker).sort(), ['A', 'メーカー不明'].sort());
  assert.deepEqual(groupDictionaryByMaker([]), []);
});

test('同数のときは名前順（見出しの並びが毎回変わらない）', () => {
  const two = [
    { jan: '1', name: 'a', maker: 'あ社' },
    { jan: '2', name: 'b', maker: 'い社' },
  ];
  assert.deepEqual(groupDictionaryByMaker(two).map((g) => g.maker), ['あ社', 'い社']);
  assert.deepEqual(groupDictionaryByMaker([...two].reverse()).map((g) => g.maker), ['あ社', 'い社']);
});

test('内蔵辞書でも同じようにまとめられる（上位50件・合計が一致）', () => {
  const { items, total } = searchDictionary(JAN_DICTIONARY, '', { limit: 50, hay: dictionaryHaystack(JAN_DICTIONARY) });
  assert.equal(items.length, 50);
  assert.ok(total > 30000);
  const groups = groupDictionaryByMaker(items);
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), 50);
  // 同じメーカーが2つの見出しに分かれていない
  const makers = groups.map((g) => g.maker);
  assert.equal(new Set(makers).size, makers.length);
  // 見出しは五十音順（カタカナ・ひらがなを混ぜてもあいうえお順）
  const sorted = [...makers].sort(compareMakerName);
  assert.deepEqual(makers, sorted);
});

test('画面: メーカー見出しで分けて描き、見出しはタップで開け閉めできる', () => {
  const app = read('app.js');
  const css = read('styles.css');
  // メーカー未選択でも選択中でも、メーカー見出しごとにまとめる（同じ条件の描き直しは集計を使い回す）
  assert.match(app, /dictGroups = groupDictionarySearch\(mergedDict, dictTabQuery, \{/);
  assert.match(app, /const groupsKey = `\$\{dictTabQuery\}\\u0000\$\{dictTabMaker\}\\u0000\$\{dictTabCategory\}\\u0000\$\{dictTabSeries\}`;/);
  assert.match(app, /if \(groupsKey !== dictGroupsKey \|\| dictGroupsDict !== mergedDict\) \{/);
  assert.match(app, /const plan = planDictGroups\(groups, \{/);
  // 見出しは在庫・補充と同じ itemTreeHtml（共通の mg/mghead）で、開閉状態を aria-expanded で持つ
  assert.match(app, /const treeGroups = plan\.map\(\(p\) => \(\{ maker: p\.maker, label: p\.maker, total: p\.total, open: p\.open \}\)\);/);
  assert.match(app, /const tree = itemTreeBlockHtml\(treeGroups, \{\n    surface: 'catalog',/);
  assert.match(app, /return `<section class="mg\$\{mOpen \? ' open' : ''\}">/);
  assert.match(app, /class="mghead" data-g-surface="\$\{esc\(surface\)\}" data-g-maker="\$\{esc\(maker\)\}" aria-expanded="\$\{open \? 'true' : 'false'\}"/);
  assert.match(app, /<use href="#i-chevron"\/>/);
  assert.match(app, /<span class="mgname">\$\{esc\(label\)\}<\/span><b>\$\{countBadge\(total\)\}<\/b>/);
  // 閉じているメーカーの中身は描かない（見出しだけ）
  assert.match(app, /\$\{sOpen \? body\(s\.items, s\.name, g\) : ''\}/);
  assert.match(css, /\.mghead\s*\{[^}]*font-size:\s*14px[^}]*font-weight:\s*700/);
  assert.match(css, /\.mg\.open \.mghead \.chev\s*\{[^}]*transform:\s*rotate\(90deg\)/);
  // 見出しの区切り線（最初の見出しには付けない）
  assert.match(css, /\.mg\s*\{[^}]*border-top:\s*1px solid var\(--line\)/);
  assert.match(css, /\.mg:first-child\s*\{[^}]*border-top:\s*none/);
});

test('画面: 結果の各行からメーカー名とJANのグレー表示を消す', () => {
  const app = read('app.js');
  const css = read('styles.css');
  // JANの行（dres-jan）は出さない
  assert.equal(/dres-jan/.test(app), false, 'JANの表示が残っている');
  assert.equal(/\.dres-jan/.test(css), false, 'JANのスタイルが残っている');
  // 行の中身は「商品名＋色・容量」だけ（メーカーは見出しに出す）
  // 補足の行は、いま出している名前に含まれないものだけ（色名を2度書かない）
  assert.match(app, /const sub = dictionaryRowDetail\(\{ name, colorName: d\.colorName, size: d\.size \}\);/);
  // 名前は「シリーズ ＋ 色名」（どちらも無ければ商品名）にする＝メーカー名も二重にならない
  assert.match(app, /const nameOf = \(d, seriesName = ''\) => seriesItemLabel\(d, seriesName\) \|\| catalogItemLabel\(d\);/);
  // シリーズ名は淡く、色名・号数は濃く出す（「シリーズ名＋色名＋号数」で読める）
  assert.match(app, /<span class="dres-name">\$\{esc\(name\)\}<\/span>/);
  // 追加・登録済み・タップで登録フォームは今までどおり
  assert.match(app, /data-dict-add="\$\{esc\(d\.jan\)\}"/);
  assert.match(app, /<span class="dres-have">登録済み<\/span>/);
  assert.match(app, /data-dict-pick="\$\{esc\(d\.jan\)\}"/);
  // シリーズ見出しの件数と「もっと見る（残り N 件）」で、全件にたどれる
  assert.match(app, /もっと見る（残り \$\{p\.rest\.toLocaleString\('ja-JP'\)\}件）/);
  assert.match(app, /data-dict-smore="\$\{esc\(g\.maker\)\}" data-sgroup="\$\{esc\(name\)\}"/);
});

test('行の補足（色・容量）は、商品名にすでに入っているものを繰り返さない', () => {
  // 名前の末尾に色名が入っている → 補足は空
  assert.equal(dictionaryRowDetail({ name: 'アクリル 59ml ウルトラマリンブルー', colorName: 'ウルトラマリンブルー', size: '59ml' }), '');
  // 容量が名前に入っていない → 容量だけを添える
  assert.equal(dictionaryRowDetail({ name: 'パンパステル 520.5 ウルトラマリンブルー', colorName: 'ウルトラマリンブルー', size: '1本' }), '1本');
  // 色名だけ名前に入っていない → 色名を添える
  assert.equal(dictionaryRowDetail({ name: '平筆 12号', colorName: '丸', size: '' }), '丸');
  // ひらがな・半角のゆらぎがあっても、入っていれば繰り返さない
  assert.equal(dictionaryRowDetail({ name: 'ぱんぱすてる 520.5 ウルトラマリンブルー', colorName: 'ウルトラマリン ブルー' }), '');
  // 補足が無ければ空文字（空の span を出さない）
  assert.equal(dictionaryRowDetail({ name: 'x' }), '');
});
