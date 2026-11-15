// 外部リンク（通販・GitHub・法務ページ）の扱い
// iOS の WKWebView は target="_blank" を開けないため、アプリ内では a タグのクリックを
// 横取りして Capacitor の Browser プラグイン（iOS は SFSafariViewController）へ渡す。
// ここは判定と取り出しだけの純粋な部分。DOM に触れないので node --test から検証できる。

/** アプリ自身のスキーム（外部ブラウザへ渡さない） */
export const APP_SCHEMES = ['capacitor:', 'ionic:', 'file:', 'about:', 'javascript:'];
/** 外部ブラウザへ渡すスキーム（http/https のほか、メーラー・電話も WebView では開けない） */
export const EXTERNAL_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

/**
 * href を URL に変換する（相対パスは base で解決）。解決できなければ null。
 * @returns {URL|null}
 */
export function parseHref(href, base) {
  const text = String(href == null ? '' : href).trim();
  if (!text) return null;
  try {
    return base ? new URL(text, base) : new URL(text);
  } catch {
    return null;
  }
}

/** アプリ自身のスキームか（capacitor://localhost/... など） */
export function isAppScheme(href, base) {
  const url = parseHref(href, base);
  return Boolean(url && APP_SCHEMES.includes(url.protocol));
}

/**
 * 外部ブラウザで開くべきリンクか。
 * - アプリ内（native）: http/https/mailto/tel はすべて外部（同梱ページも capacitor:// なので該当しない）
 * - Web: 同じサイト内のページはそのまま、別サイト・mailto・tel だけ外部
 * @returns {boolean}
 */
export function shouldOpenExternally(href, { native = false, base } = {}) {
  const url = parseHref(href, base);
  if (!url) return false;
  if (!EXTERNAL_SCHEMES.includes(url.protocol)) return false;
  if (url.protocol === 'mailto:' || url.protocol === 'tel:') return true;
  if (native) return true;
  const own = parseHref(base);
  if (!own || !/^https?:$/.test(own.protocol)) return false;
  return url.origin !== own.origin;
}

/**
 * Capacitor の Browser プラグインを取り出す。
 * ネイティブのブリッジが立てた `Capacitor.Plugins.Browser` を優先し、
 * 無ければ `registerPlugin('Browser')` の戻り（未導入なら open が失敗する）を使う。
 * @returns {{open:Function}|null}
 */
export function browserPlugin(win) {
  const cap = win?.Capacitor;
  if (!cap) return null;
  const direct = cap.Plugins?.Browser;
  if (direct && typeof direct.open === 'function') return direct;
  if (typeof cap.registerPlugin === 'function') {
    try {
      const plugin = cap.registerPlugin('Browser');
      if (plugin && typeof plugin.open === 'function') return plugin;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 外部ブラウザで開く。開けたら true。
 * プラグイン未導入・失敗（戻り値の無い Promise 含む）は false を返し、呼び出し側が次の手段へ移る。
 * @returns {Promise<boolean>}
 */
export async function openInExternalBrowser(url, { win = typeof window !== 'undefined' ? window : undefined } = {}) {
  const href = String(url == null ? '' : url).trim();
  if (!href) return false;
  const plugin = browserPlugin(win);
  if (!plugin) return false;
  try {
    await plugin.open({ url: href });
    return true;
  } catch {
    return false;
  }
}
