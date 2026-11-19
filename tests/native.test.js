import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_SCHEMES, EXTERNAL_SCHEMES, parseHref, isAppScheme,
  shouldOpenExternally, browserPlugin, openInExternalBrowser,
} from '../links.js';
import { EXTRA_DICT_REMOTE_URL, EXTRA_DICT_URL, resolveDictionaryUrl } from '../jan-extra.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

/* ---------------- 外部リンク（iOS WKWebView に閉じ込めない） ---------------- */

test('href の解決とアプリ内スキームの判定', () => {
  assert.equal(parseHref('') , null);
  assert.equal(parseHref(null), null);
  assert.equal(parseHref('壊れた url'), null);
  assert.equal(parseHref('privacy.html', 'capacitor://localhost/index.html').protocol, 'capacitor:');
  assert.ok(APP_SCHEMES.includes('capacitor:'));
  assert.ok(EXTERNAL_SCHEMES.includes('https:'));
  assert.equal(isAppScheme('capacitor://localhost/privacy.html'), true);
  assert.equal(isAppScheme('https://shodai4.com/art-supply-manager/'), false);
});

test('アプリ内では http/https・mailto・tel を外部ブラウザへ渡す', () => {
  const native = { native: true, base: 'capacitor://localhost/index.html' };
  assert.equal(shouldOpenExternally('https://www.amazon.co.jp/s?k=ホルベイン', native), true);
  assert.equal(shouldOpenExternally('https://github.com/shodai4/art-supply-manager/issues/new', native), true);
  assert.equal(shouldOpenExternally('mailto:shodai121ueda@gmail.com', native), true);
  assert.equal(shouldOpenExternally('tel:+817089718945', native), true);
  // 同梱ページはアプリ内のまま（capacitor:// なので外部ではない）
  assert.equal(shouldOpenExternally('capacitor://localhost/privacy.html', native), false);
  assert.equal(shouldOpenExternally('privacy.html', native), false);
  assert.equal(shouldOpenExternally('#stock', native), false);
  assert.equal(shouldOpenExternally('javascript:void(0)', native), false);
  assert.equal(shouldOpenExternally('', native), false);
  assert.equal(shouldOpenExternally(undefined, native), false);
});

test('Web版では同じサイト内はそのまま・別サイトだけ外部', () => {
  const web = { native: false, base: 'https://shodai4.com/art-supply-manager/' };
  assert.equal(shouldOpenExternally('privacy.html', web), false);
  assert.equal(shouldOpenExternally('https://shodai4.com/art-supply-manager/support.html', web), false);
  assert.equal(shouldOpenExternally('https://www.amazon.co.jp/dp/x', web), true);
  assert.equal(shouldOpenExternally('mailto:a@example.com', web), true);
});

test('Capacitor の Browser プラグインを取り出し、無ければ開かないと答える', async () => {
  const opened = [];
  const plugin = { open: async ({ url }) => { opened.push(url); return {}; } };
  assert.equal(browserPlugin(undefined), null);
  assert.equal(browserPlugin({}), null);
  assert.equal(browserPlugin({ Capacitor: { Plugins: { Browser: plugin } } }), plugin);
  // ネイティブ側の registerPlugin 経由でも取り出す（Plugins に居ない場合）
  const registered = browserPlugin({ Capacitor: { registerPlugin: () => plugin } });
  assert.equal(registered, plugin);
  // 未導入（open が失敗する）は false を返して、呼び出し側が次の手段へ移れる
  assert.equal(await openInExternalBrowser('https://example.com/', { win: {} }), false);
  assert.equal(await openInExternalBrowser('', { win: { Capacitor: { Plugins: { Browser: plugin } } } }), false);
  assert.equal(await openInExternalBrowser('https://example.com/', {
    win: { Capacitor: { Plugins: { Browser: { open: async () => { throw new Error('未実装'); } } } } },
  }), false);
  assert.equal(await openInExternalBrowser('https://example.com/', { win: { Capacitor: { Plugins: { Browser: plugin } } } }), true);
  assert.deepEqual(opened, ['https://example.com/']);
});

test('app.js はアプリ内の全リンクを横取りして Safari へ渡す', () => {
  const app = read('app.js');
  assert.match(app, /from '\.\/links\.js'/);
  assert.match(app, /shouldOpenExternally\(/);
  assert.match(app, /openInExternalBrowser\(/);
  // クリックは capture 段階で拾う（他のハンドラより先に止める）
  assert.match(app, /document\.addEventListener\('click',[\s\S]{0,400}?\}, true\)/);
  assert.match(app, /a\[href\]/);
  // アプリ内では Service Worker を登録しない（capacitor:// では失敗するだけ）
  assert.match(app, /'serviceWorker' in navigator && !isNativeShell\(window\)/);
});

/* ---------------- 辞書の同期先（アプリ内は本番URLから取る） ---------------- */

test('辞書の同期先はアプリ内だけ本番URL、Webは同じ階層のまま', () => {
  assert.equal(resolveDictionaryUrl(), EXTRA_DICT_URL);
  assert.equal(resolveDictionaryUrl({ native: false }), EXTRA_DICT_URL);
  assert.equal(resolveDictionaryUrl({ native: true }), EXTRA_DICT_REMOTE_URL);
  assert.match(EXTRA_DICT_REMOTE_URL, /^https:\/\/shodai4\.com\/art-supply-manager\/jan-extra\.json$/);
  // 動作確認用の上書きは http/https のときだけ受け付ける
  assert.equal(resolveDictionaryUrl({ native: true, override: 'https://example.com/x.json' }), 'https://example.com/x.json');
  assert.equal(resolveDictionaryUrl({ native: true, override: 'file:///tmp/x.json' }), EXTRA_DICT_REMOTE_URL);
  assert.equal(resolveDictionaryUrl({ native: true, override: '  ' }), EXTRA_DICT_REMOTE_URL);
});

test('app.js はアプリ内かどうかで同期先を切り替える', () => {
  const app = read('app.js');
  assert.match(app, /resolveDictionaryUrl\(\{ native: isNativeShell\(window\) \}\)/);
});

/* ---------------- 配布ファイルとキャッシュ ---------------- */

test('www/ に links.js が入り、Service Worker のキャッシュにも含まれる', async () => {
  const { WEB_ASSETS } = await import('../scripts/build.mjs');
  assert.ok(WEB_ASSETS.includes('links.js'), 'links.js が WEB_ASSETS にありません');
  assert.ok(fs.existsSync(path.join(ROOT, 'links.js')));
  const sw = read('sw.js');
  assert.match(sw, /'\.\/links\.js'/);
  // キャッシュ名は更新のたびに上げる（古いJSが残ると画面が壊れる）
  assert.match(sw, /art-supply-manager-v62/);
  // サンプルデータは別ファイル（Service Worker と www/ の両方に入れる）
  assert.match(sw, /'\.\/samples\.js'/);
  assert.ok(WEB_ASSETS.includes('samples.js'), 'samples.js が WEB_ASSETS にありません');
});

test('index.html のキャッシュバスティングは package.json の版と一致する', () => {
  const pkg = JSON.parse(read('package.json'));
  const html = read('index.html');
  assert.match(html, new RegExp(`app\\.js\\?v=${pkg.version.replace(/\./g, '\\.')}`));
  assert.match(html, new RegExp(`styles\\.css\\?v=${pkg.version.replace(/\./g, '\\.')}`));
  assert.match(pkg.dependencies['@capacitor/browser'], /^\^6\./);
});
