/**
 * アトリコ Pro の課金（買い切り / 月額）まわり。
 *
 *   1) App Store Connect に登録した Product ID・価格・サブスクグループ
 *   2) 買い切りを買ったら月額の導線を出さない
 *   3) 購入が確認できたら Pro（上限解除・画材費・広告非表示）が即座に効く
 *   4) 購入の復元（復元できる購入が無いときの案内も）
 *   5) Web（GitHub Pages）では課金しない
 *   6) サブスクが切れたら Pro を外す
 *   7) 画面（index.html / app.js）と配布物に導線・注記・規約リンクがある
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIFETIME_PRODUCT_ID, MONTHLY_PRODUCT_ID, SUBSCRIPTION_GROUP_NAME, SUBSCRIPTION_GROUP_ID,
  PRO_PLANS, PLAN_ORDER, WEB_PURCHASE_NOTE, subscriptionNoticeText, yenLabel, planPriceLabel,
  normalizePurchase, purchaseFromSettings, hasProPurchase, planVisibility, purchasedPlanName,
  planStatusLabel, settingsWithPurchase, purchaseMessage, isNativeWindow, ProStore,
} from '../iap.js';
import { isPro, itemLimit, folderLimit, canUseFeature, UNLIMITED, FREE_ITEM_LIMIT, FREE_FOLDER_LIMIT } from '../pro.js';
import { AdBanner, AD_HEIGHT_VAR } from '../admob.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

/* ---------------- 偽の CdvPurchase（プラグインの代わり） ---------------- */

function fakeCdvPurchase({ owned = {}, orderResult } = {}) {
  const registered = [];
  const orders = [];
  const handlers = {};
  const products = {};
  for (const key of PLAN_ORDER) {
    const id = PRO_PLANS[key].id;
    products[id] = {
      id,
      owned: Boolean(owned[key]),
      getOffer: () => ({ id: 'default', productId: id }),
      setOwned(value) { this.owned = Boolean(value); },
    };
  }
  const builder = {
    productUpdated(cb) { handlers.productUpdated = cb; return builder; },
    approved(cb) { handlers.approved = cb; return builder; },
    verified(cb) { handlers.verified = cb; return builder; },
    finished(cb) { handlers.finished = cb; return builder; },
  };
  const store = {
    verbosity: null,
    readyCallbacks: [],
    register(list) { registered.push(...list); },
    when() { return builder; },
    error(cb) { handlers.error = cb; },
    ready(cb) { store.readyCallbacks.push(cb); },
    initialize() {},
    async update() {},
    async restorePurchases() {},
    get(id) { return products[id] || null; },
    async order(offer) { orders.push(offer); return orderResult; },
    fireReady() { for (const cb of store.readyCallbacks) cb(); },
    fire(type, value) { handlers[type]?.(value); },
  };
  const CdvPurchase = {
    store,
    ProductType: { CONSUMABLE: 'consumable', NON_CONSUMABLE: 'non-consumable', PAID_SUBSCRIPTION: 'paid subscription' },
    Platform: { APPLE_APPSTORE: 'ios-appstore', GOOGLE_PLAY: 'android-playstore' },
    LogLevel: { WARNING: 2 },
    ErrorCode: { PAYMENT_CANCELLED: 'payment-cancelled' },
  };
  return { CdvPurchase, store, products, registered, orders, handlers };
}

function makeStore(options = {}) {
  const messages = [];
  const purchases = [];
  const fake = fakeCdvPurchase(options);
  const native = options.native === undefined ? true : options.native;
  const proStore = new ProStore({
    win: {},
    native,
    onPurchase: (state, reason) => purchases.push({ ...state, reason }),
    onMessage: (message) => messages.push(message),
  });
  if (native) {
    proStore.attach(fake.CdvPurchase);
    fake.store.fireReady();
  }
  return { proStore, messages, purchases, ...fake };
}

/* ---------------- 1) 商品の定義 ---------------- */

test('Product ID・価格・サブスクグループは App Store Connect の登録どおり', () => {
  assert.equal(LIFETIME_PRODUCT_ID, 'com.oekaki.artsupply.pro.lifetime');
  assert.equal(MONTHLY_PRODUCT_ID, 'com.oekaki.artsupply.pro.monthly');
  assert.equal(SUBSCRIPTION_GROUP_NAME, 'Atoriko Pro');
  assert.equal(SUBSCRIPTION_GROUP_ID, '22587434');
  assert.equal(PRO_PLANS.lifetime.yen, 1500);
  assert.equal(PRO_PLANS.monthly.yen, 150);
  assert.equal(PRO_PLANS.lifetime.kind, 'non-consumable');
  assert.equal(PRO_PLANS.monthly.kind, 'subscription');
  assert.deepEqual(PLAN_ORDER, ['lifetime', 'monthly']);
  // 表示は常に日本円（ストアのローカライズ価格は使わない）
  assert.equal(yenLabel(1500), '¥1,500');
  assert.equal(yenLabel(150), '¥150');
  assert.equal(planPriceLabel('lifetime'), '¥1,500');
  assert.equal(planPriceLabel('monthly'), '¥150 / 月');
  assert.equal(planPriceLabel('unknown'), '');
});

test('プランの登録は非消耗型と自動更新サブスクで、iOSのストアに出す', () => {
  const { registered } = makeStore();
  assert.equal(registered.length, 2);
  const byId = Object.fromEntries(registered.map((r) => [r.id, r]));
  assert.equal(byId[LIFETIME_PRODUCT_ID].type, 'non-consumable');
  assert.equal(byId[MONTHLY_PRODUCT_ID].type, 'paid subscription');
  for (const entry of registered) assert.equal(entry.platform, 'ios-appstore');
});

/* ---------------- 2) 買い切りを買ったら月額を出さない ---------------- */

test('買い切りを買った人には月額プランを出さない（未購入なら両方）', () => {
  assert.deepEqual(planVisibility({}), { lifetime: true, monthly: true });
  assert.deepEqual(planVisibility({ lifetime: true }), { lifetime: false, monthly: false });
  assert.deepEqual(planVisibility({ monthly: true }), { lifetime: true, monthly: false });
  // 両方 true（買い切り＋月額が残っている）でも月額は出さない
  assert.deepEqual(planVisibility({ lifetime: true, monthly: true }), { lifetime: false, monthly: false });
});

test('購入状態から設定を作り、プラン名を出せる', () => {
  assert.equal(purchasedPlanName({ lifetime: true }), '買い切り');
  assert.equal(purchasedPlanName({ monthly: true }), '月額');
  assert.equal(purchasedPlanName({}), '');

  const lifetime = settingsWithPurchase({ proPreview: true }, { lifetime: true });
  assert.equal(lifetime.pro, true);
  assert.equal(lifetime.proLifetime, true);
  assert.equal(lifetime.proPlan, 'lifetime');
  assert.equal(lifetime.proPreview, false, '購入したらプレビュー表示は消す');
  assert.equal(planStatusLabel(lifetime), 'Pro（買い切り）');

  const monthly = settingsWithPurchase({}, { monthly: true });
  assert.equal(monthly.proPlan, 'monthly');
  assert.equal(monthly.proLifetime, false);
  assert.equal(planStatusLabel(monthly), 'Pro（月額）');

  // 購入が無くなったら無料へ戻す
  const none = settingsWithPurchase(monthly, {});
  assert.equal(none.pro, false);
  assert.equal(none.proPlan, '');
  assert.equal(planStatusLabel(none), '無料');
  assert.equal(planStatusLabel({ proPreview: true }), 'Pro（プレビュー）');

  // 保存した設定から購入状態を戻せる（起動直後の表示）
  assert.deepEqual(purchaseFromSettings(lifetime), { lifetime: true, monthly: false });
  assert.deepEqual(purchaseFromSettings(monthly), { lifetime: false, monthly: true });
  assert.deepEqual(purchaseFromSettings({}), { lifetime: false, monthly: false });
  assert.equal(hasProPurchase({ monthly: true }), true);
  assert.equal(hasProPurchase({}), false);
  assert.deepEqual(normalizePurchase(undefined), { lifetime: false, monthly: false });
});

/* ---------------- 3) Pro の解放（上限・画材費・広告） ---------------- */

test('購入が確認できたら上限解除・画材費・広告非表示が即座に効く', async () => {
  const settings = settingsWithPurchase({}, { lifetime: true });
  assert.equal(isPro(settings), true);
  assert.equal(itemLimit(settings), UNLIMITED);
  assert.equal(folderLimit(settings), UNLIMITED);
  assert.equal(canUseFeature(settings, 'cost'), true);
  assert.equal(canUseFeature(settings, 'icloud'), true);

  // 広告は出さず、下の余白も残さない
  const style = new Map();
  const attributes = new Map();
  const doc = {
    documentElement: { style: { setProperty: (k, v) => style.set(k, v) } },
    body: { setAttribute: (k, v) => attributes.set(k, v) },
  };
  const win = { Capacitor: { isNativePlatform: () => true, Plugins: { AdMob: { showBanner() {}, initialize() {} } } } };
  const banner = new AdBanner({ win, doc, isPro: () => isPro(settings) });
  assert.equal(banner.adFree, true);
  assert.equal(await banner.init(), false);
  assert.equal(style.get(AD_HEIGHT_VAR), '0px');

  // 購入が無ければ無料の上限に戻る
  const free = settingsWithPurchase(settings, {});
  assert.equal(itemLimit(free), FREE_ITEM_LIMIT);
  assert.equal(folderLimit(free), FREE_FOLDER_LIMIT);
  assert.equal(canUseFeature(free, 'cost'), false);
});

/* ---------------- 4) 購入・復元の流れ ---------------- */

test('買い切りの購入が通ると Pro になり、トランザクションを完了する', async () => {
  const env = makeStore();
  await env.proStore.purchase('lifetime');
  assert.equal(env.orders.length, 1, 'ストアに注文が出ていない');
  assert.equal(env.orders[0].productId, LIFETIME_PRODUCT_ID);

  let finished = 0;
  env.store.fire('approved', {
    products: [{ id: LIFETIME_PRODUCT_ID }],
    finish: async () => { finished += 1; },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(env.proStore.purchased.lifetime, true);
  assert.equal(env.proStore.snapshot().pro, true);
  assert.equal(finished, 1, 'トランザクションを完了していない');
  assert.equal(env.messages.at(-1).kind, 'purchased');
  assert.deepEqual(planVisibility(env.proStore.purchased), { lifetime: false, monthly: false });
});

test('月額の購入も Pro になり、二重購入は案内だけ出す', async () => {
  const env = makeStore();
  env.store.fire('approved', { products: [{ id: MONTHLY_PRODUCT_ID }], finish: async () => {} });
  assert.equal(env.proStore.purchased.monthly, true);
  assert.equal(env.proStore.snapshot().pro, true);

  const before = env.orders.length;
  await env.proStore.purchase('monthly');
  assert.equal(env.orders.length, before, '購入済みなのに注文を出している');
  assert.equal(env.messages.at(-1).kind, 'already');
});

test('購入を復元できる（復元できる購入が無いときも案内する）', async () => {
  const restored = makeStore({ owned: { lifetime: true } });
  assert.equal(await restored.proStore.restore(), true);
  assert.equal(restored.proStore.purchased.lifetime, true);
  assert.equal(restored.messages.at(-1).kind, 'restored');

  const empty = makeStore();
  assert.equal(await empty.proStore.restore(), false);
  assert.equal(empty.messages.at(-1).kind, 'restore-empty');
});

test('復元したトランザクション（approved で再送）でも Pro になる', () => {
  const env = makeStore();
  env.proStore.reason = 'restore';
  env.store.fire('approved', { products: [{ id: LIFETIME_PRODUCT_ID }], finish: async () => {} });
  assert.equal(env.proStore.purchased.lifetime, true);
  assert.equal(env.purchases.at(-1).reason, 'restore');
});

test('購入のキャンセルと失敗は、状態を変えずに案内だけ出す', () => {
  const env = makeStore();
  env.store.fire('error', { code: 'payment-cancelled', message: 'cancelled' });
  assert.equal(env.messages.at(-1).kind, 'cancelled');
  assert.equal(env.proStore.purchased.lifetime, false);

  env.store.fire('error', { code: 'purchase', message: 'failed' });
  assert.equal(env.messages.at(-1).kind, 'failed');
  assert.equal(env.proStore.snapshot().pro, false);
});

/* ---------------- 5) Web では課金しない ---------------- */

test('Web（GitHub Pages）では購入も復元もせず、iOSアプリからと案内する', async () => {
  const env = makeStore({ native: false });
  assert.equal(isNativeWindow({}), false);
  assert.equal(isNativeWindow({ Capacitor: { isNative: true } }), true);
  assert.equal(isNativeWindow({ Capacitor: { isNativePlatform: () => true } }), true);
  assert.equal(env.proStore.available, false);

  assert.equal(await env.proStore.purchase('lifetime'), false);
  assert.equal(env.orders.length, 0, 'Webでストアに注文してしまっている');
  assert.equal(env.messages.at(-1).kind, 'web');
  assert.equal(env.messages.at(-1).title, WEB_PURCHASE_NOTE);

  assert.equal(await env.proStore.restore(), false);
  assert.equal(env.messages.at(-1).kind, 'web');
  assert.equal(env.store.readyCallbacks.length, 0, 'Webでストアを初期化している');
  assert.equal(env.proStore.snapshot().pro, false);
});

test('ストアが準備できていないときは、購入せずに案内する（無料で配らない）', async () => {
  const messages = [];
  const proStore = new ProStore({ win: {}, native: true, onMessage: (m) => messages.push(m) });
  assert.equal(await proStore.purchase('lifetime'), false);
  assert.equal(messages.at(-1).kind, 'unavailable');
  assert.equal(proStore.snapshot().pro, false);
  // プラグインが無いあいだは attach できないので、購入はできないまま（開始は待ち状態）
  assert.equal(proStore.attach({}), false);
  assert.equal(proStore.start(), true, 'プラグインを待つために開始状態になる');
  assert.equal(proStore.start(), false, '二重に開始しない');
  assert.equal(proStore.available, false);
});

/* ---------------- 6) サブスクの期限切れ ---------------- */

test('月額が切れたら Pro を外す（買い切りは残る）', () => {
  const env = makeStore({ owned: { monthly: true } });
  assert.equal(env.proStore.snapshot().pro, true);

  env.products[MONTHLY_PRODUCT_ID].setOwned(false);
  env.proStore.syncEntitlements();
  assert.equal(env.proStore.purchased.monthly, false);
  assert.equal(env.purchases.at(-1).pro, false);

  const lifetime = makeStore({ owned: { lifetime: true, monthly: true } });
  lifetime.products[MONTHLY_PRODUCT_ID].setOwned(false);
  lifetime.proStore.syncEntitlements();
  assert.equal(lifetime.proStore.purchased.lifetime, true);
  assert.equal(lifetime.proStore.snapshot().pro, true);
});

test('商品情報が来る前は、保存している購入状態を消さない', () => {
  const proStore = new ProStore({ win: {}, native: true });
  proStore.purchased = { lifetime: true, monthly: false };
  proStore.attach({
    store: { register() {}, when: () => ({}), error() {}, ready() {}, initialize() {}, get: () => null },
    ProductType: { NON_CONSUMABLE: 'n', PAID_SUBSCRIPTION: 's' },
    Platform: { APPLE_APPSTORE: 'ios-appstore' },
  });
  proStore.syncEntitlements();
  assert.equal(proStore.purchased.lifetime, true, '商品未取得で購入状態を消してしまっている');
});

test('注記と案内の文言（自動更新・復元）', () => {
  const notice = subscriptionNoticeText();
  assert.match(notice, /自動で更新/);
  assert.match(notice, /¥150/);
  assert.match(notice, /解約/);
  for (const kind of ['restoring', 'restored', 'restore-empty', 'purchased', 'already', 'pending', 'cancelled', 'unavailable', 'loading', 'failed', 'web', 'busy']) {
    const message = purchaseMessage(kind, { lifetime: true });
    assert.ok(message.title, `${kind} の見出しがありません`);
    assert.equal(EMOJI.test(message.title), false, `${kind} に絵文字があります`);
  }
});

test('バックアップ復元などで設定が変わっても、プランの表示は設定から決まる', () => {
  // 画面は固定値を持たず、保存している設定から毎回読む（復元直後でも買い切り→月額非表示になる）
  const restored = settingsWithPurchase({}, { lifetime: true });
  assert.deepEqual(planVisibility(purchaseFromSettings(restored)), { lifetime: false, monthly: false });
  assert.equal(planStatusLabel(restored), 'Pro（買い切り）');
  assert.match(read('app.js'), /const purchase = purchaseFromSettings\(state\.settings\);/);
});

/* ---------------- 7) 画面と配布物 ---------------- */

test('プラン画面・設定に購入と復元の導線、規約リンク、自動更新の注記がある', () => {
  const html = read('index.html');
  const app = read('app.js');
  for (const id of ['proPlans', 'proSheetPlans', 'btnProRestore', 'btnProSheetRestore', 'proNote', 'proSheetNote']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} がありません`);
  }
  // 復元ボタンはプラン画面と設定の両方に置く
  assert.match(html, /data-pro-restore/);
  assert.match(html, /terms\.html/);
  assert.match(html, /privacy\.html/);
  // 自動更新の注記は iap.js の文言を画面に出す（文言を2か所に散らさない）
  assert.match(app, /subscriptionNoticeText/);
  // Webでも注記を出す（課金できないことと、月額の自動更新の両方）
  const noteBlock = app.slice(app.indexOf('function renderProOffer'), app.indexOf('function openProSheet'));
  assert.match(noteBlock, /WEB_PURCHASE_NOTE/);
  assert.match(noteBlock, /subscriptionNoticeText/);
  assert.match(app, /planVisibility/);
  assert.match(app, /settingsWithPurchase/);
  assert.match(app, /from '\.\/iap\.js'/);
  assert.equal(/いまは無料で試せます（課金はまだ入りません）/.test(html), false, '「課金はまだ入りません」が残っている');
  // 買い切り購入後に月額を出さない判定を使っている
  assert.match(app, /data-pro-plan="\$\{esc\(plan\.key\)\}"/);
});

test('利用規約（terms.html）に課金・自動更新・返金の記載がある', () => {
  const terms = read('terms.html');
  assert.match(terms, /利用規約/);
  assert.match(terms, /自動更新/);
  assert.match(terms, /¥150/);
  assert.match(terms, /¥1,500/);
  assert.match(terms, /サブスクリプション/);
  assert.match(terms, /返金/);
  assert.match(terms, /privacy\.html/);
  assert.equal(EMOJI.test(terms), false, 'terms.html に絵文字があります');
});

test('配布物（www/・Service Worker）に iap.js と terms.html が入る', () => {
  const build = read('scripts/build.mjs');
  const sw = read('sw.js');
  assert.match(build, /'iap\.js'/);
  assert.match(build, /'terms\.html'/);
  assert.match(sw, /'\.\/iap\.js'/);
  assert.match(sw, /'\.\/terms\.html'/);
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies['cordova-plugin-purchase'], 'cordova-plugin-purchase が依存に入っていません');
  assert.match(pkg.dependencies['cordova-plugin-purchase'], /^\^13\./);
  // CI は app.js / index.html / package.json の変更で走る
  // （iap.js・terms.html を paths に足す変更は、ワークフローを変更する権限が無いため保留。
  //   現在の paths でも app.js と package.json が変わるリリースでは必ずビルドされる）
  const workflow = read('.github/workflows/ios-build.yml');
  assert.match(workflow, /- 'app\.js'/);
  assert.match(workflow, /- 'package\.json'/);
  assert.match(workflow, /npm test/);
  assert.equal(EMOJI.test(read('iap.js')), false, 'iap.js に絵文字があります');
});
