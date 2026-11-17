// バーコード読取の方式選び（Web / iOS WKWebView / Capacitor）
// iOS の WKWebView には BarcodeDetector が無いため、同梱した html5-qrcode を
// ローカルから読み込んで使う（CDNから遠隔のコードを読まない＝審査・オフライン両面で安全）。
// 方式の判定だけを純粋関数にして node --test で検証できるようにしている。

/** 同梱スキャナの場所（アプリのルートからの相対パス） */
export const VENDOR_SCANNER_PATH = 'vendor/html5-qrcode.min.js';

/* ---------------- カメラの向き（内カメラ／外カメラ） ---------------- */

/** 使うカメラの向き。environment=外（背面）カメラ / user=内（前面）カメラ */
export const FACING_MODES = ['environment', 'user'];

/** 最初に使うカメラ（画材のバーコードは外カメラで読むのが基本） */
export const DEFAULT_FACING = 'environment';

/** 想定外の値は外カメラに倒す（保存値が壊れていても落ちない） */
export function normalizeFacing(value) {
  return String(value ?? '').trim() === 'user' ? 'user' : DEFAULT_FACING;
}

/** 切り替え先の向き（外→内→外） */
export function toggleFacing(value) {
  return normalizeFacing(value) === 'user' ? 'environment' : 'user';
}

/** 画面に出す短い名前 */
export function facingLabel(value) {
  return normalizeFacing(value) === 'user' ? '内カメラ' : '外カメラ';
}

/**
 * getUserMedia（Web の BarcodeDetector 経路）に渡すカメラ指定。
 * ideal にして、その向きが無い端末でも「カメラが開かない」で止まらないようにする。
 */
export function facingConstraints(value) {
  return { facingMode: { ideal: normalizeFacing(value) } };
}

/**
 * 同梱の html5-qrcode に渡すカメラ指定。
 * このライブラリは facingMode を「文字列」か「{ exact: … }」でしか受け付けない（ideal を渡すと例外）。
 */
export function scannerFacingConfig(value) {
  return { facingMode: normalizeFacing(value) };
}

/** カメラの向きを選べる方式か（ネイティブ読取・手入力のときは切り替えボタンを出さない） */
export function canChooseFacing(strategy) {
  return strategy === 'barcode-detector' || strategy === 'html5-qrcode';
}

/**
 * 使える読取方式を決める。
 * 1. Capacitor のネイティブプラグイン（あれば最優先・高速で確実）
 * 2. Web の BarcodeDetector（Chrome/Android。WKWebView には無い）
 * 3. 同梱の html5-qrcode（iOS WKWebView を含むブラウザ全部。要 https/localhost）
 * 4. どれも不可なら手入力
 * @returns {'native'|'barcode-detector'|'html5-qrcode'|'manual'}
 */
export function chooseScanStrategy({ hasNativePlugin = false, hasBarcodeDetector = false, secureContext = true, canLoadVendor = true } = {}) {
  if (hasNativePlugin) return 'native';
  if (!secureContext) return 'manual'; // カメラ自体が開けない（http の公開URLなど）
  if (hasBarcodeDetector) return 'barcode-detector';
  if (canLoadVendor) return 'html5-qrcode';
  return 'manual';
}

/* ---------------- ネイティブ読取（iOS: AVFoundation）の指定 ---------------- */

/** ネイティブ読取で認識するバーコードの種類（画材のJANは EAN-13 が基本） */
export const NATIVE_SCAN_FORMATS = ['EAN_13', 'EAN_8', 'UPC_A', 'CODE_128'];

/**
 * ネイティブ読取に渡すオプション。
 * カメラの向きも一緒に渡す（プラグイン側は内カメラの切替ボタンも持っている）。
 */
export function nativeScanOptions(facing) {
  return { formats: [...NATIVE_SCAN_FORMATS], camera: normalizeFacing(facing) };
}

/* ---------------- 同梱スキャナ（html5-qrcode）の高速化 ---------------- */

/** web フォールバックの読み取り回数/秒（JAN 4種に絞った上で、少し上げて待たせない） */
export const WEB_SCAN_FPS = 24;

/**
 * 同梱スキャナに渡す設定（読む種類を EAN/UPC/CODE128 だけに絞って1コマの解析を軽くする）。
 * 古い版で Html5QrcodeSupportedFormats が無いときは、余計な指定をせず既定のままにする。
 */
export function vendorScannerOptions(win = typeof window !== 'undefined' ? window : undefined) {
  const formats = vendorSupportedFormats(win);
  return formats.length ? { verbose: false, formatsToSupport: formats } : { verbose: false };
}

/** 同梱スキャナの開始オプション（fps と、使えるならブラウザの高速検出） */
export function vendorStartConfig(fps = WEB_SCAN_FPS) {
  return { fps, experimentalFeatures: { useBarCodeDetectorIfSupported: true } };
}

/** 同梱スキャナが対応している形式の番号（EAN-13 など4種ぶん） */
export function vendorSupportedFormats(win = typeof window !== 'undefined' ? window : undefined) {
  const enumObj = win?.__Html5QrcodeLibrary__?.Html5QrcodeSupportedFormats
    || win?.Html5QrcodeSupportedFormats
    || null;
  if (!enumObj) return [];
  const names = ['EAN_13', 'EAN_8', 'UPC_A', 'CODE_128'];
  return names.map((n) => enumObj[n]).filter((v) => typeof v === 'number');
}

/** Capacitor のネイティブ実行中か（ブラウザ表示では false） */
export function isNativeShell(win = typeof window !== 'undefined' ? window : undefined) {
  return Boolean(win && win.Capacitor && (win.Capacitor.isNativePlatform?.() || win.Capacitor.isNative));
}

/** Capacitor のプラグインが登録されているか（未導入なら undefined） */
export function nativeScannerPlugin(win = typeof window !== 'undefined' ? window : undefined) {
  const plugins = win?.Capacitor?.Plugins;
  return plugins?.BarcodeScanner || plugins?.MlkitBarcodeScanner || null;
}

/** 同梱スキャナが定義するグローバル（UMD版はこの2つを立てる） */
export function vendorScannerCtor(win = typeof window !== 'undefined' ? window : undefined) {
  return win?.__Html5QrcodeLibrary__?.Html5Qrcode || win?.Html5Qrcode || null;
}

/**
 * 同梱スキャナを遅延読み込みする（初回の読取のときだけ375KBを読む）。
 * すでに読み込み済みならそのまま返す。読み込めなければ null。
 */
export function loadVendorScanner(doc = typeof document !== 'undefined' ? document : undefined, src = VENDOR_SCANNER_PATH) {
  const win = doc?.defaultView || (typeof window !== 'undefined' ? window : undefined);
  const existing = vendorScannerCtor(win);
  if (existing) return Promise.resolve(existing);
  if (!doc || doc.getElementById('vendorScannerScript')) {
    // 読み込み中の二重挿入を避ける（既存タグの完了を待つ）
    return new Promise((resolve) => {
      const tag = doc?.getElementById('vendorScannerScript');
      if (!tag) { resolve(null); return; }
      tag.addEventListener('load', () => resolve(vendorScannerCtor(win)));
      tag.addEventListener('error', () => resolve(null));
    });
  }
  return new Promise((resolve) => {
    const script = doc.createElement('script');
    script.id = 'vendorScannerScript';
    script.src = src;
    script.async = true;
    script.onload = () => resolve(vendorScannerCtor(win));
    script.onerror = () => resolve(null);
    doc.head.appendChild(script);
  });
}
