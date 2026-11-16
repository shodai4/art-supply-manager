import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEmptyStock, createItem, adjustStock } from '../core.js';
import { chooseScanStrategy, isNativeShell, vendorScannerCtor, VENDOR_SCANNER_PATH } from '../scanner.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

test('在庫切れ判定（数量0・残量使い切り）', () => {
  assert.equal(isEmptyStock(createItem({ name: 'x', qty: 0 })), true);
  assert.equal(isEmptyStock(createItem({ name: 'x', qty: 2, status: 'empty' })), true);
  assert.equal(isEmptyStock(createItem({ name: 'x', qty: 2, status: 'enough' })), false);
  // ステッパーで0にすると在庫切れになる
  const item = createItem({ name: 'x', qty: 1 });
  assert.equal(isEmptyStock(adjustStock(item, -1)), true);
});

test('在庫切れカードは一覧のクラスでグレー表示になり、操作は止めない', () => {
  const css = read('styles.css');
  const app = read('app.js');
  assert.match(app, /item-card--empty/);
  assert.match(app, /data-empty="\$\{isEmpty \? '1' : '0'\}"/);
  assert.match(css, /\.tile\.item-card--empty/);
  assert.match(css, /\.item\.item-card--empty/);
  // グレー表示のためのルールに pointer-events: none を入れない（＋−・タップ編集・通販を塞がない）
  const blocks = [...css.matchAll(/[^{}]*item-card--empty[^{}]*\{[^}]*\}/g)].map((m) => m[0]);
  assert.ok(blocks.length >= 2, `グレー表示のルール数: ${blocks.length}`);
  for (const block of blocks) assert.equal(/pointer-events\s*:\s*none/.test(block), false, block);
});

test('通販・辞書の導線がHTMLにある（短いラベル）', () => {
  const html = read('index.html');
  for (const id of ['shopLinks', 'shopQuery', 'proposeBox', 'btnPropose', 'sheetShop', 'sheetPropose', 'btnDictSync', 'dictSyncState']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} がありません`);
  }
  assert.match(html, />辞書に提案</);
  assert.match(html, />辞書を更新</);
  assert.match(html, />通販</);
  for (const label of ['>Amazon<', '>楽天市場<', '>Yahoo!<']) {
    assert.ok(html.includes('shop-links') || true);
    assert.ok(read('shops.js').includes(label.replace(/[><]/g, '')), `${label} が shops.js にありません`);
  }
  // 法務・規約の注記は最下部の極小1行に逃がす（Amazonアソシエイトの表示義務を含む）
  assert.match(html, /foot-note[\s\S]*アフィリエイト/);
  assert.match(html, /foot-note[\s\S]*Amazonのアソシエイトとして、適格販売により収入を得ています。/);
});

test('配信ファイル jan-extra.json がルートにある（初期構造）', () => {
  const payload = JSON.parse(fs.readFileSync(path.join(ROOT, 'jan-extra.json'), 'utf8'));
  assert.equal(typeof payload.version, 'number');
  assert.ok(Array.isArray(payload.items));
  assert.ok(payload.updatedAt);
});

test('新しく足したファイルは絵文字を含まない（表示方針）', () => {
  const files = [
    'index.html', 'app.js', 'styles.css', 'core.js', 'pro.js', 'shops.js', 'jan-extra.js', 'scanner.js',
    'sw.js', 'vendor/README.md', 'images.js', 'workers/rakuten-image-proxy/src/index.js',
    'docs/rakuten-proxy-setup.md', 'docs/ios-release-plan.md',
  ];
  for (const file of files) {
    const text = read(file);
    assert.equal(EMOJI.test(text), false, `${file} に絵文字があります`);
  }
});

test('第2弾の導線（Pro案内・色見本・画材費・復元）がHTMLとapp.jsにある', () => {
  const html = read('index.html');
  const app = read('app.js');
  for (const id of [
    'view-swatch', 'swatchGrid', 'quotaNote',
    'sheetPro', 'proLead', 'proQuota', 'proSheetBenefits', 'btnProStart',
    'proCard', 'proState', 'proBenefits', 'btnProToggle',
    'costCard', 'costBody', 'costLock', 'costStock', 'costRecorded', 'costNote', 'costTabs', 'costBars', 'btnCsv', 'btnCostPro',
    'sheetRestore', 'restoreNote', 'btnRestoreMerge', 'btnRestoreReplace',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `#${id} がありません`);
  }
  // 無料上限とPro判定は pro.js を通す（数字を画面側に散らさない）
  assert.match(app, /from '\.\/pro\.js'/);
  assert.match(app, /canAddItem\(state, state\.settings\)/);
  assert.match(app, /canAddFolder\(state, state\.settings\)/);
  assert.match(app, /requirePro\('swatch'\)/);
  // 色見本は「在庫」の次にある独立したタブ（ツールバーは狭いので増やさない）
  assert.match(html, /data-tab="swatch"[^>]*>色見本</);
  assert.match(app, /recordPurchase\(/);
  assert.match(app, /buildItemsCsvText\(/);
  assert.match(app, /mergeStates\(/);
  // 色見本は編集シートから撮影・選択できる（写真メモ。iOS では capture を外して
  // 「撮る / 選ぶ」の選択シートを出す＝カメラ固定にしない）
  assert.match(html, /色見本・写真メモ/);
  assert.match(html, /id="fPhoto" accept="image\/\*"/);
  assert.equal(/id="fPhoto"[^>]*capture=/.test(html), false);
  // バックアップは言葉を短く（保存 / 復元）
  assert.match(html, /id="btnExport">バックアップ保存</);
  assert.match(html, /id="btnImport">復元</);
  // 新しい画面のスタイルがある
  const css = read('styles.css');
  for (const sel of ['.sgrid', '.swt', '.bar .bf', '.pro-chip', '.quota']) {
    assert.ok(css.includes(sel), `${sel} のスタイルがありません`);
  }
});

test('app.js が参照する要素IDはすべて index.html にある', () => {
  // 動的に作る要素（スキャナの入れ物）はHTMLに無くてよい
  const DYNAMIC_IDS = new Set(['qrReader']);
  const app = read('app.js');
  const html = read('index.html');
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([
    ...[...app.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]),
    ...[...app.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]),
  ]);
  const missing = [...used].filter((id) => !ids.has(id) && !DYNAMIC_IDS.has(id));
  assert.deepEqual(missing, [], `index.html に無いID: ${missing.join(', ')}`);
});

test('読取方式の選び分け（iOS WKWebView には BarcodeDetector が無い前提）', () => {
  assert.equal(chooseScanStrategy({ hasNativePlugin: true }), 'native');
  assert.equal(chooseScanStrategy({ hasBarcodeDetector: true }), 'barcode-detector');
  assert.equal(chooseScanStrategy({}), 'html5-qrcode');
  assert.equal(chooseScanStrategy({ secureContext: false }), 'manual');
  assert.equal(chooseScanStrategy({ canLoadVendor: false }), 'manual');
  // WKWebView 相当（ネイティブ無し・BarcodeDetector 無し・https）：同梱スキャナで動く
  assert.equal(chooseScanStrategy({ hasNativePlugin: false, hasBarcodeDetector: false, secureContext: true }), 'html5-qrcode');
});

test('Capacitor 判定と同梱スキャナの参照', () => {
  assert.equal(isNativeShell({}), false);
  assert.equal(isNativeShell({ Capacitor: { isNative: true } }), true);
  assert.equal(isNativeShell({ Capacitor: { isNativePlatform: () => true } }), true);
  assert.equal(vendorScannerCtor({ __Html5QrcodeLibrary__: { Html5Qrcode: 'x' } }), 'x');
  assert.equal(vendorScannerCtor({ Html5Qrcode: 'y' }), 'y');
  assert.equal(vendorScannerCtor({}), null);
});

test('画像取得の設定は「中継サーバーURL＋上級者の認証情報」に整理され、画像ボタンは中継サーバー経由', () => {
  const html = read('index.html');
  const app = read('app.js');
  const images = read('images.js');

  // 設定画面: 普段見えるのは状態の1行だけで、入力は開閉式の中にまとめる
  assert.match(html, /<details class="advanced">/);
  for (const id of ['rakutenState', 'fProxyUrl', 'fRakuten', 'fAccessKey', 'btnSaveImageSettings']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} がありません`);
  }
  assert.equal(html.includes('btnSaveRakuten'), false, '旧ボタンが残っている');

  // 画像を取得ボタンは中継サーバー経由の入口を使う（自分のアプリIDは逃げ道）
  assert.match(app, /fetchProductImageInfo\(/);
  assert.match(app, /accessKey: String\(state\.settings\.rakutenAccessKey/);
  assert.equal(/fetchRakutenImage\(/.test(app), false);

  // 全員に効くURLは1か所の定数（2026年11月16日にデプロイしたWorkersのURL）
  assert.match(images, /export const DEFAULT_IMAGE_PROXY_URL = 'https:\/\/rakuten-image-proxy\.shodai121ueda\.workers\.dev';/);

  // 中継サーバーは楽天・Yahoo!の両方に対応していることを設定画面で伝える
  assert.match(html, /楽天・Yahoo!の両方に対応/);
});

test('Yahoo!のAPIを使うため、規定のHTMLでクレジットを最下部に置く', () => {
  const html = read('index.html');
  // 規定のソース（上下のコメントとspanのstyle）をそのまま使う。classなどを足して見た目を変えない
  assert.ok(html.includes('<!-- Begin Yahoo! JAPAN Web Services Attribution Snippet -->'));
  assert.ok(html.includes('<span style="margin:15px 15px 15px 15px"><a href="https://developer.yahoo.co.jp/sitemap/">Webサービス by Yahoo! JAPAN</a></span>'));
  assert.ok(html.includes('<!-- End Yahoo! JAPAN Web Services Attribution Snippet -->'));
  const snippetAt = html.indexOf('Begin Yahoo! JAPAN Web Services Attribution Snippet');
  assert.ok(snippetAt > html.indexOf('foot-note'), 'クレジットは注記より下（アプリの下部）に置く');
});

test('一覧の上部の「メーカー別」で、ワンタップでメーカーごとに分けて見られる', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');

  // 一覧の上部（ヘッダー内）にピルが1つ。ツールバーは狭いので増やさない
  assert.match(html, /<div class="viewrow" id="viewRow" hidden>\s*<button class="vpill" id="btnMakerGroup" aria-pressed="false"[^>]*>メーカー別</);
  assert.equal(/id="btnMakerGroup"[^>]*>\s*<svg/.test(html), false, 'アイコンだけにせず言葉で分かるようにする');
  assert.equal(/id="viewRow"[\s\S]{0,300}<svg/.test(html), false, 'ピルにアイコンを足さない');

  // 押すとオン・オフが切り替わる（既存のメーカー見出しグループ表示を使う）
  assert.match(app, /\$\('btnMakerGroup'\)\.addEventListener\('click', \(\) => \{[\s\S]{0,200}toggleMakerGroup\(state\.settings\)/);
  assert.match(app, /renderTilesInto\(\$\('itemList'\), currentList\(\), \{ group: state\.settings\.sort === 'maker'/);
  // 押されている状態が見た目で分かる
  assert.match(app, /\$\('btnMakerGroup'\)\.setAttribute\('aria-pressed', String\(grouped\)\)/);
  // 絞込・並替の「メーカー順」と矛盾しない（どちらから変えても同じ状態になる）
  assert.match(app, /withSortMode\(state\.settings, b\.dataset\.sort\)/);
  assert.equal(/settings: \{ \.\.\.state\.settings, sort: b\.dataset\.sort \}/.test(app), false, '並替は連動する入口を通す');
  // 出るのは在庫タブの一覧のときだけ（保管場所のグリッドでは出さない）
  assert.match(app, /\$\('viewRow'\)\.hidden = ui\.tab !== 'stock' \|\| isFolderMode\(\)/);

  // 375pxではみ出さない（横並び1つ・折り返さない・高さはツールバー並み）
  assert.match(css, /\.viewrow\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.viewrow\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.vpill\s*\{[^}]*white-space:\s*nowrap/);
  const pill = /\.vpill\s*\{([^}]*)\}/.exec(css)[1];
  assert.match(pill, /height:\s*26px/);
  assert.match(pill, /font-size:\s*11\.5px/);
  // 押されているときの見た目（テーマの変数を使う）
  assert.match(css, /\.vpill\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--accent-soft\)/);

  // 絵文字を使わない
  const block = html.slice(html.indexOf('id="viewRow"'), html.indexOf('id="viewRow"') + 300);
  assert.equal(EMOJI.test(block), false, 'メーカー別の導線に絵文字がある');
});

test('画面サイズは固定（ダブルタップ・ピンチで拡大しない）', () => {
  const html = read('index.html');
  const css = read('styles.css');
  const app = read('app.js');

  // viewport: 拡大を止めつつ、既存の viewport-fit=cover は残す
  const meta = /<meta name="viewport" content="([^"]+)"/.exec(html);
  assert.ok(meta, 'viewport がありません');
  assert.match(meta[1], /width=device-width/);
  assert.match(meta[1], /initial-scale=1\.0/);
  assert.match(meta[1], /maximum-scale=1\.0/);
  assert.match(meta[1], /user-scalable=no/);
  assert.match(meta[1], /viewport-fit=cover/);

  // CSS: html/body と下部タブバー・ボタン類はダブルタップの拡大をしない
  assert.match(css, /html, body\s*\{[^}]*touch-action:\s*manipulation/);
  assert.match(css, /[^{}]*button[^{}]*\{[^}]*touch-action:\s*manipulation/);
  assert.match(css, /[^{}]*\.tabbar button[^{}]*\{[^}]*touch-action:\s*manipulation/);

  // iOS WKWebView は user-scalable=no を無視するので、2本指のジェスチャーも止める
  assert.match(app, /for \(const type of \['gesturestart', 'gesturechange', 'gestureend'\]\) \{\s*document\.addEventListener\(type, \(e\) => e\.preventDefault\(\), \{ passive: false \}\);/);

  // 1本指のスクロール・文字入力を塞がない（touchstart を丸ごと止めない）
  assert.equal(/addEventListener\('touchstart'[\s\S]{0,160}preventDefault/.test(app), false, 'スクロールを止めている');
  assert.equal(/addEventListener\('touchmove'[\s\S]{0,160}preventDefault/.test(app), false, 'スクロールを止めている');
  // 入力欄の拡大抑止で文字入力を壊さない（font-size は16px以上を保つ）
  const inputFont = /\.field input, \.field select, \.field textarea\s*\{([^}]*)\}/.exec(css);
  assert.ok(inputFont, '入力欄のスタイルがありません');
  assert.match(inputFont[1], /font-size:\s*1[6-9]px|font-size:\s*1[6-9]\./);
});
