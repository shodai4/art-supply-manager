import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcCheckDigit, isValidJAN, normalizeJAN, detectMaker, lookupJAN,
  createItem, adjustStock, computeShoppingList, filterItems, moveItems, sortItems,
  addFolder, renameFolder, updateFolder, reorderFolders, deleteFolder,
  upsertItem, deleteItems, exportState, importState, summarize, blankState,
  countByFolder, DEFAULT_FOLDERS, CATEGORIES,
} from '../core.js';

test('JANチェックディジット計算', () => {
  assert.equal(calcCheckDigit('490066900199'), 7); // → 4900669001997
  assert.equal(calcCheckDigit('490066900191'), 1); // → 4900669001911
  assert.throws(() => calcCheckDigit('123'));
});

test('JANの妥当性と正規化', () => {
  assert.equal(isValidJAN('4900669001997'), true);
  assert.equal(isValidJAN('4900669001998'), false);
  assert.equal(isValidJAN('490066900199'), false); // 12桁は不可
  assert.equal(normalizeJAN(' 4900-669 001997 '), '4900669001997');
  assert.equal(normalizeJAN('４９００６６９００１９９７'), '4900669001997');
});

test('プレフィックスでメーカー判別', () => {
  assert.equal(detectMaker('4900669001997').maker, 'ホルベイン');
  assert.equal(detectMaker('4933317' + '000000' + '0'), null); // 13桁でない
  assert.equal(detectMaker('1234567890128'), null); // 未知プレフィックス
});

test('JAN辞書引き', () => {
  assert.equal(lookupJAN('4900669001911').colorName, 'シルバー');
  assert.equal(lookupJAN('9999999999999'), null);
});

test('アイテム生成の初期値と在庫増減', () => {
  const it = createItem({ name: 'テスト絵具', qty: '3' });
  assert.equal(it.qty, 3);
  assert.equal(it.status, 'enough');
  assert.ok(DEFAULT_FOLDERS.some((f) => f.id === it.folderId));

  let a = createItem({ name: 'X', qty: 1 });
  a = adjustStock(a, 2);
  assert.equal(a.qty, 3);
  a = adjustStock(a, -3);
  assert.equal(a.qty, 0);
  assert.equal(a.status, 'empty');
  a = adjustStock(a, -5); // マイナスにしない
  assert.equal(a.qty, 0);
  a = adjustStock(a, 1); // 補充したら残りわずか扱い
  assert.equal(a.qty, 1);
  assert.equal(a.status, 'low');
});

test('買い物リストは残りわずか・使い切りを抽出', () => {
  const items = [
    createItem({ name: 'A', status: 'enough', qty: 2 }),
    createItem({ name: 'B', status: 'low', qty: 1 }),
    createItem({ name: 'C', status: 'empty', qty: 0 }),
    createItem({ name: 'D', status: 'new', qty: 5 }),
  ];
  const list = computeShoppingList(items);
  assert.deepEqual(list.map((i) => i.name), ['C', 'B']);
});

test('検索・絞り込み（キーワード/メーカー/カテゴリ/残量/フォルダ）', () => {
  const items = [
    createItem({ name: 'シルバー', maker: 'ホルベイン', category: 'oil', folderId: 'atelier', status: 'low' }),
    createItem({ name: 'アクリルガッシュ', maker: 'ターナー', category: 'acrylic', folderId: 'home', status: 'enough' }),
    createItem({ name: 'ジェッソ', maker: 'ホルベイン', category: 'medium', folderId: 'stock', status: 'empty', jan: '4900669001997' }),
  ];
  assert.equal(filterItems(items, { query: 'ホルベイン' }).length, 2);
  assert.equal(filterItems(items, { query: 'げっそ' }).length, 0); // ひらがなは完全一致しない
  assert.equal(filterItems(items, { query: 'ジェッソ' }).length, 1);
  assert.equal(filterItems(items, { folderId: 'home' }).length, 1);
  assert.equal(filterItems(items, { category: 'oil' }).length, 1);
  assert.equal(filterItems(items, { shortageOnly: true }).length, 2);
  assert.equal(filterItems(items, { status: 'enough' }).length, 1);
  assert.equal(filterItems(items, { query: '4900669' }).length, 1); // 部分JAN検索
  assert.equal(filterItems(items, {}).length, 3);
});

test('フォルダ間の移動', () => {
  const items = [createItem({ name: 'A' }), createItem({ name: 'B' })];
  const moved = moveItems(items, [items[0].id], 'atelier', DEFAULT_FOLDERS);
  assert.equal(moved[0].folderId, 'atelier');
  assert.equal(moved[1].folderId, items[1].folderId);
  assert.throws(() => moveItems(items, [items[0].id], 'nope', DEFAULT_FOLDERS));
});

test('フォルダの追加・改名・色/アイコン変更・並び替え・削除（中身移動）', () => {
  let state = blankState();
  state = addFolder(state, { name: '倉庫', icon: '🏚️', color: '#123456' });
  const added = state.folders.at(-1);
  assert.equal(added.name, '倉庫');
  assert.throws(() => addFolder(state, { name: '  ' }));

  state = renameFolder(state, added.id, '第二倉庫');
  assert.equal(state.folders.at(-1).name, '第二倉庫');
  state = updateFolder(state, added.id, { icon: '🗄️', color: '#abcdef' });
  assert.equal(state.folders.at(-1).icon, '🗄️');

  const reversed = [...state.folders].reverse().map((f) => f.id);
  state = reorderFolders(state, reversed);
  assert.deepEqual(state.folders.map((f) => f.id), reversed);

  const item = createItem({ name: '中身', folderId: added.id });
  state = upsertItem(state, item);
  state = deleteFolder(state, added.id, 'home');
  assert.equal(state.folders.some((f) => f.id === added.id), false);
  assert.equal(state.items[0].folderId, 'home');

  const one = { ...blankState(), folders: [DEFAULT_FOLDERS[0]] };
  assert.throws(() => deleteFolder(one, DEFAULT_FOLDERS[0].id));
});

test('アイテムの更新・削除・並び替え・集計', () => {
  let state = blankState();
  const a = createItem({ name: 'B絵具', status: 'empty', qty: 0 });
  const b = createItem({ name: 'A絵具', status: 'enough', qty: 2 });
  state = upsertItem(state, a);
  state = upsertItem(state, b);
  assert.equal(state.items.length, 2);
  state = upsertItem(state, { ...a, name: 'B絵具(改)' });
  assert.equal(state.items.find((i) => i.id === a.id).name, 'B絵具(改)');
  assert.deepEqual(sortItems(state.items, 'name').map((i) => i.name), ['A絵具', 'B絵具(改)']);
  assert.equal(sortItems(state.items, 'shortage')[0].name, 'B絵具(改)');
  assert.equal(countByFolder(state.items).all_total, 2);
  const s = summarize(state.items);
  assert.equal(s.kinds, 2);
  assert.equal(s.qty, 2);
  assert.equal(s.needRestock, 1);
  assert.equal(Object.keys(s.byCategory).length, CATEGORIES.length);
  state = deleteItems(state, [a.id]);
  assert.equal(state.items.length, 1);
});

test('JSONエクスポート→インポートの往復と異常系', () => {
  let state = blankState();
  state = addFolder(state, { name: '一時', icon: '📦' });
  state = upsertItem(state, createItem({ name: '往復テスト', jan: '4900669001997', qty: 2, folderId: 'atelier' }));
  const json = exportState(state);
  const back = importState(json);
  assert.equal(back.items.length, 1);
  assert.equal(back.items[0].name, '往復テスト');
  assert.equal(back.items[0].jan, '4900669001997');
  assert.equal(back.folders.length, state.folders.length);
  assert.throws(() => importState('not json'), /JSON/);
  assert.throws(() => importState('{"items":[]}'), /想定と違います/);
  assert.throws(() => importState('{"folders":[],"items":[]}'), /フォルダ/);
  // 存在しないフォルダを指すアイテムは先頭フォルダへ寄せる
  const fixed = importState(JSON.stringify({ folders: [{ id: 'x', name: 'X' }], items: [{ name: 'Y', folderId: 'zzz' }] }));
  assert.equal(fixed.items[0].folderId, 'x');
});
