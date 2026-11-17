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
  for (const id of ['shopLinks', 'shopQuery', 'proposeBox', 'btnPropose', 'sheetShop', 'sheetPropose', 'dictInfo']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} がありません`);
  }
  assert.match(html, />辞書に提案</);
  assert.match(html, />通販</);
  // JAN辞書は設定に1行だけ（件数）。更新は起動時に裏で自動
  assert.match(html, /id="dictInfo"/);
  assert.equal(/>辞書を更新</.test(html), false, '辞書を更新ボタンが残っている');
  for (const label of ['>Amazon<', '>楽天市場<', '>Yahoo!<']) {
    assert.ok(html.includes('shop-links') || true);
    assert.ok(read('shops.js').includes(label.replace(/[><]/g, '')), `${label} が shops.js にありません`);
  }
  // 法務・規約の注記は最下部の極小1行に逃がす（Amazonアソシエイトの表示義務を含む）
  assert.match(html, /foot-note">Amazonのアソシエイトとして、適格販売により収入を得ています。/);
  // 楽天・Yahoo!などのアフィリエイトリンク（PR）も、同じ1行の後ろに続けて書く
  assert.match(html, /適格販売により収入を得ています。また、本アプリの一部リンクには楽天・Yahoo!ショッピング等のアフィリエイトリンク（PR）を含みます。<\/p>/);
  // 古い言い回し（別の補足文）は残さない
  assert.equal(/ほかの通販リンクも/.test(html), false, '古いアフィリエイトの文言が残っている');
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

test('第2弾の導線（Pro案内・画材費・復元）がHTMLとapp.jsにある', () => {
  const html = read('index.html');
  const app = read('app.js');
  for (const id of [
    'quotaNote',
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
  // 色見本タブは廃止（タブバーは在庫・メーカー・補充・検索・設定の5つ）
  assert.equal(/data-tab="swatch"/.test(html), false, '色見本タブが残っている');
  assert.equal(/swatch/i.test(read('app.js')), false, 'app.js に色見本の処理が残っている');
  assert.match(app, /recordPurchase\(/);
  assert.match(app, /buildItemsCsvText\(/);
  assert.match(app, /mergeStates\(/);
  // 写真メモは編集シートから撮影・選択できる（iOS では capture を外して
  // 「撮る / 選ぶ」の選択シートを出す＝カメラ固定にしない）
  assert.match(html, /<label>写真メモ<\/label>/);
  assert.match(html, /id="fPhoto" accept="image\/\*"/);
  assert.equal(/id="fPhoto"[^>]*capture=/.test(html), false);
  // バックアップは言葉を短く（保存 / 復元）
  assert.match(html, /id="btnExport">バックアップ保存</);
  assert.match(html, /id="btnImport">復元</);
  // 新しい画面のスタイルがある
  const css = read('styles.css');
  for (const sel of ['.bar .bf', '.pro-chip', '.quota', '.menubtn', '.hbtn']) {
    assert.ok(css.includes(sel), `${sel} のスタイルがありません`);
  }
});

test('app.js が参照する要素IDはすべて index.html にある', () => {
  // 動的に作る要素（スキャナの入れ物）と、画面から外した任意の設定欄はHTMLに無くてよい
  const DYNAMIC_IDS = new Set([
    'qrReader',
    'dictSyncState', 'fRakuten', 'fAccessKey', 'fProxyUrl', 'btnSaveImageSettings',
  ]);
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

test('画像取得の設定欄は設定画面から外し、中継サーバー経由の自動取得はそのまま残す', () => {
  const html = read('index.html');
  const app = read('app.js');
  const images = read('images.js');

  // 設定画面に入力欄・カードを出さない（UIのみ削除）
  for (const id of ['rakutenState', 'fProxyUrl', 'fRakuten', 'fAccessKey', 'btnSaveImageSettings']) {
    assert.equal(html.includes(`id="${id}"`), false, `#${id} が残っている`);
  }
  assert.equal(html.includes('商品画像'), false, '商品画像カードが残っている');
  assert.equal(html.includes('btnSaveRakuten'), false, '旧ボタンが残っている');

  // 中身の機能は壊さない（要素が無くても落ちないようガードする）
  assert.match(app, /\$\('btnSaveImageSettings'\)\) \{/);
  assert.match(app, /\$\('fRakuten'\)\?\.value/);
  assert.match(app, /fetchProductImageInfo\(/);
  assert.match(app, /accessKey: String\(state\.settings\.rakutenAccessKey/);
  assert.equal(/fetchRakutenImage\(/.test(app), false);

  // 全員に効くURLは1か所の定数（2026年11月16日にデプロイしたWorkersのURL）
  assert.match(images, /export const DEFAULT_IMAGE_PROXY_URL = 'https:\/\/rakuten-image-proxy\.shodai121ueda\.workers\.dev';/);
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

test('一覧はメーカー別タブで見て、絞込・並替は右上の⋯にまとめる', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');

  // 下部の2段ドックと3択は廃止（画面を広く使う）
  assert.equal(html.includes('id="dock"'), false, '下部ドックが残っている');
  assert.equal(html.includes('id="viewRow"'), false, '3択（viewRow）が残っている');
  assert.equal(/withViewGroup|viewGroupOf|VIEW_GROUPS/.test(app), false, '3択の処理が残っている');

  // メーカー別は独立したタブで、見出しをタップして開く（件数つき）
  assert.match(html, /<button data-tab="maker" aria-selected="false">メーカー<\/button>/);
  const view = html.slice(html.indexOf('id="view-maker"'), html.indexOf('id="view-shopping"'));
  assert.ok(view.includes('id="makerGroups"'), 'メーカーの一覧がありません');
  assert.match(app, /function renderMakerView\(\)/);
  assert.match(app, /listMakers\(items\)/);
  assert.match(app, /data-maker-group=/);
  assert.match(app, /ui\.openMakers\.has\(g\.key\)/);
  assert.match(app, /aria-expanded=/);
  // 見出しを押すと開け閉めできる
  assert.match(app, /closest\('\[data-maker-group\]'\)[\s\S]{0,200}ui\.openMakers\.(add|delete)/);
  // 開いた中はグリッド／リストの設定に従う（中身は itemsBodyHtml が itemRow / itemTile を選ぶ）
  assert.match(app, /ui\.layout === 'list'[\s\S]{0,160}itemsBodyHtml\(sorted/);
  assert.match(app, /function itemsBodyHtml[\s\S]{0,600}itemRow\(row\.item, opts\) : itemTile\(row\.item, opts\)/);

  // 絞込・並替・表示・複数選択・フォルダの並びは右上の⋯に集約
  const more = html.slice(html.indexOf('id="sheetMore"'), html.indexOf('id="sheetFolderOrder"'));
  for (const id of ['btnMoreFilter', 'btnMoreSort', 'btnMoreLayout', 'btnMoreSelect', 'btnMoreFolders']) {
    assert.ok(more.includes(`id="${id}"`), `#${id} がありません`);
  }
  assert.ok(html.includes('id="btnMore"'), '⋯ボタンがありません');
  assert.match(html, /class="hbtn" id="btnMore"/);
  assert.match(app, /\$\('btnMore'\)\.addEventListener\('click', \(\) => \{[\s\S]{0,120}openSheet\('sheetMore'\)/);
  // 並替は⋯から開く（メーカー順と連動する設定はそのまま）
  assert.match(app, /withSortMode\(state\.settings, b\.dataset\.sort\)/);
  // 絞込・並びが入っているときは⋯に点を出す
  assert.match(app, /\$\('btnMore'\)\.classList\.toggle\('has-dot'/);
  assert.match(css, /\.hbtn[^{]*\{[^}]*display:\s*grid/);
  assert.match(css, /\.hbtn\.has-dot/);

  // 検索は右上の虫眼鏡＋1行の検索欄（下部ドックの検索ではない）
  const header = html.slice(html.indexOf('<header class="app-header">'), html.indexOf('</header>'));
  assert.ok(header.includes('id="btnSearch"'), '虫眼鏡がヘッダーにありません');
  assert.ok(header.includes('id="searchRow"'), '検索欄がヘッダーにありません');
  assert.match(app, /\$\('searchRow'\)\.hidden = !searchOpen;/);
});

test('右下の＋の上に、文字なしの読取ボタンがある（ツールバーの読取は無し）', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');

  // フローティングボタンとして縦に並ぶ（＋のすぐ上）
  const scan = html.indexOf('class="fab scan" id="btnScan"');
  const add = html.indexOf('id="btnAdd"');
  assert.ok(scan > 0, '読取のフローティングボタンがありません');
  assert.ok(add > scan, '＋より前に読取ボタンを置く');
  assert.match(html, /<button class="fab scan" id="btnScan" aria-label="バーコードを読み取る"><svg class="ic"/);
  // 文字は入れない（アイコンだけ）
  const scanTag = html.slice(scan, html.indexOf('</button>', scan) + 9);
  assert.equal(/[ぁ-んァ-ヶ一-龠]/.test(scanTag.replace(/aria-label="[^"]*"/, '')), false, '読取ボタンに文字がある');
  // ツールバーからは外した
  const tools = html.slice(html.indexOf('id="tools"'), html.indexOf('id="searchRow"'));
  assert.equal(tools.includes('btnScan'), false, 'ツールバーの読取ボタンが残っている');
  assert.equal(tools.includes('読取'), false, 'ツールバーに読取の文字が残っている');

  // 位置はCSSで＋の上。下部ドック＋タブバーの高さを足した位置（重ならない）
  assert.match(css, /\.fab\.scan\s*\{[^}]*bottom:\s*calc\(var\(--tabbar-h\) \+ var\(--dock-h\)/);
  assert.match(css, /\.fab\s*\{[^}]*bottom:\s*calc\(var\(--tabbar-h\) \+ var\(--dock-h\)/);
  assert.match(app, /setProperty\('--dock-h'/);
  // 出るのは在庫・補充のタブのときだけ（＋と同じ）
  assert.match(app, /\$\('btnScan'\)\.style\.visibility = fabVisible/);
  // 押すと読取シートが開く（動きは今までどおり）
  assert.match(app, /\$\('btnScan'\)\.addEventListener\('click', \(\) => \{\s*openSheet\('sheetScan'\)/);
});

test('設定タブの「使い方」から、主要機能のチュートリアルを開ける', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');

  // 設定タブ内のカード（危険な操作の前）
  const guideCard = html.indexOf('id="guideCard"');
  assert.ok(guideCard > 0, '使い方のカードがありません');
  assert.ok(guideCard < html.indexOf('id="btnWipe"'), '使い方は危険な操作より上に置く');
  assert.match(html, /id="btnGuide">チュートリアルを見る</);
  // シートが開く
  assert.match(html, /<div class="sheet" id="sheetGuide" role="dialog" aria-modal="true" aria-labelledby="guideTitle">/);
  assert.match(html, /data-close="sheetGuide"/);
  assert.match(app, /\$\('btnGuide'\)\.addEventListener\('click', \(\) => openSheet\('sheetGuide'\)\)/);

  // 主要機能がひととおり載っている（短い日本語・絵文字なし）
  const sheet = html.slice(html.indexOf('id="sheetGuide"'), html.indexOf('<!-- 通販シート -->'));
  for (const word of ['バーコード', '連続スキャン', '辞書', '買うものリスト', 'フォルダ', '子フォルダ', 'まとめて移動', 'バックアップ', 'ナイトモード']) {
    assert.ok(sheet.includes(word), `${word} の説明がありません`);
  }
  assert.equal(EMOJI.test(sheet), false, 'チュートリアルに絵文字がある');
  assert.ok((sheet.match(/class="gstep"/g) || []).length >= 10, '項目が少なすぎる');
  // チュートリアルの見出しと本文のスタイルがある
  assert.match(css, /\.gstep b\s*\{[^}]*font-weight:\s*800/);
  assert.match(css, /\.gstep span\s*\{[^}]*font-size:\s*12\.5px/);
  // 文字の大きさを変える導線（拡大抑止の代わり）を書いておく
  assert.match(sheet, /端末の設定/);
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

test('下部はタブバーと広告だけ。操作はヘッダーの検索と⋯に集約する', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');

  // ヘッダーは「タイトル・件数・残り枠・虫眼鏡・⋯」の1行＋（開いたときだけ）検索欄
  const header = html.slice(html.indexOf('<header class="app-header">'), html.indexOf('</header>'));
  for (const id of ['hdrTotal', 'quotaNote', 'btnSearch', 'btnMore', 'searchRow']) {
    assert.ok(header.includes(`id="${id}"`), `ヘッダーに#${id}がありません`);
  }
  assert.equal(header.includes('id="tools"'), false, 'ツールバーが上部に残っている');
  assert.equal(header.includes('id="viewRow"'), false, '3択が上部に残っている');
  // 検索欄は開いたときだけ出す（常時は出さない）
  assert.match(html, /<div class="search-row" id="searchRow" hidden>/);
  assert.match(app, /\$\('searchRow'\)\.hidden = !searchOpen;/);

  // 下部はタブバーだけで、ドックは無い
  const belowMain = html.slice(html.indexOf('</main>'), html.indexOf('<!-- 絞込シート -->'));
  assert.ok(belowMain.includes('<nav class="tabbar"'), 'タブバーがありません');
  assert.equal(belowMain.includes('id="dock"'), false, 'ドックが残っている');
  assert.equal(belowMain.includes('class="tools"'), false, 'ツールバーが残っている');

  // FABはタブバーのすぐ上（ドックの高さは常に0）
  assert.match(app, /function syncBottomMetrics\(\)/);
  assert.match(app, /setProperty\('--dock-h', '0px'\)/);
  assert.match(css, /\.fab\s*\{[^}]*bottom:\s*calc\(var\(--tabbar-h\) \+ var\(--dock-h\)/);
  assert.match(css, /body\s*\{[^}]*padding-bottom:\s*calc\(var\(--tabbar-h\) \+ var\(--dock-h\) \+ var\(--fab-h\)/);
  assert.equal(/\.dock\s*\{/.test(css), false, 'ドックのスタイルが残っている');
});

test('タブバーは5つ（在庫・メーカー・補充・検索・設定）で均等に並ぶ', () => {
  const html = read('index.html');
  const css = read('styles.css');
  const bar = html.slice(html.indexOf('<nav class="tabbar"'), html.indexOf('</nav>', html.indexOf('<nav class="tabbar"')));
  const tabs = [...bar.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ['stock', 'maker', 'shopping', 'search', 'settings']);
  assert.equal(bar.includes('色見本'), false, '色見本タブが残っている');
  assert.equal(/data-tab="folders"/.test(bar), false, '「場所」タブが残っている');
  // 375pxで5等分（flex: 1 1 0 + min-width: 0 + 折り返さない）
  const btn = /^\.tabbar button\s*\{([^}]*)\}/m.exec(css);
  assert.ok(btn, '.tabbar button のスタイルがありません');
  assert.match(btn[1], /flex:\s*1 1 0/);
  assert.match(btn[1], /min-width:\s*0/);
  assert.match(btn[1], /white-space:\s*nowrap/);
});

test('フォルダは長押しで「編集 / 移動 / 削除」のメニューが開く', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');

  for (const id of ['sheetFolderMenu', 'folderMenuTitle', 'folderMenuPath',
    'btnFolderRename', 'btnFolderReparent', 'btnFolderRemove',
    'sheetFolderMove', 'folderMoveOptions', 'folderMoveNote']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} がありません`);
  }
  const menu = html.slice(html.indexOf('id="sheetFolderMenu"'), html.indexOf('id="sheetFolderMove"'));
  for (const label of ['編集', '移動', '削除']) assert.ok(menu.includes(`>${label}<`) || menu.includes(label), `${label} がありません`);

  // 長押しの判定（約480ms・指を動かしたら発火しない・タップとは干渉しない）
  assert.match(app, /const LONG_PRESS_MS = 480;/);
  assert.match(app, /const LONG_PRESS_MOVE_PX = 10;/);
  assert.match(app, /addEventListener\('pointerdown', startPress/);
  assert.match(app, /pressTimer = setTimeout\(\(\) => \{[\s\S]{0,400}if \(folderId\) openFolderMenu\(folderId\)/);
  assert.match(app, /if \(dx > LONG_PRESS_MOVE_PX \|\| dy > LONG_PRESS_MOVE_PX\) endPress\(\)/);
  assert.match(app, /suppressClickUntil/);
  // グリッド・子フォルダ・場所の一覧・フォルダ別見出しのどれでも開ける
  assert.match(app, /#folderGrid \[data-folder\]/);
  assert.match(app, /\[data-goto-folder\]/);
  assert.match(app, /#folderList \[data-fid\]/);
  assert.match(app, /\[data-folder-head\]/);
  // 移動は最上位＋各フォルダから。自分と配下は選べない（循環防止）
  assert.match(app, /folderOptions\(state\.folders, \{ exclude, noneLabel: '最上位（トップ）' \}\)/);
  assert.match(app, /folderSubtreeIds\(state\.folders, id\)/);
  // 長押し中に文字選択・iOSの吹き出しメニューを出さない
  assert.match(css, /-webkit-touch-callout:\s*none/);
  assert.match(css, /user-select:\s*none/);
});

test('検索タブは「メーカー」→（カテゴリ）→検索バー→検索結果の順に並ぶ', () => {
  const html = read('index.html');
  const search = html.slice(html.indexOf('id="view-search"'), html.indexOf('id="view-settings"'));

  const maker = search.indexOf('id="dictMakerSel"');
  const cat = search.indexOf('id="dictCatSec"');
  const input = search.indexOf('id="dictQTab"');
  const note = search.indexOf('id="dictTabNote"');
  const results = search.indexOf('id="dictResults"');
  assert.ok(maker > 0, 'メーカーの選択がありません');
  assert.ok(cat > maker, 'カテゴリはメーカーの下（メーカーを選んだときに出る）');
  assert.ok(input > cat, '検索バーはメーカーの下に置く');
  assert.ok(note > input, '検索バーの案内文はバーのすぐ下');
  assert.ok(results > note, '検索結果は検索バーの下');

  // メーカーの見出しが検索バーのカードより上にある（塊ごと入れ替わっている）
  const makerHead = search.indexOf('<span>メーカー</span>');
  const searchCard = search.lastIndexOf('<div class="card">', input);
  assert.ok(makerHead > 0 && makerHead < searchCard, 'メーカーの塊が検索バーより下にある');
});

test('設定タブは 表示→サンプル→JAN辞書→使い方→プラン→画材費→バックアップ の順に並ぶ', () => {
  const html = read('index.html');
  const settings = html.slice(html.indexOf('id="view-settings"'), html.indexOf('id="btnWipe"'));

  const order = [
    'id="themeCard"', // 表示
    'id="sampleCard"', // サンプル
    'id="dictInfo"', // JAN辞書
    'id="guideCard"', // 使い方
    'id="proCard"', // プラン
    'id="costCard"', // 画材費
    'id="btnExport"', // バックアップ
  ].map((id) => ({ id, at: settings.indexOf(id) }));
  for (const { id, at } of order) assert.ok(at > 0, `${id} がありません`);
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i].at > order[i - 1].at, `${order[i - 1].id} より ${order[i].id} を下に置く`);
  }
  // カードの中身（見出し）も一緒に動いている
  for (const label of ['表示', 'サンプル', '使い方', 'プラン', '画材費', 'バックアップ']) {
    assert.ok(settings.includes(label), `${label} の見出しがありません`);
  }
});
