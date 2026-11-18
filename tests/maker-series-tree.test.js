/**
 * 画材の一覧を「メーカー ＞ シリーズ」に統一したぶんの約束ごと（v1.27.0）。
 *
 *   1) まとめは core.js の groupItemsByMakerSeries だけ（メーカー・シリーズとも五十音順・件数つき）
 *   2) 行の名前は core.js の seriesItemLabel だけ（見出しの名前を繰り返さない）
 *   3) 開け閉めは core.js の createGroupOpenState だけ（面ごとに1つ・既定の開閉だけ面で変える）
 *   4) 見出しのDOMは app.js の makerHeadHtml / seriesHeadHtml だけ（4画面で同じ形・同じCSS）
 *   5) 一覧の描画は itemTreeHtml を通す（古いフラット一覧・メーカーのみの区分けは残っていない）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  groupItemsByMakerSeries, seriesItemLabel, createGroupOpenState, itemMaker,
} from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const app = read('app.js');
const css = read('styles.css');
const core = read('core.js');

/* ---------------- 1) まとめ ---------------- */

test('メーカー ＞ シリーズのまとめ: 五十音順・件数・未設定と「その他」は末尾', () => {
  const items = [
    { id: '1', maker: 'ホルベイン', series: '油絵具', name: '油絵具 ウルトラマリン' },
    { id: '2', maker: 'ホルベイン', series: '油絵具', name: '油絵具 カーマイン' },
    { id: '3', maker: 'ホルベイン', series: '水彩絵具', name: '水彩絵具 マゼンタ' },
    { id: '4', maker: 'ホルベイン', series: '', name: 'ボールドキャンバス F6' },
    { id: '5', maker: 'あかしや', series: 'ナイロン筆', name: 'ナイロン筆 12号' },
    { id: '6', maker: '', series: '', name: '名前だけの画材' },
  ];
  const groups = groupItemsByMakerSeries(items);
  assert.deepEqual(groups.map((g) => g.label), ['あかしや', 'ホルベイン', '未設定']);
  assert.deepEqual(groups.map((g) => g.total), [1, 4, 1], '件数はまとまりの全件');
  assert.deepEqual(groups[1].series.map((s) => s.name), ['水彩絵具', '油絵具', ''], 'シリーズは五十音順・名前なしは末尾');
  assert.deepEqual(groups[1].series.map((s) => s.total), [1, 2, 1]);
  // シリーズの中は渡した順のまま（呼び側で五十音順やお気に入り先頭に整える）
  assert.deepEqual(groups[1].series[1].items.map((x) => x.id), ['1', '2']);
  // 空の一覧でも落ちない
  assert.deepEqual(groupItemsByMakerSeries([]), []);
  assert.deepEqual(groupItemsByMakerSeries(null), []);
});

test('メーカー名は maker が無ければ brand から取る（itemMaker と同じ）', () => {
  const items = [{ id: '1', maker: '', brand: 'HOLBEIN', series: '油絵具', name: 'x' }];
  assert.equal(itemMaker(items[0]), 'HOLBEIN');
  assert.equal(groupItemsByMakerSeries(items)[0].label, 'HOLBEIN');
});

test('まとめの関数は1つだけ（古い「件数が少ないシリーズはその他へ」は残っていない）', () => {
  assert.match(core, /export function groupItemsByMakerSeries\(items = \[\], \{ makerOf = itemMaker \} = \{\}\) \{/);
  for (const name of ['groupDictionaryBySeries', 'shouldGroupBySeries', 'MIN_SERIES_ITEMS']) {
    assert.equal(new RegExp(name).test(core), false, `${name} が残っている`);
    assert.equal(new RegExp(name).test(app), false, `${name} が app.js に残っている`);
  }
});

/* ---------------- 2) 行の名前 ---------------- */

test('行の名前: 見出しのメーカー名・シリーズ名を繰り返さない', () => {
  const cases = [
    [{ name: 'コピックスケッチ クールグレイ No.1', maker: 'コピック', series: 'コピックスケッチ', colorName: 'クールグレイ' }, 'クールグレイ No.1'],
    [{ name: 'ホルベイン 油絵具 コバルト ブルー ヒュー', maker: 'ホルベイン', series: '油絵具', colorName: 'コバルトブルーヒュー' }, 'コバルト ブルー ヒュー'],
    [{ name: 'パンパステル ウルトラマリン ブルー 15ml', maker: 'パンパステル', series: '油絵具', colorName: 'ウルトラマリン ブルー' }, 'ウルトラマリン ブルー 15ml'],
    [{ name: '油絵具 カドミウムレッド 6号(20ml)', maker: 'ホルベイン', series: '油絵具', colorName: '' }, 'カドミウムレッド 6号(20ml)'],
    [{ name: 'ボールドキャンバス F6', maker: 'ホルベイン', series: 'ボールドキャンバス' }, 'F6'],
  ];
  for (const [entry, want] of cases) assert.equal(seriesItemLabel(entry), want, entry.name);
});

test('行の名前: シリーズ名と共通の頭（語の区切りまで）も落とす', () => {
  // シリーズ名が途中までしか一致しない（「ベーシックス」まで共通）
  assert.equal(seriesItemLabel({ name: 'リキテックス ベーシックス ウルトラマリンブルー 118ml', maker: 'リキテックス', series: 'ベーシックス 380(043)', colorName: 'ウルトラマリンブルー' }),
    'ウルトラマリンブルー 118ml');
  assert.equal(seriesItemLabel({ name: '名村大成堂 水彩筆 ラフィーネ LR 10号', maker: '名村大成堂', series: '水彩筆 Raffine ラフィーネ ロングラウンド' }),
    'ラフィーネ LR 10号');
  // 共通の頭が語の区切りで終わらないときは落とさない（別の商品名を削らない）
  assert.equal(seriesItemLabel({ name: 'ホルベイン 油絵具セット', maker: 'ホルベイン', series: '油絵具 12色' }), '油絵具セット');
  // 何も残らないときは商品名のまま（空欄にしない）
  assert.equal(seriesItemLabel({ name: 'ベーシックス', series: 'ベーシックス' }), 'ベーシックス');
});

test('行の名前: 色名が名前に無ければ足し、何も残らなければ商品名に戻す', () => {
  assert.equal(seriesItemLabel({ name: '15ml', maker: 'ホルベイン', series: '油絵具', colorName: 'コバルトブルー' }), 'コバルトブルー 15ml');
  assert.equal(seriesItemLabel({ name: 'コピック', maker: 'コピック', series: '' }), 'コピック');
  assert.equal(seriesItemLabel({ name: '替え芯', series: '' }), '替え芯');
  assert.equal(seriesItemLabel({}), '');
});

test('一覧の行・タイル・まとめカードは、どれも同じ名前の関数を使う', () => {
  assert.match(app, /function rowName\(it, opts = \{\}\) \{\n  return seriesItemLabel\(it, opts\.seriesName \?\? ''\) \|\| displayName\(it\);\n\}/);
  // タイル（グリッド）
  assert.match(app, /<span class="tname">\$\{esc\(rowName\(it, opts\)\)\}<\/span>/);
  assert.match(app, /const label = `\$\{rowName\(it, opts\)\} \$\{qty\}点/);
  // リストの行
  assert.match(app, /<h3 class="it-name" title="タップで編集">\$\{esc\(rowName\(it, opts\)\)\}<\/h3>/);
  // 同じJANを複数の場所に持つときの親カード
  assert.match(app, /const name = rowName\(\{ \.\.\.it, name: g\.name \|\| it\.name \}, opts\);/);
  // 見出しの外で名前を出すとき（displayName）は、シートの見出しなどだけ
  assert.equal(/<span class="tname">\$\{esc\(displayName/.test(app), false);
});

/* ---------------- 3) 開け閉め ---------------- */

test('開け閉めの状態: 既定の開閉・タップでの反転・面ごとの記憶を1つの型で持つ', () => {
  const stock = createGroupOpenState(); // 在庫・補充は開いた状態から
  assert.equal(stock.isOpen('maker', 'ホルベイン'), true);
  assert.equal(stock.toggle('maker', 'ホルベイン'), false, '開いていたら閉じる');
  assert.equal(stock.isOpen('maker', 'ホルベイン'), false);
  assert.equal(stock.toggle('maker', 'ホルベイン'), true, '閉じていたら開く');
  assert.equal(stock.openMakers.has('ホルベイン'), true);

  const catalog = createGroupOpenState({ defaultOpen: false });
  assert.equal(catalog.isOpen('maker', 'ホルベイン'), false, 'カタログは閉じた状態から');
  catalog.toggle('maker', 'ホルベイン');
  assert.equal(catalog.isOpen('maker', 'ホルベイン'), true);

  // シリーズは「メーカー＋シリーズ」で別々に覚える
  const st = createGroupOpenState();
  st.toggle('series', 'コピック', 'スケッチ');
  assert.equal(st.isOpen('series', 'コピック', 'スケッチ'), false);
  assert.equal(st.isOpen('series', 'コピック', 'チャオ'), true);
  assert.equal(st.isOpen('series', 'ホルベイン', 'スケッチ'), true);

  // 条件が変わったら捨てる
  st.reset();
  assert.equal(st.isOpen('series', 'コピック', 'スケッチ'), true);
  assert.equal(st.openSeries.size + st.closedSeries.size, 0);
});

test('アプリ側も面ごとに1つだけ持つ（在庫・補充は開く／カタログは閉じる）', () => {
  assert.match(app, /const groupStates = new Map\(\);/);
  assert.match(app, /groupStates\.set\(key, createGroupOpenState\(\{ defaultOpen \}\)\);/);
  assert.match(app, /const dictGroupState = groupStateOf\('catalog', \{ defaultOpen: false \}\);/);
  assert.match(app, /function isGroupOpen\(surface, level, maker, name = ''\) \{\n  return groupStateOf\(surface\)\.isOpen\(level, maker, name\);/);
  assert.match(app, /function toggleGroupOpen\(surface, level, maker, name = ''\) \{\n  return groupStateOf\(surface\)\.toggle\(level, maker, name\);/);
});

/* ---------------- 4) 見出しのDOM ---------------- */

test('メーカー・シリーズの見出しは、4画面で同じ関数から作る', () => {
  assert.match(app, /function makerHeadHtml\(\{ surface, maker, label, total, open \}\) \{/);
  assert.match(app, /function seriesHeadHtml\(\{ surface, maker, name, total, open \}\) \{/);
  assert.match(app, /function itemTreeHtml\(groups, opts = \{\}\) \{/);
  assert.match(app, /function itemTreeBlockHtml\(groups, opts = \{\}\) \{/);
  // 見出しはどれも「data-g-surface で面を持つ button」
  const heads = app.slice(app.indexOf('function makerHeadHtml'), app.indexOf('function itemTreeHtml'));
  assert.equal((heads.match(/<button type="button"/g) || []).length, 2, '見出しは2つ（メーカー・シリーズ）だけ');
  assert.equal((heads.match(/data-g-surface="/g) || []).length, 2);
  assert.equal((heads.match(/aria-expanded="/g) || []).length, 2);
  assert.equal((heads.match(/<b>\$\{countBadge\(total\)\}<\/b>/g) || []).length, 2, '件数は右端の丸いバッジ');
  // 絵文字は使わない（印はSVGのシェブロン）
  assert.equal(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(heads), false);
  assert.equal((heads.match(/#i-chevron/g) || []).length, 2);
});

test('見出しの見た目は1組のCSS（mg/mghead・sgroup/sgrouphead）で、古い見出しのCSSは残っていない', () => {
  assert.match(css, /\.mg \{ border-top: 1px solid var\(--line\); \}/);
  assert.match(css, /\.mghead \{[\s\S]{0,200}font-size: 14px; font-weight: 700;/);
  assert.match(css, /\.mghead b \{[\s\S]{0,160}border-radius: 999px;/);
  assert.match(css, /\.sgrouphead b \{[\s\S]{0,160}border-radius: 999px;/);
  assert.equal(/\.dgrouphead/.test(css), false, '古い検索結果の見出しスタイルが残っている');
  assert.equal(/\.mhead/.test(css), false, '古いメーカー見出し（mhead）が残っている');
});

/* ---------------- 5) 一覧の描画 ---------------- */

test('4つの一覧はどれも itemTreeHtml / renderItemTree を通る（フラット一覧は残っていない）', () => {
  // 在庫（場所ごと）・補充
  assert.match(app, /function renderItemTree\(el, items, opts = \{\}\) \{[\s\S]{0,400}itemTreeBlockHtml\(groups, \{/);
  assert.match(app, /renderItemTree\(\$\('itemList'\), list, \{\n    surface: 'place',/);
  assert.match(app, /renderItemTree\(\$\('shoppingList'\), list, \{\n    surface: 'shopping',/);
  // 在庫（メーカーごと）
  assert.match(app, /itemTreeHtml\(groups, \{\n    surface: 'maker',/);
  // カタログ
  assert.match(app, /itemTreeBlockHtml\(treeGroups, \{\n    surface: 'catalog',/);
  // 辞書の一覧（シート）
  assert.match(app, /itemTreeBlockHtml\(groups, \{ surface: 'dict', body: rows \}\)/);
  // 古いフラット一覧の描画は残っていない
  for (const name of ['viewBlocks', 'renderTilesInto', 'data-maker-group', 'data-dict-group', "group: 'maker'"]) {
    assert.equal(app.includes(name), false, `${name} が残っている`);
  }
});

test('検索結果（在庫タブの検索・カタログ・辞書）も同じ区分けになる', () => {
  // 在庫タブの検索は同じ一覧（itemList）に描くので、区分けもそのまま
  assert.match(app, /\$\('itemSecTitle'\)\.textContent = ui\.query \? '検索結果'/);
  assert.match(app, /renderItemTree\(\$\('itemList'\), list, \{/);
  // カタログの絞り込みも、同じ groupItemsByMakerSeries でメーカー ＞ シリーズに分ける
  assert.match(app, /const groupsOfMaker = groupItemsByMakerSeries\(itemsOfMaker\.get\(maker\) \|\| \[\], \{/);
  // 辞書の一覧も同じ
  assert.match(app, /const groups = groupItemsByMakerSeries\(hit, \{/);
});
