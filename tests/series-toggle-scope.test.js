/**
 * 見出しの開け閉めの範囲（v1.35.0）。
 *
 *   1) シリーズを閉じても、親のメーカーまで閉じない（カタログ・在庫・補充のどこでも）
 *   2) 「すべてのメーカー」のカタログでも、シリーズを普通に開ける
 *
 * 原因はカタログの「その場で開け閉め」（catalogToggleInPlace）が、シリーズ見出しでも
 * 親のまとまり（.mg）まで戻していたこと。メーカーの中身の入れ物（.lazybody）を
 * シリーズのものと取り違え、開くときは何も起きず、閉じるときはメーカーごと消していた。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const app = read('app.js');

/* ---------------- 1) 直す場所（app.js） ---------------- */

test('カタログのシリーズは、そのシリーズのまとまり（.sgroup）だけを開け閉めする', () => {
  const at = app.indexOf('function catalogToggleInPlace(');
  assert.ok(at > 0, 'catalogToggleInPlace がありません');
  const body = app.slice(at, app.indexOf('\n}', at));
  // シリーズは .sgroup、メーカーは .mg（お気に入りの星と同じ行に入っているので .mgrow の親）
  assert.match(body, /const block = isSeries\s*\n?\s*\? \(head\.closest\('\.sgroup'\) \|\| head\.parentElement\)\s*\n?\s*: \(head\.closest\('\.mg'\) \|\| head\.parentElement\);/);
  assert.equal(/const block = head\.closest\('\.mg'\) \|\| head\.parentElement;/.test(body), false,
    'シリーズでも親のメーカー（.mg）まで戻している');
  // 中身の入れ物は、メーカーのもの（data-lazy-maker）とシリーズのもの（data-lazy-series）を取り違えない
  assert.match(body, /el\.hasAttribute\('data-lazy-series'\) && \(el\.dataset\.sgroup \|\| ''\) === name/);
  assert.match(body, /: el\.hasAttribute\('data-lazy-maker'\)/);
  // 開くときは、一覧を描くときと同じ入れ物（data-limit＝もっと見るで足した件数）を使う
  assert.match(body, /dictLazyRender\.seriesInner\(maker, name\)/);
});

test('一覧のDOMは メーカー（.mg）の中にシリーズ（.sgroup）を入れる（閉じても親は残る）', () => {
  // itemTreeHtml: <section class="mg"> 見出し ＋ 中身（シリーズのまとまり）
  assert.match(app, /return `<section class="mg\$\{mOpen \? ' open' : ''\}">/);
  // seriesBlockHtml: <div class="sgroup"> 見出し ＋ 中身（中身は開いているときだけ）
  assert.match(app, /return `<div class="sgroup\$\{open \? ' open' : ''\}">/);
});

test('見出しのタップは、シリーズかメーカーかを data-g-series で見分ける（全画面で同じ処理）', () => {
  assert.match(app, /const isSeries = head\.hasAttribute\('data-g-series'\);/);
  assert.match(app, /toggleGroupOpen\(surface, isSeries \? 'series' : 'maker', maker, name\)/);
  // カタログだけは、描き直さずに押した見出しの下だけを開け閉めする
  assert.match(app, /if \(surface === 'catalog'\) \{ catalogToggleInPlace\(head, isSeries, open\); return; \}/);
  // シリーズ見出しには、メーカーとシリーズの両方の目印を付ける
  assert.match(app, /function seriesHeadHtml\(\{ surface, maker, name, total, open \}\) \{/);
  assert.match(app, /data-g-surface="\$\{esc\(surface\)\}" data-g-maker="\$\{esc\(maker\)\}" data-g-series="\$\{esc\(name\)\}"/);
});

/* ---------------- 2) 実ブラウザでの操作（置いてある環境だけ） ---------------- */

const CHROME = process.env.ARTIKO_CHROME || '/workspace/tmp/shell/chrome-linux/headless_shell';
const CAN_RUN = typeof WebSocket === 'function' && fs.existsSync(CHROME);
const SKIP = CAN_RUN ? false : '実ブラウザ（ARTIKO_CHROME）と WebSocket がある環境でだけ動かします';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let data = '';
    res.on('data', (c) => { data += c; });
    res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
  }).on('error', reject);
});

/** リポジトリをそのまま配る小さなサーバー（アプリは静的ファイルだけ） */
function serve(root) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp' };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(String(req.url || '/').split('?')[0]);
    const file = path.join(root, url === '/' ? 'index.html' : url);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** CDP の最小クライアント（クリックは実DOMの要素を押す） */
class Client {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 400));
    return res.result.value;
  }
}

const SEED = {
  version: 1,
  folders: [{ id: 'atelier', name: 'アトリエ', color: '#e07b39', parentId: null }],
  items: [
    { id: 'p1', name: 'ホルベイン アーティスト色鉛筆 カーマイン', maker: 'ホルベイン', brand: '', category: 'pencil', series: 'アーティスト色鉛筆', colorName: 'カーマイン', colorCode: '', size: '', folderId: 'atelier', qty: 1, status: 'low', favorite: false, jan: '', shop: '', price: 200, memo: '', imageUrl: '', purchaseLog: [], createdAt: '2026-11-17T00:00:00.000Z', updatedAt: '2026-11-17T00:00:00.000Z' },
    { id: 'p2', name: 'ホルベイン アーティスト色鉛筆 コーラル', maker: 'ホルベイン', brand: '', category: 'pencil', series: 'アーティスト色鉛筆', colorName: 'コーラル', colorCode: '', size: '', folderId: 'atelier', qty: 1, status: 'low', favorite: false, jan: '', shop: '', price: 200, memo: '', imageUrl: '', purchaseLog: [], createdAt: '2026-11-17T00:00:00.000Z', updatedAt: '2026-11-17T00:00:00.000Z' },
    { id: 'p3', name: 'ホルベイン アーティスト色鉛筆 サーセンピンク', maker: 'ホルベイン', brand: '', category: 'pencil', series: 'アーティスト色鉛筆', colorName: 'サーセンピンク', colorCode: '', size: '', folderId: 'atelier', qty: 0, status: 'enough', favorite: false, jan: '', shop: '', price: 200, memo: '', imageUrl: '', purchaseLog: [], createdAt: '2026-11-17T00:00:00.000Z', updatedAt: '2026-11-17T00:00:00.000Z' },
  ],
  settings: { sort: 'updated', layout: 'list', askBeforeDelete: true, theme: 'light', rakutenAppId: '', rakutenAccessKey: '', imageProxyUrl: '', pro: true, proPreview: false },
  updatedAt: '2026-11-17T00:00:00.000Z',
};

test('実ブラウザ: 補充の＋は即消さず、「補充を確定」でまとめて十分にする', { skip: SKIP, timeout: 120000 }, async () => {
  const server = await serve(ROOT);
  const port = 9400 + Math.floor(Math.random() * 200);
  const serverPort = server.address().port;
  const chrome = spawn(CHROME, [
    '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/artiko-test-${process.pid}-${Date.now()}`,
    '--window-size=375,812', 'about:blank',
  ], {
    stdio: 'ignore',
    env: { ...process.env, LD_LIBRARY_PATH: '/workspace/tmp/chrome-libs:/workspace/tmp/libs' },
  });
  let ws;
  try {
    let targets = null;
    for (let i = 0; i < 60 && !targets; i += 1) {
      try { targets = await getJSON(`http://127.0.0.1:${port}/json/list`); } catch { await sleep(250); }
    }
    assert.ok(targets, 'headless ブラウザが起動しませんでした');
    const page = targets.find((t) => t.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
    const cdp = new Client(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/` });
    await sleep(1200);
    await cdp.eval(`localStorage.setItem('art-supply-manager/v1', ${JSON.stringify(JSON.stringify(SEED))}); localStorage.setItem('art-supply-manager/sample-seeded', '1');`);
    await cdp.send('Page.reload');
    await sleep(1500);

    const click = async (selector, nth = 0) => {
      const ok = await cdp.eval(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(selector)})]; const el = els[${nth}]; if (!el) return false; el.click(); return true; })()`);
      assert.ok(ok, `押せませんでした: ${selector} #${nth}`);
      await sleep(350);
    };
    const saved = () => cdp.eval(`(() => { const s = JSON.parse(localStorage.getItem('art-supply-manager/v1')); return { items: s.items.map((i) => [i.id, i.qty, i.status]), pending: s.restockPending }; })()`);

    // 補充タブ → メーカーとシリーズを開く
    await click('#tabbar button[data-tab="shopping"]');
    await click('#shoppingList .mg > [data-g-maker], #shoppingList .mg > .mgrow > [data-g-maker]', 0);
    await click('#shoppingList .sgroup > [data-g-series]', 0);
    assert.ok((await cdp.eval(`document.querySelectorAll('#shoppingList .item').length`)) >= 2, '補充の行が出ていません');

    // 1行目（p1）に＋2、2行目（p2）に＋1（その場では「十分」にしない）
    await click('#shoppingList .item [data-step="1"][data-id="p1"]', 0);
    await click('#shoppingList .item [data-step="1"][data-id="p1"]', 0);
    await click('#shoppingList .item [data-step="1"][data-id="p2"]', 0);
    // 在庫0で「十分」のままの画材も、＋で数が入っても一覧から消えない（p3）
    await click('#shoppingList .item [data-step="1"][data-id="p3"]', 0);

    const during = await saved();
    const byId = new Map(during.items.map(([id, qty, status]) => [id, { qty, status }]));
    assert.equal(byId.get('p1').status, 'low', '＋で「十分」になって一覧から消えています');
    assert.equal(byId.get('p1').qty, 3);
    assert.equal(byId.get('p2').qty, 2);
    assert.equal(byId.get('p3').qty, 1);
    assert.equal(byId.get('p3').status, 'low', '在庫0の「十分」が、＋で一覧から消えています');
    assert.deepEqual(during.pending, { p1: 2, p2: 1, p3: 1 });
    assert.equal(await cdp.eval(`document.querySelectorAll('#shoppingList .item').length`), 3, '＋で行が消えています');
    assert.deepEqual(await cdp.eval(`[...document.querySelectorAll('#shoppingList .badge.bump')].map((b) => b.textContent).sort()`), ['＋1', '＋1', '＋2']);
    assert.equal(await cdp.eval(`document.getElementById('restockBar').hidden`), false, '確定バーが出ていません');
    assert.equal(await cdp.eval(`document.getElementById('restockConfirm').textContent`), '補充を確定（3件）');

    // タブを移って戻っても確定待ちは残る
    await click('#tabbar button[data-tab="stock"]');
    await click('#tabbar button[data-tab="shopping"]');
    assert.equal(await cdp.eval(`document.getElementById('restockBar').hidden`), false, 'タブを移ると確定バーが消えています');

    // 確定 → まとめて「十分」になり、補充リストから外れる
    await click('#restockConfirm');
    const after = await saved();
    const done = new Map(after.items.map(([id, qty, status]) => [id, { qty, status }]));
    assert.equal(done.get('p1').status, 'enough');
    assert.equal(done.get('p2').status, 'enough');
    assert.equal(done.get('p3').status, 'enough');
    assert.deepEqual(after.pending, {});
    assert.equal(await cdp.eval(`document.getElementById('restockBar').hidden`), true, '確定してもバーが残っています');
    // 確定した3件は補充リストから外れる
    assert.equal(await cdp.eval(`document.getElementById('shoppingCount').textContent`), '0');
    assert.equal(await cdp.eval(`document.querySelector('#shoppingList .empty b')?.textContent || ''`), '補充はありません');
    assert.equal(await cdp.eval(`document.querySelectorAll('#shoppingList .badge.bump').length`), 0);
  } finally {
    try { ws?.close(); } catch { /* 無視 */ }
    chrome.kill('SIGKILL');
    server.close();
  }
});

test('実ブラウザ: 「すべてのメーカー」でもシリーズを開け、閉じても親メーカーは開いたまま', { skip: SKIP, timeout: 120000 }, async () => {
  const server = await serve(ROOT);
  const port = 9600 + Math.floor(Math.random() * 200);
  const serverPort = server.address().port;
  const chrome = spawn(CHROME, [
    '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/artiko-test-${process.pid}-${Date.now()}`,
    '--window-size=375,812', 'about:blank',
  ], {
    stdio: 'ignore',
    env: { ...process.env, LD_LIBRARY_PATH: '/workspace/tmp/chrome-libs:/workspace/tmp/libs' },
  });
  let ws;
  try {
    let targets = null;
    for (let i = 0; i < 60 && !targets; i += 1) {
      try { targets = await getJSON(`http://127.0.0.1:${port}/json/list`); } catch { await sleep(250); }
    }
    assert.ok(targets, 'headless ブラウザが起動しませんでした');
    const page = targets.find((t) => t.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
    const cdp = new Client(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/` });
    await sleep(1200);
    await cdp.eval(`localStorage.setItem('art-supply-manager/v1', ${JSON.stringify(JSON.stringify(SEED))}); localStorage.setItem('art-supply-manager/sample-seeded', '1');`);
    await cdp.send('Page.reload');
    await sleep(1500);

    const click = async (selector, nth = 0) => {
      const ok = await cdp.eval(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(selector)})]; const el = els[${nth}]; if (!el) return false; el.click(); return true; })()`);
      assert.ok(ok, `押せませんでした: ${selector} #${nth}`);
      await sleep(400);
    };
    const makerOpen = () => cdp.eval(`(() => { const m = document.querySelector('#dictResults .mg'); const h = m.querySelector('[data-g-maker]:not([data-g-series])'); return h.getAttribute('aria-expanded') === 'true' && m.classList.contains('open') && Boolean(m.querySelector(':scope > [data-lazy-maker]')); })()`);
    const seriesOpen = (n = 0) => cdp.eval(`(() => { const s = document.querySelectorAll('#dictResults [data-g-series]')[${n}]; return s ? s.getAttribute('aria-expanded') === 'true' : null; })()`);

    // カタログ（すべてのメーカー）
    await click('#tabbar button[data-tab="catalog"]');
    await sleep(600);
    assert.equal(await cdp.eval(`document.getElementById('dictMakerSel').value`), '', 'すべてのメーカーになっていません');
    await click('#dictResults .mg > [data-g-maker]:not([data-g-series]), #dictResults .mg > .mgrow > [data-g-maker]', 0);
    await sleep(600);
    assert.equal(await makerOpen(), true, 'メーカーが開いていません');

    // シリーズを開く（「すべてのメーカー」でも開ける）
    await click('#dictResults [data-g-series]', 0);
    await sleep(600);
    assert.equal(await seriesOpen(0), true, 'シリーズが開けません');
    assert.ok((await cdp.eval(`document.querySelectorAll('#dictResults .dres').length`)) > 0, '商品の行が出ていません');
    assert.equal(await makerOpen(), true, 'シリーズを開くとメーカーが閉じています');

    // シリーズを閉じても、親メーカーは開いたまま（他のシリーズも残る）
    await click('#dictResults [data-g-series]', 0);
    await sleep(600);
    assert.equal(await seriesOpen(0), false, 'シリーズが閉じません');
    assert.equal(await makerOpen(), true, 'シリーズを閉じたらメーカーまで閉じてしまいました');
    assert.ok((await cdp.eval(`document.querySelectorAll('#dictResults [data-g-series]').length`)) > 1, 'メーカーの中身が消えています');

    // 在庫（場所ごと）でも同じ
    await click('#tabbar button[data-tab="stock"]');
    await click('#folderGrid .ftile[data-folder]', 0);
    await click('#itemList .mg > [data-g-maker]:not([data-g-series])', 0);
    await click('#itemList .sgroup > [data-g-series]', 0);
    await click('#itemList .sgroup > [data-g-series]', 0);
    assert.equal(await cdp.eval(`document.querySelector('#itemList .mg > [data-g-maker]').getAttribute('aria-expanded')`), 'true', '在庫（場所ごと）でシリーズを閉じたらメーカーまで閉じました');
  } finally {
    try { ws?.close(); } catch { /* 無視 */ }
    chrome.kill('SIGKILL');
    server.close();
  }
});
