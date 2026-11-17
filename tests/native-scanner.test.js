import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NATIVE_SCAN_FORMATS, nativeScanOptions, vendorScannerOptions, vendorStartConfig,
  vendorSupportedFormats, WEB_SCAN_FPS, chooseScanStrategy,
  withTimeout, NATIVE_SCAN_OPEN_TIMEOUT_MS,
} from '../scanner.js';
import {
  SCANNER_POD, SCANNER_PLUGIN_CLASS, addScannerPod, verifyPodfileContent, configurePodfileContent,
  configureCapConfigContent, verifyCapConfigContent,
} from '../scripts/configure-ios.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

/* ---------------- ネイティブ（AVFoundation）への渡し方 ---------------- */

test('ネイティブ読取には JAN の4形式とカメラの向きを渡す', () => {
  assert.deepEqual(NATIVE_SCAN_FORMATS, ['EAN_13', 'EAN_8', 'UPC_A', 'CODE_128']);
  assert.deepEqual(nativeScanOptions('environment'), {
    formats: ['EAN_13', 'EAN_8', 'UPC_A', 'CODE_128'], camera: 'environment',
  });
  assert.deepEqual(nativeScanOptions('user'), {
    formats: ['EAN_13', 'EAN_8', 'UPC_A', 'CODE_128'], camera: 'user',
  });
  // 壊れた値は外カメラに倒す（プラグイン側の既定と同じ）
  assert.equal(nativeScanOptions('front').camera, 'environment');
  assert.equal(nativeScanOptions(undefined).camera, 'environment');
  // 呼び出し側の配列を書き換えない
  const opts = nativeScanOptions('user');
  opts.formats.push('QR_CODE');
  assert.equal(NATIVE_SCAN_FORMATS.includes('QR_CODE'), false);
});

test('ネイティブのプラグインがあれば、ブラウザの方式より先に選ぶ', () => {
  assert.equal(chooseScanStrategy({ hasNativePlugin: true }), 'native');
  assert.equal(chooseScanStrategy({ hasNativePlugin: true, hasBarcodeDetector: true }), 'native');
  assert.equal(chooseScanStrategy({ hasNativePlugin: false, hasBarcodeDetector: true }), 'barcode-detector');
});

/* ---------------- Web フォールバック（html5-qrcode）の高速化 ---------------- */

test('同梱スキャナは EAN/UPC/CODE128 だけを読み、fps を上げる', () => {
  const fakeWin = { __Html5QrcodeLibrary__: { Html5QrcodeSupportedFormats: { EAN_13: 9, EAN_8: 10, UPC_A: 11, CODE_128: 12, QR_CODE: 0 } } };
  assert.deepEqual(vendorSupportedFormats(fakeWin), [9, 10, 11, 12]);
  const opts = vendorScannerOptions(fakeWin);
  assert.equal(opts.verbose, false);
  assert.deepEqual(opts.formatsToSupport, [9, 10, 11, 12]);
  assert.equal(WEB_SCAN_FPS, 24);
  assert.deepEqual(vendorStartConfig(), { fps: 24, experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
  // 形式の一覧が無い版（古い・別名）では、余計な指定をせずに既定のまま動かす
  assert.deepEqual(vendorScannerOptions({}), { verbose: false });
  assert.deepEqual(vendorSupportedFormats(undefined), []);
});

/* ---------------- 画面（app.js）との繋ぎ ---------------- */

test('iOS ではネイティブ読取を開き、開けないときはアプリ内カメラへ倒す', () => {
  const app = read('app.js');
  // ネイティブに形式と向きを渡す（カメラ画面が開かないまま固まらないよう上限つきで待つ）
  assert.match(app, /withTimeout\(\s*native\.startScan\(nativeScanOptions\(scanFacing\)\),\s*NATIVE_SCAN_OPEN_TIMEOUT_MS,/);
  // 読んだあと、受け付けなかったときは開いたまま待ち受け直す（開き直さない）
  assert.match(app, /if \(scanContinuous\) continue;[\s\S]{0,120}if \(scannerLive\) continue;/);
  // 閉じるボタンで閉じた（キャンセル）ときはエラー表示にしない
  assert.match(app, /const cancelled = e\?\.code === 'cancelled' \|\| e\?\.code === 'stopped';/);
  assert.match(app, /if \(cancelled\) return;/);
  // カメラ画面を開けないときは、黙って固まらずにアプリ内カメラ（html5-qrcode）へ切り替える
  assert.match(app, /await startInlineScanner\(token, 'カメラ画面を開けませんでした。アプリ内カメラで読み取ります'\);/);
  assert.match(app, /async function startInlineScanner\(token, note = ''\)/);
  // 止めるときはネイティブのカメラ画面も閉じる
  assert.match(app, /function stopScanner\(\) \{[\s\S]{0,300}nativeNow\?\.stopScan/);
  // 読み取り中の案内は、カメラ画面側にも渡す
  assert.match(app, /native\.setStatus\(\{ message: msg, count: scanLogCount\(scanLog\) \}\)/);
  // 同梱スキャナも形式を絞って fps を上げる
  assert.match(app, /new Html5Qrcode\('qrReader', vendorScannerOptions\(window\)\)/);
  assert.match(app, /await inst\.start\(scannerFacingConfig\(scanFacing\), vendorStartConfig\(\),/);
  assert.equal(/fps: 10/.test(app), false, '古い fps: 10 が残っている');
});

test('ネイティブの起動待ちは上限で切れ、タイムアウトは code=timeout で返る', async () => {
  assert.equal(NATIVE_SCAN_OPEN_TIMEOUT_MS, 5000);
  // すぐ決まるものはそのまま通る
  assert.equal(await withTimeout(Promise.resolve('ok'), 50), 'ok');
  // 断られたものはそのまま伝わる（キャンセルは従来どおり静かに閉じる）
  await assert.rejects(withTimeout(Promise.reject(Object.assign(new Error('ng'), { code: 'cancelled' })), 50), /ng/);
  // 決まらないものは待つのをやめ、後片付けを呼んでから code=timeout で返る
  let cleaned = 0;
  await assert.rejects(withTimeout(new Promise(() => {}), 20, () => { cleaned += 1; }), (e) => e.code === 'timeout');
  assert.equal(cleaned, 1);
  // 遅れて成功しても二重には決まらない（タイムアウトが先に返る）
  const late = new Promise((resolve) => setTimeout(() => resolve('late'), 30));
  await assert.rejects(withTimeout(late, 10), (e) => e.code === 'timeout');
});

/* ---------------- ネイティブプラグイン本体 ---------------- */

test('AVFoundation のハードウェア検出で読む軽量プラグインが入っている', () => {
  const swift = read('plugins/art-barcode-scanner/ios/Sources/ArtBarcodeScannerPlugin.swift');
  assert.match(swift, /import AVFoundation/);
  assert.match(swift, /AVCaptureSession/);
  assert.match(swift, /AVCaptureMetadataOutput/);
  // JAN（EAN-13）を基本に EAN-8 / UPC-E / CODE128 まで受ける
  for (const type of ['ean13', 'ean8', 'upce', 'code128']) {
    assert.match(swift, new RegExp(`AVMetadataObject\\.ObjectType\\.${type}`), `${type} を受けていない`);
  }
  // JS からは Capacitor.Plugins.BarcodeScanner として見える（scanner.js の名前と一致）
  assert.match(swift, /public let jsName = "BarcodeScanner"/);
  assert.match(swift, /@objc\(ArtBarcodeScannerPlugin\)/);
  for (const method of ['startScan', 'stopScan', 'setStatus', 'isSupported']) {
    assert.match(swift, new RegExp(`CAPPluginMethod\\(name: "${method}"`), `${method} が pluginMethods に無い`);
  }
  // 読み取った1本を barcodes[0].rawValue で返す（app.js の受け取り方と合わせる）
  assert.match(swift, /"barcodes": \[\s*\["rawValue": value/);
  // 画面を閉じる・カメラを切り替える手立てがある
  assert.match(swift, /@objc private func closeTapped\(\)/);
  assert.match(swift, /@objc private func flipTapped\(\)/);
  assert.equal(EMOJI.test(swift), false, 'Swift に絵文字がある');
});

test('カメラ画面は WebView の画面から直接出し、出なければ別ウインドウ・最後は明示的に失敗する', () => {
  const swift = read('plugins/art-barcode-scanner/ios/Sources/ArtBarcodeScannerPlugin.swift');
  // 1回目は bridge の画面（何か出ていればその一番上）から present する（別ウインドウ頼みにしない）
  assert.match(swift, /topMost\(from: host\)\.present\(controller, animated: true, completion: nil\)/);
  assert.match(swift, /private func topMost\(from base: UIViewController\) -> UIViewController/);
  // 出たかを確かめ、出ていなければ Capacitor の presentVC も試す
  assert.match(swift, /let shown = controller\.presentingViewController != nil \|\| controller\.viewIfLoaded\?\.window != nil/);
  assert.match(swift, /self\.presentController\(controller, host: host, attempt: attempt \+ 1\)/);
  assert.match(swift, /self\.bridge\?\.presentVC\(controller, animated: false, completion: nil\)/);
  // どちらも出ないときは「unavailable」で返し、JS が固まらずアプリ内カメラに倒せるようにする
  assert.match(swift, /self\.rejectActive\("カメラ画面を開けませんでした", code: "unavailable"\)/);
  assert.match(swift, /private func rejectActive\(_ message: String, code: String = "cancelled"\)/);
  // 閉じるボタン（利用者のキャンセル）だけは静かに閉じる
  assert.match(swift, /self\.rejectActive\("読み取りをやめました", code: "cancelled"\)/);
  // 閉じるときはカメラ画面そのものを閉じる
  assert.match(swift, /vc\.dismiss\(animated: false, completion: nil\)/);
});

test('プラグインはリポジトリ内のローカル Pod（外部の CocoaPods 依存なし）', () => {
  const spec = read('plugins/art-barcode-scanner/ArtBarcodeScanner.podspec');
  const pkg = JSON.parse(read('plugins/art-barcode-scanner/package.json'));
  assert.match(spec, /s\.name = 'ArtBarcodeScanner'/);
  assert.match(spec, /s\.source_files = 'ios\/Sources/);
  assert.match(spec, /s\.dependency 'Capacitor'/);
  assert.equal(/s\.dependency '(?!Capacitor')/.test(spec), false, 'Capacitor 以外の Pod に依存している');
  assert.equal(pkg.capacitor.ios.name, 'ArtBarcodeScanner');
  assert.match(SCANNER_POD, /^pod 'ArtBarcodeScanner', :path => '\.\.\/\.\.\/plugins\/art-barcode-scanner'$/);
});

test('Podfile にローカル Pod を1行だけ入れ、cap sync で消えない位置に置く', () => {
  const podfile = "platform :ios, '15.0'\nuse_frameworks!\n\ndef capacitor_pods\n  pod 'Capacitor'\nend\n\ntarget 'App' do\n  capacitor_pods\nend\n";
  const out = configurePodfileContent(podfile);
  assert.ok(out.content.includes(SCANNER_POD), 'ローカル Pod の行がありません');
  const targetAt = out.content.indexOf("target 'App' do");
  assert.ok(out.content.indexOf(SCANNER_POD) > targetAt, 'target ブロックの外に入っている');
  // 2回目は増やさない
  const again = addScannerPod(out.content);
  assert.equal(again, out.content);
  assert.equal((again.match(/pod 'ArtBarcodeScanner'/g) || []).length, 1);
  assert.deepEqual(verifyPodfileContent(out.content), []);
  // 抜けたら気づく
  assert.match(verifyPodfileContent(out.content.replace(SCANNER_POD, ''))[0], /ArtBarcodeScanner/);
});

test('capacitor.config.json の packageClassList に読取プラグインを登録する（他のプラグインは残す）', () => {
  assert.equal(SCANNER_PLUGIN_CLASS, 'ArtBarcodeScannerPlugin');
  const before = JSON.stringify({ appId: 'com.shodai4.artsupplymanager', packageClassList: ['CapacitorCommunityAdmob'] }, null, '\t');
  const out = configureCapConfigContent(before);
  assert.equal(out.modified, true);
  const config = JSON.parse(out.content);
  assert.equal(config.appId, 'com.shodai4.artsupplymanager', '既存の設定を消してはいけない');
  assert.deepEqual(config.packageClassList, ['CapacitorCommunityAdmob', 'ArtBarcodeScannerPlugin']);
  assert.deepEqual(verifyCapConfigContent(out.content), []);
  // 2回目は何も変えない
  assert.equal(configureCapConfigContent(out.content).modified, false);
  // 抜けたら気づく／JSONが壊れていたら知らせる
  assert.match(verifyCapConfigContent(before)[0], /ArtBarcodeScannerPlugin/);
  assert.match(configureCapConfigContent('{').error, /読み取れません/);
  assert.match(verifyCapConfigContent('{')[0], /読み取れません/);
});

test('CI 用のテンプレートは plugins/ の変更でもビルドし、Pod とプラグイン登録を検査する', () => {
  // 本番の .github/workflows/ios-build.yml は GitHub App の権限（workflows）では更新できないため、
  // docs/ のテンプレートを正とし、オーナーが同じ内容をコピーする運用にしている。
  const template = read('docs/ios-build.yml.template');
  assert.match(template, /- 'plugins\/\*\*'/, 'テンプレートに plugins/ の監視がない');
  assert.match(template, /test -f plugins\/art-barcode-scanner\/ArtBarcodeScanner\.podspec/);
  assert.match(template, /grep -q "pod 'ArtBarcodeScanner'" ios\/App\/Podfile/);
  assert.match(template, /grep -q 'ArtBarcodeScannerPlugin' ios\/App\/App\/capacitor\.config\.json/);
  // 実際のワークフローがまだテンプレート未反映でも、configure-ios が同じ検査で止める
  const configure = read('scripts/configure-ios.mjs');
  assert.match(configure, /if \(scanners !== 1\) return \[`ArtBarcodeScanner/);
  assert.match(configure, /list\.includes\(className\) \? \[\] : \[`capacitor\.config\.json の packageClassList に/);
  assert.match(configure, /if \(failed\) process\.exitCode = 1;/);
});
