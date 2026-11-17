/**
 * 「フォルダへ移動」の移動先は、丸チップ横並びではなく1行1フォルダの縦ツリー。
 *
 *   家
 *   アトリエ
 *   　└ 赤ちゃん
 *   　　　└ 価格
 *
 *   1) テキスト＋インデント＋└ だけで表す（絵文字は使わない）
 *   2) 親・子・孫どの行でも1タップでそのまま移動できる
 *   3) 1行1フォルダで押しやすく、増えても縦スクロールで見られる
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankState, addFolder, folderOptions, folderSubtreeIds } from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

test('移動先の並びは親の直後に子が来る（深さ付きの1列）', () => {
  let s = blankState();
  s = addFolder(s, { name: 'アトリエ', parentId: 'home' });
  const atelier = s.folders.at(-1).id;
  s = addFolder(s, { name: '赤ちゃん', parentId: atelier });
  const baby = s.folders.at(-1).id;
  s = addFolder(s, { name: '価格', parentId: baby });

  const rows = folderOptions(s.folders, { noneLabel: null });
  const byName = (name) => rows.find((o) => o.label === name);
  assert.ok(byName('アトリエ').depth >= 1);
  assert.equal(byName('赤ちゃん').depth, byName('アトリエ').depth + 1);
  assert.equal(byName('価格').depth, byName('赤ちゃん').depth + 1);
  // 子は親より後ろに出る（縦ツリーの並び）
  const names = rows.map((o) => o.label);
  assert.ok(names.indexOf('赤ちゃん') > names.indexOf('アトリエ'));
  assert.ok(names.indexOf('価格') > names.indexOf('赤ちゃん'));
});

test('画面: 移動先は1行1フォルダの縦ツリーで、深さをインデントと └ で表す', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');

  // 移動シート（1件・複数選択）とフォルダの移動先シートの両方が縦ツリー
  assert.match(html, /<div class="ftree" id="moveOptions"><\/div>/);
  assert.match(html, /<div class="ftree" id="folderMoveOptions"><\/div>/);
  assert.equal(/class="pill-row" id="moveOptions"/.test(html), false, '移動先が丸チップのままになっている');

  // 深さは --d（CSSでインデント）と └（親子の目印）で表し、絵文字は使わない
  assert.match(app, /function folderTreeHtml\(options/);
  assert.match(app, /style="--d:\$\{depth\}"/);
  assert.match(app, /class="ftree-guide" aria-hidden="true">└</);
  assert.equal(EMOJI.test(app.slice(app.indexOf('function folderTreeHtml'), app.indexOf('function openMoveSheet'))), false, '移動先に絵文字がある');

  // 親・子・孫のどこでも同じ data 属性で1タップ移動（既存のクリック処理がそのまま効く）
  assert.match(app, /data-tomove/);
  assert.match(app, /data-folder-parent/);
  assert.match(app, /\$\('moveOptions'\)\.addEventListener\('click', \(e\) => \{[\s\S]{0,300}data-tomove/);
  assert.match(app, /\$\('folderMoveOptions'\)\.addEventListener\('click', \(e\) => \{[\s\S]{0,300}data-folder-parent/);
});

test('縦ツリーは1行1フォルダで押しやすく、増えたら縦スクロールできる', () => {
  const css = read('styles.css');
  const tree = /^\.ftree\s*\{([^}]*)\}/m.exec(css);
  assert.ok(tree, '.ftree のスタイルがありません');
  assert.match(tree[1], /flex-direction:\s*column/, '縦に並んでいない');
  assert.match(tree[1], /overflow-y:\s*auto/, '縦スクロールできない');
  assert.match(tree[1], /max-height:/, '高さの上限がない');

  const row = /^\.ftree-row\s*\{([^}]*)\}/m.exec(css);
  assert.ok(row, '.ftree-row のスタイルがありません');
  assert.match(row[1], /width:\s*100%/, '行が横いっぱいでない');
  const minH = /min-height:\s*(\d+)px/.exec(row[1]);
  assert.ok(minH, 'min-height がない');
  assert.ok(Number(minH[1]) >= 44, `タップ領域が44pxより小さい（${minH[1]}px）`);
  // 深さのインデント（--d）と、長い名前の省略
  assert.match(row[1], /padding:[^;]*var\(--d/, '深さのインデントがない');
});

test('フォルダ移動では自分と自分の配下を移動先に出さない（循環を防ぐ）', () => {
  let s = blankState();
  s = addFolder(s, { name: 'アトリエ', parentId: 'home' });
  const atelier = s.folders.at(-1).id;
  s = addFolder(s, { name: '赤ちゃん', parentId: atelier });
  const exclude = folderSubtreeIds(s.folders, atelier);
  const rows = folderOptions(s.folders, { exclude, noneLabel: '最上位（トップ）' });
  assert.equal(rows.some((o) => o.id === atelier), false);
  assert.equal(rows.some((o) => o.id === exclude[1]), false);
  assert.equal(rows[0].label, '最上位（トップ）');
});
