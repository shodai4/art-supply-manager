/**
 * メーカーの中の「シリーズ」（v1.27.0で全面共通化）。
 *
 *   1) メーカー ＞ シリーズのまとめは groupItemsByMakerSeries の1つだけ
 *      （メーカーは五十音順・シリーズも五十音順・名前の無い商品は末尾の「その他」）
 *   2) 小さなシリーズも「その他」にまとめず、そのまま1つの見出しにする
 *   3) シリーズの中の並びは、呼び側が整えた順（五十音順・お気に入り先頭など）をそのまま保つ
 *   4) 行の名前は seriesItemLabel で、見出しに出ているメーカー名・シリーズ名を繰り返さない
 *   5) カタログの「もっと見る」のページ分け（planSeriesGroups）は今までどおり
 *   6) 4つの画面（在庫の場所ごと・メーカーごと・補充・カタログ）が同じまとめ関数を使う
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  groupItemsByMakerSeries, seriesItemLabel, planSeriesGroups, catalogItemLabel,
  compareSeriesName, compareSeriesColor, groupDictionarySearch, DICT_MAKER_PAGE, DICT_AUTO_OPEN_ROWS,
} from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const app = read('app.js');
const html = read('index.html');
const css = read('styles.css');

let seq = 0;
/** テスト用の商品を作る（series が空なら「シリーズ未設定」） */
const rows = (series, n, maker = 'コピック') => Array.from({ length: n }, () => {
  seq += 1;
  return { jan: `4900000${String(seq).padStart(6, '0')}`, name: `${series || '替え芯'} ${seq}`, maker, series };
});

/* ---------------- 1) まとめ ---------------- */

test('メーカーもシリーズも五十音順、名前の無いものは末尾', () => {
  const items = [
    ...rows('チャオ', 2, 'コピック'), ...rows('スケッチ', 2, 'コピック'), ...rows('', 1, 'コピック'),
    ...rows('油絵具', 1, 'ホルベイン'), ...rows('', 1, ''), ...rows('アクリル', 1, 'ぺんてる'),
  ];
  const groups = groupItemsByMakerSeries(items);
  assert.deepEqual(groups.map((g) => g.label), ['コピック', 'ぺんてる', 'ホルベイン', '未設定'], 'メーカーは五十音順・未設定は末尾');
  assert.deepEqual(groups[0].series.map((s) => s.name), ['スケッチ', 'チャオ', ''], 'シリーズは五十音順・名前なしは末尾');
  assert.equal(groups[0].total, 5, 'メーカーの件数は全件');
  assert.ok(compareSeriesName('スケッチ', 'チャオ') < 0);
  assert.ok(compareSeriesName('アクリル', 'カラー') < 0);
  assert.equal(compareSeriesName('スケッチ', 'スケッチ'), 0);
});

test('小さなシリーズも「その他」にまとめず、そのまま見出しにする（全画面で同じルール）', () => {
  const items = [...rows('スケッチ', 2), ...rows('チャオ', 1), ...rows('', 1)];
  const groups = groupItemsByMakerSeries(items);
  assert.deepEqual(groups[0].series.map((s) => s.name), ['スケッチ', 'チャオ', '']);
  assert.deepEqual(groups[0].series.map((s) => s.total), [2, 1, 1]);
  // まとめの関数は1つだけ（古い「件数が少ないシリーズはまとめる」関数は残っていない）
  assert.equal(/groupDictionaryBySeries|shouldGroupBySeries|MIN_SERIES_ITEMS/.test(app), false);
});

test('シリーズの中は、呼び側が整えた順をそのまま保つ', () => {
  const mk = (color, i, favorite = false) => ({
    jan: `4900000000${String(i).padStart(3, '0')}`, name: `コピックスケッチ ${color}`,
    series: 'コピックスケッチ', colorName: color, maker: 'コピック', favorite,
  });
  const ordered = [mk('あか', 1, true), mk('あお No.10', 2), mk('あお No.2', 3)];
  const groups = groupItemsByMakerSeries(ordered);
  assert.deepEqual(groups[0].series[0].items.map((x) => x.colorName), ['あか', 'あお No.10', 'あお No.2']);
  // 五十音順に整えて渡せば、その順で並ぶ（No.10 も自然に並ぶ）
  const sorted = [...ordered].sort(compareSeriesColor);
  assert.deepEqual(groupItemsByMakerSeries(sorted)[0].series[0].items.map((x) => x.colorName),
    ['あお No.2', 'あお No.10', 'あか']);
});

/* ---------------- 2) 行の名前 ---------------- */

test('シリーズ見出しの下の名前は、メーカー名・シリーズ名を繰り返さない', () => {
  // シリーズ名が商品名の先頭にある
  assert.equal(seriesItemLabel({ name: 'コピックスケッチ クールグレイ No.1', maker: 'コピック', series: 'コピックスケッチ', colorName: 'クールグレイ' }),
    'クールグレイ No.1');
  // メーカー名がシリーズ名の頭に重なる（「コピック」＋「コピックスケッチ」）
  assert.equal(seriesItemLabel({ name: 'パンパステル ウルトラマリン ブルー 15ml', maker: 'パンパステル', series: '油絵具', colorName: 'ウルトラマリン ブルー' }),
    'ウルトラマリン ブルー 15ml');
  // メーカー名 → シリーズ名の順に頭へ並ぶ
  assert.equal(seriesItemLabel({ name: 'ホルベイン 油絵具 コバルト ブルー ヒュー', maker: 'ホルベイン', series: '油絵具', colorName: 'コバルトブルーヒュー' }),
    'コバルト ブルー ヒュー');
  // 色名が名前に無ければ、色名を頭に足す（色名だけで登録した画材でも何の色か分かる）
  assert.equal(seriesItemLabel({ name: '15ml', maker: 'ホルベイン', series: '油絵具', colorName: 'コバルトブルー' }), 'コバルトブルー 15ml');
  // シリーズが無い商品は、メーカー名だけを落とす
  assert.equal(seriesItemLabel({ name: 'サンスター 鉄腕ハサミ 170mm', maker: 'サンスター', series: '' }), '鉄腕ハサミ 170mm');
  // 何も残らなければ商品名（空欄にしない）
  assert.equal(seriesItemLabel({ name: 'コピック', maker: 'コピック', series: '' }), 'コピック');
  assert.equal(seriesItemLabel({}), '');
  // カタログの行も同じ関数（シリーズ名を淡く出す古い表記は無い）
  assert.match(app, /const nameOf = \(d, seriesName = ''\) => seriesItemLabel\(d, seriesName\) \|\| catalogItemLabel\(d\);/);
  assert.equal(/dres-series/.test(app), false);
  assert.equal(catalogItemLabel({ name: 'x', series: 'コピックスケッチ', colorName: 'コピックスケッチ' }), 'コピックスケッチ');
});

/* ---------------- 3) ページ分け（カタログ） ---------------- */

test('カタログ: 絞り込みで当たったシリーズを自動で開き、件数が多いものは「もっと見る」に回す', () => {
  const series = [{ name: 'スケッチ', total: 120, items: rows('スケッチ', 120) }];
  const plan = planSeriesGroups(series, { autoOpen: true });
  assert.equal(plan[0].open, true);
  assert.equal(plan[0].shown.length, DICT_MAKER_PAGE, '最初に描くのは1ページ分');
  assert.equal(plan[0].rest, 120 - DICT_MAKER_PAGE);
  const more = planSeriesGroups(series, { autoOpen: true, more: new Map([['スケッチ', DICT_MAKER_PAGE]]) });
  assert.equal(more[0].shown.length, DICT_MAKER_PAGE * 2);
  // 自動展開の予算を超えるときは、描く件数で打ち切る（重い端末でも固まらない）
  const budgeted = planSeriesGroups(series, { autoOpen: true, budget: 20 });
  assert.equal(budgeted[0].shown.length, 20);
  assert.ok(DICT_AUTO_OPEN_ROWS >= 100);
  // 何も絞っていないときは閉じたまま（見出しだけ）
  assert.equal(planSeriesGroups(series)[0].open, false);
  // 手で閉じたものは自動展開より優先する
  assert.equal(planSeriesGroups(series, { autoOpen: true, closed: new Set(['スケッチ']) })[0].open, false);
});

/* ---------------- 4) 画面（4つとも同じ形） ---------------- */

test('在庫（場所ごと）・在庫（メーカーごと）・補充・カタログが同じまとめ関数と描画を使う', () => {
  // まとめは groupItemsByMakerSeries だけ
  assert.match(app, /function renderItemTree\(el, items, opts = \{\}\) \{[\s\S]{0,300}groupItemsByMakerSeries\(items, \{ makerOf: itemMaker \}\)/);
  assert.match(app, /function renderMakerView\(\) \{[\s\S]{0,600}groupItemsByMakerSeries\(items, \{ makerOf: itemMaker \}\)/);
  assert.match(app, /function renderShopping\(\) \{[\s\S]{0,400}renderItemTree\(\$\('shoppingList'\)/);
  assert.match(app, /const groupsOfMaker = groupItemsByMakerSeries\(itemsOfMaker\.get\(maker\) \|\| \[\], \{/);
  // 描画は itemTreeHtml / itemTreeBlockHtml（見出し・アコーディオン・件数バッジの共通部品）
  assert.match(app, /function itemTreeHtml\(groups, opts = \{\}\) \{/);
  assert.match(app, /function itemTreeBlockHtml\(groups, opts = \{\}\) \{/);
  assert.match(app, /function makerHeadHtml\(\{ surface, maker, label, total, open \}\) \{/);
  assert.match(app, /function seriesHeadHtml\(\{ surface, maker, name, total, open \}\) \{/);
  assert.match(app, /const countBadge = \(n\) => Number\(n \|\| 0\)\.toLocaleString\('ja-JP'\);/);
  // 開閉の記憶も面ごとに1か所（在庫・補充は開いた状態から、カタログは閉じた状態から）
  assert.match(app, /function isGroupOpen\(surface, level, maker, name = ''\) \{/);
  assert.match(app, /function toggleGroupOpen\(surface, level, maker, name = ''\) \{/);
  // 開け閉めの仕組みは core.js の1つ（在庫・補充は開いた状態、カタログは閉じた状態から）
  assert.match(app, /const dictGroupState = groupStateOf\('catalog', \{ defaultOpen: false \}\);/);
  assert.match(app, /groupStates\.set\(key, createGroupOpenState\(\{ defaultOpen \}\)\);/);
});

test('見出しは在庫・補充・カタログ・辞書のどれも同じ形（mg / sgroup・▶・右端の丸い件数）', () => {
  // 1段目（メーカー）: mg > mghead（▶・名前・件数）
  assert.match(app, /return `<section class="mg\$\{mOpen \? ' open' : ''\}">/);
  assert.match(app, /class="mghead" data-g-surface="\$\{esc\(surface\)\}" data-g-maker="\$\{esc\(maker\)\}" aria-expanded="\$\{open \? 'true' : 'false'\}"/);
  assert.match(app, /<span class="mgname">\$\{esc\(label\)\}<\/span><b>\$\{countBadge\(total\)\}<\/b>/);
  // 2段目（シリーズ）: sgroup > sgrouphead
  assert.match(app, /<div class="sgroup\$\{sOpen \? ' open' : ''\}">/);
  assert.match(app, /class="sgrouphead" data-g-surface="\$\{esc\(surface\)\}" data-g-maker="\$\{esc\(maker\)\}" data-g-series="\$\{esc\(name\)\}" aria-expanded="\$\{open \? 'true' : 'false'\}"/);
  assert.match(app, /<span>\$\{esc\(name \|\| 'その他'\)\}<\/span><b>\$\{countBadge\(total\)\}<\/b>/);
  // 件数バッジは右端の丸（CSSは1か所だけ）
  assert.match(css, /\.mghead b \{\n  flex: 0 0 auto; font-size: 11px; font-weight: 700; color: var\(--muted-ink\);\n  background: var\(--surface-3\); border-radius: 999px;/);
  assert.match(css, /\.sgrouphead b \{\n  flex: 0 0 auto;\n  font-size: 10px; font-weight: 700; color: var\(--muted-ink\);\n  background: var\(--surface-3\); border-radius: 999px;/);
  // 開いたら ▶ が下向きになる（同じ印）
  assert.match(css, /\.mg\.open \.mghead \.chev \{ transform: rotate\(90deg\); \}/);
  assert.match(css, /\.sgroup\.open > \.sgrouphead \.chev \{ transform: rotate\(90deg\); \}/);
  // 絵文字は使わない
  assert.equal(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(app.slice(app.indexOf('function itemTreeHtml'), app.indexOf('function renderItemTree'))), false);
});

test('辞書の一覧（シート）も同じまとめ・同じ行の名前を使う', () => {
  assert.match(app, /const groups = groupItemsByMakerSeries\(hit, \{ makerOf: \(d\) => String\(d\?\.maker \|\| 'メーカー不明'\) \}\);/);
  assert.match(app, /\$\('dictList'\)\.innerHTML = itemTreeBlockHtml\(groups, \{ surface: 'dict', autoOpen: Boolean\(String\(query \|\| ''\)\.trim\(\)\), body: rows \}\)/);
  assert.match(app, /esc\(seriesItemLabel\(d, seriesName\) \|\| d\.name \|\| d\.colorName\)/);
  assert.ok(html.includes('id="dictList"'));
  assert.ok(html.includes('id="dictResults"'));
  assert.ok(groupDictionarySearch(rows('スケッチ', 3), '', {}).groups.length >= 1);
});
