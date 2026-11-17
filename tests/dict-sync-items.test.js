import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createItem, syncItemsWithDictionary, describeSyncItemsResult, SYNC_ITEMS_CONFIRM_TEXT,
  DICT_SYNC_FIELDS,
} from '../core.js';
import { JAN_DICTIONARY } from '../jan-database.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

const JAN_A = '4901881120017'; // テスト用（チェックディジットは問わない）
const JAN_B = '4901881120024';
const NOW = '2026-11-17T12:00:00.000Z';

/** 辞書の1件（実在の辞書と同じ形） */
function entry(over = {}) {
  return {
    jan: JAN_A,
    name: 'ホルベイン 油絵具 ウルトラマリン 20ml',
    maker: 'ホルベイン',
    brand: 'HOLBEIN',
    category: 'oil',
    colorName: 'ウルトラマリン',
    size: '20ml',
    code: 'H001',
    source: 'テスト',
    verifiedAt: '2026-11-16',
    ...over,
  };
}

test('JANが一致する在庫の表記だけを最新の辞書の内容に揃える', () => {
  const item = createItem({
    id: 'a', name: 'ウルトラマリン（旧）', maker: '旧メーカー', category: 'other',
    jan: JAN_A, qty: 2, memo: 'メモ', folderId: 'atelier', createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  });
  const other = createItem({ id: 'b', name: '別の画材', jan: JAN_B });
  const noJan = createItem({ id: 'c', name: 'JANなし' });

  const { items, updatedCount } = syncItemsWithDictionary([item, other, noJan], [entry()], { now: NOW });
  assert.equal(updatedCount, 1);
  assert.equal(items.length, 3);

  const [a, b, c] = items;
  assert.equal(a.name, 'ホルベイン 油絵具 ウルトラマリン 20ml');
  assert.equal(a.maker, 'ホルベイン');
  assert.equal(a.brand, 'HOLBEIN');
  assert.equal(a.category, 'oil');
  assert.equal(a.colorName, 'ウルトラマリン');
  assert.equal(a.colorCode, 'H001');
  assert.equal(a.size, '20ml');
  assert.equal(a.updatedAt, NOW);

  // JANが辞書に無い画材・JANが空の画材は、そのまま（同じオブジェクト）
  assert.equal(b, other);
  assert.equal(c, noJan);
});

test('数量・メモ・フォルダ・お気に入り・価格・購入ログ・写真・ID・作成日は絶対に変えない', () => {
  const item = createItem({
    id: 'keep-me', name: '旧名', maker: '旧', jan: JAN_A, qty: 7, favorite: true,
    folderId: 'carry', memo: '大事なメモ', price: 1200, imageUrl: 'https://example.com/a.jpg',
    purchaseLog: [{ at: '2026-02-01T00:00:00.000Z', qty: 2, amount: 2400 }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-03T00:00:00.000Z',
  });
  item.status = 'low';
  const { items, updatedCount } = syncItemsWithDictionary([item], [entry()], { now: NOW });
  assert.equal(updatedCount, 1);
  const next = items[0];
  for (const field of [
    'id', 'folderId', 'qty', 'status', 'favorite', 'memo', 'price', 'purchaseLog', 'imageUrl', 'createdAt',
  ]) {
    assert.deepEqual(next[field], item[field], `${field} を変えてはいけない`);
  }
  // 表記系だけが入る（ブランドの無い辞書でも今の値は消さない）
  assert.equal(next.name, entry().name);
  assert.equal(next.maker, 'ホルベイン');
});

test('辞書側が空の項目は今の値を残す（消さない）', () => {
  const thin = entry({ brand: '', colorName: '', size: '', code: '', category: '' });
  const item = createItem({
    name: '旧名', maker: '旧メーカー', brand: 'MY BRAND', category: 'watercolor',
    colorName: 'セルリアン', colorCode: 'C9', size: '12号', jan: JAN_A,
  });
  const { items, updatedCount } = syncItemsWithDictionary([item], [thin], { now: NOW });
  assert.equal(updatedCount, 1);
  const next = items[0];
  assert.equal(next.name, thin.name);
  assert.equal(next.maker, 'ホルベイン');
  assert.equal(next.brand, 'MY BRAND');
  assert.equal(next.category, 'watercolor');
  assert.equal(next.colorName, 'セルリアン');
  assert.equal(next.colorCode, 'C9');
  assert.equal(next.size, '12号');
});

test('商品名が辞書に無ければ色名で補い、カテゴリは知らない値なら変えない', () => {
  const bare = entry({ name: '', colorName: 'ウルトラマリン', category: 'unknown-category' });
  const item = createItem({ name: 'そのまま', category: 'brush', jan: JAN_A });
  const { items, updatedCount } = syncItemsWithDictionary([item], [bare], { now: NOW });
  assert.equal(updatedCount, 1);
  assert.equal(items[0].name, 'ウルトラマリン');
  assert.equal(items[0].category, 'brush');
});

test('変わった項目が1つも無ければ、配列も中身もそのまま（updatedAtも動かさない）', () => {
  const item = createItem({
    id: 'same', name: entry().name, maker: 'ホルベイン', brand: 'HOLBEIN', category: 'oil',
    colorName: 'ウルトラマリン', size: '20ml', jan: JAN_A,
    updatedAt: '2026-01-02T00:00:00.000Z',
  });
  item.colorCode = 'H001';
  const list = [item];
  const { items, updatedCount } = syncItemsWithDictionary(list, [entry()], { now: NOW });
  assert.equal(updatedCount, 0);
  assert.equal(items, list); // 同じ配列をそのまま返す
  assert.equal(items[0], item);
  assert.equal(items[0].updatedAt, '2026-01-02T00:00:00.000Z');
});

test('辞書が空・配列でないときは何もしない', () => {
  const item = createItem({ name: 'x', jan: JAN_A });
  for (const dict of [[], null, undefined, 'not-an-array']) {
    const { items, updatedCount } = syncItemsWithDictionary([item], dict, { now: NOW });
    assert.equal(updatedCount, 0);
    assert.equal(items[0], item);
  }
  assert.deepEqual(syncItemsWithDictionary(null, [entry()]).items, []);
});

test('JANは全角・ハイフン入りでも同じものとして照合する', () => {
  const fullWidth = JAN_A.replace(/\d/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0));
  const item = createItem({ name: '旧名', jan: `${fullWidth.slice(0, 4)}-${fullWidth.slice(4)}` });
  const { items, updatedCount } = syncItemsWithDictionary([item], [entry()], { now: NOW });
  assert.equal(updatedCount, 1);
  assert.equal(items[0].name, entry().name);
  // JANそのものは書き換えない（登録時の値をそのまま残す）
  assert.equal(items[0].jan, item.jan);
});

test('同じJANを複数のフォルダに持っていても、それぞれの数量・フォルダを保ったまま揃う', () => {
  const home = createItem({ id: 'h', name: '旧名', jan: JAN_A, folderId: 'home', qty: 1 });
  const atelier = createItem({ id: 't', name: '旧名', jan: JAN_A, folderId: 'atelier', qty: 5 });
  const { items, updatedCount } = syncItemsWithDictionary([home, atelier], [entry()], { now: NOW });
  assert.equal(updatedCount, 2);
  assert.equal(items[0].name, entry().name);
  assert.equal(items[1].name, entry().name);
  assert.equal(items[0].folderId, 'home');
  assert.equal(items[1].folderId, 'atelier');
  assert.equal(items[0].qty, 1);
  assert.equal(items[1].qty, 5);
});

test('同じJANの辞書が複数あれば先頭を使う', () => {
  const first = entry({ name: '先頭の名前' });
  const second = entry({ name: 'あとの名前' });
  const item = createItem({ name: '旧名', jan: JAN_A });
  const { items } = syncItemsWithDictionary([item], [first, second], { now: NOW });
  assert.equal(items[0].name, '先頭の名前');
});

test('表記の更新対象は文字の項目だけ（数量・写真などの項目名が混ざっていない）', () => {
  const fields = DICT_SYNC_FIELDS.map((f) => f.item);
  assert.deepEqual(fields, ['name', 'maker', 'brand', 'category', 'series', 'colorName', 'colorCode', 'size']);
  for (const forbidden of [
    'id', 'folderId', 'qty', 'count', 'minCount', 'status', 'favorite', 'memo',
    'price', 'purchaseHistory', 'purchaseLog', 'photo', 'imageUrl', 'createdAt',
  ]) {
    assert.equal(fields.includes(forbidden), false, `${forbidden} は同期しない`);
  }
});

test('通知と確認の文言', () => {
  assert.equal(describeSyncItemsResult(3), '3件の表記を最新辞書に揃えました');
  assert.equal(describeSyncItemsResult(1), '1件の表記を最新辞書に揃えました');
  assert.equal(describeSyncItemsResult(0), 'すべて最新の表記です');
  assert.equal(describeSyncItemsResult(-2), 'すべて最新の表記です');
  assert.equal(describeSyncItemsResult('4'), '4件の表記を最新辞書に揃えました');
  assert.match(SYNC_ITEMS_CONFIRM_TEXT, /数量・メモ・フォルダ・写真はそのまま残ります/);
  assert.match(SYNC_ITEMS_CONFIRM_TEXT, /JANが一致する画材/);
});

test('内蔵辞書（実データ）でも、登録済みの古い表記が最新の辞書の表記に揃う', () => {
  const real = JAN_DICTIONARY[0];
  const item = createItem({
    name: 'むかしの名前', maker: '', category: 'other', jan: real.jan, qty: 3, memo: '残す',
  });
  const { items, updatedCount } = syncItemsWithDictionary([item], JAN_DICTIONARY, { now: NOW });
  assert.equal(updatedCount, 1);
  assert.equal(items[0].name, real.name || real.colorName);
  assert.equal(items[0].maker, real.maker);
  assert.equal(items[0].qty, 3);
  assert.equal(items[0].memo, '残す');
  // もう一度かけても変わらない（何度押しても安全）
  const again = syncItemsWithDictionary(items, JAN_DICTIONARY, { now: NOW });
  assert.equal(again.updatedCount, 0);
});

test('設定タブのJAN辞書カードに「画材名を最新にする」ボタンと補足がある', () => {
  const html = read('index.html');
  const app = read('app.js');
  const settings = html.slice(html.indexOf('id="view-settings"'), html.indexOf('id="btnWipe"'));
  assert.match(settings, /id="btnSyncItems">画材名を最新にする</);
  assert.match(settings, /id="dictSyncNote">※ 数量やメモは消えません</);
  // ボタンのすぐ下に補足（辞書の件数の下ではなく、ボタンの後ろ）
  const btn = settings.indexOf('id="btnSyncItems"');
  const note = settings.indexOf('id="dictSyncNote"');
  assert.ok(btn > 0 && note > btn, '補足はボタンのすぐ下に置く');
  // カードの並び（サンプル → JAN辞書 → 使い方）を崩さない
  const sample = settings.indexOf('id="sampleCard"');
  const dict = settings.indexOf('id="dictInfo"');
  const guide = settings.indexOf('id="guideCard"');
  assert.ok(sample < dict && dict < guide, 'JAN辞書カードの位置が変わっている');

  // 押すと確認 → 保存 → 描き直し → 結果の通知、の順に動く
  const fn = app.slice(app.indexOf('function syncItemNamesWithDictionary'));
  assert.match(fn, /syncItemsWithDictionary\(state\.items, mergedDict\)/);
  assert.match(fn, /confirm\(SYNC_ITEMS_CONFIRM_TEXT\)/);
  assert.match(fn, /save\(\);/);
  assert.match(fn, /render\(\);/);
  assert.match(fn, /toast\(describeSyncItemsResult\(/);
  // 0件のときは確認を出さずに「すべて最新」と伝える
  assert.match(fn, /updatedCount\) \{\s*toast\(describeSyncItemsResult\(0\)\);\s*return;/);
  assert.match(app, /\$\('btnSyncItems'\)\.addEventListener\('click', syncItemNamesWithDictionary\)/);
});
