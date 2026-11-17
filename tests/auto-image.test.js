import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  autoImageJan, hasLocalPhoto, needsAutoImage, applyFetchedImage, shouldApplyFormImage,
  fetchAutoImage, describeFetchedImage,
} from '../auto-image.js';
import { blankState, createItem } from '../core.js';
import { SAMPLE_SEEDS, sampleItems, backfillSampleImages } from '../samples.js';
import { DEFAULT_IMAGE_PROXY_URL, imageProxyUrl } from '../images.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const JAN_OIL = '4900669001072';
const IMG = 'https://item-shopping.c.yimg.jp/i/j/arcoasis2_4900669001072x3';

/* ---------------- 判定 ---------------- */

test('自動取得は13桁のJANがあるときだけ（数字以外・桁不足は対象外）', () => {
  assert.equal(autoImageJan('4900669001072'), JAN_OIL);
  assert.equal(autoImageJan('４９００６６９００１０７２'), JAN_OIL, '全角数字は寄せる');
  assert.equal(autoImageJan('12345'), '');
  assert.equal(autoImageJan(''), '');
  assert.equal(autoImageJan(undefined), '');
});

test('画像・写真がまだ無い画材だけが自動取得の対象', () => {
  const bare = createItem({ name: '絵具', jan: JAN_OIL });
  assert.equal(needsAutoImage(bare), true);
  // すでに画像URLがある
  assert.equal(needsAutoImage({ ...bare, imageUrl: IMG }), false);
  // 手元の写真（写真メモ）がある
  assert.equal(needsAutoImage(bare, { photoIds: new Map([[bare.id, {}]]) }), false);
  assert.equal(needsAutoImage(bare, { photoIds: [bare.id] }), false);
  assert.equal(needsAutoImage(bare, { photoIds: new Set() }), true);
  // JANが無い
  assert.equal(needsAutoImage(createItem({ name: '筆' })), false);
  assert.equal(needsAutoImage(null), false);
  // 写真の有無はIDで見る（他の画材の写真に引きずられない）
  assert.equal(needsAutoImage(bare, { photoIds: new Set(['other']) }), true);
  assert.equal(hasLocalPhoto(new Map([['x', 1]]), 'x'), true);
  assert.equal(hasLocalPhoto(undefined, 'x'), false);
});

/* ---------------- 反映（非同期の取り違えを防ぐ） ---------------- */

test('取得できた画像を、まだ空の画材へ入れる', () => {
  const item = createItem({ name: 'ウルトラマリン', jan: JAN_OIL, qty: 2 });
  const state = { ...blankState(), items: [item] };
  const out = applyFetchedImage(state, { itemId: item.id, jan: JAN_OIL, imageUrl: IMG });
  assert.equal(out.changed, true);
  assert.equal(out.reason, 'filled');
  assert.equal(out.state.items[0].imageUrl, IMG);
  // 他の項目・更新日時は動かさない（一覧の並びが勝手に変わらない）
  assert.equal(out.state.items[0].updatedAt, item.updatedAt);
  assert.equal(state.items[0].imageUrl, '', '元の state を書き換えない');
});

test('取得中に削除・JAN変更・画像設定・写真設定があったら上書きしない', () => {
  const item = createItem({ name: 'ウルトラマリン', jan: JAN_OIL });
  const state = { ...blankState(), items: [item] };

  // 削除された
  const gone = applyFetchedImage({ ...state, items: [] }, { itemId: item.id, jan: JAN_OIL, imageUrl: IMG });
  assert.equal(gone.changed, false);
  assert.equal(gone.reason, 'missing');

  // 別のJANへ書き換えた
  const other = applyFetchedImage({ ...state, items: [{ ...item, jan: '4900669000518' }] },
    { itemId: item.id, jan: JAN_OIL, imageUrl: IMG });
  assert.equal(other.changed, false);
  assert.equal(other.reason, 'jan_changed');

  // 自分で画像URLを入れた
  const own = applyFetchedImage({ ...state, items: [{ ...item, imageUrl: 'https://example.com/a.jpg' }] },
    { itemId: item.id, jan: JAN_OIL, imageUrl: IMG });
  assert.equal(own.changed, false);
  assert.equal(own.reason, 'has_image');
  assert.equal(own.state.items[0].imageUrl, 'https://example.com/a.jpg');

  // 自分で写真を撮った
  const photo = applyFetchedImage(state, { itemId: item.id, jan: JAN_OIL, imageUrl: IMG, photoIds: [item.id] });
  assert.equal(photo.changed, false);
  assert.equal(photo.reason, 'has_photo');
});

test('URLでない値・JAN違いの結果は捨てる（壊れた画像を入れない）', () => {
  const item = createItem({ name: 'ウルトラマリン', jan: JAN_OIL });
  const state = { ...blankState(), items: [item] };
  assert.equal(applyFetchedImage(state, { itemId: item.id, jan: JAN_OIL, imageUrl: '' }).reason, 'no_image');
  assert.equal(applyFetchedImage(state, { itemId: item.id, jan: JAN_OIL, imageUrl: 'item.jpg' }).reason, 'no_image');
  assert.equal(applyFetchedImage(state, { itemId: item.id, jan: '', imageUrl: IMG }).reason, 'no_jan');
});

/* ---------------- フォーム（編集シート）への反映 ---------------- */

test('フォームは、JANも画像も写真も変わっていないときだけ自動取得の結果を入れる', () => {
  const base = {
    requestJan: JAN_OIL, currentJan: JAN_OIL, currentImageUrl: '',
    hasPendingPhoto: false, hasSavedPhoto: false, token: 3, activeToken: 3,
  };
  assert.equal(shouldApplyFormImage(base), true);
  // JANを打ち替えた
  assert.equal(shouldApplyFormImage({ ...base, currentJan: '4900669000518' }), false);
  // 自分で画像URLを入れた
  assert.equal(shouldApplyFormImage({ ...base, currentImageUrl: IMG }), false);
  // 写真を選んだ（保存前・保存済みのどちらも）
  assert.equal(shouldApplyFormImage({ ...base, hasPendingPhoto: true }), false);
  assert.equal(shouldApplyFormImage({ ...base, hasSavedPhoto: true }), false);
  // シートを開き直した（古い取得結果）
  assert.equal(shouldApplyFormImage({ ...base, activeToken: 4 }), false);
  // JANの空白・全角は同じJANとして扱う
  assert.equal(shouldApplyFormImage({ ...base, currentJan: ' ４９００６６９００１０７２ ' }), true);
  // JANが無い
  assert.equal(shouldApplyFormImage({ ...base, requestJan: '', currentJan: '' }), false);
});

/* ---------------- 取得（中継サーバー経由。失敗は静かに） ---------------- */

test('自動取得は中継サーバーへJANを投げ、失敗は例外にせず null を返す', async () => {
  const calls = [];
  const ok = await fetchAutoImage(JAN_OIL, {
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ jan: JAN_OIL, imageUrl: IMG, itemName: 'ホルベイン 油絵具', source: 'yahoo' }),
      };
    },
  });
  assert.equal(ok.imageUrl, IMG);
  assert.equal(calls[0], imageProxyUrl(DEFAULT_IMAGE_PROXY_URL, JAN_OIL));
  assert.match(calls[0], /^https:\/\/rakuten-image-proxy\.shodai121ueda\.workers\.dev\/\?jan=4900669001072$/);

  // 404（未ヒット）
  assert.equal(await fetchAutoImage(JAN_OIL, {
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ error: 'image_not_found' }) }),
  }), null);
  // 通信できない
  assert.equal(await fetchAutoImage(JAN_OIL, {
    fetchImpl: async () => { throw new Error('offline'); },
  }), null);
  // JANが無い・取得中に同じJANが来た（二重取得しない）
  assert.equal(await fetchAutoImage('', {}), null);
  const inFlight = new Set([JAN_OIL]);
  assert.equal(await fetchAutoImage(JAN_OIL, { inFlight, fetchImpl: async () => { throw new Error('no'); } }), null);
  assert.equal(inFlight.has(JAN_OIL), true, '自分の取り消しで他人のフラグを消さない');
});

test('画像URL欄の案内文は商品名と取得元を短く添える', () => {
  assert.equal(describeFetchedImage({ itemName: '', source: 'yahoo' }), '商品画像を入れました（保存で確定）');
  assert.match(describeFetchedImage({ itemName: 'ホルベイン 油絵具 H107', source: 'yahoo' }, { sourceText: 'Yahoo!' }),
    /^ホルベイン 油絵具 H107（Yahoo!）の画像を入れました$/);
  assert.ok(describeFetchedImage({ itemName: 'あ'.repeat(80) }).length < 60, '長い商品名は切る');
});

/* ---------------- サンプルの初期画像 ---------------- */

test('サンプル8点は、実測した商品画像URLを持っている', () => {
  assert.equal(SAMPLE_SEEDS.length, 8);
  const urls = new Set();
  for (const seed of SAMPLE_SEEDS) {
    assert.match(String(seed.imageUrl), /^https:\/\/item-shopping\.c\.yimg\.jp\//, `${seed.id} に画像URLがありません`);
    urls.add(seed.imageUrl);
  }
  assert.equal(urls.size, 8, '同じ画像を共有していない');
  // 投入したサンプルにも画像が入る（一覧が最初から写真で並ぶ）
  const items = sampleItems(new Date('2026-11-16T09:00:00+09:00'));
  for (const it of items) assert.match(String(it.imageUrl), /^https:\/\//, `${it.id} に画像が入っていない`);
  // サンプルの画像URLは中継サーバーの応答（Yahoo!/楽天のCDN）だけを使う
  for (const seed of SAMPLE_SEEDS) assert.equal(/localhost|example\.com/.test(seed.imageUrl), false);
});

test('サンプル画像は行の書き換えでは消さない', () => {
  const seeded = sampleItems(new Date('2026-11-16T09:00:00+09:00'));
  // 自分で撮った写真があるサンプルには、定義の画像を足さない
  const withPhoto = seeded.map((it) => ({ ...it, imageUrl: '' }));
  const photoIds = new Set([withPhoto[0].id]);
  const out = backfillSampleImages({ ...blankState(), items: withPhoto }, { photoIds });
  assert.equal(out.filled, 7);
  assert.equal(out.state.items[0].imageUrl, '', '写真がある画材には足さない');
  assert.ok(out.state.items[1].imageUrl);

  // 自分で画像URLを入れた画材は触らない
  const own = backfillSampleImages({
    ...blankState(),
    items: [{ ...seeded[0], imageUrl: 'https://example.com/mine.jpg' }],
  }, { photoIds: new Set() });
  assert.equal(own.filled, 0);
  assert.equal(own.state.items[0].imageUrl, 'https://example.com/mine.jpg');

  // サンプル以外の画材・サンプルから作り直した画材（JAN違い）は触らない
  const others = backfillSampleImages({
    ...blankState(),
    items: [
      { ...createItem({ name: '自分の絵具', jan: JAN_OIL }) },
      { ...seeded[1], jan: JAN_OIL, imageUrl: '' }, // 自分でJANを書き換えたサンプル
      { ...seeded[2], imageUrl: '' },               // 画像を空に戻しただけのサンプル
    ],
  }, { photoIds: new Set() });
  assert.equal(others.filled, 1, 'IDとJANが両方一致するものだけ補う');
  assert.equal(others.state.items[0].imageUrl, '');
  assert.equal(others.state.items[1].imageUrl, '', 'JANが違うサンプルには足さない');
  assert.equal(others.state.items[2].imageUrl, seeded[2].imageUrl);

  // 画像が全部そろっていれば何もしない（保存もしない）
  const full = backfillSampleImages({ ...blankState(), items: seeded }, { photoIds: new Set() });
  assert.equal(full.filled, 0);
  const base = { ...blankState(), items: seeded };
  assert.equal(backfillSampleImages(base, { photoIds: new Set() }).state, base, '変化なしなら同じ state を返す');
});

/* ---------------- 画面側の導線 ---------------- */

test('3つの導線（単発の読取・連続スキャン・カタログから）から自動取得が呼ばれる', () => {
  const app = read('app.js');
  // 編集シートを開いたとき（単発の読取・カタログから開いたときもここを通る）
  assert.match(app, /setTimeout\(\(\) => \$\('fName'\)\.focus\(\{ preventScroll: true \}\), 120\);[\s\S]{0,200}autoFetchFormImage\(\)/);
  // カタログから選んだとき（JAN入りのプリセットでシートを開く）
  assert.match(app, /openItemSheet\(null, dictPreset\(d\)\)/);
  // 連続スキャンで登録したとき
  assert.match(app, /result\.kind === 'added' \|\| result\.kind === 'drafted'\)\) autoFillScannedImage\(result\.item\)/);
  // 失敗は静かに（自動取得では toast を出さない）
  const autoBlock = app.slice(app.indexOf('async function autoFetchFormImage'), app.indexOf('function backfillSampleImagesInState'));
  assert.equal(/toast\(/.test(autoBlock), false, '自動取得でユーザー操作を止める通知を出さない');
  // 既存の「画像を取得」ボタンは残す（手動でも取り直せる）
  assert.match(app, /\$\('btnFetchImage'\)\.addEventListener\('click', async \(\) => \{/);
});

test('サンプルへの画像補完は、写真の読み込みが済んでから静かに行う', () => {
  const app = read('app.js');
  assert.match(app, /preloadPhotos\(\)\.then\(\(ok\) => \{\s*if \(!ok\) return;\s*backfillSampleImagesInState\(\);/);
  assert.match(app, /function backfillSampleImagesInState\(\) \{[\s\S]{0,400}backfillSampleImages\(state, \{ photoIds: photoUrls \}\)/);
  // 補完は通知しない（静かに）
  const block = app.slice(app.indexOf('function backfillSampleImagesInState'), app.indexOf('/* ---------------- 画像の後補完'));
  assert.equal(/toast\(/.test(block), false);
});

test('自動取得の新しいファイルは配信・ビルド・キャッシュに入り、絵文字を使わない', () => {
  const sw = read('sw.js');
  const build = read('scripts/build.mjs');
  assert.match(sw, /'\.\/auto-image\.js'/);
  assert.match(build, /'auto-image\.js'/);
  assert.equal(EMOJI.test(read('auto-image.js')), false, 'auto-image.js に絵文字があります');
});
