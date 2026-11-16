import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_DISPLAY_NAME, APP_BUNDLE_NAME, CONFIG_ENTRIES, configureContent,
} from '../scripts/configure-ios.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* 正式名称と短縮表記（この2つ以外の名前を画面に出さない） */
const APP_NAME_FULL = 'ガザイコ〜画材の在庫を管理するアプリ〜';
const APP_NAME_SHORT = 'ガザイコ';
const OLD_NAME = '画材管理';

const BASE_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
\t<key>CFBundleDisplayName</key>
\t<string>App</string>
</dict>
</plist>
`;

/** Info.plist に書き込まれる名前の一覧（CI の APP_NAME 検査に使う） */
const plistNames = () => CONFIG_ENTRIES
  .filter((e) => /^CFBundle(Name|DisplayName)$/.test(e.key))
  .map((e) => /<string>([^<]*)<\/string>/.exec(e.value)[1]);

const workflowAppName = (rel) => {
  const found = /^\s*APP_NAME:\s*(.+?)\s*$/m.exec(read(rel));
  assert.ok(found, `${rel} に APP_NAME がありません`);
  return found[1];
};

test('正式名称と短縮表記が Web・PWA・iOS で揃っている', () => {
  const html = read('index.html');
  assert.equal(/<title>([^<]*)<\/title>/.exec(html)[1], APP_NAME_FULL);
  assert.equal(/<h1>([^<]*)<\/h1>/.exec(html)[1], APP_NAME_SHORT);
  assert.match(/<meta name="description" content="([^"]*)">/.exec(html)[1], new RegExp(APP_NAME_SHORT));

  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.name, APP_NAME_FULL);
  assert.equal(manifest.short_name, APP_NAME_SHORT);

  const capacitor = JSON.parse(read('capacitor.config.json'));
  assert.equal(capacitor.appName, APP_NAME_SHORT);

  assert.equal(APP_DISPLAY_NAME, APP_NAME_SHORT);
  assert.ok(plistNames().includes(APP_NAME_SHORT), 'Info.plist の表示名がガザイコになっていない');
});

test('CI が検査する APP_NAME は Info.plist に実在する名前（ビルドを止めない）', () => {
  const plist = configureContent(BASE_PLIST).content;
  const names = plistNames();
  for (const rel of ['.github/workflows/ios-build.yml', 'docs/ios-build.yml.template']) {
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    const appName = workflowAppName(rel);
    assert.ok(
      names.includes(appName),
      `${rel} の APP_NAME「${appName}」が Info.plist（${names.join(' / ')}）に無い`,
    );
    assert.ok(plist.includes(`<string>${appName}</string>`));
  }
});

test('旧名は内部名（CFBundleName）だけに残し、画面・法務ページ・README には出さない', () => {
  // App Store Connect の登録名が「画材管理」のままなので、内部名としてだけ残している。
  // ストア側の名前を変えたら APP_BUNDLE_NAME もガザイコにすればよい（CI の検査は表示名で通る）。
  assert.equal(APP_BUNDLE_NAME, OLD_NAME);
  for (const rel of [
    'index.html', 'manifest.webmanifest', 'capacitor.config.json',
    'support.html', 'privacy.html', 'README.md',
  ]) {
    assert.equal(read(rel).includes(OLD_NAME), false, `${rel} に旧名が残っています`);
  }
  for (const rel of ['support.html', 'privacy.html']) {
    assert.match(read(rel), new RegExp(`<title>[^<]*${APP_NAME_SHORT}</title>`), `${rel} のタイトル`);
    assert.match(read(rel), new RegExp(APP_NAME_SHORT), `${rel} に名前がない`);
  }
});

test('名前を変えても保存キー・Bundle ID・配信URL は変えない（既存データを壊さない）', () => {
  assert.match(read('core.js'), /export const STORAGE_KEY = 'art-supply-manager\/v1';/);
  assert.match(read('theme.js'), /'art-supply-manager\/theme'/);
  assert.match(read('images.js'), /export const IMAGE_DB_NAME = 'art-supply-images';/);
  assert.match(read('index.html'), /'art-supply-manager\/theme'/);

  const capacitor = JSON.parse(read('capacitor.config.json'));
  assert.equal(capacitor.appId, 'com.shodai4.artsupplymanager');

  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.start_url, './index.html');
  assert.equal(manifest.scope, './');
  assert.match(read('index.html'), /<link rel="manifest" href="manifest.webmanifest">/);
  // 公開URL（GitHub Pages のサブパス）はそのまま
  assert.match(read('index.html'), /href="manifest\.webmanifest"/);
});

test('Service Worker のキャッシュ名は名前を変えず版だけ上げる', () => {
  const sw = read('sw.js');
  const cache = /const CACHE = '([^']+)';/.exec(sw);
  assert.ok(cache, 'CACHE がありません');
  assert.match(cache[1], /^art-supply-manager-v\d+$/);
  const version = Number(cache[1].split('-v')[1]);
  assert.ok(version >= 24, `キャッシュ版が古い（${cache[1]}）。名前の変更に合わせて上げる`);
});

test('名前に絵文字を使わない（表示方針）', () => {
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  for (const rel of [
    'index.html', 'manifest.webmanifest', 'support.html', 'privacy.html',
    'README.md', 'package.json', 'capacitor.config.json', 'scripts/configure-ios.mjs',
  ]) {
    assert.equal(EMOJI.test(read(rel)), false, `${rel} に絵文字があります`);
  }
});
