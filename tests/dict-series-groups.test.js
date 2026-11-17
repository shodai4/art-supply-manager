/**
 * メーカーの中の「シリーズ」開閉（v1.26.0）。
 *
 *   1) メーカーの中をシリーズごとにまとめる（名前のあるものは五十音順・少ないシリーズは末尾の「その他」へ）
 *   2) 分けるかどうかは共通ルール（名前のあるシリーズが2つ以上・16件以上）
 *   3) カタログタブ: メーカーを開くとシリーズ見出しが並び、タップで中身が開く
 *   4) 検索語で絞ったときは、当たったシリーズを自動で開く
 *   5) 在庫タブの「メーカーごと」も同じルールでシリーズ開閉できる
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  groupDictionaryBySeries, planSeriesGroups, shouldGroupBySeries, MIN_SERIES_ITEMS, catalogItemLabel,
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

test('シリーズは五十音順（ja ロケール）に並ぶ', () => {
  const groups = groupDictionaryBySeries([
    ...rows('チャオ', 6), ...rows('スケッチ', 6), ...rows('アクリル', 6), ...rows('ひまわり', 6), ...rows('カラー', 6),
  ]);
  assert.deepEqual(groups.map((g) => g.name), ['アクリル', 'カラー', 'スケッチ', 'チャオ', 'ひまわり']);
  assert.ok(compareSeriesName('アクリル', 'カラー') < 0);
  assert.ok(compareSeriesName('スケッチ', 'チャオ') < 0);
  assert.equal(compareSeriesName('スケッチ', 'スケッチ'), 0);
  // 在庫の「メーカーごと」も同じ関数で並べる
  assert.match(app, /const seriesGroups = groupDictionaryBySeries\(list\);/);
});

test('カタログの行の名前は「シリーズ ＋ 色名」、無ければ商品名に戻す', () => {
  assert.equal(catalogItemLabel({ name: 'コピックスケッチ クールグレイ No.1', series: 'コピックスケッチ', colorName: 'クールグレイ' }),
    'コピックスケッチ クールグレイ');
  assert.equal(catalogItemLabel({ name: '平筆 12号', series: '', colorName: '' }), '平筆 12号', 'どちらも無ければ商品名');
  assert.equal(catalogItemLabel({ name: 'コピックスケッチ 赤', series: 'スケッチ', colorName: '' }), 'スケッチ', 'シリーズだけ');
  assert.equal(catalogItemLabel({ name: 'ウルトラマリン', series: '', colorName: 'ウルトラマリン' }), 'ウルトラマリン', '色名だけ');
  assert.equal(catalogItemLabel({ name: '', series: '', colorName: '' }), '', '空欄も作らない（呼び側で名前を出す）');
  // 色名がシリーズ名に含まれるときは繰り返さない
  assert.equal(catalogItemLabel({ name: 'x', series: 'コピックスケッチ', colorName: 'コピックスケッチ' }), 'コピックスケッチ');
  // 画面もこの関数を使い、号数などは補足の行へ
  assert.match(app, /const nameOf = \(d\) => catalogItemLabel\(d\);/);
});

/* ---------------- 1) 集計 ---------------- */

test('シリーズごとにまとめる（五十音順・少ないシリーズは末尾の「その他」へ）', () => {
  const groups = groupDictionaryBySeries([
    ...rows('スケッチ', 6), ...rows('チャオ', 6), ...rows('クリヤー', 2), ...rows('', 1),
  ]);
  assert.deepEqual(groups.map((g) => g.name), ['スケッチ', 'チャオ', ''], '五十音順のあと、まとめが末尾');
  assert.deepEqual(groups.map((g) => g.total), [6, 6, 3]);
  // 少ないシリーズ（クリヤー2件）と名前の無い商品は「その他」に集まる
  assert.ok(groups[2].items.some((d) => d.series === 'クリヤー'));
  assert.ok(groups[2].items.some((d) => d.series === ''));
});

test('シリーズが無い商品だけなら、まとまりは1つ（＝分けない）', () => {
  const groups = groupDictionaryBySeries(rows('', 8));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, '');
  assert.equal(shouldGroupBySeries(groups), false);
});

/* ---------------- 2) 分けるかどうかの共通ルール ---------------- */

test('シリーズが2つ以上あり、中身が十分にあるときだけシリーズ単位に分ける', () => {
  assert.ok(MIN_SERIES_ITEMS >= 2);
  // 2シリーズ×4件＝8件（少ない）→ まとめに寄って分けない
  assert.equal(shouldGroupBySeries(groupDictionaryBySeries([...rows('スケッチ', 4), ...rows('チャオ', 4)])), false);
  // シリーズが1つだけなら、件数が多くても分けない
  assert.equal(shouldGroupBySeries(groupDictionaryBySeries(rows('レンブラント', 40))), false);
  // 2シリーズ×8件＝16件 → 分ける
  assert.equal(shouldGroupBySeries(groupDictionaryBySeries([...rows('スケッチ', 8), ...rows('チャオ', 8)])), true);
});

/* ---------------- 3) 開閉の計画 ---------------- */

test('何も絞っていないときは閉じたまま（見出しだけ）、タップしたシリーズだけ開く', () => {
  const groups = groupDictionaryBySeries([...rows('スケッチ', 6), ...rows('チャオ', 6), ...rows('', 2)]);
  const closed = planSeriesGroups(groups);
  assert.deepEqual(closed.map((s) => s.name), ['スケッチ', 'チャオ', '']);
  assert.deepEqual(closed.map((s) => s.open), [false, false, true], '「その他」だけは既定で開く');
  const tapped = planSeriesGroups(groups, { open: new Set(['スケッチ']) });
  assert.equal(tapped[0].open, true);
  assert.equal(tapped[0].shown.length, 6);
  // 手で閉じたものは自動展開より優先する
  const reopened = planSeriesGroups(groups, { autoOpen: true, closed: new Set(['スケッチ']) });
  assert.equal(reopened[0].open, false);
});

test('検索語で絞ったときは当たったシリーズを自動で開き、件数が多いものは「もっと見る」に回す', () => {
  const groups = groupDictionaryBySeries(rows('スケッチ', 120));
  const plan = planSeriesGroups(groups, { autoOpen: true });
  assert.equal(plan[0].open, true);
  assert.equal(plan[0].shown.length, DICT_MAKER_PAGE, '最初に描くのは1ページ分');
  assert.equal(plan[0].rest, 120 - DICT_MAKER_PAGE);
  const more = planSeriesGroups(groups, { autoOpen: true, more: new Map([['スケッチ', DICT_MAKER_PAGE]]) });
  assert.equal(more[0].shown.length, DICT_MAKER_PAGE * 2);
  // 自動展開の予算を超えるときは、描く件数で打ち切る（重い端末でも固まらない）
  const budgeted = planSeriesGroups(groups, { autoOpen: true, budget: 20 });
  assert.equal(budgeted[0].shown.length, 20);
  assert.ok(DICT_AUTO_OPEN_ROWS >= 100);
  // まとめ（名前なし）もページ単位で描き、残りは「もっと見る」に回す
  const rest = planSeriesGroups(groupDictionaryBySeries(rows('', 120)));
  assert.equal(rest[0].shown.length, DICT_MAKER_PAGE);
});

/* ---------------- 4) カタログタブの画面 ---------------- */

test('カタログ: 開いたメーカーの中はシリーズ見出しで開閉でき、シリーズ未設定・少数はそのまま並ぶ', () => {
  // メーカーの中身をシリーズに分け、共通ルールで切り替える
  assert.match(app, /const seriesGroups = groupDictionaryBySeries\(itemsOfMaker\.get\(g\.maker\) \|\| \[\]\);/);
  assert.match(app, /if \(shouldGroupBySeries\(seriesGroups\)\) \{/);
  assert.match(app, /const planned = planSeriesGroups\(seriesGroups, \{[\s\S]{0,300}autoOpen: Boolean\(dictTabQuery\)/);
  // シリーズ見出しはボタン（▶ の印・開閉状態・件数つき）
  assert.match(app, /class="sgrouphead" data-dict-sgroup="\$\{esc\(g\.maker\)\}" data-sgroup="\$\{esc\(s\.name\)\}" aria-expanded="\$\{s\.open \? 'true' : 'false'\}"/);
  assert.match(app, /<span>\$\{esc\(s\.name \|\| 'その他'\)\}<\/span><b>\$\{s\.total\.toLocaleString\('ja-JP'\)\}<\/b>/);
  // シリーズの「もっと見る」
  assert.match(app, /data-dict-smore="\$\{esc\(g\.maker\)\}" data-sgroup="\$\{esc\(s\.name\)\}"/);
  // タップで開閉・続きを描く
  assert.match(app, /const sgroup = e\.target\.closest\('\[data-dict-sgroup\]'\);/);
  assert.match(app, /toggleOpenKey\(dictOpenSeries, dictClosedSeries, key, sgroup\.getAttribute\('aria-expanded'\) === 'true'\)/);
  assert.match(app, /const smore = e\.target\.closest\('\[data-dict-smore\]'\);/);
  // 条件が変わったら開閉の記憶は捨てる
  assert.match(app, /dictOpenSeries\.clear\(\);[\s\S]{0,120}dictClosedSeries\.clear\(\);/);
});

/* ---------------- 5) 在庫タブ「メーカーごと」 ---------------- */

test('在庫の「メーカーごと」も、同じルールでシリーズ単位に開閉できる', () => {
  assert.match(app, /const makerOpenSeries = new Set\(\);/);
  assert.match(app, /const makerClosedSeries = new Set\(\);/);
  assert.match(app, /const seriesGroups = groupDictionaryBySeries\(list\);/);
  assert.match(app, /if \(!shouldGroupBySeries\(seriesGroups\)\) return bodyOf\(list\);/);
  assert.match(app, /planSeriesGroups\(seriesGroups, \{[\s\S]{0,300}open: scopedSet\(makerOpenSeries, key\)/);
  assert.match(app, /class="sgrouphead" data-maker-sgroup="\$\{esc\(key\)\}" data-sgroup="\$\{esc\(s\.name\)\}"/);
  assert.match(app, /const seriesHead = e\.target\.closest\('\[data-maker-sgroup\]'\);/);
  assert.match(app, /toggleOpenKey\(makerOpenSeries, makerClosedSeries, key, seriesHead\.getAttribute\('aria-expanded'\) === 'true'\)/);
});

/* ---------------- 6) 並び順の統一 ---------------- */

test('シリーズの商品も五十音順（No.0〜No.10 も自然に並ぶ）', () => {
  const mk = (color, i) => ({ jan: `4900000000${String(i).padStart(3, '0')}`, name: `コピックスケッチ ${color}`, series: 'コピックスケッチ', colorName: color });
  const list = ['あお No.10', 'あお No.2', 'あか', 'きいろ', 'みどり', 'あお'].map(mk);
  assert.deepEqual([...list].sort(compareSeriesColor).map((x) => x.colorName),
    ['あお', 'あお No.2', 'あお No.10', 'あか', 'きいろ', 'みどり']);
  // まとめた側（groupDictionaryBySeries）でも、中身がその順で並ぶ
  const groups = groupDictionaryBySeries(list.map((x, i) => ({ ...x, jan: `4900000001${String(i).padStart(2, '0')}` })));
  assert.equal(groups[0].name, 'コピックスケッチ');
  assert.deepEqual(groups[0].items.map((x) => x.colorName), ['あお', 'あお No.2', 'あお No.10', 'あか', 'きいろ', 'みどり']);
  // シリーズをまたぐ時はシリーズ名で先に並ぶ（シリーズ→色名）
  assert.deepEqual(
    [{ series: 'チャオ', colorName: '青' }, { series: 'スケッチ', colorName: '赤' }].sort(compareSeriesColor).map((x) => x.series),
    ['スケッチ', 'チャオ'],
  );
});

test('補充タブも「シリーズ ＋ 色名」で五十音順に揃える', () => {
  assert.match(app, /const list = \[\.\.\.computeShoppingList\(state\.items\)\]\.sort\(compareSeriesColor\);/);
  assert.match(app, /seriesLabel: true,/);
  assert.match(app, /function rowName\(it, opts = \{\}\) \{\n  return opts\.seriesLabel \? \(catalogItemLabel\(it\) \|\| displayName\(it\)\) : displayName\(it\);/);
  assert.match(app, /<h3 class="it-name" title="タップで編集">\$\{esc\(rowName\(it, opts\)\)\}<\/h3>/);
});

/* ---------------- 7) 見た目 ---------------- */

test('シリーズ見出しの見た目は、メーカー見出しより一段軽く（どちらの画面でも同じ）', () => {
  assert.match(css, /\.sgroup\s*\{[^}]*border-top:\s*1px solid var\(--line\)/);
  assert.match(css, /\.sgroup:first-child\s*\{[^}]*border-top:\s*0/);
  assert.match(css, /\.sgrouphead\s*\{[^}]*font-size:\s*12px[^}]*font-weight:\s*700/);
  assert.match(css, /\.sgroup\.open > \.sgrouphead \.chev\s*\{[^}]*transform:\s*rotate\(90deg\)/);
  // 絵文字は使わない
  assert.equal(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(app.slice(app.indexOf('function renderSearchTab'), app.indexOf('function renderSearchTab') + 4000)), false);
  // 出発点の「検索結果」の中に置く（メーカー見出しの中）
  assert.match(html, /<div id="dictResults"><\/div>/);
  assert.ok(groupDictionarySearch(rows('スケッチ', 3), '', {}).groups.length >= 1);
  assert.ok(DICT_MAKER_PAGE > 0);
});
