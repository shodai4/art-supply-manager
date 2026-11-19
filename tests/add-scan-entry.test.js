/**
 * 「＋」の「画材を追加」シートに、バーコード読取の項目を足した（v1.41.0）。
 *
 * 見たいこと:
 *   1. シートの最上段に「バーコードで読み取る」があり、既存の2択と同じ文字だけのボタン
 *   2. 押すとシートを閉じてから、右下の読取ボタンと同じ処理（beginScan）でカメラが開く
 *   3. チュートリアル（stock-3）の説明が3択に合っている
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TUTORIAL_TABS } from '../tutorial.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const html = read('index.html');
const app = read('app.js');
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

const sheet = html.slice(html.indexOf('id="sheetAdd"'), html.indexOf('id="sheetMore"'));
const listStart = sheet.indexOf('<div class="menulist">');
const list = sheet.slice(listStart, sheet.indexOf('</div>', listStart));

test('「画材を追加」シートの最上段に「バーコードで読み取る」がある（3択・上から順に）', () => {
  const labels = [...list.matchAll(/<button type="button" class="menubtn" id="(btnAdd\w+)">([^<]*)<\/button>/g)]
    .map((m) => [m[1], m[2]]);
  assert.deepEqual(labels, [
    ['btnAddScan', 'バーコードで読み取る'],
    ['btnAddCatalog', 'カタログから選ぶ'],
    ['btnAddManual', '自分で入力'],
  ]);
  // 追加の1行だけ（アイコン・補足は足さない。既存2択と同じ、文字だけのボタン）
  assert.equal(/<svg|<small/.test(list), false, 'バーコードの項目にアイコン・補足が付いている');
  assert.equal(EMOJI.test(list), false, '追加メニューに絵文字がある');
  // シートの見出し・閉じるはこれまでどおり
  assert.match(sheet, /<h2 id="addTitle">画材を追加/);
  assert.match(sheet, /data-close="sheetAdd"/);
});

test('押すと「画材を追加」シートを閉じて、右下の読取ボタンと同じ処理でカメラを開く', () => {
  const handler = /\$\('btnAddScan'\)\.addEventListener\('click', \(\) => \{([\s\S]{0,300}?)\n\}\);/.exec(app);
  assert.ok(handler, 'バーコードの項目に、押したときの処理がない');
  const body = handler[1];
  assert.match(body, /closeSheet\('sheetAdd'\);/);
  assert.match(body, /beginScan\(\);/);
  assert.ok(
    body.indexOf("closeSheet('sheetAdd')") < body.indexOf('beginScan()'),
    'シートを閉じる前にカメラを開いている',
  );

  // 右下の読取ボタンと同じ beginScan を通る（置き場所＝いま見ているフォルダの決め方も同じ）
  assert.match(app, /\$\('btnScan'\)\.addEventListener\('click', beginScan\);/);
  const begin = /function beginScan\(\) \{([\s\S]*?)\n\}/.exec(app);
  assert.ok(begin, 'beginScan（読取の共通処理）がない');
  for (const step of [
    /openSheet\('sheetScan'\)/, /resetScanSession\(scanSession\)/, /clearScanLog\(\)/,
    /renderScanMode\(\)/, /startScanner\(\)/,
  ]) {
    assert.match(begin[1], step, '読取の共通処理に、これまでの手順が抜けている');
  }
  // シートを移るときは、前のシートを閉じてから次を開く（背景の暗幕が残らない）
  assert.match(app, /function closeSheet\(id\) \{[\s\S]{0,220}openSheets\.delete\(id\);/);
});

test('チュートリアル（stock-3）の説明が3択に合っている', () => {
  const slide = TUTORIAL_TABS.find((tab) => tab.id === 'stock').slides.find((s) => /stock-3\.webp$/.test(s.image));
  assert.ok(slide, 'stock-3 のスライドがない');
  for (const label of ['バーコードで読み取る', 'カタログから選ぶ', '自分で入力']) {
    assert.ok(slide.caption.includes(label), `説明文に「${label}」がない: ${slide.caption}`);
    assert.ok(slide.alt.includes(label), `alt に「${label}」がない: ${slide.alt}`);
  }
  assert.equal(/2択/.test(slide.caption + slide.alt), false, '2択のままになっている');
  assert.ok(slide.caption.length <= 60, `説明が長い（${slide.caption.length}文字）`);
});
