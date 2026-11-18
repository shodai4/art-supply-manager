/**
 * 確定申告向けの画材費レポート（月別・メーカー別・年間サマリ・CSV）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createItem, costReport, buildCostReportCsv, buildShoppingListText, CSV_BOM } from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function item(over = {}) {
  return createItem({
    name: 'ウルトラマリン', maker: 'ホルベイン', folderId: 'home', qty: 2, price: 500,
    ...over,
  });
}

const ITEMS = [
  item({
    id: 'a', createdAt: '2025-12-20T00:00:00.000Z',
    purchaseLog: [
      { at: '2025-12-20T00:00:00.000Z', qty: 2, amount: 1000 },
      { at: '2026-01-10T00:00:00.000Z', qty: 1, amount: 500 },
      { at: '2026-03-05T00:00:00.000Z', qty: 2, amount: 1000 },
    ],
  }),
  item({
    id: 'b', name: 'ジェッソ', maker: 'ターレンス', price: 800,
    purchaseLog: [{ at: '2026-03-20T00:00:00.000Z', qty: 1, amount: 800 }],
  }),
  { ...item({ id: 'c', name: '単価なし' }), price: null },
];

test('今年の購入を月別・メーカー別に集め、年間サマリを出す', () => {
  const report = costReport(ITEMS, { year: 2026 });
  assert.equal(report.year, 2026);
  assert.equal(report.total, 500 + 1000 + 800);
  assert.equal(report.count, 3);
  assert.equal(report.months[0].value, 500);   // 1月
  assert.equal(report.months[2].value, 1800);  // 3月
  assert.equal(report.months[11].value, 0);    // 12月
  assert.deepEqual(report.byMaker.map((m) => m.maker), ['ホルベイン', 'ターレンス']);
  assert.equal(report.byMaker[0].value, 1500);
  assert.equal(report.byMaker[0].count, 2);
  // 単価が入っていない画材は金額に数えず、件数だけ知らせる
  assert.equal(report.unpriced, 1);
  // 明細は新しい順で、日付・メーカー・商品名を持つ
  assert.equal(report.purchases.length, 3);
  assert.equal(report.purchases[0].date, '2026-03-20');
  assert.equal(report.purchases[0].maker, 'ターレンス');
});

test('年を変えると、その年の購入だけを集める', () => {
  const y2025 = costReport(ITEMS, { year: 2025 });
  assert.equal(y2025.total, 1000);
  assert.equal(y2025.count, 1);
  assert.equal(y2025.months[11].value, 1000);
});

test('確定申告CSVは、サマリ・月別・メーカー別・明細を1枚にまとめる（BOM付き）', () => {
  const csv = buildCostReportCsv(ITEMS, { year: 2026 });
  assert.ok(csv.startsWith(CSV_BOM));
  assert.match(csv, /アトリコ 画材費レポート,2026年/);
  assert.match(csv, /年間購入額,2300,件数,3/);
  assert.match(csv, /単価未入力の画材,1点（金額に含みません）/);
  assert.match(csv, /月別,金額,件数/);
  assert.match(csv, /3月,1800,2/);
  assert.match(csv, /メーカー別,金額,件数/);
  assert.match(csv, /ホルベイン,1500,2/);
  assert.match(csv, /購入明細,日付,メーカー,商品名,カテゴリ,数量,金額/);
  assert.match(csv, /,2026-03-20,ターレンス,ジェッソ,/);
  // Excel向けに CRLF
  assert.ok(csv.includes('\r\n'));
});

test('買い物リストの文面は、補充が必要なものだけを買い物中に読める形にする', () => {
  const items = [
    item({ id: 'x', name: 'ウルトラマリン', colorName: 'ウルトラマリン', size: '20ml', qty: 0, status: 'empty' }),
    item({ id: 'y', name: 'ジェッソ', colorName: '白', size: '300ml', qty: 1, status: 'low' }),
    item({ id: 'z', name: '十分ある', qty: 5, status: 'enough' }),
  ];
  const text = buildShoppingListText(items, { now: new Date('2026-11-19T10:00:00+09:00') });
  assert.match(text, /^買い物リスト（11月19日）/);
  assert.match(text, /・ウルトラマリン（20ml）/);
  assert.match(text, /・ジェッソ 白（300ml）（補充）/);
  assert.equal(/十分ある/.test(text), false);
  // 0件でも文面は作れる
  assert.match(buildShoppingListText([item({ qty: 9, status: 'enough' })]), /補充が必要な画材はありません/);
});

test('画面: 画材費に月別タブ・年間サマリ・確定申告CSVがあり、補充にコピーと共有がある', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.match(html, /data-costkey="month"[^>]*>月別</);
  assert.match(html, /id="costYear"/);
  assert.match(html, /id="btnTaxCsv">確定申告CSV</);
  assert.match(html, /id="btnShopCopy">コピー</);
  assert.match(html, /id="btnShopShare">共有</);
  assert.match(app, /buildCostReportCsv\(state\.items, \{ year \}\)/);
  assert.match(app, /requirePro\('taxreport'\)/);
  assert.match(app, /requirePro\('shopping'\)/);
  assert.match(app, /sharePlainText\(\{ text, title: '買い物リスト' \}\)/);
});
