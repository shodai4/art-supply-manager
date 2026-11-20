/**
 * 同じ画材を複数の保管場所に分けて持っているときの見せ方と、場所を増やす導線。
 *
 *   1) 同じJANの画材が2つ以上のフォルダにあるときだけ、1つの親カードにまとめる
 *      （親には「計 4点」と、フォルダごとの行を ┣ / └ のツリーで出す）
 *   2) 1つのフォルダにしか無い画材・JANが空の画材は、これまでどおり1行のまま
 *   3) フォルダを1つだけ開いているときは、まとめずに「他：アトリエ 1点」を添える
 *   4) 「＋ 別の場所に追加」は、同じ画材情報を新しい独立した1点として別のフォルダに足す
 *      （今の1点は動かさない・数量は1・無料の上限は従来どおり）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createItem, blankState, calcCheckDigit, DEFAULT_FOLDERS,
  groupItemsAcrossFolders, otherPlaceSummary, sumItemQty, commonItemName,
  addItemToAnotherFolder, describeAddPlaceError, ADD_PLACE_ERRORS,
  findItemByJanInFolder, normalizeJAN,
} from '../core.js';
import { FREE_ITEM_LIMIT } from '../pro.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

/** 12桁から正しいJAN（チェックディジット付き）を作る */
const jan = (first12) => `${first12}${calcCheckDigit(first12)}`;
const JAN_A = jan('490123456789');
const JAN_B = jan('490765432109');

/** 家3点・アトリエ1点の同じ画材（同じJAN）＋ 別の画材1点 */
function sampleItems() {
  return [
    createItem({ name: 'ホルベイン 油絵具 シルバー', maker: 'ホルベイン', colorName: 'シルバー', jan: JAN_A, qty: 3, folderId: 'home' }),
    createItem({ name: '別の画材', maker: 'ターレンス', jan: JAN_B, qty: 2, folderId: 'home' }),
    createItem({ name: 'ホルベイン 油絵具 シルバー', maker: 'ホルベイン', colorName: 'シルバー', jan: JAN_A, qty: 1, folderId: 'atelier' }),
  ];
}

/* ---------------- まとめ（親カード＋┣/└） ---------------- */

test('同じJANが2つのフォルダにある画材だけを1つの親にまとめ、合計数を出す', () => {
  const items = sampleItems();
  const rows = groupItemsAcrossFolders(items, DEFAULT_FOLDERS);

  // 1行目が親（まとめ）、2行目がそのままの1行
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, 'group');
  assert.equal(rows[1].type, 'item');
  assert.equal(rows[1].item.name, '別の画材', 'まとめない画材はそのまま1行');

  const g = rows[0];
  assert.equal(g.jan, normalizeJAN(JAN_A));
  assert.equal(g.items.length, 2, '2フォルダ分の2点');
  assert.equal(g.total, 4, '3点＋1点＝計4点');
  assert.equal(g.favorite, false);
  assert.equal(g.name, 'ホルベイン 油絵具 シルバー');
  // フォルダの並び順（家 → アトリエ）で行を並べる
  assert.deepEqual(g.items.map((i) => i.folderId), ['home', 'atelier']);
  assert.deepEqual(g.items.map((i) => i.qty), [3, 1]);
  // まとめても実体は元の2点のまま（IDは別々・複製しない）
  assert.equal(new Set(g.items.map((i) => i.id)).size, 2);
  assert.equal(items.length, 3);
});

test('1つのフォルダに2点あるだけ・JANが空・JANが違う画材はまとめない', () => {
  const sameFolder = [
    createItem({ name: '同じフォルダに2点', jan: JAN_A, qty: 1, folderId: 'home' }),
    createItem({ name: '同じフォルダに2点', jan: JAN_A, qty: 1, folderId: 'home' }),
  ];
  assert.deepEqual(groupItemsAcrossFolders(sameFolder, DEFAULT_FOLDERS).map((r) => r.type), ['item', 'item']);

  // JANが空の画材同士は「同じ画材」とみなさない（別フォルダでもまとめない）
  const noJan = [
    createItem({ name: 'JANなし', jan: '', folderId: 'home' }),
    createItem({ name: 'JANなし', jan: '', folderId: 'atelier' }),
  ];
  assert.deepEqual(groupItemsAcrossFolders(noJan, DEFAULT_FOLDERS).map((r) => r.type), ['item', 'item']);

  const otherJan = [
    createItem({ name: 'A', jan: JAN_A, folderId: 'home' }),
    createItem({ name: 'B', jan: JAN_B, folderId: 'atelier' }),
  ];
  assert.deepEqual(groupItemsAcrossFolders(otherJan, DEFAULT_FOLDERS).map((r) => r.type), ['item', 'item']);

  // 3つのフォルダに散らばっていても1つの親にまとまる
  const three = [
    createItem({ name: 'x', jan: JAN_A, qty: 1, folderId: 'home' }),
    createItem({ name: 'x', jan: JAN_A, qty: 2, folderId: 'atelier' }),
    createItem({ name: 'x', jan: JAN_A, qty: 3, folderId: 'carry' }),
  ];
  const rows = groupItemsAcrossFolders(three, DEFAULT_FOLDERS);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total, 6);
  assert.deepEqual(rows[0].items.map((i) => i.folderId), ['home', 'atelier', 'carry']);
});

test('親カードの星は「どれか1つでもお気に入りなら点灯」', () => {
  const items = sampleItems();
  items[2] = { ...items[2], favorite: true };
  const g = groupItemsAcrossFolders(items, DEFAULT_FOLDERS)[0];
  assert.equal(g.type, 'group');
  assert.equal(g.favorite, true, 'アトリエの1点だけお気に入りでも親は点灯する');
});

test('合計数は数量の合計（0や不正な値は数えない）・名前は多数決', () => {
  assert.equal(sumItemQty([{ qty: 3 }, { qty: '2' }, { qty: 0 }]), 5);
  assert.equal(sumItemQty([{ qty: -2 }, { qty: null }, {}]), 0);
  assert.equal(sumItemQty([]), 0);
  assert.equal(commonItemName([{ name: '旧表記' }, { name: '新表記' }, { name: '新表記' }]), '新表記');
  assert.equal(commonItemName([{ name: 'A' }, { name: 'B' }]), 'A');
  assert.equal(commonItemName([]), '');
});

/* ---------------- フォルダを1つ開いているときの「他：アトリエ1」 ---------------- */

test('フォルダを開いているときは、外にある同じ画材を「他：◯◯ N点」で添える', () => {
  const items = sampleItems();
  const home = items[0];
  assert.equal(otherPlaceSummary(items, home, DEFAULT_FOLDERS), '他：アトリエ 1点');

  // 3か所に散らばっているときは2か所まで名前を出し、残りは「ほか◯か所」
  const three = [
    createItem({ name: 'x', jan: JAN_A, qty: 2, folderId: 'home' }),
    createItem({ name: 'x', jan: JAN_A, qty: 1, folderId: 'atelier' }),
    createItem({ name: 'x', jan: JAN_A, qty: 2, folderId: 'carry' }),
    createItem({ name: 'x', jan: JAN_A, qty: 4, folderId: 'stock' }),
  ];
  assert.equal(otherPlaceSummary(three, three[0], DEFAULT_FOLDERS), '他：アトリエ 1点・持ち出し用 2点 ほか1か所');

  // 1つのフォルダにしか無い・JANが空のときは何も添えない
  const alone = [createItem({ name: 'alone', jan: JAN_B, qty: 1, folderId: 'home' })];
  assert.equal(otherPlaceSummary(alone, alone[0], DEFAULT_FOLDERS), '');
  const noJan = [createItem({ name: 'a', folderId: 'home' }), createItem({ name: 'a', folderId: 'atelier' })];
  assert.equal(otherPlaceSummary(noJan, noJan[0], DEFAULT_FOLDERS), '');
});

/* ---------------- 別の場所に追加 ---------------- */

test('別のフォルダに、同じ画材情報の新しい1点を足す（今の1点は動かさない）', () => {
  const items = sampleItems();
  const src = items[0];
  const res = addItemToAnotherFolder(items, src.id, 'carry', { now: '2026-11-17T10:00:00.000Z' });

  assert.equal(res.ok, true);
  assert.equal(res.error, '');
  assert.equal(res.items.length, 4, '1点増える');
  const added = res.item;
  assert.notEqual(added.id, src.id, 'IDは新しく振る（独立した在庫）');
  assert.equal(added.folderId, 'carry');
  assert.equal(added.qty, 1, '数量は1点から');
  assert.equal(added.jan, normalizeJAN(JAN_A));
  assert.equal(added.name, src.name);
  assert.equal(added.maker, src.maker);
  assert.equal(added.colorName, src.colorName);
  assert.equal(added.category, src.category);
  assert.equal(added.createdAt, '2026-11-17T10:00:00.000Z');
  assert.equal(added.updatedAt, '2026-11-17T10:00:00.000Z');

  // 元の1点は数量もフォルダも中身も変わらない
  const unchanged = res.items.find((i) => i.id === src.id);
  assert.equal(unchanged.qty, 3);
  assert.equal(unchanged.folderId, 'home');
  assert.equal(unchanged.updatedAt, src.updatedAt);
  // 渡した配列は変えない（純粋関数）
  assert.equal(items.length, 3);
  // 同じフォルダで数えると2点（家3点・持ち出し1点）
  assert.equal(findItemByJanInFolder(res.items, JAN_A, 'carry')?.qty, 1);
});

test('数量・メモ・価格・購入ログ・お気に入り・写真は写さない（その場所の分だけ数える）', () => {
  const src = createItem({
    name: '油絵具', jan: JAN_A, qty: 5, folderId: 'home', memo: 'メモ', price: 900,
    favorite: true, shop: 'Amazon', imageUrl: 'https://example.com/a.jpg',
    purchaseLog: [{ at: '2026-11-01', amount: 2, price: 900 }],
  });
  const res = addItemToAnotherFolder([src], src.id, 'atelier');
  assert.equal(res.ok, true);
  const added = res.item;
  assert.equal(added.qty, 1);
  assert.equal(added.memo, '');
  assert.equal(added.price, null);
  assert.equal(added.favorite, false);
  assert.deepEqual(added.purchaseLog, []);
  // 画材の情報そのもの（ショップ・画像）は引き継ぐ
  assert.equal(added.shop, 'Amazon');
  assert.equal(added.imageUrl, 'https://example.com/a.jpg');
});

test('同じフォルダ・同じJANが既にあるフォルダ・上限のときは追加しない', () => {
  const items = sampleItems();
  const src = items[0];

  const same = addItemToAnotherFolder(items, src.id, 'home');
  assert.equal(same.ok, false);
  assert.equal(same.error, 'same-folder');
  assert.equal(same.items.length, 3);

  // アトリエには既に同じJANがある（二重登録しない）
  const dup = addItemToAnotherFolder(items, src.id, 'atelier');
  assert.equal(dup.ok, false);
  assert.equal(dup.error, 'exists');
  assert.equal(dup.items.length, 3);

  // 無料の上限（100点）に達しているとき
  const full = Array.from({ length: FREE_ITEM_LIMIT }, (_, i) => createItem({ name: `画材${i}`, qty: 1 }));
  const over = addItemToAnotherFolder(full, full[0].id, 'atelier', { limit: FREE_ITEM_LIMIT });
  assert.equal(over.ok, false);
  assert.equal(over.error, 'limit');
  assert.equal(over.items.length, FREE_ITEM_LIMIT);

  // 元の画材が無い・行き先が無い
  assert.equal(addItemToAnotherFolder(items, 'no-such-id', 'carry').error, 'no-source');
  assert.equal(addItemToAnotherFolder(items, src.id, '').error, 'no-folder');

  // 文言はどれも空でない
  for (const key of Object.keys(ADD_PLACE_ERRORS)) {
    assert.ok(describeAddPlaceError(key).length > 0);
  }
  assert.equal(describeAddPlaceError('unknown'), '追加できませんでした');
});

test('JANが空の画材は、同じ名前でも別のフォルダに足せる（重複とみなさない）', () => {
  const src = createItem({ name: 'JANなしの画材', folderId: 'home' });
  const res = addItemToAnotherFolder([src], src.id, 'atelier');
  assert.equal(res.ok, true);
  assert.equal(res.item.folderId, 'atelier');
});

/* ---------------- 画面の配線 ---------------- */

test('画面: 親カードは「計 N点」と ┣ / └ の行、別の場所に追加の導線を持つ', () => {
  const app = read('app.js');
  const html = read('index.html');
  const css = read('styles.css');
  const core = read('core.js');

  // データ側（core.js）にまとめと追加の関数がある
  assert.match(core, /export function groupItemsAcrossFolders\(/);
  assert.match(core, /export function otherPlaceSummary\(/);
  assert.match(core, /export function addItemToAnotherFolder\(/);
  // app.js がそれを使う
  assert.match(app, /groupItemsAcrossFolders, otherPlaceSummary, countOtherPlaces,/);
  assert.match(app, /groupItemsAcrossFolders\(items, state\.folders\)/);

  // 親カード: 見出しに合計数、行は ┣ / └、行ごとに −/＋・フォルダ移動・詳細編集
  assert.match(app, /function janGroupCard\(/);
  assert.match(app, /class="badge jg-total">計 \$\{g\.total\}点/);
  assert.match(app, /aria-hidden="true">\$\{last \? '└' : '┣'\}/);
  assert.match(app, /class="folder-tag jg-folder" data-move=/);
  assert.match(app, /class="icon-btn jg-pen" data-edit=/);
  assert.match(app, /data-step="-1" data-id="\$\{esc\(m\.id\)\}"/);
  assert.match(app, /data-step="1" data-id="\$\{esc\(m\.id\)\}"/);
  assert.match(app, /data-fav-group="\$\{esc\(g\.jan\)\}"/);
  assert.match(app, /class="jg-add" data-addplace="\$\{esc\(it\.id\)\}">＋ 別の場所に追加</);

  // 同じJANの1点だけの画材は、これまでどおり1行（まとめない）
  assert.match(app, /const plain = opts\.noJanGroup \|\| ui\.selectMode;/);
  // 買い物リストではまとめない
  assert.match(app, /forceList: true, noJanGroup: true/);
  // フォルダを1つだけ開いているときの「他：…」
  assert.match(app, /otherPlaces: ui\.folderId !== 'all' && !fav && !all && !ui\.query/);
  assert.match(app, /otherPlaceSummary\(state\.items, it, state\.folders\)/);

  // 追加の導線（編集シート・行・親カードの末尾）と、追加先を選ぶシート
  assert.match(html, /<button type="button" class="btn mini wide" id="btnAddPlace">＋ 別の場所に追加<\/button>/);
  assert.match(html, /<div class="sheet" id="sheetAddPlace"/);
  assert.match(html, /<div class="ftree" id="addPlaceOptions"><\/div>/);
  assert.match(app, /function openAddPlaceSheet\(/);
  assert.match(app, /function addPlaceTreeHtml\(/);
  // 既にあるフォルダは「登録済み」「いまここ」で選べない
  assert.match(app, /'<span class="ftree-here">いまここ<\/span>' : has \? '<span class="ftree-here">登録済み<\/span>'/);
  assert.match(app, /\$\{off \? ' disabled' : ''\}/);

  // 見た目
  assert.match(css, /\.jg \{/);
  assert.match(css, /\.tgrid \.jg \{ margin: 0; grid-column: 1 \/ -1; \}/);
  assert.match(css, /\.jg-row \{/);
  assert.match(css, /\.jg-add \{/);
  assert.match(css, /\.it-other \{/);

  // 絵文字は使わない（既存の方針）
  assert.equal(EMOJI.test(app.slice(app.indexOf('function janGroupCard'), app.indexOf('function itemsBodyHtml'))), false);
});

test('画面: 版とキャッシュを上げる（index.html と package.json が揃う）', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.version, '1.43.1');
  assert.match(read('index.html'), new RegExp(`app\\.js\\?v=${pkg.version.replace(/\./g, '\\.')}`));
  assert.match(read('index.html'), new RegExp(`styles\\.css\\?v=${pkg.version.replace(/\./g, '\\.')}`));
  assert.match(read('sw.js'), /art-supply-manager-v69/);
  // 空の状態でも壊れない
  assert.equal(blankState().items.length, 0);
});
