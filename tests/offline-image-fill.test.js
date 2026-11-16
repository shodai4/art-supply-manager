/**
 * オフラインで登録した画材の、オンライン復帰時の商品画像の後補完。
 *
 *   1) 対象は「JANがあり、画像URLも手元写真も無い画材」だけ
 *   2) 1まとまりの上限と、続けて問い合わせない間隔がある
 *   3) 起動時と online 復帰時に走る（オフライン中・実行中は走らない）
 *   4) 取得中にユーザーが画像・写真を設定していたら上書きしない（applyFetchedImage）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pendingAutoImages, shouldRunAutoFill, needsAutoImage, applyFetchedImage, autoImageJan,
  AUTO_IMAGE_FILL_LIMIT, AUTO_IMAGE_FILL_GAP_MS, AUTO_IMAGE_FILL_ROUNDS,
} from '../auto-image.js';
import { createItem, blankState } from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const JAN1 = '4900669001072';
const JAN2 = '4900669001911';
const IMG = 'https://item-shopping.c.yimg.jp/i/j/arcoasis2_4900669001072x3';

test('後補完の対象は、JANがあり画像も写真も無い画材だけ', () => {
  const bare = createItem({ name: '絵具', jan: JAN1 });
  const withImage = createItem({ name: '絵具2', jan: JAN2, imageUrl: IMG });
  const withPhoto = createItem({ name: '絵具3', jan: JAN2 });
  const noJan = createItem({ name: '筆' });
  const photos = new Map([[withPhoto.id, {}]]);
  const targets = pendingAutoImages([bare, withImage, withPhoto, noJan], { photoIds: photos });
  assert.deepEqual(targets, [{ id: bare.id, jan: JAN1 }]);
  assert.equal(needsAutoImage(bare), true);
});

test('同じJANは1回だけ・1まとまりの件数に上限がある', () => {
  assert.equal(AUTO_IMAGE_FILL_LIMIT, 8);
  assert.equal(AUTO_IMAGE_FILL_ROUNDS, 3);
  assert.ok(AUTO_IMAGE_FILL_GAP_MS >= 1000, '連続リクエストを避ける間隔（1秒以上）');
  // 同じ商品が複数登録されていても、問い合わせは1回
  const items = [createItem({ name: 'a', jan: JAN1 }), createItem({ name: 'b', jan: JAN1 })];
  assert.equal(pendingAutoImages(items).length, 1);
  // 上限より多くても、まとめては問い合わせない
  const many = Array.from({ length: 20 }, (_, i) => createItem({ name: `x${i}`, jan: `49006690010${String(10 + i).padStart(2, '0')}` }));
  assert.equal(pendingAutoImages(many).length, AUTO_IMAGE_FILL_LIMIT);
  assert.equal(pendingAutoImages(many, { limit: 2 }).length, 2);
  assert.equal(pendingAutoImages(many, { limit: 0 }).length, 0);
  assert.deepEqual(pendingAutoImages(null), []);
});

test('オフライン・実行中・対象なしでは始めない', () => {
  assert.equal(shouldRunAutoFill({ online: true, running: false, count: 2 }), true);
  assert.equal(shouldRunAutoFill({ online: false, running: false, count: 2 }), false);
  assert.equal(shouldRunAutoFill({ online: true, running: true, count: 2 }), false);
  assert.equal(shouldRunAutoFill({ online: true, running: false, count: 0 }), false);
  assert.equal(shouldRunAutoFill(), false);
});

test('取得中に画像・写真・JANが変わっていたら入れない（上書きしない）', () => {
  const item = createItem({ name: '絵具', jan: JAN1 });
  const state = { ...blankState(), items: [item] };
  // 入る
  const ok = applyFetchedImage(state, { itemId: item.id, jan: JAN1, imageUrl: IMG });
  assert.equal(ok.changed, true);
  assert.equal(ok.state.items[0].imageUrl, IMG);
  // 写真が付いていた
  const photo = new Map([[item.id, {}]]);
  assert.equal(applyFetchedImage(state, { itemId: item.id, jan: JAN1, imageUrl: IMG, photoIds: photo }).changed, false);
  // すでに画像がある
  const filled = { ...state, items: [{ ...item, imageUrl: IMG }] };
  assert.equal(applyFetchedImage(filled, { itemId: item.id, jan: JAN1, imageUrl: IMG }).changed, false);
  // JANが違う（別商品の画像を入れない）
  assert.equal(applyFetchedImage(state, { itemId: item.id, jan: JAN2, imageUrl: IMG }).changed, false);
  assert.equal(autoImageJan(JAN1), JAN1);
});

test('アプリは起動時とオンライン復帰時に、静かに後補完する', () => {
  const app = read('app.js');
  // 起動時（写真を読み込めたあと）
  assert.match(app, /preloadPhotos\(\)\.then\(\(ok\) => \{[\s\S]{0,200}fillMissingImages\(\);/);
  // online 復帰
  assert.match(app, /window\.addEventListener\('online', \(\) => \{ fillMissingImages\(\); \}\)/);
  // 実装（ガード・間隔・まとまり・上書きしない）
  const fn = app.slice(app.indexOf('async function fillMissingImages'), app.indexOf('/** 読み込み後、存在しない画材の写真を端末内から片付ける */'));
  assert.ok(fn.length > 200, 'fillMissingImages が見つかりません');
  assert.match(fn, /if \(!photosReady\) return 0;/, '写真の所在が分かるまで触らない');
  assert.match(fn, /shouldRunAutoFill\(\{ online: isOnline\(\), running: imageFillRunning, count: first\.length \}\)/);
  assert.match(fn, /pendingAutoImages\(state\.items, \{ photoIds: photoUrls \}\)/);
  assert.match(fn, /await wait\(AUTO_IMAGE_FILL_GAP_MS\)/, '間隔をあける');
  assert.match(fn, /fetchAutoImage\(t\.jan/);
  assert.match(fn, /applyFetchedImage\(state, \{[\s\S]{0,160}photoIds: photoUrls/, '写真・既存画像は上書きしない');
  // 失敗は静かに（画面にエラーを出さない）
  assert.equal(/toast\(err|throw new Error/.test(fn), false);
  // 補えたときだけ知らせる
  assert.match(fn, /if \(filled\) \{[\s\S]{0,120}toast\(/);
});

test('後補完用のファイルは配信・ビルド・キャッシュに入っている', () => {
  const sw = read('sw.js');
  const build = read('scripts/build.mjs');
  assert.match(sw, /'\.\/auto-image\.js'/);
  assert.match(build, /'auto-image\.js'/);
});
