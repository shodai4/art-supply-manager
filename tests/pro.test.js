import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FREE_ITEM_LIMIT, FREE_FOLDER_LIMIT, UNLIMITED, PRO_BENEFITS, PRO_FEATURES,
  isPro, itemLimit, folderLimit, quota, itemQuota, folderQuota,
  canAddItem, canAddFolder, canUseFeature, describeQuota, isQuotaTight,
  applyProEntitlement,
} from '../pro.js';
import { createItem, blankState, DEFAULT_FOLDERS, addFolder } from '../core.js';

const withItems = (n, folders = DEFAULT_FOLDERS) => ({
  ...blankState(),
  folders: folders.map((f) => ({ ...f })),
  items: Array.from({ length: n }, (_, i) => createItem({ name: `画材${i}` })),
});

test('無料上限は100点・フォルダ3つで、Proは上限なし', () => {
  assert.equal(FREE_ITEM_LIMIT, 100);
  assert.equal(FREE_FOLDER_LIMIT, 3);
  assert.equal(itemLimit({}), 100);
  assert.equal(folderLimit({}), 3);
  assert.equal(itemLimit({ pro: true }), UNLIMITED);
  assert.equal(folderLimit({ pro: true }), UNLIMITED);
  assert.equal(itemLimit({ proPreview: true }), UNLIMITED);
  // 数値としての無限大（比較や描画で壊れない）
  assert.ok(Number.isFinite(FREE_ITEM_LIMIT));
  assert.equal(UNLIMITED > 1e9, true);
});

test('Pro判定は購入状態とプレビューのどちらでも真', () => {
  assert.equal(isPro({}), false);
  assert.equal(isPro({ pro: false, proPreview: false }), false);
  assert.equal(isPro({ pro: true }), true);
  assert.equal(isPro({ proPreview: true }), true);
  assert.equal(isPro(undefined), false);
  assert.equal(isPro(null), false);
});

test('残り枠の計算と表示（12 / 100点）', () => {
  const q = quota(12, 100);
  assert.deepEqual(q, { used: 12, limit: 100, unlimited: false, full: false, remaining: 88 });
  assert.equal(describeQuota(q), '12 / 100点');
  assert.equal(describeQuota(q, 'つ'), '12 / 100つ');

  const full = quota(100, 100);
  assert.equal(full.full, true);
  assert.equal(full.remaining, 0);

  const over = quota(120, 100); // 既存データが上限を超えていても壊れない
  assert.equal(over.full, true);
  assert.equal(over.remaining, 0);

  const unlimited = quota(120, UNLIMITED);
  assert.equal(unlimited.unlimited, true);
  assert.equal(unlimited.full, false);
  assert.equal(describeQuota(unlimited), '120点');
});

test('新規アイテムは100点まで。既存の超過データは消さない・編集は許可', () => {
  assert.equal(canAddItem(withItems(99), {}).ok, true);
  const at99 = canAddItem(withItems(99), {});
  assert.equal(describeQuota(at99.quota), '99 / 100点');

  const at100 = canAddItem(withItems(100), {});
  assert.equal(at100.ok, false);
  assert.equal(at100.quota.full, true);

  // 100点を超えて保存されている既存データも、そのまま持てる（追加だけ止まる）
  const over = withItems(130);
  assert.equal(canAddItem(over, {}).ok, false);
  assert.equal(over.items.length, 130);
  assert.equal(describeQuota(itemQuota(over, {})), '130 / 100点');

  // Proなら追加できる
  assert.equal(canAddItem(withItems(130), { pro: true }).ok, true);
});

test('既定の4フォルダは無料枠に数えず、あとから3つまで作れる（子フォルダも可）', () => {
  const base = blankState();
  assert.equal(base.folders.length, 4);
  // 既定の4つだけの状態＝残り3つ。ここが「4 / 3」で作れなかった不具合の修正点
  assert.equal(folderQuota(base, {}).used, 0);
  assert.equal(folderQuota(base, {}).full, false);
  assert.equal(canAddFolder(base, {}).ok, true);
  assert.equal(describeQuota(folderQuota(base, {}), 'つ'), '0 / 3つ');

  // 3つまでは作れる（子フォルダ・孫フォルダも1つとして数える）
  let s = addFolder(base, { name: 'スタジオ' });
  s = addFolder(s, { name: '引き出し1', parentId: 'home' });
  s = addFolder(s, { name: '引き出し2', parentId: s.folders.at(-2).id });
  assert.equal(folderQuota(s, {}).used, 3);
  assert.equal(canAddFolder(s, {}).ok, false);
  assert.equal(describeQuota(folderQuota(s, {}), 'つ'), '3 / 3つ');
  // Proなら何個でも
  assert.equal(canAddFolder(s, { pro: true }).ok, true);

  // 既定フォルダの名前を変えてもIDはそのままなので枠に数えない
  const renamed = { ...base, folders: base.folders.map((f) => (f.id === 'home' ? { ...f, name: '自宅' } : f)) };
  assert.equal(folderQuota(renamed, {}).used, 0);
  // 既定を消した状態でも数え方が壊れない
  assert.equal(folderQuota({ folders: DEFAULT_FOLDERS.slice(0, 2) }, {}).used, 0);
});

test('Pro機能（画材費・写真・買い物リスト・確定申告・広告なし）はProだけ。上限以外は常に使える', () => {
  for (const feature of PRO_FEATURES) {
    assert.equal(canUseFeature({}, feature), false, feature);
    assert.equal(canUseFeature({ pro: true }, feature), true, feature);
  }
  assert.equal(canUseFeature({}, 'unknown'), true);
  assert.equal(canUseFeature({}, ''), true);
  assert.deepEqual(PRO_FEATURES, ['cost', 'samples', 'shopping', 'taxreport', 'noads']);
  assert.deepEqual(PRO_BENEFITS.map((b) => b.id), ['limit', 'cost', 'samples', 'shopping', 'taxreport', 'noads']);
  assert.ok(PRO_BENEFITS.every((b) => b.label && b.label.length <= 12));
  // プレビュー中も購入後と同じ特典が使える
  assert.equal(canUseFeature({ proPreview: true }, 'samples'), true);
});

test('残りが少ないときだけ目印を出す（90%以上）', () => {
  assert.equal(isQuotaTight(quota(89, 100)), false);
  assert.equal(isQuotaTight(quota(90, 100)), true);
  assert.equal(isQuotaTight(quota(100, 100)), true);
  assert.equal(isQuotaTight(quota(120, UNLIMITED)), false);
});

test('StoreKitの購入結果を設定へ反映する（接続点）', () => {
  assert.deepEqual(applyProEntitlement({ sort: 'updated' }, true), { sort: 'updated', pro: true });
  // 購入したらプレビュー表示は消す
  assert.deepEqual(applyProEntitlement({ proPreview: true }, true), { proPreview: false, pro: true });
  assert.deepEqual(applyProEntitlement({ pro: true }, false), { pro: false });
  assert.equal(isPro(applyProEntitlement({}, true)), true);
  assert.equal(isPro(applyProEntitlement({}, false)), false);
});

test('pro.js は絵文字を含まない', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const text = fs.readFileSync(path.join(root, 'pro.js'), 'utf8');
  assert.equal(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(text), false);
});
