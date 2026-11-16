import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FACING_MODES, DEFAULT_FACING, normalizeFacing, toggleFacing, facingLabel,
  facingConstraints, scannerFacingConfig, canChooseFacing,
} from '../scanner.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

test('カメラの向きは外（背面）から始まり、外と内を切り替える', () => {
  assert.deepEqual(FACING_MODES, ['environment', 'user']);
  assert.equal(DEFAULT_FACING, 'environment');
  assert.equal(normalizeFacing('user'), 'user');
  assert.equal(normalizeFacing('environment'), 'environment');
  assert.equal(normalizeFacing(''), 'environment', '壊れた値は外カメラに倒す');
  assert.equal(normalizeFacing(null), 'environment');
  assert.equal(normalizeFacing('front'), 'environment');
  assert.equal(toggleFacing('environment'), 'user');
  assert.equal(toggleFacing('user'), 'environment');
  assert.equal(toggleFacing(''), 'user');
  assert.equal(toggleFacing(toggleFacing('user')), 'user', '2回で戻る');
});

test('今どちらのカメラかが画面の文字で分かる', () => {
  assert.equal(facingLabel('environment'), '外カメラ');
  assert.equal(facingLabel('user'), '内カメラ');
  assert.equal(facingLabel(undefined), '外カメラ');
});

test('向きの渡し方は getUserMedia と同梱スキャナで違う（ideal / 文字列）', () => {
  assert.deepEqual(facingConstraints('user'), { facingMode: { ideal: 'user' } });
  assert.deepEqual(facingConstraints('environment'), { facingMode: { ideal: 'environment' } });
  assert.deepEqual(scannerFacingConfig('user'), { facingMode: 'user' });
  // html5-qrcode は { exact } か文字列しか受け付けない（ideal を渡すと例外になる）
  const cfg = scannerFacingConfig('environment');
  assert.equal(typeof cfg.facingMode, 'string');
});

test('向きを選べるのはブラウザのカメラ方式だけ（ネイティブ・手入力では出さない）', () => {
  assert.equal(canChooseFacing('barcode-detector'), true);
  assert.equal(canChooseFacing('html5-qrcode'), true);
  assert.equal(canChooseFacing('native'), false);
  assert.equal(canChooseFacing('manual'), false);
  assert.equal(canChooseFacing(''), false);
});

test('読取シートに切り替えボタンがあり、絵文字を使わない', () => {
  const html = read('index.html');
  const sheet = html.slice(html.indexOf('id="sheetScan"'), html.indexOf('id="sheetFolder"'));
  assert.match(sheet, /id="btnFacing"/);
  assert.match(sheet, /id="facingLabel"/);
  assert.match(sheet, /<use href="#i-camera-flip"\/>/);
  assert.match(sheet, /class="fchip cam"/);
  assert.equal(EMOJI.test(sheet), false, '読取シートに絵文字があります');
  // アイコン（単色SVG）を1つ足している
  assert.match(html, /<symbol id="i-camera-flip"/);
});

test('切り替えは「カメラを止めてから開き直す」順で、連続スキャンの状態を壊さない', () => {
  const app = read('app.js');
  // 押したら向きを反転して、止めてから開き直す
  assert.match(app, /\$\('btnFacing'\)\.addEventListener\('click', async \(\) => \{[\s\S]{0,400}scanFacing = toggleFacing\(scanFacing\);/);
  assert.match(app, /async function restartScanner\(\) \{\s*await stopScanner\(\);/);
  assert.match(app, /await startScanner\(\);\s*\}/);
  // 開き直す前に、古いストリームを止めて片付ける
  assert.match(app, /function stopScanner\(\) \{[\s\S]{0,900}return Promise\.resolve\(s\.stop\(\)\)/);
  // 起動時も前のストリームを待ってから開く
  assert.match(app, /async function startScanner\(\) \{\s*await stopScanner\(\);/);
  // 向きは getUserMedia と同梱スキャナの両方に効く
  assert.match(app, /getUserMedia\(\{ video: facingConstraints\(scanFacing\) \}\)/);
  assert.match(app, /inst\.start\(scannerFacingConfig\(scanFacing\)/);
  // 選べない方式ではボタンを隠す
  assert.match(app, /\$\('btnFacing'\)\.hidden = !canChooseFacing\(strategy\);/);
  // 連続スキャンON/OFF・ログ・クールダウンは切り替えで触らない
  const restart = /async function restartScanner\(\) \{[\s\S]*?\n\}/.exec(app)[0];
  assert.equal(/scanContinuous\s*=/.test(restart), false, '切り替えで連続スキャンの設定を変えない');
  assert.equal(/scanLog\s*=/.test(restart), false, '切り替えで読み取りログを消さない');
  assert.equal(/resetScanSession/.test(restart), false, '切り替えでクールダウンを戻さない');
  assert.equal(/closeSheet\(/.test(restart), false, '切り替えでシートを閉じない');
});

test('カメラを開けなかったときは外カメラへ戻して一度だけ試す（無限ループしない）', () => {
  const app = read('app.js');
  assert.match(app, /if \(scanFacing !== DEFAULT_FACING\) \{\s*scanFacing = DEFAULT_FACING;/);
  assert.match(app, /return startScanner\(\);/);
});

test('375pxで1行に収まらないときは折り返す（はみ出さない）', () => {
  const css = read('styles.css');
  assert.match(css, /\.scan-mode \{[^}]*flex-wrap: wrap;[^}]*\}/);
  assert.match(css, /#btnFacing \{ display: inline-flex; align-items: center; gap: 4px;[^}]*white-space: nowrap; \}/);
  assert.match(css, /#btnFacing\[hidden\] \{ display: none; \}/);
});
