import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  CONFIG_ENTRIES, APP_DISPLAY_NAME, MINIMUM_IOS_VERSION,
  configureContent, verifyContent, configurePodfileContent, verifyPodfileContent,
  configureProjectContent, verifyProjectContent, compareVersions,
} from '../scripts/configure-ios.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BASE_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDisplayName</key>
\t<string>App</string>
\t<key>CFBundleName</key>
\t<string>App</string>
</dict>
</plist>
`;

test('Info.plist：表示名・カメラ・写真・輸出コンプライアンスを入れて点検できる', () => {
  const once = configureContent(BASE_PLIST);
  assert.equal(once.modified, true);
  assert.deepEqual(verifyContent(once.content), []);
  assert.match(once.content, new RegExp(`<string>${APP_DISPLAY_NAME}</string>`));
  assert.match(once.content, /NSCameraUsageDescription/);
  assert.match(once.content, /バーコード（JANコード）を読み取るためにカメラを使用します/);
  assert.match(once.content, /NSPhotoLibraryUsageDescription/);
  assert.match(once.content, /<key>ITSAppUsesNonExemptEncryption<\/key>\n\t<false\/>/);
  // 2回目は何も変えない（冪等）
  const twice = configureContent(once.content);
  assert.equal(twice.modified, false);
  assert.deepEqual(twice.actions.map((a) => a.action).filter((a) => a === 'updated' || a === 'injected'), []);
});

test('Info.plist：重複キーは1件にまとめ、値の違いは直す', () => {
  const dup = BASE_PLIST.replace('</dict>', '\t<key>NSCameraUsageDescription</key>\n\t<string>古い</string>\n\t<key>NSCameraUsageDescription</key>\n\t<string>古い</string>\n</dict>');
  const fixed = configureContent(dup);
  assert.equal((fixed.content.match(/<key>NSCameraUsageDescription<\/key>/g) || []).length, 1);
  assert.deepEqual(verifyContent(fixed.content), []);

  const wrong = configureContent(BASE_PLIST).content.replace(
    /<key>ITSAppUsesNonExemptEncryption<\/key>\n\t<false\/>/,
    '<key>ITSAppUsesNonExemptEncryption</key>\n\t<true/>',
  );
  assert.ok(wrong.includes('<true/>'), '置き換えが効いていない');
  assert.ok(verifyContent(wrong).some((p) => /ITSAppUsesNonExemptEncryption/.test(p)));
});

test('Podfile と Xcode プロジェクトの最低OSを iOS 15.0 に揃える', () => {
  const podfile = configurePodfileContent("platform :ios, '13.0'\n\nuse_frameworks!\n");
  assert.equal(podfile.content.split('\n')[0], `platform :ios, '${MINIMUM_IOS_VERSION}'`);
  assert.deepEqual(verifyPodfileContent(podfile.content), []);
  assert.equal(podfile.modified, true);

  const added = configurePodfileContent('use_frameworks!\n');
  assert.equal(added.added, true);
  assert.match(added.content, /platform :ios, '15.0'/);
  assert.deepEqual(verifyPodfileContent(added.content), []);
  assert.match(verifyPodfileContent('target "App" do\n')[0], /platform/);

  const project = configureProjectContent('IPHONEOS_DEPLOYMENT_TARGET = 13.0;\nIPHONEOS_DEPLOYMENT_TARGET = 14.2;');
  assert.equal(project.raised, 2);
  assert.equal(project.content, 'IPHONEOS_DEPLOYMENT_TARGET = 15.0;\nIPHONEOS_DEPLOYMENT_TARGET = 15.0;');
  assert.deepEqual(verifyProjectContent(project.content), []);
  assert.match(verifyProjectContent('IPHONEOS_DEPLOYMENT_TARGET = 13.0;')[0], /13.0/);
  assert.deepEqual(verifyProjectContent('何もない'), ['project.pbxproj に IPHONEOS_DEPLOYMENT_TARGET がありません']);
  assert.equal(compareVersions('15.0', '13'), 2);
});

test('capacitor.config.json と package.json の土台', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8'));
  assert.equal(config.appId, 'com.shodai4.artsupplymanager');
  assert.equal(config.appName, '画材管理');
  assert.equal(config.webDir, 'www');
  assert.equal(config.ios.contentInset, 'never');
  assert.equal(config.ios.preferredContentMode, 'mobile');

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies['@capacitor/core']);
  assert.ok(pkg.dependencies['@capacitor/ios']);
  assert.ok(pkg.devDependencies['@capacitor/cli']);
  assert.equal(pkg.type, 'module');
  assert.match(pkg.scripts.build, /scripts\/build\.mjs/);
  assert.match(pkg.scripts.test, /node --test/);
  // 設定値はコード1か所（shops.js）に集約されている
  const shops = fs.readFileSync(path.join(ROOT, 'shops.js'), 'utf8');
  assert.match(shops, /export const SHOP_AFFILIATE_CONFIG = \{/);
});

/* ---------------- iOS 配布物まわり（www/・法務ページ・絵文字なし） ---------------- */

test('Capacitor 用の www/ に必要なファイルが列挙され、実在する', async () => {
  const { WEB_ASSETS } = await import('../scripts/build.mjs');
  for (const rel of ['jan-extra.json', 'privacy.html', 'support.html', 'vendor/html5-qrcode.min.js', 'scanner.js']) {
    assert.ok(WEB_ASSETS.includes(rel), `${rel} が WEB_ASSETS にありません`);
  }
  for (const rel of WEB_ASSETS) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} が実在しません`);
  }
  // sw.js はアプリ内（capacitor://）では不要なので www/ に入れない
  assert.equal(WEB_ASSETS.includes('sw.js'), false);
});

test('build.mjs は www/ を作り、足りないファイルを報告する', async () => {
  const { buildWebDir } = await import('../scripts/build.mjs');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asm-www-'));
  try {
    const result = buildWebDir({ outDir });
    assert.deepEqual(result.missing, []);
    assert.ok(fs.existsSync(path.join(outDir, 'index.html')));
    assert.ok(fs.existsSync(path.join(outDir, 'vendor', 'html5-qrcode.min.js')));
    const none = buildWebDir({ outDir: path.join(outDir, 'x'), assets: ['nope.html'] });
    assert.deepEqual(none.missing, ['nope.html']);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test('アプリ内から参照する法務ページが用意されている', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /href="privacy\.html"/);
  assert.match(html, /href="support\.html"/);
  const privacy = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
  assert.match(privacy, /shodai121ueda\+artsupply@gmail\.com/);
  assert.match(privacy, /バーコード（JANコード）の読み取りのためだけに、端末内で使用/);
  assert.match(privacy, /外部サーバーへ送信することはありません/);
  assert.match(privacy, /アフィリエイトプログラム/);
  const support = fs.readFileSync(path.join(ROOT, 'support.html'), 'utf8');
  assert.match(support, /shodai121ueda\+artsupply@gmail\.com/);
  assert.match(support, /privacy\.html/);
  // 審査で聞かれる「カメラの用途」がInfo.plist側にも入る
  assert.ok(CONFIG_ENTRIES.some((e) => e.key === 'NSCameraUsageDescription'));
});

test('iOS・法務・運用スクリプトは絵文字を含まない（表示方針）', () => {
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  for (const rel of [
    'privacy.html', 'support.html', 'capacitor.config.json',
    'scripts/build.mjs', 'scripts/configure-ios.mjs', 'scripts/add-jan-extra.mjs',
    'scripts/lib/jan-extra-edit.mjs',
    'docs/ios-release-plan.md', 'docs/ios-build.yml.template',
  ]) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.equal(EMOJI.test(text), false, `${rel} に絵文字があります`);
  }
});

test('CIワークフローはテンプレートとして置き、Secrets未登録でも止まらない作り', () => {
  // GitHub App の権限では .github/workflows/*.yml を push できないため、
  // テンプレートを docs/ に置き、オーナーが手動でコピーする運用にしている。
  const template = fs.readFileSync(path.join(ROOT, 'docs/ios-build.yml.template'), 'utf8');
  assert.match(template, /npm test/);
  assert.match(template, /npm run build/);
  assert.match(template, /configure-ios\.mjs/);
  assert.match(template, /CODE_SIGNING_ALLOWED=NO/);
  assert.match(template, /secrets\.APP_STORE_CONNECT_API_KEY_P8/);
  assert.match(template, /if: steps\.secrets\.outputs\.ready == 'true'/);
  assert.match(template, /workflow_dispatch/);
  // docs/ にはテンプレートだけを置く（.github には置けないので README と設計書で案内）
  const plan = fs.readFileSync(path.join(ROOT, 'docs/ios-release-plan.md'), 'utf8');
  assert.match(plan, /docs\/ios-build\.yml\.template/);
  assert.match(plan, /403/);
});
