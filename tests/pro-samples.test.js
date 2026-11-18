/**
 * Pro特典「自分で撮った写真・色見本の添付」。
 *
 *   - 1つの画材に複数（最大6枚）・端末内（IndexedDB）に保存し、追加・表示・削除できる
 *   - 無料では Pro の案内を出し、写真は付けさせない（見るだけ）
 *   - iCloud・JSONバックアップには載せない（容量）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_SAMPLES, sampleId, sampleRoom, SAMPLE_STORE, IMAGE_DB_VERSION } from '../images.js';
import { PRO_FEATURES, canUseFeature } from '../pro.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('1つの画材に6枚まで。残りの枚数を数えられる', () => {
  assert.equal(MAX_SAMPLES, 6);
  assert.equal(sampleRoom(0), 6);
  assert.equal(sampleRoom(2), 4);
  assert.equal(sampleRoom(6), 0);
  assert.equal(sampleRoom(9), 0);
  assert.equal(sampleRoom(-1), 6);
});

test('写真のIDは同じミリ秒でも重ならない', () => {
  const at = 1763490000000;
  const ids = new Set(Array.from({ length: 50 }, () => sampleId(at)));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^p[0-9a-z]+$/);
});

test('写真は専用の保存場所（IndexedDB）を使い、写真メモとは別に持つ', () => {
  assert.equal(SAMPLE_STORE, 'samples');
  assert.equal(IMAGE_DB_VERSION, 2, '保存場所を増やすときに版を上げていない');
  const images = read('images.js');
  assert.match(images, /export async function putSample\(/);
  assert.match(images, /export function listSamples\(/);
  assert.match(images, /export function deleteSample\(/);
  assert.match(images, /export function deleteSamplesOf\(/);
  assert.match(images, /createIndex\('itemId', 'itemId'/);
  // 画材を消したら、その画材の写真も消す（見えない写真を溜めない）
  assert.match(read('app.js'), /await deleteSamplesOf\(id\);/);
});

test('Proだけが写真を追加できる（無料は案内・見るだけ）', () => {
  assert.equal(PRO_FEATURES.includes('samples'), true);
  assert.equal(canUseFeature({}, 'samples'), false);
  assert.equal(canUseFeature({ pro: true }, 'samples'), true);
  assert.equal(canUseFeature({ proPreview: true }, 'samples'), true);
  const app = read('app.js');
  assert.match(app, /if \(!isPro\(state\.settings\)\) \{ openProSheet\('samples'\); return; \}/);
  assert.match(app, /\$\('btnSamplePick'\)\.hidden = !pro \|\| !ui\.editingId;/);
  assert.match(app, /\$\('btnSamplePro'\)\.hidden = pro;/);
});

test('画面: 編集シートに色見本・参考写真の欄があり、保存前は付けられないことを伝える', () => {
  const html = read('index.html');
  const app = read('app.js');
  assert.match(html, /id="sampleField"/);
  assert.match(html, /id="fSample" accept="image\/\*" class="sr"/);
  assert.match(html, /id="sampleGrid"/);
  assert.match(html, /端末内に保存/);
  assert.match(app, /loadFormSamples\(it \? it\.id : ''\);/);
  assert.match(app, /'保存すると、この画材に写真を付けられます'/);
  // 追加は圧縮してから（容量を食いすぎない）
  assert.match(app, /compressImageFile\(file, \{ maxEdge: 480, quality: 0\.75 \}\)/);
  // 削除は確認してから
  assert.match(app, /confirm\('この写真を削除しますか？'\)/);
});
