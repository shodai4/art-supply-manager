/**
 * iCloud自動バックアップ。
 *
 *   - 書き出す中身は、これまでのJSON書き出しと同じ（在庫・フォルダ・設定＋保存時刻）
 *   - 初回起動だけ戻す／手元にデータがあれば勝手に置き換えない
 *   - 大きすぎるバックアップは送らない・壊れたバックアップは読まない
 *   - iPhoneアプリのプラグインと entitlements がそろっている
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createItem, blankState } from '../core.js';
import {
  ICLOUD_KEY, MAX_SYNC_BYTES, cloudBackupText, parseCloudBackup, decideStartup,
  byteLength, canSync, savedAtLabel, cloudStatusText, icloudPlugin,
} from '../icloud.js';
import {
  entitlementsContent, verifyEntitlementsContent, addEntitlementSetting,
  configurePodfileContent, verifyPodfileContent, ICLOUD_PLUGIN_CLASS,
  ICLOUD_ENTITLEMENT_KEY, configureCapConfigContent, verifyCapConfigContent, applyAll,
} from '../scripts/configure-ios.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function stateWithItems() {
  const st = blankState();
  const a = createItem({ name: 'ウルトラマリン', maker: 'ホルベイン', folderId: 'home', qty: 2 });
  const b = createItem({ name: 'ジェッソ', maker: 'ホルベイン', folderId: 'atelier', qty: 1 });
  return { ...st, items: [a, b], settings: { ...st.settings, favMakers: ['ホルベイン'] } };
}

test('バックアップの中身は、JSON書き出しと同じ（在庫・フォルダ・設定・お気に入り）', () => {
  const st = stateWithItems();
  const text = cloudBackupText(st, { now: new Date('2026-11-19T02:40:00+09:00') });
  const data = JSON.parse(text);
  assert.equal(data.app, 'art-supply-manager');
  assert.equal(data.items.length, 2);
  assert.equal(data.folders.length, st.folders.length);
  assert.deepEqual(data.settings.favMakers, ['ホルベイン']);
  assert.equal(data.savedAt, '2026-11-18T17:40:00.000Z');
  // 読み戻すと、同じ在庫・フォルダ・設定になる
  const back = parseCloudBackup(text);
  assert.equal(back.items, 2);
  assert.equal(back.state.items.length, 2);
  assert.deepEqual(back.state.settings.favMakers, ['ホルベイン']);
  assert.equal(back.savedAt, data.savedAt);
});

test('壊れたバックアップは読まない（手元のデータを壊さない）', () => {
  assert.equal(parseCloudBackup(''), null);
  assert.equal(parseCloudBackup('{'), null);
  assert.equal(parseCloudBackup('{"foo":1}'), null);
});

test('起動時の判断: 初回だけ戻す・手元が新しければ送る・iCloudが新しければ選んでもらう', () => {
  const cloud = { items: 2, savedAt: '2026-11-18T10:00:00.000Z', state: stateWithItems() };
  assert.deepEqual(decideStartup({ fresh: true, cloud, local: blankState() }).action, 'restore');
  // 手元にデータが無い（全削除あと）は、勝手に戻さず選んでもらう
  assert.deepEqual(decideStartup({ fresh: false, cloud, local: { items: [], updatedAt: '' } }).action, 'pull');
  // 手元のほうが新しい
  assert.equal(decideStartup({ fresh: false, cloud, local: { items: [1], updatedAt: '2026-11-19T00:00:00.000Z' } }).action, 'push');
  // iCloudのほうが新しい
  assert.equal(decideStartup({ fresh: false, cloud, local: { items: [1], updatedAt: '2026-11-01T00:00:00.000Z' } }).action, 'pull');
  // 初回でiCloudが空なら、何もせずサンプルを入れる側へ
  assert.equal(decideStartup({ fresh: true, cloud: null, local: blankState() }).action, 'none');
  assert.equal(decideStartup({ fresh: false, cloud: null, local: blankState() }).action, 'push');
});

test('大きすぎるバックアップは送らない（iCloud KVSの1MB上限を超えない）', () => {
  assert.equal(byteLength('あいうえお'), 15);
  assert.equal(canSync('').ok, false);
  const big = 'a'.repeat(MAX_SYNC_BYTES + 10);
  assert.deepEqual(canSync(big).ok, false);
  assert.equal(canSync(big).reason, 'too-large');
  assert.equal(canSync('small').ok, true);
});

test('設定に出す状態文と保存時刻', () => {
  // 端末の時刻表示（実行環境のタイムゾーンで変わるので、同じ値から期待値を作る）
  const at = '2026-11-19T02:40:00+09:00';
  const d = new Date(at);
  const pad = (n) => String(n).padStart(2, '0');
  const expect = `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  assert.equal(savedAtLabel(at), expect);
  assert.equal(savedAtLabel('broken'), '');
  assert.match(cloudStatusText({ native: true, available: true, savedAt: at }), new RegExp(`iCloudに自動保存（最終 ${expect}`));
  assert.match(cloudStatusText({ native: true, available: true, pending: true }), /新しいバックアップ/);
  assert.match(cloudStatusText({ native: false, available: false }), /iPhoneアプリ/);
  assert.match(cloudStatusText({ native: true, available: false, reason: 'no-account' }), /サインイン/);
});

test('Webではネイティブのプラグインを掴まない', () => {
  assert.equal(icloudPlugin({}), null);
  assert.equal(icloudPlugin(undefined), null);
  const plugin = { read() {}, write() {} };
  assert.equal(icloudPlugin({ Capacitor: { Plugins: { ArtICloudSync: plugin } } }), plugin);
});

test('画面（設定）にiCloudのカードがあり、起動時に読みに行く。JSON書き出しも残っている', () => {
  const html = read('index.html');
  assert.match(html, /<h2 class="card-t">iCloudバックアップ<\/h2>/);
  assert.match(html, /id="icloudState"/);
  assert.match(html, /id="btnIcloudRestore"/);
  assert.match(html, /id="btnExport">バックアップ保存</);
  const app = read('app.js');
  assert.match(app, /await initICloud\(\)/);
  assert.match(app, /scheduleCloudPush\(\)/);
  assert.match(app, /fresh: FRESH_INSTALL/);
  // 写真はiCloudに載せない（容量）。コメントでもその方針を残す
  assert.match(read('icloud.js'), /写真・色見本の画像（IndexedDBのBlob）は容量が大きく/);
});

test('iOSのプラグインと entitlements（iCloudのキー・バリュー保存）がそろっている', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'plugins/art-icloud-sync/ios/Sources/ArtICloudSyncPlugin.swift')));
  assert.ok(fs.existsSync(path.join(ROOT, 'plugins/art-icloud-sync/ArtICloudSync.podspec')));
  const swift = read('plugins/art-icloud-sync/ios/Sources/ArtICloudSyncPlugin.swift');
  assert.match(swift, /public let jsName = "ArtICloudSync"/);
  assert.match(swift, /NSUbiquitousKeyValueStore\.default/);
  assert.match(swift, /CAPPluginMethod\(name: "write"/);
  assert.match(swift, /didChangeExternallyNotification/);

  const entitlements = entitlementsContent();
  assert.deepEqual(verifyEntitlementsContent(entitlements), []);
  assert.match(entitlements, new RegExp(`<key>${ICLOUD_ENTITLEMENT_KEY}<\\/key>`));
  assert.match(entitlements, /<string>\$\(TeamIdentifierPrefix\)com\.shodai4\.artsupplymanager<\/string>/);
  assert.ok(verifyEntitlementsContent('<dict></dict>').length > 0);

  // Podfile に1回だけ入り、もう一度掛けても増えない
  const pod = configurePodfileContent("platform :ios, '15.0'\nuse_frameworks!\ntarget 'App' do\n  capacitor_pods\nend\n");
  assert.equal((pod.content.match(/pod 'ArtICloudSync'/g) || []).length, 1);
  assert.deepEqual(verifyPodfileContent(pod.content), []);
  assert.equal(configurePodfileContent(pod.content).modified, false);

  // Xcode の構成（Debug/Release）に CODE_SIGN_ENTITLEMENTS を入れる
  const pbx = `PRODUCT_BUNDLE_IDENTIFIER = com.shodai4.artsupplymanager;\nIPHONEOS_DEPLOYMENT_TARGET = 15.0;\nPRODUCT_BUNDLE_IDENTIFIER = com.shodai4.artsupplymanager;\nIPHONEOS_DEPLOYMENT_TARGET = 15.0;\n`;
  const withEnt = addEntitlementSetting(pbx);
  assert.equal((withEnt.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g) || []).length, 2);
  assert.equal(addEntitlementSetting(withEnt), withEnt);

  // iOS プロジェクトが無いときは entitlements を作らない（空の ios/ を作らない）
  {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'artiko-icloud-'));
    const res = applyAll({
      plistPath: path.join(dir, 'none.plist'),
      podfilePath: path.join(dir, 'none'),
      projectPath: path.join(dir, 'none.pbxproj'),
      lockPath: path.join(dir, 'none.lock'),
      capConfigPath: path.join(dir, 'none.json'),
      entitlementsPath: path.join(dir, 'ios', 'App', 'App', 'App.entitlements'),
    });
    assert.equal(fs.existsSync(path.join(dir, 'ios')), false, 'iOSプロジェクトが無いのに ios/ を作っている');
    assert.equal(res.some((r) => r.file === 'App.entitlements'), false);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ネイティブプラグインは packageClassList に載せる（載っていないとJSから見えない）
  const cap = configureCapConfigContent('{"packageClassList":[]}', ICLOUD_PLUGIN_CLASS);
  assert.equal(cap.modified, true);
  assert.deepEqual(verifyCapConfigContent(cap.content, ICLOUD_PLUGIN_CLASS), []);
});
