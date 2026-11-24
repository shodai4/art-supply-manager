/**
 * iOS のトラッキング許可（ATT）ダイアログ。
 *
 * App Store 審査（2026-11-24・ビルド1.0(94)）で「Guideline 2.1 - Information Needed」により
 * リジェクトされた原因は、AdMob を入れているのに許可ダイアログが出ていなかったこと。
 *
 *   1) まだ聞いていない（notDetermined）ときだけ聞く。拒否・制限・許可済みは尊重する
 *   2) AdMob.initialize() より必ず先に、画面が表示されてから聞く（iOS 15+ は前面でないと出ない）
 *   3) ダイアログが出なかったときは、もう一度だけ聞き直す
 *   4) 答えないまま固まらないよう上限を置き、失敗してもアプリと広告の初期化は続く
 *   5) Web・Android・プラグイン無しでもエラーにしない
 *   6) Info.plist の説明文は残し、configure-ios の「いまは許可を求めていない」古いコメントは消す
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATT_STATUS, ATT_VISIBLE_TIMEOUT, ATT_SETTLE_MS, ATT_ATTEMPTS, ATT_REQUEST_TIMEOUT,
  normalizeTrackingStatus, shouldRequestTrackingAuthorization, trackingPlatform, isDocumentVisible,
  waitUntilVisible, readTrackingAuthorizationStatus, ensureTrackingAuthorization, withTimeout,
  AdBanner, setupAdBanner,
} from '../admob.js';
import { CONFIG_ENTRIES } from '../scripts/configure-ios.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

/** すぐ返る待ち（テストを実時間で待たせない） */
const noWait = async () => {};

/**
 * 起動1回ぶんの偽の環境。何がどの順で呼ばれたかを events に残す。
 * status は配列で渡す（呼ばれるたびに次の値へ進む。最後の値は繰り返す）。
 */
function fakeStartup({
  platform = 'ios',
  native = true,
  statuses = [ATT_STATUS.NOT_DETERMINED, ATT_STATUS.AUTHORIZED],
  request = 'resolve',
  visibility = 'visible',
  withPlugin = true,
  withStatusMethod = true,
  withRequestMethod = true,
  hiddenFor = 0,
} = {}) {
  const events = [];
  let statusIndex = 0;
  const nextStatus = () => {
    const value = statuses[Math.min(statusIndex, statuses.length - 1)];
    statusIndex += 1;
    return value;
  };
  const plugin = {
    async trackingAuthorizationStatus() {
      if (!withStatusMethod) throw new Error('not implemented');
      const status = nextStatus();
      events.push(`status:${status}`);
      return { status };
    },
    async requestTrackingAuthorization() {
      events.push('request');
      if (request === 'reject') throw new Error('request failed');
      if (request === 'hang') return new Promise(() => {});
      return undefined;
    },
    async initialize() { events.push('initialize'); },
    async showBanner() { events.push('showBanner'); return undefined; },
    async hideBanner() { events.push('hideBanner'); },
    addListener() { return Promise.resolve({ remove() {} }); },
  };
  if (!withRequestMethod) delete plugin.requestTrackingAuthorization;
  if (!withStatusMethod) {
    // 状態が読めない環境（メソッド自体が無い）
    delete plugin.trackingAuthorizationStatus;
  }

  const doc = {
    visibilityState: visibility,
    documentElement: { style: { setProperty() {} } },
    body: { setAttribute() {}, removeAttribute() {} },
  };
  const win = {
    Capacitor: {
      isNativePlatform: () => native,
      getPlatform: () => platform,
      Plugins: withPlugin ? { AdMob: plugin } : {},
    },
    document: doc,
  };
  let waits = 0;
  const wait = async () => {
    waits += 1;
    if (hiddenFor > 0 && waits >= hiddenFor) doc.visibilityState = 'visible';
  };
  return { plugin, events, doc, win, wait, waits: () => waits };
}

/* ---------------- 状態と判断 ---------------- */

test('許可の状態は iOS の値をそのままそろえる', () => {
  assert.equal(normalizeTrackingStatus('notDetermined'), 'notDetermined');
  assert.equal(normalizeTrackingStatus({ status: 'authorized' }), 'authorized');
  assert.equal(normalizeTrackingStatus({ status: ' denied ' }), 'denied');
  assert.equal(normalizeTrackingStatus(undefined), null);
  assert.equal(normalizeTrackingStatus({}), null);
  assert.equal(normalizeTrackingStatus({ status: '' }), null);
  assert.equal(normalizeTrackingStatus({ status: 3 }), null);
  assert.deepEqual(Object.values(ATT_STATUS), ['authorized', 'denied', 'restricted', 'notDetermined']);
});

test('許可ダイアログを出すのは「まだ聞いていない」ときだけ', () => {
  assert.equal(shouldRequestTrackingAuthorization(ATT_STATUS.NOT_DETERMINED), true);
  assert.equal(shouldRequestTrackingAuthorization(ATT_STATUS.AUTHORIZED), false);
  assert.equal(shouldRequestTrackingAuthorization(ATT_STATUS.DENIED), false, '拒否の答えを変えない');
  assert.equal(shouldRequestTrackingAuthorization(ATT_STATUS.RESTRICTED), false);
  assert.equal(shouldRequestTrackingAuthorization(null), false, '分からないときは出さない');
});

test('土台の判定と画面の表示状態', () => {
  assert.equal(trackingPlatform({ Capacitor: { getPlatform: () => 'ios' } }), 'ios');
  assert.equal(trackingPlatform({ Capacitor: { getPlatform: () => 'android' } }), 'android');
  assert.equal(trackingPlatform({ Capacitor: { getPlatform: () => 'web' } }), 'web');
  assert.equal(trackingPlatform({}), '');
  assert.equal(trackingPlatform(undefined), '');
  assert.equal(trackingPlatform({ Capacitor: { getPlatform: () => { throw new Error('x'); } } }), '');

  assert.equal(isDocumentVisible({ visibilityState: 'visible' }), true);
  assert.equal(isDocumentVisible({ visibilityState: 'hidden' }), false);
  assert.equal(isDocumentVisible({}), true, '分からない環境では表示中とみなす');
  assert.equal(isDocumentVisible(undefined), true);
});

test('画面が表示中になるまで待つ（上限あり）', async () => {
  const doc = { visibilityState: 'hidden' };
  let calls = 0;
  const wait = async () => { calls += 1; if (calls >= 3) doc.visibilityState = 'visible'; };
  assert.equal(await waitUntilVisible({ doc, wait, timeout: 1000, interval: 10 }), true);
  assert.equal(calls, 3);
  // 一度も表示されなければ false（待ち続けない）
  const stuck = { visibilityState: 'hidden' };
  assert.equal(await waitUntilVisible({ doc: stuck, wait: noWait, timeout: 100, interval: 10 }), false);
  // はじめから表示中なら待たない
  assert.equal(await waitUntilVisible({ doc: { visibilityState: 'visible' }, wait: noWait }), true);
});

test('状態が読めないときは null（例外にしない）', async () => {
  assert.equal(await readTrackingAuthorizationStatus(null), null);
  assert.equal(await readTrackingAuthorizationStatus({}), null);
  assert.equal(await readTrackingAuthorizationStatus({ trackingAuthorizationStatus: async () => ({ status: 'denied' }) }), 'denied');
  assert.equal(await readTrackingAuthorizationStatus({ trackingAuthorizationStatus: async () => { throw new Error('no'); } }), null);
});

test('上限つきの待ちは、過ぎたら TIMED_OUT を返して先へ進む', async () => {
  const never = new Promise(() => {});
  const out = await withTimeout(never, 20);
  assert.equal(typeof out, 'symbol', '時間切れを表す値が返る');
  assert.equal(await withTimeout(Promise.resolve('ok'), 20), 'ok');
  assert.equal(await withTimeout(Promise.resolve('ok'), 0), 'ok', '上限0は待たない');
});

/* ---------------- 起動時の流れ ---------------- */

test('iOS でまだ聞いていないときは、広告の初期化より先に許可を求める', async () => {
  const env = fakeStartup({ statuses: ['notDetermined', 'authorized'] });
  const banner = new AdBanner({ win: env.win, doc: env.doc, log() {} });
  assert.equal(await banner.init(), true);

  const order = env.events.join(' > ');
  assert.equal(order, 'status:notDetermined > request > status:authorized > initialize > showBanner');
  assert.ok(env.events.indexOf('request') < env.events.indexOf('initialize'), '許可ダイアログが初期化より先ではない');
  assert.equal(banner.tracking.status, 'authorized');
  assert.equal(banner.tracking.requested, true);
  assert.equal(banner.tracking.attempts, 1);
  assert.equal(banner.tracking.reason, 'answered-authorized');
});

test('画面が表示される前には頼まない（iOS 15+ で出なくなるため）', async () => {
  const env = fakeStartup({ visibility: 'hidden', hiddenFor: 4, statuses: ['notDetermined', 'denied'] });
  const banner = new AdBanner({ win: env.win, doc: env.doc, log() {}, wait: env.wait, att: { settleMs: 0 } });
  await banner.init();
  // 表示中になるまで待ってから聞いている（最初のイベントが request ではない）
  assert.equal(env.events[0], 'status:notDetermined');
  assert.ok(env.events.indexOf('request') > 0);
  assert.ok(env.waits() >= 4, '表示中になるまで待っている');
  assert.ok(env.events.indexOf('request') < env.events.indexOf('initialize'));
  assert.equal(env.doc.visibilityState, 'visible');
});

test('拒否・制限・許可済みなら、もう聞かずに広告の初期化へ進む', async () => {
  for (const status of ['denied', 'restricted', 'authorized']) {
    const env = fakeStartup({ statuses: [status] });
    const banner = new AdBanner({ win: env.win, doc: env.doc, log() {} });
    assert.equal(await banner.init(), true, status);
    assert.equal(env.events.includes('request'), false, `${status} なのに聞き直している`);
    assert.ok(env.events.includes('initialize'));
    assert.equal(banner.tracking.status, status);
    assert.equal(banner.tracking.reason, `already-${status}`);
  }
});

test('答えてもらえなくても（notDetermined のまま）もう一度だけ聞き直し、広告は出す', async () => {
  const env = fakeStartup({ statuses: ['notDetermined'], request: 'resolve' });
  const banner = new AdBanner({ win: env.win, doc: env.doc, log() {}, wait: env.wait, att: { settleMs: 1 } });
  await banner.init();
  assert.equal(banner.tracking.attempts, ATT_ATTEMPTS, '決めた回数だけ聞き直す');
  assert.equal(env.events.filter((e) => e === 'request').length, ATT_ATTEMPTS);
  assert.ok(env.events.includes('initialize'), 'ダイアログが出なくても広告の初期化は続ける');
  assert.equal(banner.tracking.reason, 'still-not-determined');
});

test('許可を求められなくても、アプリと広告の初期化は止まらない', async () => {
  const env = fakeStartup({ statuses: ['notDetermined'], request: 'reject' });
  const banner = new AdBanner({ win: env.win, doc: env.doc, log() {} });
  assert.equal(await banner.init(), true);
  assert.equal(banner.tracking.requested, false);
  assert.equal(banner.tracking.reason, 'request-failed');
  assert.ok(env.events.includes('initialize'));
});

test('ダイアログに答えないままでも、待ち時間の上限で広告の初期化へ進む', async () => {
  const env = fakeStartup({ statuses: ['notDetermined'], request: 'hang' });
  const banner = new AdBanner({ win: env.win, doc: env.doc, log() {}, wait: env.wait, att: { settleMs: 0, attempts: 1, requestTimeout: 30 } });
  const started = Date.now();
  assert.equal(await banner.init(), true);
  assert.ok(Date.now() - started < 2000, '上限を超えて待ち続けている');
  assert.equal(banner.tracking.requested, false);
  assert.ok(env.events.includes('initialize'));
});

test('状態が読めない iOS でも、許可ダイアログは出しに行く', async () => {
  const env = fakeStartup({ withStatusMethod: false, platform: 'ios' });
  const banner = new AdBanner({ win: env.win, doc: env.doc, log() {} });
  await banner.init();
  assert.equal(env.events.filter((e) => e === 'request').length >= 1, true);
  assert.ok(env.events.includes('initialize'));
});

test('Web・Android では iOS の許可ダイアログを出さない', async () => {
  for (const platform of ['web', 'android']) {
    const env = fakeStartup({ platform, native: false, statuses: ['notDetermined'] });
    const banner = new AdBanner({ win: env.win, doc: env.doc, log() {} });
    await banner.init();
    assert.equal(env.events.includes('request'), false, `${platform} で聞いている`);
  }
  // Android でネイティブ判定でも聞かない
  const android = fakeStartup({ platform: 'android', statuses: ['notDetermined'] });
  const banner = new AdBanner({ win: android.win, doc: android.doc, log() {} });
  await banner.init();
  assert.equal(android.events.includes('request'), false);
  assert.equal(banner.tracking.reason, 'not-ios-android');
});

test('プラグインが無い・古い（メソッドが無い）ときもエラーにしない', async () => {
  const none = fakeStartup({ withPlugin: false });
  const a = new AdBanner({ win: none.win, doc: none.doc, log() {} });
  assert.equal(await a.init(), false, 'プラグインが無ければ広告は出さない（従来どおり）');

  const old = fakeStartup({ withRequestMethod: false, statuses: ['notDetermined'] });
  const b = new AdBanner({ win: old.win, doc: old.doc, log() {} });
  assert.equal(await b.init(), true);
  assert.equal(b.tracking.reason, 'unsupported');
  assert.ok(old.events.includes('initialize'));
});

test('起動時にProなら、広告も許可ダイアログも出さない（広告を出さないので追跡もしない）', async () => {
  const env = fakeStartup({ statuses: ['notDetermined', 'authorized'] });
  const banner = setupAdBanner({ win: env.win, doc: env.doc, log() {}, isPro: () => true });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(env.events.includes('request'), false);
  assert.equal(env.events.includes('initialize'), false);
  assert.equal(banner.tracking, null);
});

/* ---------------- コードと設定の担保 ---------------- */

test('admob.js は initialize の前に許可を求める実装になっている', () => {
  const src = read('admob.js');
  assert.match(src, /requestTrackingAuthorization/);
  assert.match(src, /trackingAuthorizationStatus/);
  const initBody = src.slice(src.indexOf('async init()'), src.indexOf('async prepareTracking()'));
  const prepareAt = initBody.indexOf('await this.prepareTracking();');
  const initializeAt = initBody.indexOf('this.plugin.initialize(');
  assert.ok(prepareAt > -1, 'init() で許可の確認をしていない');
  assert.ok(initializeAt > -1);
  assert.ok(prepareAt < initializeAt, '許可ダイアログより先に広告を初期化している');
  // 古い説明（許可を求めていない前提）が残っていない
  assert.equal(/いまは許可を求めていない/.test(src), false);
  assert.equal(/いまは許可を求めていない/.test(read('scripts/configure-ios.mjs')), false);
});

test('起動の入口（app.js）から呼ばれ、Info.plist にATTの説明文がある', () => {
  const app = read('app.js');
  assert.match(app, /adBanner = setupAdBanner\(\{ isPro: \(\) => isPro\(state\.settings\) \}\);/);
  const keys = CONFIG_ENTRIES.map((e) => e.key);
  assert.ok(keys.includes('NSUserTrackingUsageDescription'));
  assert.ok(keys.includes('GADApplicationIdentifier'));
  const entry = CONFIG_ENTRIES.find((e) => e.key === 'NSUserTrackingUsageDescription');
  assert.match(entry.value, /広告識別子/);
  assert.match(entry.value, /許可しない場合も/);
});

test('待ち時間の初期値は現実的な範囲', () => {
  assert.ok(ATT_VISIBLE_TIMEOUT > 0 && ATT_VISIBLE_TIMEOUT <= 10000);
  assert.ok(ATT_SETTLE_MS > 0 && ATT_SETTLE_MS <= 1000);
  assert.ok(ATT_ATTEMPTS >= 1 && ATT_ATTEMPTS <= 3);
  assert.ok(ATT_REQUEST_TIMEOUT >= 5000 && ATT_REQUEST_TIMEOUT <= 60000);
});
