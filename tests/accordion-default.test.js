// 「メーカー ＞ シリーズ」のアコーディオンは、検索語が空のときは全部閉じておき、
// 検索したときだけ当たった見出しを開く（2026-11-18 の指示）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGroupOpenState, planDictGroups, planSeriesGroups } from '../core.js';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('既定は閉じた状態（メーカーもシリーズも）', () => {
  const st = createGroupOpenState();
  assert.equal(st.isOpen('maker', 'ホルベイン'), false);
  assert.equal(st.isOpen('series', 'ホルベイン', '油絵具'), false);
  // 明示的に開いた状態から始める指定も残す（将来の画面のため）
  const open = createGroupOpenState({ defaultOpen: true });
  assert.equal(open.isOpen('maker', 'ホルベイン'), true);
});

test('検索中は当たった見出しを自動で開き、手で閉じたものは閉じたまま', () => {
  const st = createGroupOpenState();
  // 検索語あり（autoOpen）→ 開く
  assert.equal(st.isOpenWhen('maker', 'ホルベイン', '', true), true);
  assert.equal(st.isOpenWhen('series', 'コピック', 'スケッチ', true), true);
  // 検索語なし → 閉じたまま
  assert.equal(st.isOpenWhen('maker', 'ホルベイン', '', false), false);

  // 手で開いた／閉じた記憶は、そのあとの操作でも保たれる
  assert.equal(st.toggle('maker', 'ホルベイン'), true); // 開く
  assert.equal(st.isOpenWhen('maker', 'ホルベイン', '', false), true, '手で開いた見出しは検索語を消しても開いたまま');
  assert.equal(st.toggle('maker', 'ホルベイン'), false); // 閉じる
  assert.equal(st.isOpenWhen('maker', 'ホルベイン', '', true), false, '手で閉じた見出しは検索中も閉じたまま');
  assert.equal(st.isClosedManually('maker', 'ホルベイン'), true);
});

test('カタログの計画: 検索語が空なら全部閉じ、入れたら当たった見出しを開く', () => {
  const groups = [
    { maker: 'ホルベイン', items: [{ jan: '1' }, { jan: '2' }] },
    { maker: 'コピック', items: [{ jan: '3' }] },
  ];
  const closed = planDictGroups(groups, { query: '', open: new Set(), closed: new Set() });
  assert.deepEqual(closed.map((g) => g.open), [false, false]);

  const searched = planDictGroups(groups, { query: 'コピック', open: new Set(), closed: new Set() });
  assert.deepEqual(searched.map((g) => g.open), [true, true]);

  const series = [{ name: 'スクリーン', items: [{ jan: '1' }] }];
  assert.equal(planSeriesGroups(series, { autoOpen: false })[0].open, false);
  assert.equal(planSeriesGroups(series, { autoOpen: true })[0].open, true);
});

test('アプリ側: どの一覧も閉じた状態から描き、検索中だけ自動で開く', () => {
  // 面ごとの記憶は既定で閉じる
  assert.match(app, /function groupStateOf\(surface, \{ defaultOpen = false \} = \{\}\) \{/);
  assert.match(app, /const dictGroupState = groupStateOf\('catalog', \{ defaultOpen: false \}\);/);
  // 見出しを描くときに autoOpen を渡し、検索中だけ開く
  assert.match(app, /function isGroupOpenWhen\(surface, level, maker, name = '', autoOpen = false\) \{/);
  assert.match(app, /openMaker = \(g\) => isGroupOpenWhen\(surface, 'maker', g\.maker, '', autoOpen\)/);
  assert.match(app, /openSeries = \(g, s\) => isGroupOpenWhen\(surface, 'series', g\.maker, s\.name, autoOpen\)/);
  // 在庫・補充・辞書の一覧は検索語が入っているときだけ自動で開く
  assert.match(app, /autoOpen: Boolean\(ui\.query\),/);
  assert.match(app, /surface: 'dict', autoOpen: Boolean\(String\(query \|\| ''\)\.trim\(\)\)/);
});
