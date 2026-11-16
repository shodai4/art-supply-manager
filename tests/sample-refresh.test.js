import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SAMPLE_SEEDS, SAMPLE_LEGACY_JANS, sampleItems, backfillSampleImages, refreshSampleItem,
} from '../samples.js';
import { blankState, createItem, isValidJAN, lookupJAN, DEFAULT_FOLDERS } from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const TODAY = new Date('2026-11-16T09:00:00+09:00');
const OLD_SAMPLE_06_JAN = '4547617000178'; // 旧 sample-06（カラバジオ 510 張りキャンバス F6）

/** 端末に残っている旧 sample-06 を作る（画像なし・手元写真なし） */
function oldSample06() {
  return createItem({
    id: 'sample-06',
    name: 'カラバジオ 510 張りキャンバス F6',
    maker: 'カラバジオ', brand: 'CARAVAGGIO', category: 'canvas',
    colorCode: '510', size: 'F6',
    folderId: 'atelier', qty: 0, status: 'empty', jan: OLD_SAMPLE_06_JAN,
    price: 900, memo: '張り替え用に補充',
    createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z',
  });
}

test('旧バージョンのサンプルJANは実在のJANで、いまのサンプルと重ならない', () => {
  const current = new Set(SAMPLE_SEEDS.map((s) => s.jan));
  for (const [id, jans] of Object.entries(SAMPLE_LEGACY_JANS)) {
    assert.ok(SAMPLE_SEEDS.some((s) => s.id === id), `${id} は今のサンプルに無いID`);
    for (const jan of jans) {
      assert.equal(isValidJAN(jan), true, `${jan} がJANとして不正`);
      assert.equal(current.has(jan), false, `${jan} は今のサンプルのJANと同じ`);
    }
  }
  // 辞書にある実在品（サンプルは内蔵辞書の品だけを使う）
  assert.ok(lookupJAN(OLD_SAMPLE_06_JAN));
  assert.equal(lookupJAN(OLD_SAMPLE_06_JAN).maker, 'カラバジオ');
});

test('旧 sample-06（カラバジオ・画像なし）は、新しいサンプルの中身＋画像へ差し替わる', () => {
  const seed = SAMPLE_SEEDS.find((s) => s.id === 'sample-06');
  assert.equal(seed.jan, '4938331139242');
  assert.match(seed.imageUrl, /^https:\/\//);

  const state = { ...blankState(), items: [oldSample06()] };
  const out = backfillSampleImages(state, { photoIds: new Set(), today: TODAY });
  assert.equal(out.replaced, 1);
  assert.equal(out.filled, 0);

  const item = out.state.items[0];
  assert.equal(item.id, 'sample-06', 'IDは変えない（二重に入らない）');
  assert.equal(item.jan, seed.jan);
  assert.equal(item.name, seed.name);
  assert.equal(item.maker, seed.maker);
  assert.equal(item.imageUrl, seed.imageUrl);
  assert.equal(item.qty, seed.qty);
  assert.equal(item.status, seed.status);
  assert.equal(item.folderId, 'atelier', '入れているフォルダは引き継ぐ');
  assert.equal(item.createdAt, '2026-10-08T00:00:00.000Z', '作成日は引き継ぐ（並びを変えない）');
  assert.ok(item.purchaseLog.length >= 1);
});

test('差し替えは一度きり（次からは何もしない）', () => {
  const first = backfillSampleImages({ ...blankState(), items: [oldSample06()] }, { photoIds: new Set(), today: TODAY });
  const again = backfillSampleImages(first.state, { photoIds: new Set(), today: TODAY });
  assert.equal(again.filled, 0);
  assert.equal(again.replaced, 0);
  assert.equal(again.state, first.state, '変化なしなら同じ state を返す');
});

test('自分で画像URLを入れた旧サンプルは差し替えない', () => {
  const mine = { ...oldSample06(), imageUrl: 'https://example.com/mine.jpg' };
  const out = backfillSampleImages({ ...blankState(), items: [mine] }, { photoIds: new Set(), today: TODAY });
  assert.equal(out.replaced, 0);
  assert.equal(out.filled, 0);
  assert.equal(out.state.items[0].name, 'カラバジオ 510 張りキャンバス F6');
  assert.equal(out.state.items[0].jan, OLD_SAMPLE_06_JAN);
  assert.equal(out.state.items[0].imageUrl, 'https://example.com/mine.jpg');
});

test('手元写真を撮った旧サンプルは差し替えない', () => {
  const out = backfillSampleImages(
    { ...blankState(), items: [oldSample06()] },
    { photoIds: new Set(['sample-06']), today: TODAY },
  );
  assert.equal(out.replaced, 0);
  assert.equal(out.state.items[0].jan, OLD_SAMPLE_06_JAN);
});

test('自分で別の画材へ書き換えたサンプル（知らないJAN）は触らない', () => {
  const other = createItem({ id: 'sample-06', name: '自分のキャンバス', jan: '4938331139242', qty: 4, imageUrl: '' });
  const unknown = { ...other, jan: '4900669001072', name: '自分の油絵具', qty: 5 };
  const out = backfillSampleImages({ ...blankState(), items: [unknown] }, { photoIds: new Set(), today: TODAY });
  assert.equal(out.replaced, 0);
  assert.equal(out.state.items[0].name, '自分の油絵具');
  assert.equal(out.state.items[0].qty, 5);
  assert.equal(out.state.items[0].imageUrl, '', '勝手に画像を足さない');
});

test('サンプル以外の画材（IDが sample- でない）は触らない', () => {
  const mine = createItem({ id: 'mine-1', name: '自分の絵具', jan: OLD_SAMPLE_06_JAN, qty: 1 });
  const out = backfillSampleImages({ ...blankState(), items: [mine] }, { photoIds: new Set(), today: TODAY });
  assert.equal(out.replaced, 0);
  assert.equal(out.filled, 0);
  assert.equal(out.state.items[0].imageUrl, '');
});

test('いまのJANのサンプルは画像だけ補い、自分で直した中身は残す', () => {
  const seed = SAMPLE_SEEDS[0];
  const edited = { ...sampleItems(TODAY)[0], name: '自分の呼び名', qty: 7, imageUrl: '' };
  const out = backfillSampleImages({ ...blankState(), items: [edited] }, { photoIds: new Set(), today: TODAY });
  assert.equal(out.filled, 1);
  assert.equal(out.replaced, 0);
  assert.equal(out.state.items[0].imageUrl, seed.imageUrl);
  assert.equal(out.state.items[0].name, '自分の呼び名');
  assert.equal(out.state.items[0].qty, 7);
});

test('refreshSampleItem はID・フォルダ・作成日を引き継ぎ、既知のフォルダだけ使う', () => {
  const seed = SAMPLE_SEEDS.find((s) => s.id === 'sample-06');
  const item = oldSample06();
  const fresh = refreshSampleItem(item, seed, TODAY);
  assert.equal(fresh.id, 'sample-06');
  assert.equal(fresh.folderId, 'atelier');
  assert.equal(fresh.createdAt, item.createdAt);
  assert.equal(fresh.jan, seed.jan);
  assert.ok(DEFAULT_FOLDERS.some((f) => f.id === fresh.folderId));
});

test('差し替えの呼び出しは画面の読み込み後（写真の準備ができてから）に1回だけ', () => {
  const app = read('app.js');
  assert.match(app, /preloadPhotos\(\)\.then\(\(ok\) => \{\s*if \(ok\) backfillSampleImagesInState\(\);/);
  assert.match(app, /const out = backfillSampleImages\(state, \{ photoIds: photoUrls \}\);\s*if \(!out\.filled && !out\.replaced\) return;/);
  // 差し替えは静かに（toast を出さない）
  const block = app.slice(app.indexOf('function backfillSampleImagesInState'), app.indexOf('/* ---------------- storage'));
  assert.equal(/toast\(/.test(block), false);
});
