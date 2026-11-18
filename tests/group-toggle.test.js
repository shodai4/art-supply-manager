/**
 * 見出しの「すべて開く／すべて閉じる」の点検。
 *
 * 見たいこと:
 *   1. 一覧の見出し（メーカー・シリーズ）をまとめて開け閉めできる（全開・全閉の切り替え）
 *   2. 1つでも閉じていれば「すべて開く」、全開なら「すべて閉じる」と出る
 *   3. 件数ではボタンを出し分けない（未絞り込みの38,140件でも押せる。重さは遅延描画で抑える）
 *   4. 在庫（場所ごと・メーカーごと）・補充・カタログの見出し行にボタンが置かれ、押すと描き直す
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createGroupOpenState, groupToggleSummary, groupItemsByMakerSeries,
} from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

/** 見出しの材料（groupItemsByMakerSeries の戻り値と同じ形） */
const GROUPS = [
  { maker: 'ホルベイン', total: 3, series: [{ name: 'アーティスト色鉛筆', total: 3 }] },
  { maker: 'クサカベ', total: 2, series: [{ name: '油絵具', total: 1 }, { name: '水彩', total: 1 }] },
];

test('まとめて開くと、メーカーもシリーズも全部開く', () => {
  const state = createGroupOpenState();
  const before = groupToggleSummary(GROUPS, state);
  assert.equal(before.allOpen, false, '最初から全開になっている');
  assert.equal(before.allowed, true);

  state.openAll(before.entries);
  const after = groupToggleSummary(GROUPS, state);
  assert.equal(after.allOpen, true);
  assert.equal(state.isOpen('maker', 'ホルベイン'), true);
  assert.equal(state.isOpen('series', 'クサカベ', '油絵具'), true);
  assert.equal(state.isOpen('series', 'クサカベ', '水彩'), true);
  // 開いた記憶は「開いた側」に入り、閉じた記憶からは消える（手で押したときと同じ持ち方）
  assert.equal(state.closedMakers.has('クサカベ'), false);
});

test('1つでも閉じていれば「すべて開く」、全開なら「すべて閉じる」', () => {
  const state = createGroupOpenState();
  state.openAll(GROUPS.map((g) => ({ maker: g.maker, series: g.series.map((s) => s.name) })));
  assert.equal(groupToggleSummary(GROUPS, state).allOpen, true, '全開の判定ができていない');

  // シリーズを1つだけ手で閉じる → 全開ではないので「すべて開く」に戻る
  state.toggle('series', 'クサカベ', '水彩');
  assert.equal(groupToggleSummary(GROUPS, state).allOpen, false);

  // メーカーを1つ閉じても同じ
  const state2 = createGroupOpenState();
  state2.openAll(GROUPS.map((g) => ({ maker: g.maker, series: g.series.map((s) => s.name) })));
  state2.toggle('maker', 'ホルベイン');
  assert.equal(groupToggleSummary(GROUPS, state2).allOpen, false);
});

test('まとめて閉じると、メーカーもシリーズも全部閉じる', () => {
  const state = createGroupOpenState();
  const entries = GROUPS.map((g) => ({ maker: g.maker, series: g.series.map((s) => s.name) }));
  state.openAll(entries);
  state.closeAll(entries);
  for (const g of GROUPS) {
    assert.equal(state.isOpen('maker', g.maker), false, `${g.maker} が開いたまま`);
    for (const s of g.series) assert.equal(state.isOpen('series', g.maker, s.name), false, `${s.name} が開いたまま`);
  }
  assert.equal(groupToggleSummary(GROUPS, state).allOpen, false);
});

test('件数ではボタンを出し分けない（38,140件・8,854シリーズでも「すべて開く」を出す）', () => {
  const state = createGroupOpenState();
  // 未絞り込みのカタログと同じ規模（4万件・8千シリーズ）でも出す
  const huge = [{
    maker: 'ホルベイン',
    total: 38140,
    series: Array.from({ length: 8812 }, (_, i) => ({ name: `s${i}`, total: 5 })),
  }];
  assert.equal(groupToggleSummary(huge, state).allowed, true, '件数が多いと出さないままになっている');
  assert.equal(groupToggleSummary(huge, state).items, 38140);
  assert.equal(groupToggleSummary(huge, state).seriesHeads, 8812);
  // 空の一覧では出さない（開け閉めする見出しが無い）
  assert.equal(groupToggleSummary([], state).allowed, false);
  assert.equal(groupToggleSummary(null, state).allowed, false);
});

test('まとめて開け閉めする材料は、一覧のまとまり（メーカー・シリーズ）から作る', () => {
  const items = [
    { name: 'アーティスト色鉛筆 カーマイン', maker: 'ホルベイン', series: 'アーティスト色鉛筆' },
    { name: 'アーティスト色鉛筆 コーラル', maker: 'ホルベイン', series: 'アーティスト色鉛筆' },
    { name: '油絵具 ホワイト', maker: 'クサカベ', series: '油絵具' },
  ];
  const groups = groupItemsByMakerSeries(items, { makerOf: (it) => it.maker });
  const summary = groupToggleSummary(groups, createGroupOpenState());
  assert.equal(summary.allowed, true);
  assert.equal(summary.entries.length, 2);
  assert.equal(summary.items, 3);
  assert.equal(summary.seriesHeads, 2, 'シリーズ見出しの数が見出しと合わない');
  assert.deepEqual(
    summary.entries.map((e) => e.maker).sort(),
    ['クサカベ', 'ホルベイン'],
  );
});

test('見出し行にボタンがあり、押すと状態を作り直して描き直す', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  // 在庫（場所ごと・メーカーごと）・補充・カタログの4か所
  for (const id of ['allToggleItems', 'allToggleMaker', 'allToggleShopping', 'allToggleCatalog']) {
    assert.ok(html.includes(`id="${id}"`), `${id} がない`);
  }
  assert.ok(html.includes('data-all-surface="place"'));
  assert.ok(html.includes('data-all-surface="maker"'));
  assert.ok(html.includes('data-all-surface="shopping"'));
  assert.ok(html.includes('data-all-surface="catalog"'));
  // 最初は隠しておき、一覧を描いたときに出す（件数が多ければ出さない）
  assert.equal((html.match(/class="allbtn"[^>]*hidden/g) || []).length, 4, '最初から見えているボタンがある');
  // 押したときの処理
  assert.match(app, /closest\('\[data-all-surface\]'\)/);
  assert.match(app, /function applyGroupToggle\(btn, summary, allOpen\)/);
  assert.match(app, /btn\.textContent = open \? 'すべて閉じる' : 'すべて開く'/);
  // 文言は「いま出ている見出し」の開閉で決める（検索中の自動展開ともズレない）
  assert.match(app, /function anyGroupClosed\(surface\)/);
  assert.match(app, /querySelector\('\[data-g-maker\]\[aria-expanded="false"\]'\)/);
  assert.match(app, /const closing = groupToggleIsClose\(surface\)/);
  assert.match(app, /state\.openAll\(summary\.entries\)/);
  assert.match(app, /state\.closeAll\(summary\.entries\)/);
  // 一覧を描くたびに、その一覧に合わせて文言を決める
  assert.match(app, /syncGroupToggle\(\$\('allToggleItems'\), groups, 'place'\)/);
  assert.match(app, /syncGroupToggle\(\$\('allToggleMaker'\), groups, 'maker'\)/);
  assert.match(app, /syncGroupToggle\(\$\('allToggleShopping'\), groups, 'shopping'\)/);
  assert.match(app, /applyGroupToggle\(\$\('allToggleCatalog'\), catalogGroupToggle\(\), !anyGroupClosed\('catalog'\)\)/);
  // カタログは件数でボタンを隠さない（材料は条件が変わったときだけ作り、あとは数えるだけ）
  assert.match(app, /function catalogGroupToggle\(\) \{\n  if \(!dictToggleGroups\.length\) return null;/);
  assert.match(app, /dictToggleGroups = dictGroups\.groups\.map\(\(g\) => \(\{/);
  assert.equal(/GROUP_EXPAND_LIMITS/.test(app), false, '件数の上限でボタンを隠している');
  assert.equal(/GROUP_EXPAND_LIMITS/.test(read('core.js')), false);
  // 未絞り込みで「すべて開く」を押しても固まらないよう、画面の近くだけを遅延して描く
  assert.match(app, /const catalogLazyObserver = typeof IntersectionObserver === 'function'/);
  assert.match(app, /function observeCatalogLazy\(root\) \{/);
  assert.match(app, /function fillCatalogMakerBody\(el\) \{/);
  assert.match(app, /function fillCatalogSeriesBody\(el\) \{/);
  assert.match(app, /lazyMaker: \(g\) => `<div class="lazybody" data-lazy-maker="\$\{esc\(g\.maker\)\}"><\/div>`/);
  assert.match(app, /observeCatalogLazy\(\$\('dictResults'\)\);/);
  // 見出しの開け閉めは描き直さず、その場だけ（スクロール位置を飛ばさない）
  assert.match(app, /function catalogToggleInPlace\(head, isSeries, open\) \{/);
  assert.match(app, /if \(surface === 'catalog'\) \{ catalogToggleInPlace\(head, isSeries, open\); return; \}/);
  // 見た目は控えめな小さなチップ
  assert.match(css, /\.sechead \.allbtn \{[^}]*font-size:\s*10\.5px/);
  assert.match(css, /\.sechead \.allbtn \{[^}]*border-radius:\s*999px/);
  assert.match(css, /\.sechead \.allbtn\[hidden\] \{ display: none; \}/);
});
