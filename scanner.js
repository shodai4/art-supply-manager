// バーコード読取の方式選び（Web / iOS WKWebView / Capacitor）
// iOS の WKWebView には BarcodeDetector が無いため、同梱した html5-qrcode を
// ローカルから読み込んで使う（CDNから遠隔のコードを読まない＝審査・オフライン両面で安全）。
// 方式の判定だけを純粋関数にして node --test で検証できるようにしている。

/** 同梱スキャナの場所（アプリのルートからの相対パス） */
export const VENDOR_SCANNER_PATH = 'vendor/html5-qrcode.min.js';

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
