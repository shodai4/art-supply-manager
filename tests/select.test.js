import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  toggleSelection, isSelected, selectAllIds, pruneSelection, moveItems, createItem, blankState,
  addFolder, folderOptions,
} from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

test('選択の切り替え（足す・外す・二度押しで元に戻る）', () => {
  let ids = [];
  assert.equal(isSelected(ids, 'a'), false);
  ids = toggleSelection(ids, 'a');
  assert.deepEqual(ids, ['a']);
  ids = toggleSelection(ids, 'b');
  assert.deepEqual(ids, ['a', 'b']);
  assert.equal(isSelected(ids, 'b'), true);
  ids = toggleSelection(ids, 'a');
  assert.deepEqual(ids, ['b']);
  ids = toggleSelection(ids, 'b');
  assert.deepEqual(ids, []);
  // 空IDは無視する
  assert.deepEqual(toggleSelection(['a'], ''), ['a']);
  // Set を渡しても配列で返る
  assert.deepEqual(toggleSelection(new Set(['a']), 'b'), ['a', 'b']);
});

test('全選択と、消えた画材の掃除', () => {
  const items = [createItem({ name: 'a' }), createItem({ name: 'b' })];
  const all = selectAllIds(items);
  assert.deepEqual(all, items.map((i) => i.id));
  assert.equal(all.length, 2);
  const left = pruneSelection([items[0].id, 'gone'], items);
  assert.deepEqual(left, [items[0].id]);
  assert.deepEqual(pruneSelection([], items), []);
});

test('一括移動: 選択した分だけ動き、ほかは変わらない', () => {
  let state = blankState();
  state = addFolder(state, { name: '引き出し', parentId: 'atelier' });
  const sub = state.folders.at(-1).id;
  const a = createItem({ name: 'a' });
  const b = createItem({ name: 'b' });
  const c = createItem({ name: 'c' });
  state = { ...state, items: [a, b, c] };
  const before = state.items.find((i) => i.id === b.id);
  const moved = moveItems(state.items, [a.id, c.id], sub, state.folders);
  assert.equal(moved.filter((i) => i.folderId === sub).length, 2);
  assert.deepEqual(moved.find((i) => i.id === b.id), before);
  // 移動先が無いIDなら何も壊さずに例外
  assert.throws(() => moveItems(state.items, [a.id], 'nope', state.folders), /移動先/);
  // 移動した画材は更新日時が新しくなる（新しい順に並ぶ）
  assert.ok(moved.find((i) => i.id === a.id).updatedAt >= before.updatedAt);
});

test('移動先の選択肢は階層順（子フォルダも選べる）', () => {
  let state = blankState();
  state = addFolder(state, { name: '引き出し', parentId: 'atelier' });
  state = addFolder(state, { name: '引き出し2', parentId: 'atelier' });
  const opts = folderOptions(state.folders, { noneLabel: null });
  const atelier = opts.findIndex((o) => o.id === 'atelier');
  assert.equal(opts[atelier + 1].label, '引き出し');
  assert.equal(opts[atelier + 1].depth, 1);
  assert.equal(opts[atelier + 2].label, '引き出し2');
  // 移動先に「すべて」は出さない（noneLabel: null）
  assert.equal(opts.some((o) => o.id === ''), false);
});

test('画面: 複数選択の入口（⋯メニュー）・選択マーク・操作バーがある', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  for (const id of ['btnMoreSelect', 'selBar', 'selCount', 'btnSelAll', 'btnSelMove', 'btnSelCancel']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} がありません`);
  }
  // 普段の画面には出さず、右上の⋯メニューから入る
  const more = html.slice(html.indexOf('id="sheetMore"'), html.indexOf('id="sheetFolderOrder"'));
  assert.ok(more.includes('id="btnMoreSelect"'), '⋯メニューに複数選択がありません');
  assert.ok(more.includes('id="moreSelectLabel"'));
  assert.match(html, />全選択</);
  assert.match(html, />移動</);
  assert.match(html, />やめる</);
  // タイル・リストの両方で選択できる
  assert.match(app, /data-select=/);
  assert.match(app, /ui\.selectMode/);
  assert.match(app, /toggleSelection\(ui\.selected/);
  assert.match(app, /selectAllIds\(/);
  assert.match(app, /pruneSelection\(/);
  assert.match(app, /exitSelect\(\)/);
  assert.match(app, /function toggleSelectMode\(\)/);
  // 選択中は編集を開かない（選択の切り替えを先に見る）
  const body = app.slice(app.indexOf("document.addEventListener('click', (e) => {\n  // 子フォルダのチップ"));
  assert.ok(body.indexOf('if (ui.selectMode)') < body.indexOf("closest('[data-edit]')"));
  // 操作バーは下タブバーの上に固定し、チェックの見た目がある
  assert.match(css, /\.selbar\s*\{[^}]*position:\s*fixed/);
  assert.match(css, /\.selbar\s*\{[^}]*bottom:\s*calc\(var\(--tabbar-h\)/);
  assert.match(css, /\.selmark\s*\{/);
  assert.match(css, /\.tile\.sel \.sw|\.tile\.sel \.selmark/);
});

test('シートは開くたび先頭から・移動先は1行1フォルダの縦ツリー', () => {
  const app = read('app.js');
  // 前回のスクロール位置が残ると、開いた瞬間に中ほどが見えてしまう
  assert.match(app, /openSheet\('sheetItem'\);\n\s*\$\('sheetItem'\)\.scrollTop = 0;/);
  // 縦ツリーは深さのインデントで親子を表すので、行に親の経路を重ねて書かない
  assert.match(app, /function folderTreeHtml\(options/);
  assert.match(app, /\$\('moveOptions'\)\.innerHTML = folderTreeHtml\(folderOptions\(state\.folders/);
  assert.match(app, /\$\('folderMoveOptions'\)\.innerHTML = folderTreeHtml\(/);
  assert.equal(/mpath/.test(app), false, '移動先に親の経路（mpath）が残っている');
});

test('選択モードのときに増減・編集のボタンを塞がない（pointer-events を殺さない）', () => {
  const css = read('styles.css');
  const blocks = [...css.matchAll(/[^{}]*\.sel(?:bar|mark|ecting)?[^{}]*\{[^}]*\}/g)].map((m) => m[0]);
  assert.ok(blocks.length >= 3, `選択のスタイル数: ${blocks.length}`);
  for (const block of blocks) assert.equal(/pointer-events\s*:\s*none/.test(block), false, block);
});
