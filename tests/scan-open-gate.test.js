/**
 * ネイティブ読取の「カメラ画面が開くまで」の待ち方（v1.26.0）。
 *
 *   1) startScan は「読み取るか閉じるまで」返らないので、全体に時間切れを掛けない
 *   2) ネイティブの「画面を出せた」合図（scanOpened）が来るまでだけ時間を数える
 *   3) 合図が来たら解除し、読み取るまでいくら待ってもアプリ内カメラへ切り替えない
 *   4) 合図が来ないまま上限を過ぎたときだけ、アプリ内カメラ（html5-qrcode）へ倒す
 *   5) 閉じるボタンで閉じたときはエラー扱いにせず、手入力を案内する
 *   6) 読取シートの「JANを手入力」とボタンは、広告バナーが出ていても隠れない
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOpenGate, NATIVE_SCAN_OPEN_TIMEOUT_MS } from '../scan-open-gate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const app = read('app.js');
const html = read('index.html');
const css = read('styles.css');
const swift = read('plugins/art-barcode-scanner/ios/Sources/ArtBarcodeScannerPlugin.swift');
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

/** 時間を手で進められるタイマー（node --test を実時間で待たせない） */
function fakeTimers() {
  const timers = new Map();
  let seq = 0;
  return {
    setTimer: (fn, ms) => { seq += 1; timers.set(seq, { fn, ms }); return seq; },
    clearTimer: (id) => { timers.delete(id); },
    fire() { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } },
    pending: () => timers.size,
    delays: () => [...timers.values()].map((t) => t.ms),
  };
}

/** 次のマイクロタスクまで進める（wait の中の then を動かす） */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/* ---------------- 1) 関門そのもの ---------------- */

test('カメラ画面の合図が来なければ、上限で code=open-timeout になる', async () => {
  const t = fakeTimers();
  const gate = createOpenGate({ timeoutMs: 8000, setTimer: t.setTimer, clearTimer: t.clearTimer });
  const waiting = gate.wait(new Promise(() => {}));
  assert.deepEqual(t.delays(), [8000]);
  t.fire();
  await assert.rejects(waiting, (e) => e.code === 'open-timeout');
  assert.equal(gate.done, true);
});

test('カメラ画面が開いた合図が来たら、時間切れにしない（読み取るまで待つ）', async () => {
  const t = fakeTimers();
  const gate = createOpenGate({ timeoutMs: 8000, setTimer: t.setTimer, clearTimer: t.clearTimer });
  let resolveScan;
  const waiting = gate.wait(new Promise((resolve) => { resolveScan = resolve; }));
  // 1.5秒後に「画面が出た」合図 → タイマーは消える
  gate.confirmOpened();
  assert.equal(gate.opened, true);
  assert.equal(t.pending(), 0, '合図のあとも時間切れのタイマーが残っている');
  // その後どれだけ経っても切り替わらない
  for (let i = 0; i < 5; i += 1) t.fire();
  assert.equal(t.pending(), 0);
  // 読み取ったときに、その値で終わる
  resolveScan({ barcodes: [{ rawValue: '4900669001911' }] });
  assert.deepEqual(await waiting, { barcodes: [{ rawValue: '4900669001911' }] });
});

test('合図を受け取れない古いネイティブ（enable:false）では時間切れにしない', async () => {
  const t = fakeTimers();
  const gate = createOpenGate({ enable: false, setTimer: t.setTimer, clearTimer: t.clearTimer });
  const waiting = gate.wait(new Promise(() => {}));
  assert.equal(t.pending(), 0);
  assert.equal(gate.done, false);
  gate.cancel();
  assert.equal(gate.done, true);
  void waiting.catch(() => {});
});

test('閉じた・切り替えたときは待つのをやめ、後片付けでタイマーが残らない', async () => {
  const t = fakeTimers();
  const gate = createOpenGate({ setTimer: t.setTimer, clearTimer: t.clearTimer });
  let reject;
  const waiting = gate.wait(new Promise((_, rej) => { reject = rej; }));
  gate.cancel();
  assert.equal(t.pending(), 0);
  reject(Object.assign(new Error('stopped'), { code: 'stopped' }));
  await assert.rejects(waiting, /stopped/);
});

test('カメラ画面を開けない（ネイティブが unavailable を返す）ときは、そのまま伝わる', async () => {
  const t = fakeTimers();
  const gate = createOpenGate({ setTimer: t.setTimer, clearTimer: t.clearTimer });
  const waiting = gate.wait(Promise.reject(Object.assign(new Error('開けません'), { code: 'unavailable' })));
  await assert.rejects(waiting, (e) => e.code === 'unavailable');
  assert.equal(t.pending(), 0, 'エラーのあとにタイマーが残っている');
});

test('起動待ちの上限は 8 秒（読み取りの長さには掛けない）', () => {
  assert.equal(NATIVE_SCAN_OPEN_TIMEOUT_MS, 8000);
});

/* ---------------- 2) 画面（app.js）との繋ぎ ---------------- */

test('app.js は「画面が出た合図」で時間切れを解除し、読み取り中は切り替えない', () => {
  assert.match(app, /import \{ createOpenGate \} from '\.\/scan-open-gate\.js';/);
  assert.equal(/withTimeout\(\s*native\.startScan/.test(app), false, '読み取り全体に時間切れを掛けている');
  // startScan ごとに新しい関門を作り、合図で解除できるようにする
  assert.match(app, /const gate = createOpenGate\(\{ enable: scanOpenedSubscribed \}\);/);
  assert.match(app, /scanOpenGate = gate;/);
  assert.match(app, /await gate\.wait\(native\.startScan\(nativeScanOptions\(scanFacing\)\)\)/);
  assert.match(app, /native\.addListener\('scanOpened', \(\) => \{ scanOpenGate\?\.confirmOpened\(\); \}\)/);
  // 時間切れのときだけアプリ内カメラへ倒す
  assert.match(app, /const timedOut = e\?\.code === 'open-timeout';/);
  assert.match(app, /if \(timedOut\) \{[\s\S]{0,300}startInlineScanner\(token, 'カメラ画面を開けませんでした。アプリ内カメラで読み取ります'\)/);
  // 閉じるボタンで閉じたときはエラーにせず、手入力を案内する
  assert.match(app, /if \(cancelled\) \{[\s\S]{0,160}showScanMsg\('読み取りをやめました。下の手入力をどうぞ'\)/);
  // シートを閉じたら関門も閉じる（閉じたあとに時間切れで切り替わらない）
  assert.match(app, /function stopScanner\(\) \{[\s\S]{0,200}scanOpenGate\?\.cancel\(\);/);
});

test('連続スキャンの切り替えは、ネイティブのカメラ画面とも双方向で揃う', () => {
  assert.match(app, /function syncNativeContinuous\(\)/);
  assert.match(app, /native\.setContinuous\(\{ on: scanContinuous \}\)/);
  assert.match(app, /native\.addListener\('continuousChanged'/);
  assert.match(app, /setContinuousScan\(Boolean\(data\?\.on\)\)/);
  // 読み取りを始める前に、いまの設定を渡す
  assert.match(app, /syncNativeContinuous\(\); \/\/ 連続スキャンの設定をカメラ画面のボタンに合わせる/);
  // ネイティブ側は合図を送る／受け取る口を持つ
  assert.match(swift, /CAPPluginMethod\(name: "setContinuous"/);
  assert.match(swift, /notifyListeners\("continuousChanged"/);
  assert.match(swift, /notifyListeners\("scanOpened"/);
  assert.match(swift, /override func viewDidAppear\(_ animated: Bool\) \{[\s\S]{0,200}onOpened\?\(\)/);
  assert.match(swift, /continuousButton\.setTitle\(on \? "連続スキャン ON" : "連続スキャン OFF"/);
  // 画面のボタンは閉じる・カメラ切替・連続スキャンの3つ
  assert.match(swift, /setupTitleButton\(continuousButton, title: "連続スキャン OFF"/);
  assert.equal(EMOJI.test(swift), false, 'Swift に絵文字がある');
});

/* ---------------- 3) 読取シートの下端（広告に隠れない） ---------------- */

test('読取シートは「JANを手入力」とボタンを下端に固定し、広告の上まで持ち上げる', () => {
  const sheet = html.slice(html.indexOf('id="sheetScan"'), html.indexOf('id="sheetFolder"'));
  // カメラ・ログはスクロールする本体、入力欄とボタンは外（固定の足）に置く
  assert.match(sheet, /<div class="sheet-body">/);
  assert.match(sheet, /<div class="scan-foot">/);
  const bodyAt = sheet.indexOf('<div class="sheet-body">');
  const footAt = sheet.indexOf('<div class="scan-foot">');
  assert.ok(bodyAt > 0 && footAt > bodyAt, '足が本体より後ろにない');
  const foot = sheet.slice(footAt);
  assert.match(foot, /id="manualJan"/);
  assert.match(foot, /id="btnManualLookup"/);
  assert.match(foot, /id="btnRescan"/);
  assert.equal(sheet.slice(bodyAt, footAt).includes('id="manualJan"'), false, '入力欄がスクロールする本体の中にある');

  // CSS: シートは縦並び・本体だけスクロール・足は縮まない
  assert.match(css, /#sheetScan\.open\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*overflow:\s*hidden/);
  assert.match(css, /#sheetScan > \.sheet-body\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.scan-foot\s*\{[^}]*flex:\s*0 0 auto[^}]*border-top:\s*1px solid var\(--line\)/);
  assert.match(css, /\.scan-foot\s*\{[^}]*padding-bottom:\s*calc\([^)]*env\(safe-area-inset-bottom\)\)/);
  assert.match(
    css,
    /body\[data-ad-banner="true"\]\s*\.scan-foot\s*\{[^}]*padding-bottom:\s*calc\([\s\S]{0,90}env\(safe-area-inset-bottom\)[\s\S]{0,40}var\(--ad-h\)/,
  );
});
