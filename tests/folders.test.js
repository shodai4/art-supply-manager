import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  blankState, addFolder, updateFolder, moveFolder, deleteFolder, createItem, upsertItem,
  filterItems, moveItems, importState, exportState, DEFAULT_FOLDERS,
  folderParentId, folderChildren, folderChain, folderDepth, folderPathLabel,
  folderSubtreeIds, folderTree, folderOptions, countByFolderDeep, canSetFolderParent,
  isFolderDescendant, countByFolder,
} from '../core.js';
import { FREE_FOLDER_LIMIT, folderQuota, canAddFolder, isPro } from '../pro.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

/** 家 > アトリエ > 引き出し1、家 > アトリエ > 引き出し2 の3階層と、別のトップ「倉庫」を作る */
function nestedState() {
  let s = blankState();
  s = addFolder(s, { name: '机まわり', parentId: 'home' });
  const atelier = s.folders.at(-1).id;
  s = addFolder(s, { name: '引き出し1', parentId: atelier });
  const drawer1 = s.folders.at(-1).id;
  s = addFolder(s, { name: '引き出し2', parentId: atelier });
  const drawer2 = s.folders.at(-1).id;
  s = addFolder(s, { name: '倉庫' });
  const stock = s.folders.at(-1).id;
  return { s, atelier, drawer1, drawer2, stock };
}

test('子フォルダを作れる（parentId）・存在しない親は作らない', () => {
  let state = blankState();
  state = addFolder(state, { name: 'アトリエ', parentId: 'home' });
  const child = state.folders.at(-1);
  assert.equal(child.parentId, 'home');
  assert.equal(child.name, 'アトリエ');
  // 既存の既定フォルダは parentId なしのまま（後方互換）
  assert.equal(folderParentId(state.folders[0]), '');
  assert.throws(() => addFolder(state, { name: '迷子', parentId: 'nope' }), /親フォルダがありません/);
});

test('階層の参照（子・経路・深さ・子孫）', () => {
  const { s, atelier, drawer1, drawer2, stock } = nestedState();
  assert.deepEqual(folderChildren(s.folders, 'home').map((f) => f.name), ['机まわり']);
  assert.deepEqual(folderChildren(s.folders, atelier).map((f) => f.name), ['引き出し1', '引き出し2']);
  assert.deepEqual(folderChildren(s.folders, stock), []);
  assert.deepEqual(folderChain(s.folders, drawer1).map((f) => f.name), ['家', '机まわり', '引き出し1']);
  assert.equal(folderDepth(s.folders, 'home'), 0);
  assert.equal(folderDepth(s.folders, atelier), 1);
  assert.equal(folderDepth(s.folders, drawer1), 2);
  assert.equal(folderPathLabel(s.folders, drawer1), '家 / 机まわり / 引き出し1');
  assert.equal(folderPathLabel(s.folders, drawer1, ' › '), '家 › 机まわり › 引き出し1');
  assert.deepEqual(folderSubtreeIds(s.folders, atelier).sort(), [atelier, drawer1, drawer2].sort());
  assert.deepEqual(folderSubtreeIds(s.folders, drawer1), [drawer1]);
  assert.deepEqual(folderSubtreeIds(s.folders, 'nope'), []);
  assert.equal(isFolderDescendant(s.folders, atelier, drawer1), true);
  assert.equal(isFolderDescendant(s.folders, atelier, atelier), false);
  assert.equal(isFolderDescendant(s.folders, drawer1, atelier), false);
});

test('循環参照は作れない（自分自身・自分の配下を親にしない）', () => {
  const { s, atelier, drawer1 } = nestedState();
  assert.equal(canSetFolderParent(s.folders, atelier, atelier).ok, false);
  assert.equal(canSetFolderParent(s.folders, atelier, drawer1).ok, false);
  assert.equal(canSetFolderParent(s.folders, drawer1, atelier).ok, true);
  assert.equal(canSetFolderParent(s.folders, atelier, '').ok, true);
  assert.throws(() => updateFolder(s, atelier, { parentId: atelier }), /自分自身/);
  assert.throws(() => updateFolder(s, atelier, { parentId: drawer1 }), /配下/);
  assert.throws(() => updateFolder(s, atelier, { parentId: 'nope' }), /親フォルダがありません/);
});

test('親フォルダの付け替え（トップへ戻す・別の親へ）', () => {
  const { s, atelier, drawer1, stock } = nestedState();
  const moved = updateFolder(s, atelier, { parentId: stock });
  assert.equal(moved.folders.find((f) => f.id === atelier).parentId, stock);
  assert.deepEqual(folderChain(moved.folders, drawer1).map((f) => f.name), ['倉庫', '机まわり', '引き出し1']);
  const top = updateFolder(moved, atelier, { parentId: null });
  assert.equal(top.folders.find((f) => f.id === atelier).parentId, null);
  assert.equal(folderParentId(top.folders.find((f) => f.id === atelier)), '');
  // 名前・色の変更は今までどおり
  const renamed = updateFolder(top, atelier, { name: '机まわり2', color: '#123456' });
  assert.equal(renamed.folders.find((f) => f.id === atelier).name, '机まわり2');
  assert.equal(renamed.folders.find((f) => f.id === atelier).color, '#123456');
});

test('表示順は親のすぐ下に子（ツリー順）', () => {
  const { s, atelier, drawer1, drawer2, stock } = nestedState();
  assert.deepEqual(folderTree(s.folders).map(({ folder, depth }) => `${depth}:${folder.name}`), [
    '0:家', '1:机まわり', '2:引き出し1', '2:引き出し2',
    '0:アトリエ', '0:持ち出し用', '0:ストック・予備', '0:倉庫',
  ]);
  // 選択肢も階層順（なし＝トップを除いたIDの並び）
  const opts = folderOptions(s.folders, { noneLabel: null });
  assert.deepEqual(opts.map((o) => o.id), ['home', atelier, drawer1, drawer2, 'atelier', 'carry', 'stock', stock]);
  assert.deepEqual(opts.map((o) => o.depth), [0, 1, 2, 2, 0, 0, 0, 0]);
  // 除外（自分と配下）は選択肢から消える
  const excluding = folderOptions(s.folders, { exclude: folderSubtreeIds(s.folders, atelier) });
  assert.equal(excluding[0].id, '', 'トップ（なし）は先頭に残る');
  assert.equal(excluding.some((o) => o.id === atelier || o.id === drawer1), false);
});

test('同じ親の中で上下に入れ替える（子フォルダは付いたまま）', () => {
  const { s, atelier, drawer1, drawer2, stock } = nestedState();
  const up = moveFolder(s, drawer2, 'up');
  assert.deepEqual(folderChildren(up.folders, atelier).map((f) => f.id), [drawer2, drawer1]);
  // 一番上をさらに上へは動かない
  assert.deepEqual(folderChildren(moveFolder(up, drawer2, 'up').folders, atelier).map((f) => f.id), [drawer2, drawer1]);
  // トップ同士の入れ替え（倉庫を1つ上へ）
  const top = moveFolder(s, stock, 'up');
  assert.deepEqual(folderChildren(top.folders, '').map((f) => f.name),
    ['家', 'アトリエ', '持ち出し用', '倉庫', 'ストック・予備']);
  // 親を動かしても子は連れて行く（配列順が変わっても親子は parentId で決まる）
  assert.deepEqual(folderTree(top.folders).slice(0, 4).map((f) => f.folder.name),
    ['家', '机まわり', '引き出し1', '引き出し2']);
});

test('フォルダ削除: 画材は移動先へ、子フォルダは1つ上へ逃がす', () => {
  const { s, atelier, drawer1, drawer2 } = nestedState();
  const withItems = { ...s, items: [
    createItem({ name: '机の絵具', folderId: atelier }),
    createItem({ name: '引き出しの筆', folderId: drawer1 }),
  ] };
  const deleted = deleteFolder(withItems, atelier, 'home');
  assert.equal(deleted.folders.some((f) => f.id === atelier), false);
  // 中の画材は移動先へ
  assert.equal(deleted.items.find((i) => i.name === '机の絵具').folderId, 'home');
  // 子フォルダは消さず、削除したフォルダの親（家）へ
  assert.equal(deleted.folders.find((f) => f.id === drawer1).parentId, 'home');
  assert.equal(deleted.folders.find((f) => f.id === drawer2).parentId, 'home');
  // 子フォルダの中身はそのまま
  assert.equal(deleted.items.find((i) => i.name === '引き出しの筆').folderId, drawer1);
  // 最後の1つは消せない・移動先が自分自身なら断る
  assert.throws(() => deleteFolder({ ...blankState(), folders: [DEFAULT_FOLDERS[0]] }, 'home'), /最低1つ/);
  assert.throws(() => deleteFolder(withItems, atelier, atelier), /移動先/);
});

test('親フォルダを開くと、配下フォルダの画材もまとめて絞り込める', () => {
  const { s, atelier, drawer1 } = nestedState();
  const items = [
    createItem({ name: '机の油', folderId: atelier }),
    createItem({ name: '引き出しの筆', folderId: drawer1 }),
    createItem({ name: '家の水彩', folderId: 'home' }),
  ];
  const scope = folderSubtreeIds(s.folders, atelier);
  assert.deepEqual(filterItems(items, { folderIds: scope }).map((i) => i.name), ['机の油', '引き出しの筆']);
  // folderId だけの従来の使い方はそのまま
  assert.deepEqual(filterItems(items, { folderId: atelier }).map((i) => i.name), ['机の油']);
  assert.equal(filterItems(items, { folderId: 'all' }).length, 3);
});

test('件数は子フォルダも含めて数える（タイル・一覧の数字）', () => {
  const { s, atelier, drawer1 } = nestedState();
  const items = [
    createItem({ name: 'a', folderId: atelier }),
    createItem({ name: 'b', folderId: drawer1 }),
    createItem({ name: 'c', folderId: drawer1 }),
    createItem({ name: 'd', folderId: 'home' }),
  ];
  const deep = countByFolderDeep(s.folders, items);
  assert.equal(deep[atelier], 3);
  assert.equal(deep[drawer1], 2);
  assert.equal(deep['home'], 4);
  assert.equal(deep.all_total, 4);
  // 直接の件数は今までどおり（子フォルダの分は数えない）
  assert.equal(countByFolder(items)[atelier], 1);
  assert.equal(countByFolder(items)['home'], 1);
});

test('複数の画材をサブフォルダへ一括移動できる', () => {
  const { s, drawer1 } = nestedState();
  const items = [
    createItem({ name: 'a' }),
    createItem({ name: 'b' }),
    createItem({ name: 'c' }),
  ];
  const moved = moveItems(items, [items[0].id, items[2].id], drawer1, s.folders);
  assert.equal(moved[0].folderId, drawer1);
  assert.equal(moved[1].folderId, items[1].folderId);
  assert.equal(moved[2].folderId, drawer1);
});

test('保存データの後方互換: parentId 無しで読める・壊れた親/循環はトップへ', () => {
  const legacy = JSON.stringify({
    folders: [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y', parentId: 'x' }],
    items: [{ name: '画材', folderId: 'y' }],
  });
  const back = importState(legacy);
  assert.equal(folderParentId(back.folders[0]), '');
  assert.equal(back.folders[1].parentId, 'x');
  assert.equal(back.items[0].folderId, 'y');

  const broken = importState(JSON.stringify({
    folders: [
      { id: 'a', name: 'A', parentId: 'missing' },
      { id: 'b', name: 'B', parentId: 'b' },
      { id: 'c', name: 'C', parentId: 'd' },
      { id: 'd', name: 'D', parentId: 'c' },
    ],
    items: [],
  }));
  const byId = new Map(broken.folders.map((f) => [f.id, f]));
  assert.equal(byId.get('a').parentId, null, '存在しない親はトップへ');
  assert.equal(byId.get('b').parentId, null, '自分自身は親にしない');
  // c と d の相互参照は、どちらかの線を切って循環を残さない（切った側は親を保ってよい）
  assert.notEqual(byId.get('c').parentId, 'c');
  for (const f of broken.folders) {
    let p = f.parentId;
    const seen = new Set([f.id]);
    let ok = true;
    while (p) {
      if (seen.has(p)) { ok = false; break; }
      seen.add(p);
      p = byId.get(p).parentId;
    }
    assert.equal(ok, true, `${f.id} の経路が循環しています`);
  }

  const { s, drawer1 } = nestedState();
  const round = importState(exportState(s));
  assert.equal(round.folders.find((f) => f.id === drawer1).parentId, s.folders.find((f) => f.id === drawer1).parentId);
});

test('無料のフォルダ上限は子フォルダも1つとして数える（既定4つは数えない）', () => {
  const { s } = nestedState(); // 既定4 + 机まわり + 引き出し1/2 + 倉庫 = 8
  assert.equal(s.folders.length, 8);
  assert.equal(folderQuota(s, { pro: false }).used, 4); // あとから作った4つだけ
  assert.equal(folderQuota(s, { pro: false }).full, true);
  assert.equal(canAddFolder(s, { pro: false }).ok, false);
  assert.equal(isPro({ proPreview: true }), true);
  assert.equal(canAddFolder(s, { proPreview: true }).ok, true);
  assert.equal(FREE_FOLDER_LIMIT, 3);
});

test('画面: 階層フォルダの導線（フォルダのタイル・親の選択・インデント）がある', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  for (const id of ['fFolderParent', 'folderGrid', 'folderList', 'crumb', 'btnHome', 'folderSec']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} がありません`);
  }
  assert.match(html, /id="fFolderParent"/);
  assert.match(app, /folderOptions\(state\.folders/);
  // フォルダを開いても、子フォルダは同じグリッドに並べて「＋ フォルダ」で作る
  assert.match(app, /folderChildren\(state\.folders, parentId\)/);
  assert.match(app, /data-add-folder/);
  assert.match(app, /folderSubtreeIds\(state\.folders/);
  assert.match(app, /folderPathLabel\(state\.folders/);
  // 深さでインデントする（移動先は1行1フォルダの縦ツリー）
  assert.match(css, /\.folder-row[^{]*\{[^}]*padding-left:\s*calc\(var\(--d/);
  assert.match(css, /\.ftree-row[^{]*\{[^}]*padding:\s*9px 12px 9px calc\(12px \+ var\(--d/);
});
