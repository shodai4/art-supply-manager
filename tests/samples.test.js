import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SAMPLE_SEEDS, SAMPLE_ID_PREFIX, SAMPLE_FLAG_KEY, sampleItems, mergeSampleItems,
  shouldSeedSamples, readSampleSeeded, writeSampleSeeded,
  isSampleItemId, presentSampleIds, hasSampleItems, removeSampleItems,
} from '../samples.js';
import {
  blankState, createItem, isValidJAN, lookupJAN, isEmptyStock, computeShoppingList,
  costSummary, purchaseTotalOf, unitPrice, DEFAULT_FOLDERS, CATEGORIES,
} from '../core.js';
import { shopSearchLinks } from '../shops.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const TODAY = new Date('2026-11-16T09:00:00+09:00');

test('サンプルは8点で、お試しに必要なカテゴリがそろっている', () => {
  const items = sampleItems(TODAY);
  assert.equal(items.length, 8);
  assert.equal(new Set(items.map((it) => it.id)).size, 8, 'IDが重複しています');
  for (const it of items) assert.ok(it.id.startsWith(SAMPLE_ID_PREFIX), `${it.id} はサンプルIDでない`);
  const cats = new Set(items.map((it) => it.category));
  for (const id of ['oil', 'watercolor', 'acrylic', 'brush', 'canvas', 'paper', 'medium']) {
    assert.ok(cats.has(id), `カテゴリ ${id} のサンプルがありません`);
  }
  // カテゴリは core.js の定義にあるものだけ
  for (const it of items) assert.ok(CATEGORIES.some((c) => c.id === it.category));
});

test('在庫あり・在庫0・残量の種類がひととおり試せる', () => {
  const items = sampleItems(TODAY);
  const out = items.filter(isEmptyStock);
  assert.equal(out.length, 2, '在庫0（グレー表示）は2点');
  assert.deepEqual(out.map((it) => it.qty), [0, 0]);
  assert.deepEqual(out.map((it) => it.status), ['empty', 'empty']);
  const statuses = new Set(items.map((it) => it.status));
  for (const id of ['enough', 'low', 'empty', 'new']) assert.ok(statuses.has(id), `残量 ${id} のサンプルがありません`);
  // 補充リストに在庫0が並ぶ（通販検索をすぐ試せる）
  const shopping = computeShoppingList(items);
  assert.ok(shopping.length >= 2);
  assert.ok(shopping.slice(0, 2).every((it) => it.qty === 0));
  // 色名付きのサンプルが複数ある
  assert.ok(items.filter((it) => it.colorName).length >= 3);
});

test('サンプルのJANは妥当で、内蔵辞書の実在品と一致する', () => {
  for (const it of sampleItems(TODAY)) {
    assert.equal(isValidJAN(it.jan), true, `${it.name} のJANが不正です`);
    const hit = lookupJAN(it.jan);
    assert.ok(hit, `${it.jan} が辞書にありません`);
    assert.equal(hit.maker, it.maker, `${it.name} のメーカーが辞書と違います`);
  }
});

test('単価と購入履歴が入っていて、画材費の集計がすぐ見られる', () => {
  const items = sampleItems(TODAY);
  for (const it of items) {
    assert.ok(unitPrice(it) > 0, `${it.name} に単価がありません`);
    assert.ok(it.purchaseLog.length >= 1, `${it.name} に購入履歴がありません`);
    for (const log of it.purchaseLog) {
      assert.ok(log.amount > 0 && log.qty > 0);
      assert.ok(log.at);
    }
  }
  const cost = costSummary(items);
  assert.equal(cost.pricedCount, items.length);
  assert.equal(cost.unpricedCount, 0);
  assert.ok(cost.stockValue > 0 && cost.recordedTotal >= cost.stockValue);
  // 使い切った画材も「記録済み」には残る
  for (const it of items.filter((x) => x.qty === 0)) assert.ok(purchaseTotalOf(it) > 0);
  assert.equal(cost.byCategory.length >= 5, true);
  assert.equal(cost.byMaker.length, new Set(items.map((it) => it.maker)).size);
  assert.equal(cost.byMaker.reduce((sum, row) => sum + row.count, 0), items.length);
});

test('サンプルは既定フォルダの中で、メーカー・色名・メモが入っている', () => {
  const items = sampleItems(TODAY);
  for (const it of items) {
    assert.ok(DEFAULT_FOLDERS.some((f) => f.id === it.folderId), `${it.name} のフォルダが既定にない`);
    assert.ok(it.maker, `${it.name} にメーカーがありません`);
  }
  assert.ok(new Set(items.map((it) => it.folderId)).size >= 3, 'フォルダが1か所に固まりすぎ');
  assert.ok(items.filter((it) => it.colorName).length >= 3);
  assert.ok(items.filter((it) => it.memo).length >= 3);
  // 作成日は更新日より前（新しい順に並べても不自然にならない）
  for (const it of items) assert.ok(Date.parse(it.createdAt) <= Date.parse(it.updatedAt), it.name);
});

test('通販リンク（Amazon／楽天市場／Yahoo!）がサンプルから作れる', () => {
  const it = sampleItems(TODAY)[0];
  const links = shopSearchLinks(it, {});
  assert.deepEqual(links.map((l) => l.label), ['Amazon', '楽天市場', 'Yahoo!']);
  for (const l of links) assert.ok(l.url.includes(it.jan), `${l.label} のURLにJANが無い`);
});

test('サンプルの文言に絵文字を使わない（表示方針）', () => {
  assert.equal(new RegExp(EMOJI.source, 'u').test(read('samples.js')), false);
  for (const seed of SAMPLE_SEEDS) {
    for (const value of [seed.name, seed.maker, seed.memo, seed.colorName]) {
      assert.equal(new RegExp(EMOJI.source, 'u').test(String(value)), false, `${seed.id}: ${value}`);
    }
  }
});

test('投入は足すだけで、二重に入らない', () => {
  const base = blankState();
  const first = mergeSampleItems(base, sampleItems(TODAY));
  assert.equal(first.added, 8);
  assert.equal(first.state.items.length, 8);
  assert.equal(first.limited, false);

  const again = mergeSampleItems(first.state, sampleItems(TODAY));
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 8);
  assert.equal(again.state.items.length, 8);

  // 既存の画材は消さない
  const mine = createItem({ id: 'mine', name: '自分の絵具', qty: 4 });
  const mixed = mergeSampleItems({ ...base, items: [mine] }, sampleItems(TODAY));
  assert.equal(mixed.added, 8);
  assert.equal(mixed.state.items.length, 9);
  assert.equal(mixed.state.items.at(-1).id, 'mine');
});

test('同じ商品を自分で登録していれば、その1点は飛ばす', () => {
  const seed = SAMPLE_SEEDS[0];
  const mine = createItem({ id: 'mine', name: `  ${seed.name}  `, maker: seed.maker, qty: 1 });
  const out = mergeSampleItems(blankState(), sampleItems(TODAY), { limit: 100 });
  assert.equal(out.added, 8);
  const dup = mergeSampleItems({ ...blankState(), items: [mine] }, sampleItems(TODAY));
  assert.equal(dup.added, 7);
  assert.equal(dup.skipped, 1);
  assert.equal(dup.state.items.filter((it) => it.name.trim() === seed.name).length, 1);
});

test('無料の残り枠を超えるぶんは入れない', () => {
  const out = mergeSampleItems(blankState(), sampleItems(TODAY), { limit: 3 });
  assert.equal(out.added, 3);
  assert.equal(out.skipped, 5);
  assert.equal(out.limited, true);
  assert.equal(out.state.items.length, 3);

  const none = mergeSampleItems(blankState(), sampleItems(TODAY), { limit: 0 });
  assert.equal(none.added, 0);
  assert.equal(none.limited, true);
});

test('フォルダが無いデータでも既定フォルダへ寄せて壊さない', () => {
  const out = mergeSampleItems({ items: [], folders: [] }, sampleItems(TODAY));
  assert.equal(out.added, 8);
  // folders が空なら元の folderId のまま（画面側は「未分類」で表示できる）
  assert.equal(out.state.items.length, 8);
  const kept = mergeSampleItems(blankState(), sampleItems(TODAY));
  assert.ok(kept.state.folders.length >= 4, '既定フォルダを消さない');
});

test('初回起動の判定（0件・まだ入れていない、の両方）', () => {
  assert.equal(shouldSeedSamples({ items: [], seeded: false }), true);
  assert.equal(shouldSeedSamples({ items: [], seeded: true }), false, '一度入れたら復活させない');
  assert.equal(shouldSeedSamples({ items: [createItem({ name: 'x' })], seeded: false }), false);
  assert.equal(shouldSeedSamples({}), true);
});

test('印（フラグ）の読み書きは storage が無くても落ちない', () => {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  assert.equal(readSampleSeeded(storage), false);
  assert.equal(writeSampleSeeded(storage, true), true);
  assert.equal(store.get(SAMPLE_FLAG_KEY), '1');
  assert.equal(readSampleSeeded(storage), true);
  assert.equal(writeSampleSeeded(storage, false), true);
  assert.equal(readSampleSeeded(storage), false);
  // storage が無い・壊れているときは「未投入」に倒す（落ちない）
  assert.equal(readSampleSeeded(undefined), false);
  assert.equal(readSampleSeeded({ getItem() { throw new Error('no'); } }), false);
  assert.equal(writeSampleSeeded({ setItem() { throw new Error('no'); } }), false);
});

test('画面の導線（空の一覧・設定）と配信ファイルへの登録がある', () => {
  const html = read('index.html');
  const app = read('app.js');
  const sw = read('sw.js');
  const build = read('scripts/build.mjs');
  const workflow = read('.github/workflows/ios-build.yml');
  const pkg = JSON.parse(read('package.json'));

  // 設定の「サンプル」から入れる・消すができる（入っていれば「消す」に切り替わる）
  assert.match(html, /id="sampleCard"/);
  assert.match(html, /<h2 class="card-t">サンプル<\/h2>/);
  assert.match(html, /id="btnAddSamples" data-sample-toggle>サンプルを入れる</);
  assert.match(app, /function renderSampleCard\(\)[\s\S]{0,500}'サンプルを消す'/);
  assert.match(app, /function removeSamples\(\)[\s\S]{0,300}removeSampleItems\(state\)/);
  assert.match(app, /\[data-sample-toggle\][\s\S]{0,200}hasSampleItems\(state\)[\s\S]{0,120}removeSamples\(\)[\s\S]{0,60}addSamples\(\)/);
  // 空の一覧にも同じボタンが出る（文字は短く）
  assert.match(app, /data-add-samples>サンプルを入れる</);
  assert.match(app, /seedSamplesOnFirstRun\(\)/);
  assert.match(app, /shouldSeedSamples\(\{ items: state\.items, seeded: readSampleSeeded\(safeStorage\(\)\) \}\)/);
  assert.match(app, /from '\.\/samples\.js'/);
  // 残り枠を守る（無料上限を超えて足さない）
  assert.match(app, /mergeSampleItems\(state, sampleItems\(\), \{ limit: remaining \}\)/);
  // サンプルの文言に絵文字を入れない
  assert.equal(EMOJI.test(html.slice(html.indexOf('id="sampleCard"'), html.indexOf('id="sampleCard"') + 400)), false);

  // キャッシュ・iOSビルド・Service Worker に新しいファイルが入っている
  assert.match(sw, /'\.\/samples\.js'/);
  assert.match(sw, /art-supply-manager-v62/);
  assert.match(build, /'samples\.js'/);
  // CI（iOSビルド）は app.js / index.html の変更で走る（samples.js は build.mjs 経由で www/ へ入る）
  assert.match(workflow, /- 'app\.js'/);
  assert.match(workflow, /- 'scripts\/\*\*'/);
  // キャッシュバスティングは package.json の版と揃える
  assert.match(html, new RegExp(`app\\.js\\?v=${pkg.version.replace(/\./g, '\\.')}`));
  assert.equal(pkg.version, '1.40.0');
});

/* ---------------- 設定の「サンプルを消す」（入れ直しもできる） ---------------- */

test('サンプルのIDかどうかの判定（自分で登録した画材は対象外）', () => {
  for (const id of ['sample-01', 'sample-02', 'sample-08']) assert.equal(isSampleItemId(id), true, id);
  assert.equal(isSampleItemId('sample-09'), false, 'サンプルに無いIDは消さない');
  assert.equal(isSampleItemId('sample-'), false);
  assert.equal(isSampleItemId('i123abc'), false, '自分で登録した画材');
  assert.equal(isSampleItemId(''), false);
  assert.equal(isSampleItemId(undefined), false);
});

test('サンプルが入っているかを判定できる（入っていればボタンは「消す」）', () => {
  const empty = blankState();
  assert.equal(hasSampleItems(empty), false);
  assert.deepEqual(presentSampleIds(empty), []);

  const seeded = mergeSampleItems(empty, sampleItems(TODAY)).state;
  assert.equal(hasSampleItems(seeded), true);
  assert.equal(presentSampleIds(seeded).length, 8);
  // 在庫が空の状態（全部消した）でも判定は落ちない
  assert.equal(hasSampleItems({ items: [] }), false);
  assert.equal(hasSampleItems({}), false);
  assert.deepEqual(presentSampleIds({ items: null }), []);
});

test('「サンプルを消す」はサンプル8点だけを消し、自分で登録した画材とフォルダは残す', () => {
  const base = mergeSampleItems(blankState(), sampleItems(TODAY)).state;
  const mine = createItem({ name: '自分のゲッソ', maker: '自分', folderId: 'atelier' });
  const alsoMine = createItem({ name: '自分の筆', maker: '自分', folderId: 'stock' });
  const state = { ...base, items: [mine, ...base.items, alsoMine] };

  const { state: next, removed } = removeSampleItems(state);
  assert.equal(removed, 8);
  assert.deepEqual(next.items.map((it) => it.id).sort(), [mine.id, alsoMine.id].sort());
  assert.ok(next.items.some((it) => it.name === '自分のゲッソ'), '自分の画材が消えた');
  // フォルダ（サンプルが入っていた場所）は片付けない
  assert.equal(next.folders.length, state.folders.length);
  assert.deepEqual(next.folders.map((f) => f.id), state.folders.map((f) => f.id));
  assert.equal(hasSampleItems(next), false);
  // 設定など、ほかの項目はそのまま
  assert.equal(next.settings, state.settings);
});

test('サンプルのフォルダに自分の画材があっても、フォルダごと消さない', () => {
  const base = mergeSampleItems(blankState(), sampleItems(TODAY)).state;
  // sample-01〜08 が入っているフォルダ（atelier 等）に、自分の画材を1点ずつ足す
  const mine = SAMPLE_SEEDS.map((seed, i) => createItem({ name: `自分の画材${i}`, folderId: seed.folderId }));
  const state = { ...base, items: [...base.items, ...mine] };

  const { state: next, removed } = removeSampleItems(state);
  assert.equal(removed, 8);
  assert.equal(next.items.length, mine.length);
  for (const folder of new Set(SAMPLE_SEEDS.map((s) => s.folderId))) {
    assert.ok(next.folders.some((f) => f.id === folder), `フォルダ ${folder} が消えた`);
    assert.ok(next.items.some((it) => it.folderId === folder), `フォルダ ${folder} の中身が消えた`);
  }
});

test('入れる→消す→また入れる、を何度でも繰り返せる（二重に入らない）', () => {
  let state = blankState();
  for (let round = 0; round < 3; round += 1) {
    const added = mergeSampleItems(state, sampleItems(TODAY));
    assert.equal(added.added, 8, `${round + 1}回目に入れられない`);
    state = added.state;
    assert.equal(state.items.length, 8);
    assert.equal(new Set(state.items.map((it) => it.id)).size, 8, '同じIDが二重に入った');

    const removed = removeSampleItems(state);
    assert.equal(removed.removed, 8);
    state = removed.state;
    assert.equal(state.items.length, 0);
  }
  // 消したあとは「入れた印」が残るので、勝手に戻らない（ボタンで入れる）
  assert.equal(shouldSeedSamples({ items: state.items, seeded: true }), false);
});

test('サンプルを消すときに、サンプルを自分用に書き換えていてもIDで判定して消す（区別できる）', () => {
  const base = mergeSampleItems(blankState(), sampleItems(TODAY)).state;
  const edited = { ...base.items[0], name: '書き換えた名前', qty: 9 };
  const state = { ...base, items: [edited, ...base.items.slice(1)] };
  const { state: next, removed } = removeSampleItems(state);
  assert.equal(removed, 8, 'IDがサンプルなら消す（ユーザーが書き換えてもサンプル扱い）');
  assert.equal(next.items.length, 0);
});

test('サンプルが入っていないときの「消す」は何も変えない', () => {
  const state = blankState();
  const out = removeSampleItems(state);
  assert.equal(out.removed, 0);
  assert.equal(out.state, state, '状態を作り直さない');
});
