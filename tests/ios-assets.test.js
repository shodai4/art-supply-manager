import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

/** python3 と Pillow が使えるか（CI では先に pip install Pillow する） */
function pythonReady() {
  try {
    execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('AppIcon 生成はフォントに依存しない（macOSランナーでフォント欠けで落ちない）', () => {
  const script = read('scripts/generate-ios-assets.py');
  assert.equal(/ImageFont/.test(script), false, 'ImageFont を使わない');
  assert.equal(/\/usr\/share\/fonts|\/System\/Library\/Fonts/.test(script), false, '特定OSのフォントパスを書かない');
  assert.equal(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(script), false, '絵文字を使わない');
});

test('AppIcon と起動画面を生成できる（1024px・アルファ無し・全サイズ）', (t) => {
  if (!pythonReady()) {
    t.skip('Pillow が無い環境のためスキップ（CI では pip install Pillow してから実行）');
    return;
  }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'asm-ios-assets-'));
  execFileSync('python3', [path.join(ROOT, 'scripts', 'generate-ios-assets.py')], {
    env: { ...process.env, IOS_ASSETS_OUT: out },
    stdio: 'ignore',
  });

  const iconSet = path.join(out, 'resources', 'AppIcon.appiconset');
  const contents = JSON.parse(fs.readFileSync(path.join(iconSet, 'Contents.json'), 'utf8'));
  const marketing = contents.images.find((i) => i.idiom === 'ios-marketing');
  assert.ok(marketing, 'App Store 用 1024px がありません');
  assert.equal(marketing.size, '1024x1024');
  assert.equal(marketing.scale, '1x');
  // iPhone（20/29/40/60）と iPad（76/83.5）の枠が埋まっている
  for (const size of ['20x20', '29x29', '40x40', '60x60', '76x76', '83.5x83.5']) {
    assert.ok(contents.images.some((i) => i.size === size), `${size} がありません`);
  }
  for (const image of contents.images) {
    const file = path.join(iconSet, image.filename);
    assert.ok(fs.existsSync(file), `${image.filename} が生成されていません`);
  }

  const splash = path.join(out, 'resources', 'splash.png');
  assert.ok(fs.existsSync(splash));
  // PNG のヘッダから色種別と大きさを読む（Pillow 無しでも検証できる形にする）
  const header = fs.readFileSync(path.join(iconSet, marketing.filename)).subarray(0, 26);
  assert.equal(header.toString('latin1', 12, 16), 'IHDR');
  assert.equal(header.readUInt32BE(16), 1024);
  assert.equal(header.readUInt32BE(20), 1024);
  assert.equal(header[25], 2, 'カラータイプは RGB（2）＝アルファ無し');

  const splashHeader = fs.readFileSync(splash).subarray(0, 26);
  assert.equal(splashHeader.readUInt32BE(16), 2732);
  assert.equal(splashHeader.readUInt32BE(20), 2732);
});

test('リポジトリ同梱の素材（1024px アイコンと起動画面）が揃っている', () => {
  const icon = path.join(ROOT, 'resources', 'AppIcon.appiconset', 'AppIcon-1024x1024@1x.png');
  const splash = path.join(ROOT, 'resources', 'splash.png');
  for (const file of [icon, splash]) assert.ok(fs.existsSync(file), `${file} がありません`);
  const header = fs.readFileSync(icon).subarray(0, 26);
  assert.equal(header.readUInt32BE(16), 1024);
  assert.equal(header[25], 2);
  const contents = JSON.parse(read('resources/AppIcon.appiconset/Contents.json'));
  assert.ok(contents.images.some((i) => i.size === '1024x1024'));
  // Contents.json に並んだファイルがすべて同梱されている（Xcode が未割り当てにしない）
  for (const image of contents.images) {
    assert.ok(fs.existsSync(path.join(ROOT, 'resources', 'AppIcon.appiconset', image.filename)), `${image.filename} がありません`);
  }
});

test('setup-ios-assets.mjs はアイコンと起動画面の両方を反映できる', async () => {
  const { copyIconSet, copySplash } = await import('../scripts/setup-ios-assets.mjs');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'asm-ios-setup-'));
  const src = path.join(base, 'src');
  const dst = path.join(base, 'dst');
  const splashSrc = path.join(base, 'splash.png');
  fs.mkdirSync(src);
  fs.mkdirSync(dst);
  fs.writeFileSync(path.join(src, 'Contents.json'), '{}');
  fs.writeFileSync(path.join(src, 'AppIcon-1024x1024@1x.png'), 'new');
  fs.writeFileSync(path.join(dst, 'AppIcon-512@2x.png'), 'old'); // Capacitor の初期アイコン
  fs.writeFileSync(splashSrc, 'SPLASH');

  const result = copyIconSet({ sourceDir: src, targetDir: dst });
  assert.equal(result.copied, 2);
  assert.deepEqual(result.removed, ['AppIcon-512@2x.png']);
  assert.equal(fs.existsSync(path.join(dst, 'AppIcon-512@2x.png')), false);
  assert.equal(fs.readFileSync(path.join(dst, 'AppIcon-1024x1024@1x.png'), 'utf8'), 'new');

  fs.writeFileSync(path.join(dst, 'splash-2732x2732.png'), 'old');
  fs.writeFileSync(path.join(dst, 'splash-2732x2732-1.png'), 'old');
  assert.equal(copySplash({ splashFile: splashSrc, targetDir: dst }), 3);
  assert.equal(fs.readFileSync(path.join(dst, 'splash-2732x2732.png'), 'utf8'), 'SPLASH');
  assert.equal(fs.readFileSync(path.join(dst, 'splash-2732x2732-1.png'), 'utf8'), 'SPLASH');

  assert.equal(copyIconSet({ sourceDir: src, targetDir: path.join(base, 'none') }), null);
  assert.equal(copySplash({ splashFile: splashSrc, targetDir: path.join(base, 'none') }), 0);
});
