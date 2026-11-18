import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  blankState, createItem, calcCheckDigit, computeShoppingList, buildItemsCsvText,
  findItemByJanInFolder, itemsByJanInOtherFolders, DEFAULT_FOLDERS,
} from '../core.js';
import { applyScan, classifyJAN, scanFolderId } from '../scan-flow.js';
import { FREE_ITEM_LIMIT } from '../pro.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 12桁から正しいJAN（チェックディジット付き）を作る */
const jan = (first12) => `${first12}${calcCheckDigit(first12)}`;

const JAN_A = jan('490123456789'); // 辞書にある想定のJAN
const JAN_B = jan('490765432109'); // 辞書に無いJAN
const DICT = [{ jan: JAN_A, name: 'テスト油絵具 ウルトラマリン', maker: 'テストメーカー', category: 'oil', colorName: 'ウルトラマリン' }];

/* ---------------- 同じJANをフォルダで探す ---------------- */

test('同じJANでも保管場所が違えば別の画材（同じフォルダのときだけ同じ1点）', () => {
  const home = createItem({ name: 'ウルトラマリン', jan: JAN_A, qty: 2, folderId: 'home' });
  const atelier = createItem({ name: 'ウルトラマリン', jan: JAN_A, qty: 1, folderId: 'atelier' });
  const items = [home, atelier];

  assert.equal(findItemByJanInFolder(items, JAN_A, 'home')?.id, home.id);
  assert.equal(findItemByJanInFolder(items, JAN_A, 'atelier')?.id, atelier.id);
  assert.equal(findItemByJanInFolder(items, JAN_A, 'carry'), null);
  // 別のフォルダにある同じJAN（案内用）
  assert.deepEqual(itemsByJanInOtherFolders(items, JAN_A, 'home').map((i) => i.id), [atelier.id]);
  assert.deepEqual(itemsByJanInOtherFolders(items, JAN_A, 'carry').map((i) => i.id), [home.id, atelier.id]);
  // JANが空の画材は「同じ画材」とみなさない（JANなし同士で吸着しない）
  const noJan = createItem({ name: 'JANなし', jan: '', folderId: 'home' });
  assert.equal(findItemByJanInFolder([noJan], '', 'home'), null);
  assert.deepEqual(itemsByJanInOtherFolders([noJan], '', 'atelier'), []);
});

/* ---------------- 読み取り（連続スキャン） ---------------- */

test('別のフォルダにある同じJANは上書きせず、いまのフォルダに新しく登録する', () => {
  const home = createItem({ name: 'ウルトラマリン', jan: JAN_A, qty: 3, folderId: 'home' });
  const state = { ...blankState(), items: [home] };

  const { state: next, result } = applyScan(state, JAN_A, { dict: DICT, folderId: 'atelier' });
  assert.equal(result.kind, 'added', '別フォルダの1点を＋1にしてはいけない');
  assert.equal(result.otherFolders, 1, 'ほかのフォルダにあることを伝える');
  assert.match(result.message, /ほかのフォルダに1点/);
  assert.equal(next.items.length, 2);

  const added = next.items.find((i) => i.folderId === 'atelier');
  assert.ok(added, 'いまのフォルダに登録されていない');
  assert.equal(added.jan, JAN_A);
  assert.equal(added.qty, 1);
  assert.notEqual(added.id, home.id, 'IDは別（同じJANでも独立した1点）');
  // 元のフォルダの1点は数量も中身も変わらない
  const unchanged = next.items.find((i) => i.id === home.id);
  assert.equal(unchanged.qty, 3);
  assert.equal(unchanged.updatedAt, home.updatedAt);
  // 元の状態は変えない（純粋関数）
  assert.equal(state.items.length, 1);
});

test('同じフォルダにある同じJANは、これまでどおり＋1（新しい点を増やさない）', () => {
  const atelier = createItem({ name: 'ウルトラマリン', jan: JAN_A, qty: 1, folderId: 'atelier', price: 900 });
  const state = { ...blankState(), items: [atelier, createItem({ name: '同じJAN', jan: JAN_A, folderId: 'home' })] };

  const { state: next, result } = applyScan(state, JAN_A, { dict: DICT, folderId: 'atelier' });
  assert.equal(result.kind, 'incremented');
  assert.equal(next.items.length, 2, '同じJANでもフォルダが違う点はそのまま残る');
  const target = next.items.find((i) => i.id === atelier.id);
  assert.equal(target.qty, 2);
  assert.equal(target.purchaseLog.reduce((s, e) => s + e.amount, 0), 1800);
  assert.equal(next.items.find((i) => i.folderId === 'home').qty, 1, '別フォルダの在庫は増やさない');
});

test('「すべて」表示の読み取りは、先頭のフォルダを登録先にして数える', () => {
  const first = DEFAULT_FOLDERS[0].id;
  const inFirst = createItem({ name: '先頭フォルダの1点', jan: JAN_B, qty: 1, folderId: first });
  const state = { ...blankState(), items: [inFirst] };
  assert.equal(scanFolderId(state, 'all'), first);

  // 先頭フォルダにあるJANは＋1
  const inc = applyScan(state, JAN_B, { dict: [], folderId: 'all' });
  assert.equal(inc.result.kind, 'incremented');

  // 先頭フォルダに無いJANは、別のフォルダにあっても先頭フォルダへ新規登録
  const elsewhere = { ...blankState(), items: [createItem({ name: 'アトリエの1点', jan: JAN_B, qty: 1, folderId: 'atelier' })] };
  const added = applyScan(elsewhere, JAN_B, { dict: [], folderId: 'all' });
  assert.equal(added.result.kind, 'drafted');
  const created = added.state.items.find((i) => i.id !== elsewhere.items[0].id);
  assert.equal(created.folderId, first);
});

test('JANの種類分けもフォルダ単位（別フォルダの同じJANは「登録済み」にしない）', () => {
  const items = [createItem({ name: 'ウルトラマリン', jan: JAN_A, folderId: 'home' })];
  assert.equal(classifyJAN(JAN_A, { items, dict: DICT, folderId: 'home' }).kind, 'registered');
  assert.equal(classifyJAN(JAN_A, { items, dict: DICT, folderId: 'atelier' }).kind, 'dictionary');
  // フォルダを渡さないときは、これまでどおりフォルダを問わず探す（既存の呼び出し互換）
  assert.equal(classifyJAN(JAN_A, { items, dict: DICT }).kind, 'registered');
});

test('無料上限のときは、別フォルダに同じJANがあっても黙って上書きせず止める', () => {
  const items = Array.from({ length: FREE_ITEM_LIMIT }, (_, i) => createItem({ name: `画材${i}`, qty: 1 }));
  const state = { ...blankState(), items };
  const { state: next, result } = applyScan(state, JAN_A, { dict: DICT, folderId: 'atelier' });
  assert.equal(result.kind, 'limit');
  assert.equal(next.items.length, FREE_ITEM_LIMIT);
});

/* ---------------- 一覧・補充・CSV（ID衝突と誤集計が起きない） ---------------- */

test('同じJANが複数フォルダにあっても、ID・補充リスト・CSVが混ざらない', () => {
  const items = [
    createItem({ name: 'ウルトラマリン', jan: JAN_A, qty: 0, status: 'empty', folderId: 'home' }),
    createItem({ name: 'ウルトラマリン', jan: JAN_A, qty: 1, status: 'low', folderId: 'atelier' }),
    createItem({ name: 'ウルトラマリン', jan: JAN_A, qty: 4, folderId: 'stock' }),
  ];
  assert.equal(new Set(items.map((i) => i.id)).size, 3, 'IDが重複している');

  // 補充リストは「不足している点」を1件ずつ出す（同じJANでもフォルダごとに別の行）
  const shopping = computeShoppingList(items);
  assert.equal(shopping.length, 2);
  assert.deepEqual(shopping.map((i) => i.folderId).sort(), ['atelier', 'home']);

  // CSVはフォルダ名つきで3行（同じJANでも1点ずつ別の行）
  const csv = buildItemsCsvText(items, blankState().folders);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 4, `ヘッダー1行＋画材3行になるはず（実際 ${lines.length} 行）`);
  assert.match(csv, /自宅|家/);
});

/* ---------------- 画面（app.js）の導線 ---------------- */

test('登録の各入口が「JAN×フォルダ」で探す（スキャン・JAN入力・辞書から追加）', () => {
  const app = read('app.js');
  // 通常スキャン／JAN手入力の入口
  assert.match(app, /function applyJAN\(jan\) \{[\s\S]{0,600}const targetFolder = scanFolderId\(state, ui\.folderId\);/);
  assert.match(app, /const existing = findItemByJanInFolder\(state\.items, jan, targetFolder\);/);
  assert.equal(/const existing = state\.items\.find\(\(i\) => i\.jan === jan\);/.test(app), false, 'JANだけで探す古い入口が残っている');
  // 辞書から在庫へ追加
  assert.match(app, /function addDictToStock\(d, \{ keepList = false \} = \{\}\) \{[\s\S]{0,400}const folderId = scanFolderId\(state, ui\.folderId\);/);
  // 検索タブの「登録済み」判定も、いまのフォルダの分だけ
  assert.match(app, /const ownedFolder = scanFolderId\(state, ui\.folderId\);/);
  assert.match(app, /String\(i\.folderId\) === ownedFolder/);
  // 連続スキャンは applyScan にフォルダを渡す
  assert.match(app, /applyScan\(state, jan, \{ dict: mergedDict, folderId: ui\.folderId \}\)/);
});
