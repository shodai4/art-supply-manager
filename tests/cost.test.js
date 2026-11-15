import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createItem, adjustStock, recordPurchase, purchaseTotalOf, stockValueOf, unitPrice, hasPrice,
  costSummary, costRows, csvEscape, toCsv, buildItemsCsvText, itemCsvRow,
  CSV_COLUMNS, CSV_BOM, mergeStates, blankState, exportState, importState, upsertItem,
  MAX_PURCHASE_LOG, DEFAULT_FOLDERS, localDate,
} from '../core.js';

const priced = (n = 1) => createItem({ name: 'シルバー', maker: 'ホルベイン', category: 'oil', colorName: 'シルバー', qty: n, price: 1200 });

test('単価は0円も入力済みとして扱い、未入力は null', () => {
  assert.equal(hasPrice({ price: 0 }), true);
  assert.equal(hasPrice({ price: 1200 }), true);
  assert.equal(hasPrice({ price: null }), false);
  assert.equal(hasPrice({ price: '' }), false);
  assert.equal(hasPrice({}), false);
  assert.equal(unitPrice({ price: '1200.4' }), 1200);
  assert.equal(unitPrice({ price: -5 }), null);
  assert.equal(unitPrice({ price: 'abc' }), null);
  assert.equal(createItem({ name: 'x', price: '' }).price, null);
});

test('在庫価値は 単価 × 在庫数（使った分だけ減る）', () => {
  assert.equal(stockValueOf(priced(3)), 3600);
  assert.equal(stockValueOf(createItem({ name: 'x', qty: 3 })), 0);
  assert.equal(stockValueOf({ price: 500, qty: 0 }), 0);
});

test('買い足すと購入ログが積まれ、記録済み合計は減らない', () => {
  let it = createItem({ name: 'シルバー', qty: 1, price: 1200 });
  assert.deepEqual(it.purchaseLog, []);
  assert.equal(purchaseTotalOf(it), 1200); // ログが無い間は在庫ぶんを購入額とみなす

  it = recordPurchase(it, 1);
  // 最初の在庫ぶんを種にしてから、買い足しを追記する（合計2400）
  assert.equal(it.purchaseLog.length, 2);
  assert.deepEqual(it.purchaseLog.map((e) => e.amount), [1200, 1200]);
  assert.equal(purchaseTotalOf(it), 2400);

  it = adjustStock(it, 1);
  assert.equal(it.qty, 2);
  assert.equal(stockValueOf(it), 2400);

  // 使うと在庫価値だけが減り、記録済みはそのまま
  it = adjustStock(it, -2);
  assert.equal(it.qty, 0);
  assert.equal(stockValueOf(it), 0);
  assert.equal(purchaseTotalOf(it), 2400);

  // 減らす操作はログを増やさない
  assert.equal(recordPurchase(it, -1).purchaseLog.length, 2);
  // 単価なしは記録しない
  assert.deepEqual(recordPurchase(createItem({ name: 'x', qty: 2 }), 1).purchaseLog, []);
});

test('購入ログは200件までで、古いものから落とす', () => {
  let it = createItem({ name: 'x', qty: 1, price: 100 });
  for (let i = 0; i < MAX_PURCHASE_LOG + 20; i += 1) it = recordPurchase(it, 1);
  assert.equal(it.purchaseLog.length, MAX_PURCHASE_LOG);
  assert.ok(it.purchaseLog.every((e) => e.amount === 100 && e.qty === 1));
  // 読み込み時も安全な形へ整える（壊れた行は捨てる）
  const fixed = createItem({ name: 'y', purchaseLog: [{ amount: '100', qty: '2', at: 'x' }, null, { foo: 1 }] });
  assert.deepEqual(fixed.purchaseLog, [{ at: 'x', qty: 2, amount: 100 }]);
});

test('画材費の2軸集計（在庫価値と記録済み合計）', () => {
  const items = [
    createItem({ name: 'A', maker: 'ホルベイン', category: 'oil', qty: 2, price: 1000 }), // 2000
    createItem({ name: 'B', maker: 'ホルベイン', category: 'oil', qty: 1, price: 500 }),  // 500
    // 使い切った画材も、購入ログがあれば「記録済み」に残る（在庫価値は0）
    createItem({ name: 'C', maker: 'ターナー', category: 'acrylic', qty: 0, price: 800, purchaseLog: [{ at: '2026-11-01', qty: 1, amount: 800 }] }),
    createItem({ name: 'D', maker: 'ターナー', category: 'brush', qty: 3 }),               // 単価なし
  ];
  const cost = costSummary(items);
  assert.equal(cost.kinds, 4);
  assert.equal(cost.qty, 6);
  assert.equal(cost.pricedCount, 3);
  assert.equal(cost.unpricedCount, 1);
  assert.equal(cost.stockValue, 2500);
  assert.equal(cost.recordedTotal, 3300); // 使い切ったCも「記録済み」には残る

  assert.deepEqual(cost.byCategory.map((r) => [r.label, r.value]), [['油絵具', 2500], ['アクリル', 800]]);
  assert.deepEqual(cost.byMaker.map((r) => [r.label, r.value]), [['ホルベイン', 2500], ['ターナー', 800]]);
  // 単価なしの筆は内訳に出ない
  assert.equal(cost.byCategory.some((r) => r.label === '筆/ナイフ'), false);

  // 買い足したあとも2軸が別々に動く
  let withPurchase = upsertItem(
    { ...blankState() },
    adjustStock(recordPurchase(createItem({ name: 'E', maker: 'クサカベ', category: 'oil', qty: 1, price: 900 }), 2), 2),
  );
  const after = costSummary(withPurchase.items);
  assert.equal(after.stockValue, 2700);
  assert.equal(after.recordedTotal, 2700); // 初回900＋買い足し1800
});

test('集計はデータが空・単価なしでも壊れない', () => {
  const empty = costSummary([]);
  assert.deepEqual(
    [empty.kinds, empty.qty, empty.pricedCount, empty.unpricedCount, empty.stockValue, empty.recordedTotal],
    [0, 0, 0, 0, 0, 0],
  );
  assert.deepEqual(empty.byCategory, []);
  assert.deepEqual(costSummary(undefined).byMaker, []);
  const noPrice = costSummary([createItem({ name: 'x', qty: 2 })]);
  assert.equal(noPrice.pricedCount, 0);
  assert.equal(noPrice.stockValue, 0);
});

test('内訳は上位6件に絞り、残りは「ほか」にまとめる', () => {
  const list = Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, label: `L${i}`, value: (9 - i) * 100, count: 1 }));
  const { rows, rest } = costRows(list, 6);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].label, 'L0');
  assert.deepEqual(rest, { value: 300 + 200 + 100, count: 3 });
  assert.equal(costRows(list.slice(0, 2), 6).rest, null);
  assert.deepEqual(costRows([], 6), { rows: [], rest: null });
});

test('CSVのエスケープ（カンマ・引用符・改行）', () => {
  assert.equal(csvEscape('シルバー'), 'シルバー');
  assert.equal(csvEscape('ホルベイン, 6号'), '"ホルベイン, 6号"');
  assert.equal(csvEscape('6号(20ml)'), '6号(20ml)');
  assert.equal(csvEscape('ダブル"コート"'), '"ダブル""コート"""');
  assert.equal(csvEscape('1行目\n2行目'), '"1行目\n2行目"');
  assert.equal(csvEscape(null), '');
  assert.equal(csvEscape(undefined), '');
  assert.equal(csvEscape(0), '0');
  assert.equal(csvEscape('=SUM(A1)'), '=SUM(A1)');
});

test('CSV本文はBOM付きUTF-8・CRLFで、列は13個そろっている', () => {
  const item = createItem({
    name: 'ホルベイン 油絵具 シルバー, 6号', maker: 'ホルベイン', brand: 'HOLBEIN', category: 'oil',
    colorName: 'シルバー', colorCode: 'H191', jan: '4900669001911', folderId: 'atelier',
    qty: 2, price: 1200, status: 'low', updatedAt: new Date(2026, 10, 15, 20, 12).toISOString(),
  });
  const text = buildItemsCsvText([item], DEFAULT_FOLDERS);
  assert.equal(text.startsWith(CSV_BOM), true);
  assert.equal(text.slice(1).startsWith(CSV_COLUMNS.join(',')), true);
  assert.equal(text.includes('\r\n'), true);
  assert.equal(text.endsWith('\r\n'), true);
  const lines = text.slice(1).trimEnd().split('\r\n');
  assert.equal(lines.length, 2);
  assert.equal(CSV_COLUMNS.length, 13);

  const row = itemCsvRow(item, DEFAULT_FOLDERS);
  assert.equal(row.length, 13);
  assert.deepEqual(row, [
    'ホルベイン 油絵具 シルバー, 6号', 'ホルベイン', 'HOLBEIN', '油絵具', 'シルバー', 'H191',
    '4900669001911', 'アトリエ', '残りわずか', 2, 1200, 2400, '2026-11-15',
  ]);
  // 名前のカンマは引用符で囲まれる（列がずれない）
  assert.equal(lines[1].includes('"ホルベイン 油絵具 シルバー, 6号"'), true);
});

test('CSVの更新日は端末のタイムゾーンで出す（UTCの日付にしない）', () => {
  // ローカル時刻 2026-11-15 23:30（UTCでは翌日になりうる時間）
  assert.equal(localDate(new Date(2026, 10, 15, 23, 30).toISOString()), '2026-11-15');
  assert.equal(localDate(new Date(2026, 0, 1, 0, 5).toISOString()), '2026-01-01');
  assert.equal(localDate(''), '');
  assert.equal(localDate('not-a-date'), '');
  assert.equal(localDate(null), '');
});

test('CSVは単価なし・フォルダ不明でも空欄で出る', () => {
  const item = createItem({ name: '名もなき筆', folderId: 'gone' });
  const row = itemCsvRow(item, DEFAULT_FOLDERS);
  assert.equal(row[7], '');
  assert.equal(row[10], '');
  assert.equal(row[11], 0);
  const text = buildItemsCsvText([], DEFAULT_FOLDERS);
  assert.equal(text, `${CSV_BOM}${CSV_COLUMNS.join(',')}\r\n`);
});

test('バックアップの「まとめる」は、どちらのデータも消さない', () => {
  const mine = createItem({ name: 'いまの画材', jan: '4900669001997', folderId: 'home' });
  const sameId = { ...mine, name: 'あとで直した名前', updatedAt: '2027-01-01T00:00:00.000Z' };
  const older = { ...mine, name: '古い名前', updatedAt: '2000-01-01T00:00:00.000Z' };
  const other = createItem({ name: 'バックアップ側', folderId: 'atelier' });
  const missingFolder = createItem({ name: '無いフォルダ', folderId: 'zzz' });

  const current = { ...blankState(), items: [mine] };
  const incoming = { ...blankState(), items: [other, sameId, missingFolder] };
  const merged = mergeStates(current, incoming);

  assert.equal(merged.items.length, 3);
  assert.equal(merged.items.find((i) => i.id === mine.id).name, 'あとで直した名前'); // 新しいほうを残す
  assert.equal(merged.items.some((i) => i.name === 'バックアップ側'), true);
  assert.equal(merged.items.find((i) => i.name === '無いフォルダ').folderId, merged.folders[0].id);
  assert.deepEqual(merged.mergeStats, { added: 2, updated: 1, foldersAdded: 0 });

  // 古いほうが来たら上書きしない
  const merged2 = mergeStates(current, { ...blankState(), items: [older] });
  assert.equal(merged2.items[0].name, 'いまの画材');
  assert.deepEqual(merged2.mergeStats, { added: 0, updated: 0, foldersAdded: 0 });

  // フォルダは足りないIDだけ増える
  const withFolder = mergeStates(current, {
    ...blankState(),
    folders: [...DEFAULT_FOLDERS, { id: 'studio2', name: '第2アトリエ', color: '#123456' }],
    items: [],
  });
  assert.equal(withFolder.folders.length, 5);
  assert.deepEqual(withFolder.mergeStats, { added: 0, updated: 0, foldersAdded: 1 });

  // 壊れた入力でも既存データを失わない
  const safe = mergeStates(current, {});
  assert.equal(safe.items.length, 1);
  assert.equal(safe.folders.length, 4);
});

test('バックアップの往復で更新日時も保たれ、同じ内容なら「まとめる」で何も変わらない', () => {
  const item = createItem({
    name: 'シルバー', qty: 2, price: 1200, colorName: 'シルバー',
    updatedAt: '2026-11-10T01:02:03.000Z', createdAt: '2026-11-01T00:00:00.000Z',
  });
  const state = upsertItem(blankState(), item);
  const back = importState(exportState(state));
  assert.equal(back.items[0].updatedAt, '2026-11-10T01:02:03.000Z');
  assert.equal(back.items[0].createdAt, '2026-11-01T00:00:00.000Z');
  const merged = mergeStates(state, back);
  assert.equal(merged.items.length, 1);
  assert.deepEqual(merged.mergeStats, { added: 0, updated: 0, foldersAdded: 0 });
  assert.equal(merged.items[0].name, 'シルバー');

  // 編集（保存し直し）は、呼び出し側が新しい日時を渡して上書きする
  const edited = createItem({ ...item, name: 'シルバー(改)', updatedAt: new Date().toISOString() });
  assert.notEqual(edited.updatedAt, item.updatedAt);
  assert.equal(edited.createdAt, item.createdAt);
});

test('バックアップJSONの往復で購入ログと単価が保たれる', () => {
  const item = adjustStock(recordPurchase(createItem({ name: 'x', qty: 1, price: 500 }), 1), 1);
  const state = upsertItem(blankState(), item);
  const back = importState(exportState(state));
  assert.equal(back.items[0].price, 500);
  assert.equal(back.items[0].purchaseLog.length, 2);
  assert.equal(purchaseTotalOf(back.items[0]), 1000);
  // 旧バックアップ（purchaseLogなし）も読める
  const legacy = importState(JSON.stringify({ folders: [{ id: 'home', name: '家' }], items: [{ name: '旧', folderId: 'home', price: 300, qty: 2 }] }));
  assert.deepEqual(legacy.items[0].purchaseLog, []);
  assert.equal(purchaseTotalOf(legacy.items[0]), 600);
});
