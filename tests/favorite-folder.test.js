/**
 * 「お気に入り」を、削除できない固定フォルダにする。
 *
 *   1) 在庫一覧の先頭に、最初からあるフォルダ「お気に入り」が出る（上の帯は廃止）
 *   2) 星を付けた画材がその中に入り、元のフォルダにもそのまま残る
 *      （データを複製せず、同じ実体を見せるフィルタ。数量の増減・編集も同じデータに効く）
 *   3) 削除・移動・改名はできず、フォルダ移動の選択肢にも出ない
 *   4) 無料プランのフォルダ数上限（FREE_FOLDER_LIMIT）のカウント対象外
 *   5) カードの星は画像に重ねず、下のボタン。編集はカードのタップと編集シートから
 *   6) 編集シートの中にもお気に入りの入/切がある
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FAVORITE_FOLDER_ID, FAVORITE_FOLDER, isFavoriteFolder, favoriteItems, countFavorites,
  blankState, createItem, upsertItem, toggleFavorite, adjustStock, folderOptions, folderTree,
} from '../core.js';
import {
  FREE_FOLDER_LIMIT, customFolderCount, folderQuota, isBaseFolder,
} from '../pro.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

/* ---------------- データ（特別フォルダ） ---------------- */

test('「お気に入り」は名前とIDを持つ特別フォルダ（state.folders には入れない）', () => {
  assert.equal(FAVORITE_FOLDER_ID, 'favorites');
  assert.equal(FAVORITE_FOLDER.id, FAVORITE_FOLDER_ID);
  assert.equal(FAVORITE_FOLDER.name, 'お気に入り');
  assert.equal(isFavoriteFolder(FAVORITE_FOLDER_ID), true);
  assert.equal(isFavoriteFolder('home'), false);
  assert.equal(isFavoriteFolder(null), false);

  // 保存するフォルダの一覧には入らない＝削除・改名・移動の対象にならない
  const state = blankState();
  assert.equal(state.folders.some((f) => f.id === FAVORITE_FOLDER_ID), false);
  assert.equal(folderTree(state.folders).some((t) => t.folder.id === FAVORITE_FOLDER_ID), false);
});

test('フォルダ移動の選択肢に「お気に入り」は出ない（移動先に選べない）', () => {
  const state = blankState();
  const opts = folderOptions(state.folders, { noneLabel: null });
  assert.equal(opts.some((o) => o.id === FAVORITE_FOLDER_ID), false);
  assert.deepEqual(opts.map((o) => o.label), ['家', 'アトリエ', '持ち出し用', 'ストック・予備']);
});

test('星を付けた画材が「お気に入り」の中身になり、元のフォルダからは消えない', () => {
  const home = createItem({ name: 'ホルベイン 油絵具', folderId: 'home' });
  const atelier = createItem({ name: 'ターレンス 水彩', folderId: 'atelier' });
  const items = [home, atelier];
  assert.deepEqual(favoriteItems(items), []);
  assert.equal(countFavorites(items), 0);

  // 星を付ける＝お気に入りフォルダに入る。folderId は元のまま（実体は1つ）
  const starred = toggleFavorite(home, true);
  const next = [starred, atelier];
  assert.deepEqual(favoriteItems(next).map((i) => i.name), ['ホルベイン 油絵具']);
  assert.equal(starred.folderId, 'home', '元のフォルダが変わってしまう');
  assert.equal(countFavorites(next), 1);
  // 複製していない（同じIDの画材が1件だけ）
  assert.equal(next.filter((i) => i.id === home.id).length, 1);
});

test('お気に入りの中で増減・編集しても、元のフォルダの画材が同じように変わる', () => {
  const item = createItem({ name: 'x', folderId: 'stock', qty: 2, price: 300 });
  const starred = toggleFavorite(item, true);
  const state = upsertItem(blankState(), starred);

  // お気に入りフォルダから見えている1件を＋する
  const visible = favoriteItems(state.items)[0];
  const adjusted = adjustStock(visible, 1);
  const saved = upsertItem(state, adjusted);
  assert.equal(saved.items.length, 1, 'お気に入りにコピーが増えている');
  assert.equal(saved.items[0].qty, 3);
  assert.equal(saved.items[0].folderId, 'stock', '元のフォルダから外れている');
  // 元のフォルダで見ても同じ3点
  assert.equal(saved.items.filter((i) => i.folderId === 'stock')[0].qty, 3);
});

test('「お気に入り」は無料プランのフォルダ数に数えない', () => {
  const state = blankState();
  assert.equal(customFolderCount(state.folders), 0);
  assert.equal(folderQuota(state, {}).used, 0);
  assert.equal(folderQuota(state, {}).limit, FREE_FOLDER_LIMIT);
  // 仮に favorites というIDのフォルダが入っていても数えない（古いデータ対策）
  const legacy = [...state.folders, { id: FAVORITE_FOLDER_ID, name: 'お気に入り', parentId: null }];
  assert.equal(customFolderCount(legacy), 0);
  assert.equal(isBaseFolder({ id: FAVORITE_FOLDER_ID }), true);
  // 自分で作ったフォルダは今までどおり数える
  assert.equal(customFolderCount([...legacy, { id: 'f1', name: '引き出し1', parentId: null }]), 1);
});

/* ---------------- 画面（在庫一覧の固定フォルダ） ---------------- */

test('在庫一覧の先頭に固定フォルダ「お気に入り」が出て、上の帯は無くなった', () => {
  const html = read('index.html');
  const app = read('app.js');

  // 以前の「★ お気に入り」帯（favSec / favStrip / renderFavorites）は残っていない
  assert.equal(/id="favSec"/.test(html), false, '古いお気に入りの帯が残っている');
  assert.equal(/id="favStrip"/.test(html), false, '古いお気に入りの帯が残っている');
  assert.equal(/function renderFavorites/.test(app), false, '古いお気に入りの描画が残っている');

  // ルートの上段（スマートフォルダ）に、星のタイルとして並べる（件数つき）
  assert.match(app, /data-folder="\$\{esc\(FAVORITE_FOLDER_ID\)\}"/);
  assert.match(app, /const favCount = countFavorites\(state\.items\);/);
  assert.match(app, /function renderSmartGrid\(\) \{[\s\S]{0,900}FAVORITE_FOLDER\.name/);
  // 中を開いたときは子フォルダを作らない（フォルダの節を出さない）。
  // フォルダの並びは在庫タブの「場所ごと」のときだけなので、その条件も入る
  assert.match(app, /const show = ui\.tab === 'stock' && ui\.stockMode !== 'maker' && !ui\.query && !hasFilters\(\) && !fav && !all;/);
  // 長押しメニュー（編集／移動／削除）は出さない
  assert.match(app, /if \(folderId && \(isFavoriteFolder\(folderId\) \|\| isAllFolder\(folderId\)\)\) return;/);
  // 中身は星の付いた画材を、どのフォルダからでも集めて出す
  assert.match(app, /favoriteOnly: ui\.favoriteOnly \|\| fav/);
  assert.match(app, /emptyKey: fav \? 'favorites' : \(unfiledOnly \? 'unfiled' : 'items'\)/);
  // 現在地（パンくず）にも「お気に入り」と出る
  assert.match(app, /isFavoriteFolder\(ui\.folderId\)[\s\S]{0,400}FAVORITE_FOLDER\.name/);
});

test('編集シートの中でもお気に入りを入/切できる（保存で画材に反映）', () => {
  const html = read('index.html');
  const app = read('app.js');
  assert.match(html, /id="fFav"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /id="fFavLabel"/);
  // 開いたときに今の状態を入れ、押すたびに入/切
  assert.match(app, /setFormFavorite\(data\.favorite === true\)/);
  assert.match(app, /function setFormFavorite\(on\) \{[\s\S]{0,400}aria-pressed/);
  assert.match(app, /\$\('fFav'\)\.addEventListener\('click'/);
  // 保存（追加・編集とも）で favorite が createItem へ渡る
  assert.match(app, /favorite: \$\('fFav'\)\.getAttribute\('aria-pressed'\) === 'true'/);
});

test('カードの右端の鉛筆（編集）は星に置き換わり、詳細テキストは出さない', () => {
  const app = read('app.js');
  const row = app.slice(app.indexOf('function itemRow('), app.indexOf('/**\n * 画材群の中身'));
  assert.match(row, /class="icon-btn favbtn/, '右端が星になっていない');
  assert.match(row, /data-fav=/);
  assert.equal(/<svg class="pencil"/.test(row), false, '鉛筆（編集）が残っている');
  // 商品名・「要補充」バッジ・−/＋ は残し、メーカー名・色番号などの詳細は出さない
  assert.match(row, /class="it-name"/);
  assert.match(row, /class="badge \$\{st\.tone\}"/);
  assert.match(row, /data-step="1"/);
  assert.equal(/it-meta/.test(row), false, '詳細テキスト（メーカー・色番号など）が残っている');
  assert.equal(/itemMaker\(it\)/.test(row), false, 'メーカー名が残っている');
});

test('リストの行もタップで編集が開く（フォルダ・通販のチップが先に効く）', () => {
  const app = read('app.js');
  const row = app.slice(app.indexOf('function itemRow('), app.indexOf('/**\n * 画材群の中身'));
  // 指で押しやすいよう、商品名だけでなく行の本文（名前＋バッジ）をタップ範囲にする
  assert.match(row, /<div class="it-main" data-edit="\$\{esc\(it\.id\)\}">/);
  // チップ（移動・通販）の判定は、行のタップ（編集）より前に行う
  const body = app.slice(app.indexOf("document.addEventListener('click', (e) => {\n  // 子フォルダのチップ"));
  const moveIf = body.indexOf('if (mv) { openMoveSheet');
  const editIf = body.indexOf('if (edit) { openItemSheet');
  assert.ok(moveIf > 0 && editIf > moveIf, '行のタップ（編集）がチップより先に判定されている');
  assert.match(body, /if \(mv\) \{ openMoveSheet\(\[mv\.dataset\.move\]\); return; \}[\s\S]{0,300}if \(edit\) \{ openItemSheet\(edit\.dataset\.edit\); return; \}/);
});
