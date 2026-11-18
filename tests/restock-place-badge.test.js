/**
 * 補充リスト（補充タブ）の行に「フォルダ名」を出す。
 *
 *   1) 補充タブは通販ボタンつきのリスト行（itemRow + shopChip）で並ぶ
 *   2) その行は、フォルダチップの代わりに場所の色の点つきバッジでフォルダ名を小さく出す
 *   3) 同じ画材が複数フォルダにあって「要補充」に並んでも、どのフォルダの分かが分かる
 *   4) 在庫タブの行はこれまでどおり「フォルダ名 ▾」（移動ボタン）で、バッジは出さない
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankState, createItem, upsertItem, computeShoppingList } from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const app = read('app.js');
const css = read('styles.css');
const itemRow = app.slice(app.indexOf('function itemRow('), app.indexOf('/**\n * 画材群の中身'));

test('補充タブの行には、場所の色の点つきでフォルダ名が小さく出る', () => {
  // 補充リストも在庫と同じ「メーカー ＞ シリーズ」で描く（行は補充用のチップつき）
  assert.match(app, /function renderShopping\(\) \{[\s\S]{0,500}renderItemTree\(\$\('shoppingList'\), list, \{\n    surface: 'shopping', emptyKey: 'shopping', shopChip: true, forceList: true, noJanGroup: true,/);
  // 通販ボタンの行（＝補充リスト）だけ、フォルダ名のバッジを添える
  assert.match(itemRow, /const placeChip = opts\.shopChip\n    \? `<span class="badge place" title="\$\{esc\(folderPathLabel\(state\.folders, it\.folderId, ' › '\)\)\}"><span class="pdot" style="background:\$\{esc\(f\.color\)\}"><\/span>\$\{esc\(f\.name\)\}<\/span>`\n    : '';/);
  assert.match(itemRow, /\? `\$\{placeChip\}<button class="folder-tag shop-chip" data-shop-for="\$\{esc\(it\.id\)\}">通販<\/button>`/);
  // 在庫タブの行は、これまでどおりフォルダ名の移動ボタン（バッジは出さない）
  assert.match(itemRow, /: `<button class="folder-tag" data-move="\$\{esc\(it\.id\)\}">\$\{esc\(f\.name\)\} ▾<\/button>`/);
  assert.match(itemRow, /<div class="it-sub">\n        \$\{first\}\n        <span class="badge \$\{st\.tone\}"/);
});

test('場所バッジは小さく、長い名前は省略する（行の高さを崩さない）', () => {
  assert.match(css, /\.badge\.place \{\n  display: inline-flex; align-items: center; gap: 3px; max-width: 45%;\n  background: var\(--surface-2\); color: var\(--ink-2\); overflow: hidden; text-overflow: ellipsis;\n\}/);
  assert.match(css, /\.badge\.place \.pdot \{ flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%; \}/);
});

test('同じ画材が複数のフォルダで足りなくなると、フォルダごとに1行ずつ並ぶ', () => {
  let state = blankState();
  const [home, atelier] = state.folders;
  const jan = '4901234567891';
  state = upsertItem(state, createItem({ name: 'ウルトラマリン', maker: 'ホルベイン', category: 'oil', jan, folderId: home.id, qty: 0 }));
  state = upsertItem(state, createItem({ name: 'ウルトラマリン', maker: 'ホルベイン', category: 'oil', jan, folderId: atelier.id, qty: 1, status: 'low' }));

  const list = computeShoppingList(state.items);
  assert.equal(list.length, 2, '要補充の2点が別々に並ばない');
  assert.deepEqual([...new Set(list.map((i) => i.folderId))].sort(), [home.id, atelier.id].sort());
  // 同じ画材でもフォルダが違うので、行のバッジで見分けられる
  assert.equal(list[0].folderId === list[1].folderId, false);
});
