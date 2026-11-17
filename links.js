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

/** アプリに同梱している法務・サポートのページ（アプリ内で読む） */
export const LEGAL_DOCS = [
  { key: 'terms', file: 'terms.html', title: '利用規約' },
  { key: 'privacy', file: 'privacy.html', title: 'プライバシーポリシー' },
  { key: 'support', file: 'support.html', title: 'サポート' },
];

/**
 * 法務・サポートのページを指すリンクか。当たれば 'terms' / 'privacy' / 'support'。
 *
 * iOS の WKWebView は `target="_blank"` を開けないので、同梱ページへの相対リンクは
 * アプリ内では押しても無反応になる（capacitor:// なので外部ブラウザ行きにもならない）。
 * 呼び出し側はこの結果でリンクを横取りし、アプリ内の読み物シートに切り替える。
 * 対象は「同梱の3ページ」と「同じサイトにある同じ3ページ」だけ（別サイトの同名ページは拾わない）。
 * @returns {string} 'terms' | 'privacy' | 'support' | ''
 */
export function legalDocKey(href, base) {
  const url = parseHref(href, base);
  if (!url) return '';
  if (!['capacitor:', 'file:', 'about:', 'http:', 'https:'].includes(url.protocol)) return '';
  // 同じサイトのページだけ（Web版の別サイト・別オリジンは通常のリンクのまま）
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    const own = parseHref(base);
    if (!own || url.origin !== own.origin) return '';
  }
  const name = String(url.pathname || '').split('/').pop().toLowerCase();
  const doc = LEGAL_DOCS.find((d) => d.file === name || `${d.key}.html` === name);
  return doc ? doc.key : '';
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
