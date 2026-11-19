/**
 * 最下部の AdMob バナーと、バナー分の余白。
 *
 *   1) いまは TestFlight 確認のため Google 公式のテスト広告（USE_TEST_ADS = true。
 *      審査提出の直前に false へ戻すと本番IDで配信する）
 *   2) iOSアプリのネイティブ起動時だけ出す（Webブラウザ／GitHub Pagesでは何もしない）
 *   3) 読み込めた実測の高さを CSS 変数 --ad-h に入れ、タブバー・FAB・一覧の下端を押し上げる
 *   4) Info.plist の GADApplicationIdentifier と admob.js のアプリIDが一致する
 *   5) 配布物（www/・Service Worker）に admob.js が入る
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const require_os = os;
import { fileURLToPath } from 'node:url';
import {
  USE_TEST_ADS, ADMOB_TEST_APP_ID, ADMOB_TEST_BANNER_ID, ADMOB_PROD_APP_ID, ADMOB_PROD_BANNER_ID,
  ADMOB_APP_ID, ADMOB_BANNER_ID,
  ADMOB_BANNER_FALLBACK_HEIGHT, AD_HEIGHT_VAR, adMobPlugin, shouldShowAdBanner, bannerLiftHeight,
  bannerShowOptions, bannerInitializeOptions, applyBannerLift, clearBannerLift, AdBanner, setupAdBanner,
} from '../admob.js';
import {
  CONFIG_ENTRIES, ADMOB_APP_ID as PLIST_APP_ID, configureContent, verifyContent,
  configurePodfileContent, verifyPodfileContent, ADMOB_UMP_POD,
  lockNeedsRefresh, applyAll,
} from '../scripts/configure-ios.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

/* ---------------- 本番IDの設定 ---------------- */

test('TestFlight 確認のため、いまは Google 公式のテスト広告を出している', () => {
  assert.equal(USE_TEST_ADS, true);
  assert.equal(ADMOB_TEST_APP_ID, 'ca-app-pub-3940256099942544~1458002511');
  assert.equal(ADMOB_TEST_BANNER_ID, 'ca-app-pub-3940256099942544/2934735716');
  assert.equal(ADMOB_APP_ID, ADMOB_TEST_APP_ID);
  assert.equal(ADMOB_BANNER_ID, ADMOB_TEST_BANNER_ID);
  // 本番IDは消さない（USE_TEST_ADS を false に戻すだけで審査提出用になる）
  assert.equal(ADMOB_PROD_APP_ID, 'ca-app-pub-5739782559889389~2686704558');
  assert.equal(ADMOB_PROD_BANNER_ID, 'ca-app-pub-5739782559889389/1132135646');
  // テスト広告のあいだは isTesting を添える（自分の広告を誤って押しても無効トラフィックにしない）
  const show = bannerShowOptions();
  assert.equal(show.isTesting, true);
  assert.equal(show.adId, ADMOB_TEST_BANNER_ID);
  assert.equal(show.position, 'BOTTOM_CENTER');
  assert.equal(show.margin, 0);
  assert.equal(show.adSize, 'ADAPTIVE_BANNER');
  assert.equal(bannerInitializeOptions().initializeForTesting, true);
});

test('出すのはiOSアプリのネイティブ起動時だけ（Webでは広告枠も余白も出さない）', () => {
  assert.equal(shouldShowAdBanner({ native: true, hasPlugin: true }), true);
  assert.equal(shouldShowAdBanner({ native: false, hasPlugin: true }), false);
  assert.equal(shouldShowAdBanner({ native: true, hasPlugin: false }), false);
  const plugin = { showBanner() {} };
  assert.equal(adMobPlugin({ Capacitor: { Plugins: { AdMob: plugin } } }), plugin);
  assert.equal(adMobPlugin({}), null);
  assert.equal(adMobPlugin(undefined), null);
});

test('余白の高さは実測値を使い、おかしな値は予備値・上下限に倒す', () => {
  assert.equal(bannerLiftHeight(50), 50);
  assert.equal(bannerLiftHeight(60), 60);
  assert.equal(bannerLiftHeight(0), ADMOB_BANNER_FALLBACK_HEIGHT);
  assert.equal(bannerLiftHeight(-10), ADMOB_BANNER_FALLBACK_HEIGHT);
  assert.equal(bannerLiftHeight('abc'), ADMOB_BANNER_FALLBACK_HEIGHT);
  assert.equal(bannerLiftHeight(undefined), ADMOB_BANNER_FALLBACK_HEIGHT);
  assert.equal(bannerLiftHeight(1000), 120, '上限を超えない');
  assert.equal(bannerLiftHeight(2), 32, '下限より小さくしない');
});

/* ---------------- 余白（CSS変数） ---------------- */

function fakeEnv({ native = true, withPlugin = true } = {}) {
  const calls = { initialize: [], showBanner: [], hideBanner: 0 };
  const listeners = new Map();
  const plugin = {
    async initialize(options) { calls.initialize.push(options); },
    async showBanner(options) { calls.showBanner.push(options); },
    async hideBanner() { calls.hideBanner += 1; },
    addListener(name, handler) {
      listeners.set(name, handler);
      return Promise.resolve({ remove() {} });
    },
  };
  const style = new Map();
  const attributes = new Map();
  const doc = {
    documentElement: { style: { setProperty: (k, v) => style.set(k, v) } },
    body: {
      setAttribute: (k, v) => attributes.set(k, v),
      removeAttribute: (k) => attributes.delete(k),
    },
  };
  const win = {
    Capacitor: {
      isNativePlatform: () => native,
      Plugins: withPlugin ? { AdMob: plugin } : {},
    },
  };
  return { plugin, calls, listeners, style, attributes, doc, win };
}

test('余白はCSS変数 --ad-h で入れ、解除すると0に戻る', () => {
  const env = fakeEnv();
  const h = applyBannerLift(env.doc, 50);
  assert.equal(h, 50);
  assert.equal(env.style.get(AD_HEIGHT_VAR), '50px');
  assert.equal(env.attributes.get('data-ad-banner'), 'true');
  clearBannerLift(env.doc);
  assert.equal(env.style.get(AD_HEIGHT_VAR), '0px');
  assert.equal(env.attributes.get('data-ad-banner'), 'false');
});

test('ネイティブでは初期化→バナー表示。読み込めた大きさに合わせて余白が決まる', async () => {
  const env = fakeEnv();
  const banner = new AdBanner({ win: env.win, doc: env.doc, log() {} });
  assert.equal(banner.enabled, true);
  assert.equal(await banner.init(), true);
  assert.equal(env.calls.initialize.length, 1);
  assert.equal(env.calls.initialize[0].initializeForTesting, true);
  assert.equal(env.calls.showBanner.length, 1);
  assert.equal(env.calls.showBanner[0].isTesting, true);
  assert.equal(env.calls.showBanner[0].adId, ADMOB_TEST_BANNER_ID);

  // 読み込めたら予備の高さで先に余白を確保し、実測が来たら合わせる
  env.listeners.get('bannerAdLoaded')();
  assert.equal(env.style.get(AD_HEIGHT_VAR), `${ADMOB_BANNER_FALLBACK_HEIGHT}px`);
  env.listeners.get('bannerAdSizeChanged')({ width: 375, height: 50 });
  assert.equal(env.style.get(AD_HEIGHT_VAR), '50px');
  // 出せなかったら余白を残さない（下に空白を作らない）
  env.listeners.get('bannerAdFailedToLoad')();
  assert.equal(env.style.get(AD_HEIGHT_VAR), '0px');
  assert.equal(env.attributes.get('data-ad-banner'), 'false');

  // 二重初期化しない
  await banner.init();
  assert.equal(env.calls.initialize.length, 1);
});

test('Webブラウザでは初期化も表示もせず、余白も入れない', async () => {
  const env = fakeEnv({ native: false });
  const banner = new AdBanner({ win: env.win, doc: env.doc, log() {} });
  assert.equal(banner.enabled, false);
  assert.equal(await banner.init(), false);
  assert.equal(env.calls.initialize.length, 0);
  assert.equal(env.calls.showBanner.length, 0);
  assert.equal(env.attributes.get('data-ad-banner'), 'false');
  // プラグインが入っていてもネイティブでなければ出さない
  const noPlugin = fakeEnv({ native: true, withPlugin: false });
  const other = setupAdBanner({ win: noPlugin.win, doc: noPlugin.doc, log() {} });
  assert.equal(other.enabled, false);
  assert.equal(noPlugin.attributes.get('data-ad-banner'), 'false');
});

/* ---------------- 画面の配線と余白（CSS） ---------------- */

test('アプリは起動時にバナーを用意し、CSSはバナー分だけ下を持ち上げる', () => {
  const app = read('app.js');
  assert.match(app, /import \{ setupAdBanner \} from '\.\/admob\.js';/);
  assert.match(app, /adBanner = setupAdBanner\(\{ isPro: \(\) => isPro\(state\.settings\) \}\);/);

  const css = read('styles.css');
  // 既定は0（Web・広告が出ていないときは何も変わらない）
  assert.match(css, /:root\s*\{[^}]*--ad-h:\s*0px/);
  // 本文の下余白
  assert.match(css, /body\s*\{[^}]*padding-bottom:\s*calc\(var\(--tabbar-h\)[^;]*var\(--ad-h\)[^;]*env\(safe-area-inset-bottom\)/);
  // タブバーは普段は画面最下部（セーフエリアは padding で確保）
  assert.match(css, /\.tabbar\s*\{[^}]*bottom:\s*0;/);
  assert.match(css, /\.tabbar\s*\{[^}]*padding-bottom:\s*env\(safe-area-inset-bottom\)/);
  // バナーが出ている間も下端は 0 のまま、中身だけをバナー＋セーフエリア分持ち上げる
  // （バーの地色がバナーの背後と下のセーフエリアまで覆い、後ろの内容が透けない）
  assert.match(css, /body\[data-ad-banner="true"\] \.tabbar\s*\{[^}]*height:\s*calc\(var\(--tabbar-h\) \+ var\(--ad-h\) \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /body\[data-ad-banner="true"\] \.tabbar\s*\{[^}]*padding-bottom:\s*calc\(var\(--ad-h\) \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.tabbar\s*\{[^}]*bottom:\s*0;/);
  assert.equal(/body\[data-ad-banner="true"\] \.tabbar\s*\{[^}]*[\n;]\s*bottom:\s*calc/.test(css), false, 'タブバーが上に浮いてバナー裏が透明になっている');
  // 下部操作ドックは廃止（タブバー＋バナーだけ）
  assert.equal(/\.dock\s*\{/.test(css), false);
  // 選択バー・FAB・トースト・シートも同じだけ持ち上げる
  assert.match(css, /\.selbar\s*\{[^}]*bottom:\s*calc\(var\(--tabbar-h\) \+ var\(--ad-h\)/);
  assert.match(css, /\.fab\s*\{[^}]*bottom:\s*calc\(var\(--tabbar-h\)[^;]*var\(--ad-h\)/);
  assert.match(css, /\.fab\.scan\s*\{[^}]*bottom:\s*calc\(var\(--tabbar-h\)[^;]*var\(--ad-h\)/);
  assert.match(css, /\.toast\s*\{[^}]*bottom:\s*calc\(var\(--tabbar-h\)[^;]*var\(--ad-h\)/);
  assert.match(css, /\.sheet\s*\{[^}]*padding:\s*14px 14px calc\(18px \+ var\(--ad-h\)/);
});

/* ---------------- Info.plist・配布物 ---------------- */

test('Info.plist に AdMob のアプリID・SKAdNetwork・ATT の説明を入れる', () => {
  // テスト広告のあいだも、Info.plist のアプリIDは本番のもの（テスト広告ユニットは自分のアプリIDでもテスト広告を返す）
  assert.equal(PLIST_APP_ID, ADMOB_PROD_APP_ID, 'configure-ios と admob.js のアプリIDが揃っている');
  assert.equal(USE_TEST_ADS, true, 'TestFlight 中はテスト広告');
  assert.equal(ADMOB_APP_ID, ADMOB_TEST_APP_ID);
  const keys = CONFIG_ENTRIES.map((e) => e.key);
  for (const key of ['GADApplicationIdentifier', 'SKAdNetworkItems', 'NSUserTrackingUsageDescription']) {
    assert.ok(keys.includes(key), `${key} がありません`);
  }
  const base = '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t<key>CFBundleDisplayName</key>\n\t<string>App</string>\n</dict>\n</plist>\n';
  const { content } = configureContent(base);
  assert.match(content, new RegExp(`<key>GADApplicationIdentifier</key>\\s*<string>${ADMOB_PROD_APP_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</string>`));
  assert.match(content, /<key>SKAdNetworkItems<\/key>\s*<array>[\s\S]*SKAdNetworkIdentifier/);
  assert.match(content, /NSUserTrackingUsageDescription/);
  assert.deepEqual(verifyContent(content), []);
});

test('admob.js は配布物（www/・Service Worker）に入り、絵文字を使わない', () => {
  const sw = read('sw.js');
  const build = read('scripts/build.mjs');
  const pkg = JSON.parse(read('package.json'));
  assert.match(sw, /'\.\/admob\.js'/);
  assert.match(build, /'admob\.js'/);
  assert.ok(pkg.dependencies['@capacitor-community/admob'], 'プラグインが依存に入っていません');
  assert.match(pkg.dependencies['@capacitor-community/admob'], /^\^6\./);
  assert.equal(EMOJI.test(read('admob.js')), false, 'admob.js に絵文字があります');
  // バージョン（キャッシュの更新）
  assert.match(sw, /art-supply-manager-v60/);
  assert.equal(pkg.version, '1.38.0');
});

test('Podfile で UMP を 2.x に固定する（プラグインのSwiftが新しいSDKの改名で壊れるため）', () => {
  // @capacitor-community/admob 6.2.0 は Google-Mobile-Ads-SDK 11.3.0 を指定し、
  // その UMP の依存は >= 1.1 なので、何もしないと 3.x が入ってコンパイルできない
  const podfile = `platform :ios, '13.0'\nuse_frameworks!\n\ndef capacitor_pods\n  pod 'Capacitor'\nend\n\ntarget 'App' do\n  capacitor_pods\nend\n`;
  const out = configurePodfileContent(podfile);
  assert.equal(ADMOB_UMP_POD, "pod 'GoogleUserMessagingPlatform', '~> 2.7'");
  assert.ok(out.content.includes(ADMOB_UMP_POD), 'UMP の固定行がありません');
  // target ブロックの中に入れる
  const targetAt = out.content.indexOf("target 'App' do");
  assert.ok(out.content.indexOf(ADMOB_UMP_POD) > targetAt);
  // 2回目は何も変えない（1行だけ）
  const twice = configurePodfileContent(out.content);
  assert.equal(twice.modified, false);
  assert.equal((twice.content.match(/GoogleUserMessagingPlatform/g) || []).length, 1);
  assert.deepEqual(verifyPodfileContent(out.content), []);
});

test('Podfile.lock が UMP 3.x を持っていたら作り直す（cap sync が先に解決した分）', () => {
  // cap sync は configure-ios より先に pod install するため、Podfile.lock に 3.x が入っている。
  // CocoaPods はロックを下限として扱うので、そのままでは 2.7 固定とぶつかって失敗する。
  assert.equal(lockNeedsRefresh('- GoogleUserMessagingPlatform (2.7.0)\n'), false);
  assert.equal(lockNeedsRefresh('- GoogleUserMessagingPlatform (3.1.0):\n'), true);
  assert.equal(lockNeedsRefresh('- GoogleUserMessagingPlatform (3.0.0):\n'), true);
  assert.equal(lockNeedsRefresh('- GoogleUserMessagingPlatform (1.1.0):\n'), true);
  assert.equal(lockNeedsRefresh('- Capacitor (6.2.0)\n'), false);
  assert.equal(lockNeedsRefresh(''), false);

  // 実ファイルでも、Podfile を直したとき／ロックが 3.x のときは消して解決し直す
  const dir = fs.mkdtempSync(path.join(require_os.tmpdir(), 'asm-lock-'));
  try {
    const podfile = path.join(dir, 'Podfile');
    const lock = path.join(dir, 'Podfile.lock');
    fs.writeFileSync(podfile, "platform :ios, '13.0'\nuse_frameworks!\n\ntarget 'App' do\n  capacitor_pods\nend\n");
    fs.writeFileSync(lock, 'PODS:\n  - Capacitor (6.2.0)\n  - GoogleUserMessagingPlatform (3.1.0)\n');
    const results = applyAll({ plistPath: path.join(dir, 'none.plist'), podfilePath: podfile, projectPath: path.join(dir, 'none.pbxproj'), lockPath: lock });
    assert.equal(fs.existsSync(lock), false, 'Podfile.lock を消していない');
    assert.ok(results.some((r) => r.file === 'Podfile.lock' && r.action === 'removed'));

    // 2回目（Podfile が直っていて、ロックも無い）は何もしない
    fs.writeFileSync(lock, 'PODS:\n  - GoogleUserMessagingPlatform (2.7.0)\n');
    const again = applyAll({ plistPath: path.join(dir, 'none.plist'), podfilePath: podfile, projectPath: path.join(dir, 'none.pbxproj'), lockPath: lock });
    assert.equal(fs.existsSync(lock), true, '2.x のロックは残す');
    assert.ok(again.some((r) => r.file === 'Podfile.lock' && r.action === 'kept'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------------- Pro のときは広告を出さない ---------------- */

test('Pro（プレビュー含む）の間は広告を出さず、終了したら戻す', async () => {
  const env = fakeEnv();
  let pro = true;
  const banner = new AdBanner({ win: env.win, doc: env.doc, log() {}, isPro: () => pro });

  // Proの間は初期化もしない・余白も空けない（タブバーは最下部まで下がる）
  assert.equal(await banner.init(), false);
  assert.equal(env.calls.initialize.length, 0);
  assert.equal(env.calls.showBanner.length, 0);
  assert.equal(env.style.get(AD_HEIGHT_VAR), '0px');
  assert.equal(env.attributes.get('data-ad-banner'), 'false');

  // Proを終了したら広告を出し、読み込めたら余白が戻る
  pro = false;
  await banner.sync();
  assert.equal(env.calls.initialize.length, 1);
  assert.equal(env.calls.showBanner.length, 1);
  env.listeners.get('bannerAdLoaded')();
  assert.equal(env.style.get(AD_HEIGHT_VAR), `${ADMOB_BANNER_FALLBACK_HEIGHT}px`);
  assert.equal(env.attributes.get('data-ad-banner'), 'true');

  // Proに戻したら hideBanner して余白を0に戻す
  pro = true;
  await banner.sync();
  assert.equal(env.calls.hideBanner, 1);
  assert.equal(env.style.get(AD_HEIGHT_VAR), '0px');
  assert.equal(env.attributes.get('data-ad-banner'), 'false');

  // 何度 sync しても増殖しない
  await banner.sync();
  assert.equal(env.calls.hideBanner, 1);

  // もう一度Proを終了すれば、初期化は増やさずに再表示する
  pro = false;
  await banner.sync();
  assert.equal(env.calls.initialize.length, 1);
  assert.equal(env.calls.showBanner.length, 2);
});

test('起動時にProなら広告を用意しない（setupAdBanner）', () => {
  const env = fakeEnv();
  const banner = setupAdBanner({ win: env.win, doc: env.doc, log() {}, isPro: () => true });
  assert.equal(banner.enabled, true);
  assert.equal(env.calls.initialize.length, 0);
  assert.equal(env.calls.showBanner.length, 0);
  assert.equal(env.style.get(AD_HEIGHT_VAR), '0px');
  assert.equal(env.attributes.get('data-ad-banner'), 'false');
});

test('アプリはProの切り替えで広告を出し入れする', () => {
  const app = read('app.js');
  assert.match(app, /setupAdBanner\(\{ isPro: \(\) => isPro\(state\.settings\) \}\)/);
  assert.match(app, /function setProPreview\(on\) \{[\s\S]{0,400}adBanner\?\.sync\(\);/);
});
