import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* バーコード読取の枠ズレ: 映像を切り取らず、箱の高さを映像の縦横比に合わせる */

test('同梱スキャナに qrbox を渡さない（ライブラリの枠と自前の枠を二重にしない）', () => {
  const app = read('app.js');
  assert.equal(/qrbox:\s*\{/.test(app), false, 'qrbox を渡すと映像の切り取りで枠がズレる');
  // 読み取る種類（EAN/UPC/CODE128）に絞り、fps は vendorStartConfig で上げている
  assert.match(app, /await inst\.start\(scannerFacingConfig\(scanFacing\), vendorStartConfig\(\),/);
});

test('映像は幅いっぱい・高さは映像の縦横比のまま（切り取らない）', () => {
  const css = read('styles.css');
  assert.match(css, /\.scan-box > video\s*\{[^}]*width:\s*100%[^}]*height:\s*auto/);
  assert.match(css, /#qrReader\s*\{[^}]*width:\s*100%\s*!important[^}]*height:\s*auto\s*!important/);
  assert.match(css, /#qrReader video\s*\{[^}]*width:\s*100%\s*!important[^}]*height:\s*auto\s*!important/);
  // 固定の高さで切り取らない（以前は height: 220px + object-fit: cover でズレていた）
  assert.equal(/\.scan-box\s*\{[^}]*height:\s*220px/.test(css), false, '固定高さが残っている');
});

test('ガイド枠は箱の中央に固定（左右・上下に寄らない）', () => {
  const css = read('styles.css');
  const box = /\.scan-box \.reticle\s*\{([^}]*)\}/.exec(css);
  assert.ok(box, '.reticle のスタイルがありません');
  assert.match(box[1], /position:\s*absolute/);
  assert.match(box[1], /left:\s*7%/);
  assert.match(box[1], /right:\s*7%/);
  assert.match(box[1], /top:\s*31%/);
  assert.match(box[1], /bottom:\s*31%/);
});

test('映像が出たときだけ枠を出す（案内の文字が出ているときは枠を消す）', () => {
  const app = read('app.js');
  assert.match(app, /\$\('scanReticle'\)\.hidden = false;/);
  assert.match(app, /function showScanMsg\(msg\) \{[\s\S]{0,200}\$\('scanReticle'\)\.hidden = true;/);
});
