/**
 * 手触りの動き（GSAP・v1.36.0）の約束ごと。
 *
 *   1) GSAP はローカル同梱（vendor/gsap.min.js）。CDN からは読まない
 *   2) 配布物（www/・Service Worker）に入り、index.html は app.js より先に読む
 *   3) ライセンス（GSAP Standard License / 商用無償）とサイズを記録してある
 *   4) OSの「視差効果を減らす」が有効なら、動かさずに終わりの状態へ（0秒）
 *   5) GSAP が無い・テスト環境でも、motion.js の関数は何もせずに安全に返る
 *   6) 画面（app.js）は motion.js だけを通して動かす（GSAP を直接触らない）
 *   7) 動きはどれも短い（0.4秒以下）。やりすぎない
 *   8) 実ブラウザでは、シート・＋・星・トーストで実際に動き、コンソールエラーが0件
 *
 * 実ブラウザの確認は、ヘッドレスChromeがある環境でだけ動かす（無ければ skip）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  MOTION_TIMING, MAX_MOTION_SECONDS, REDUCED_MOTION_QUERY,
  gsapEngine, prefersReducedMotion, motionAllowed, createMotion, motion,
} from '../motion.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const app = read('app.js');
const html = read('index.html');
const css = read('styles.css');
const sw = read('sw.js');
const pkg = JSON.parse(read('package.json'));

/* ---------------- 1) 同梱・サイズ・ライセンス ---------------- */

test('GSAP はローカル同梱で、CDN からは読まない', () => {
  const file = path.join(ROOT, 'vendor', 'gsap.min.js');
  assert.ok(fs.existsSync(file), 'vendor/gsap.min.js がありません');
  const body = fs.readFileSync(file, 'utf8');
  // ライセンスの表示（proprietary notice）は消さずに残す
  assert.match(body, /GSAP 3\.\d+\.\d+/);
  assert.match(body, /gsap\.com\/standard-license/);
  // サイズは 100KB 未満（アプリのバンドルを重くしない）
  const size = fs.statSync(file).size;
  assert.ok(size > 20_000 && size < 100_000, `gsap.min.js のサイズが想定外: ${size}`);
  for (const name of ['index.html', 'app.js', 'motion.js', 'sw.js']) {
    assert.equal(/https?:\/\/[^"' ]*gsap/i.test(read(name)), false, `${name} が CDN から GSAP を読んでいる`);
  }
});

test('ライセンス（GSAP Standard License・商用無償）と出典を記録してある', () => {
  const license = read('vendor/gsap.LICENSE.txt');
  assert.match(license, /GSAP 3\.\d+\.\d+/);
  assert.match(license, /Standard "No Charge" License/);
  assert.match(license, /https:\/\/gsap\.com\/standard-license/);
  // 商用利用が無償であること、禁止されるのはビジュアルなアニメーション作成ツールだけ
  assert.match(license, /商用利用/);
  assert.match(license, /ビジュアルアニメーション/);
  // 出典（npm のどのバージョンをそのまま置いたか）とサイズ
  assert.match(license, /npm パッケージ gsap@3\.\d+\.\d+/);
  assert.match(license, /73,\d{3} バイト/);
  // vendor/README.md からも辿れる
  assert.match(read('vendor/README.md'), /gsap\.min\.js/);
  assert.match(read('vendor/README.md'), /standard-license/);
});

test('配布物（www/・Service Worker）に motion.js と gsap.min.js が入る', async () => {
  const { WEB_ASSETS } = await import('../scripts/build.mjs');
  for (const rel of ['motion.js', 'vendor/gsap.min.js']) {
    assert.ok(WEB_ASSETS.includes(rel), `${rel} が WEB_ASSETS にありません`);
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} が実在しません`);
    assert.ok(sw.includes(`'./${rel}'`), `${rel} が Service Worker のキャッシュ対象にありません`);
  }
  // キャッシュ版も上がっている（古いキャッシュが GSAP 無しのまま使われないように）
  assert.match(sw, /const CACHE = 'art-supply-manager-v60';/);
});

test('index.html は GSAP を app.js より先に読み、版を合わせている', () => {
  const gsapAt = html.indexOf('<script src="vendor/gsap.min.js');
  const appAt = html.indexOf('<script type="module" src="app.js');
  assert.ok(gsapAt > 0, 'vendor/gsap.min.js を読んでいません');
  assert.ok(appAt > 0, 'app.js を読んでいません');
  assert.ok(gsapAt < appAt, 'GSAP が app.js より後に読み込まれています');
  assert.match(html, new RegExp(`<script src="vendor/gsap\\.min\\.js\\?v=${pkg.version.replace(/\./g, '\\.')}">`));
  assert.match(html, new RegExp(`app\\.js\\?v=${pkg.version.replace(/\./g, '\\.')}`));
  assert.equal(pkg.version, '1.38.0');
});

/* ---------------- 2) 安全なフォールバック ---------------- */

test('GSAP が無いときは「動かさない」を返し、例外も投げない', () => {
  const fake = { document: null }; // window の代わり（gsap も matchMedia も無い）
  assert.equal(gsapEngine(fake), null);
  assert.equal(prefersReducedMotion(fake), false);
  assert.equal(motionAllowed(fake), false);
  const m = createMotion(fake);
  const el = { style: {} };
  assert.equal(m.sheetIn(el, el), false);
  assert.equal(m.sheetOut(el, () => {}), false);
  assert.equal(m.press(el), false);
  assert.equal(m.bump(el), false);
  assert.equal(m.enter(el), false);
  assert.equal(m.toast(el), false);
  assert.equal(m.bar(el), false);
  // 要素が null でも落ちない
  assert.equal(m.sheetIn(null), false);
  assert.equal(m.sheetOut(null), false);
  assert.equal(m.press(null), false);
});

test('GSAP も matchMedia も無い環境（Node）でも、書き出した motion は安全に動く', () => {
  assert.equal(typeof motion.sheetIn, 'function');
  assert.equal(motion.enabled(), false);
  assert.doesNotThrow(() => {
    motion.sheetIn(null);
    motion.press(undefined);
    motion.bump(undefined);
    motion.toast(undefined);
  });
});

test('OSの「視差効果を減らす」が有効なら、GSAP があっても動かさない（0秒で終わりの状態）', () => {
  const calls = [];
  const fakeGsap = {
    to: (...args) => calls.push(['to', ...args]),
    fromTo: (...args) => calls.push(['fromTo', ...args]),
    set: (...args) => calls.push(['set', ...args]),
    killTweensOf: (...args) => calls.push(['kill', ...args]),
    timeline: () => ({ to: () => ({}) }),
  };
  const win = { gsap: fakeGsap, matchMedia: (q) => ({ matches: q === REDUCED_MOTION_QUERY }) };
  assert.equal(prefersReducedMotion(win), true);
  assert.equal(motionAllowed(win), false);
  const m = createMotion(win);
  const el = {};
  assert.equal(m.sheetIn(el, el), false);
  assert.equal(m.press(el), false);
  assert.equal(m.toast(el), false);
  assert.equal(m.enter(el), false);
  // 閉じるときは「動かさない」を返す（呼び出し側が、その場で隠す）
  let hidden = false;
  assert.equal(m.sheetOut(el, () => { hidden = true; }), false);
  assert.deepEqual(calls, [], 'アニメーションの関数を呼んでいる');
  assert.equal(hidden, false, 'motion.js 側で勝手に隠している（呼び出し側の仕事）');
});

test('視差効果を減らす設定でなければ、GSAP の関数で動かす', () => {
  const calls = [];
  const fakeGsap = {
    to: (el, vars) => { calls.push(['to', vars]); return {}; },
    fromTo: (el, from, to) => { calls.push(['fromTo', from, to]); return {}; },
    set: () => {},
    killTweensOf: () => {},
    timeline: () => ({ to: () => ({ to: () => ({}) }) }),
  };
  const win = { gsap: fakeGsap, matchMedia: () => ({ matches: false }) };
  const m = createMotion(win);
  assert.equal(motionAllowed(win), true);
  assert.equal(m.sheetIn({}, null), true);
  const sheet = calls.find((c) => c[0] === 'fromTo');
  assert.ok(sheet, 'シートを動かしていない');
  assert.equal(sheet[1].y > 0, true, '下から上がってこない');
  assert.equal(sheet[2].ease, 'power3.out');
  assert.equal(sheet[2].duration, MOTION_TIMING.sheetIn);

  // 閉じる: 隠す処理はアニメーションのあと（onComplete）に呼ぶ
  let hidden = false;
  assert.equal(m.sheetOut({}, () => { hidden = true; }), true);
  const out = calls.filter((c) => c[0] === 'to').pop();
  assert.equal(typeof out[1].onComplete, 'function');
  assert.equal(hidden, false, '閉じるアニメーションの前に隠している');
  out[1].onComplete();
  assert.equal(hidden, true, '閉じるアニメーションのあとに隠していない');
});

test('閉じる途中で開き直したら、閉じる処理を取り消す（開いたのに消えない）', () => {
  const tweens = [];
  const fakeGsap = {
    to: (el, vars) => { tweens.push(vars); return {}; },
    fromTo: () => {},
    set: () => {},
    killTweensOf: () => {},
    timeline: () => ({ to: () => ({ to: () => ({}) }) }),
  };
  const win = { gsap: fakeGsap, matchMedia: () => ({ matches: false }) };
  const m = createMotion(win);
  const el = {};
  let hidden = 0;
  m.sheetOut(el, () => { hidden += 1; });
  m.sheetIn(el);
  // 閉じる動きの完了が遅れて呼ばれても、隠さない（開き直したため）
  const out = tweens.find((t) => typeof t.onComplete === 'function');
  out.onComplete();
  assert.equal(hidden, 0, '開き直したのに、あとから閉じてしまった');
});

test('別のシートを開いたら、閉じかけのシートはその場で隠す（次が重ならない）', () => {
  const fakeGsap = {
    to: () => ({}),
    fromTo: () => {},
    set: () => {},
    killTweensOf: () => {},
    timeline: () => ({ to: () => ({ to: () => ({}) }) }),
  };
  const win = { gsap: fakeGsap, matchMedia: () => ({ matches: false }) };
  const m = createMotion(win);
  const first = {};
  const second = {};
  let hidden = 0;
  m.sheetOut(first, () => { hidden += 1; });
  assert.equal(hidden, 0, '閉じる動きの前に隠している');
  m.sheetIn(second);
  assert.equal(hidden, 1, '閉じかけのシートをその場で隠していない');
  // 二重に呼ばれても1回だけ
  m.sheetIn(second);
  assert.equal(hidden, 1);
});

test('GSAP の中で例外が出ても、操作を止めない（false を返すだけ）', () => {  const broken = {
    to: () => { throw new Error('boom'); },
    fromTo: () => { throw new Error('boom'); },
    set: () => { throw new Error('boom'); },
    killTweensOf: () => { throw new Error('boom'); },
    timeline: () => { throw new Error('boom'); },
  };
  const win = { gsap: broken, matchMedia: () => ({ matches: false }) };
  const m = createMotion(win);
  assert.equal(m.sheetIn({}), false);
  assert.equal(m.press({}), false);
  assert.equal(m.bump({}), false);
  assert.equal(m.enter({}), false);
  assert.equal(m.toast({}), false);
  assert.equal(m.bar({}), false);
  assert.equal(m.sheetOut({}, () => {}), false);
});

/* ---------------- 3) やりすぎない（長さの上限） ---------------- */

test('動きはどれも 0.4 秒以下で、開閉は「控えめなバネ（back.out）」まで', () => {
  for (const [name, sec] of Object.entries(MOTION_TIMING)) {
    assert.ok(sec > 0 && sec <= MAX_MOTION_SECONDS, `${name} が長すぎる（${sec}秒）`);
  }
  assert.ok(MAX_MOTION_SECONDS <= 0.4);
  const src = read('motion.js');
  // 強いバネ（back.out(3) 以上）や、終わらないループは使わない
  assert.match(src, /back\.out\(/, 'back.out を使っていない');
  const overshoots = [...src.matchAll(/overshoot = ([\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(overshoots.length > 0, 'バネの強さ（overshoot）が見当たらない');
  for (const o of overshoots) assert.ok(o > 1 && o <= 2.4, `バネが強すぎる（back.out(${o})）`);
  assert.equal(/repeat:\s*-1/.test(src), false, '終わらないループがある');
});

/* ---------------- 4) 画面の配線（app.js） ---------------- */

test('app.js は motion.js だけを通して動かす（GSAP を直接触らない）', () => {
  assert.match(app, /import \{ motion \} from '\.\/motion\.js';/);
  // window.gsap / gsap.to を app.js では使わない
  assert.equal(/\bgsap\s*\./.test(app), false, 'app.js が GSAP を直接使っている');
  assert.equal(/window\.gsap/.test(app), false);
});

test('シートの開閉に、動きが付いている（開く・閉じるで引っかからない順番）', () => {
  assert.match(app, /function openSheet\(id\) \{[\s\S]{0,240}motion\.sheetIn\(\$\(id\), \$?\('mask'\)\);|function openSheet\(id\) \{[\s\S]{0,240}motion\.sheetIn\(\$\(id\), \$\('mask'\)\);/);
  // 閉じる: 「隠す」を関数にして、動かせないときはその場で隠す
  assert.match(app, /function closeSheet\(id\) \{[\s\S]{0,400}const hide = \(\) => \{[\s\S]{0,200}\$\('mask'\)\.classList\.remove\('open'\);/);
  assert.match(app, /if \(!motion\.sheetOut\(\$\(id\), hide, lastOne \? \$\('mask'\) : null\)\) hide\(\);/);
  // スキャン停止・画像取得のタイマーは、これまでどおり閉じた瞬間に止める
  assert.match(app, /if \(id === 'sheetScan'\) stopScanner\(\);/);
  assert.match(app, /if \(id === 'sheetItem'\) clearTimeout\(janFetchTimer\);/);
});

test('「＋」「−」「星」「追加完了」「確定」「トースト」に反応を付けている', () => {
  // カードの ＋/−（その場で在庫を増減する一覧）
  assert.match(app, /save\(\); render\(\);\n\s*animateStepFeedback\(it\.id, delta\);/);
  // 補充タブの ＋/−（確定待ちの数え）
  assert.match(app, /function stepRestock\(it, delta\) \{[\s\S]{0,700}animateStepFeedback\(it\.id, delta\);/);
  // 星（カード・まとめカード・長押しメニュー・メーカー）
  assert.match(app, /animateStarFeedback\(target\.id\);/);
  assert.match(app, /animateStarFeedback\(jan, \{ group: true \}\);/);
  assert.match(app, /animateStarFeedback\(it\.id\);/);
  assert.match(app, /motion\.press\(star, \{ scale: 0\.84, overshoot: 2\.2 \}\);/);
  // 画材の追加・編集のあと
  assert.match(app, /animateSavedItemFeedback\(targetId\);/);
  // 補充を確定したあと
  assert.match(app, /motion\.enter\(\$\('shoppingList'\)\);/);
  // 「補充を確定」バーが出た瞬間
  assert.match(app, /if \(show && wasHidden\) motion\.bar\(bar\);/);
  // トースト
  assert.match(app, /el\.classList\.add\('show'\);\n\s*motion\.toast\(el\);/);
  // 反応を付ける関数は、描き直したあとの DOM を dataset で探す（IDをセレクタに埋めない）
  assert.match(app, /function renderedRow\(id\) \{[\s\S]{0,200}\.find\(\(el\) => el\.dataset\.swipeId === id\)/);
});

test('視差効果を減らす設定では、CSS のトランジションも止める', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{/);
  assert.match(css, /transition-duration: 0\.01ms !important;/);
  assert.match(css, /animation-duration: 0\.01ms !important;/);
});

/* ---------------- 5) 実ブラウザ（置いてある環境だけ） ---------------- */

const CHROME = process.env.ARTIKO_CHROME || '/workspace/tmp/shell/chrome-linux/headless_shell';
const CAN_RUN = typeof WebSocket === 'function' && fs.existsSync(CHROME);
const SKIP = CAN_RUN ? false : '実ブラウザ（ARTIKO_CHROME）と WebSocket がある環境でだけ動かします';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve(root) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const file = path.join(root, rel);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

class Client {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.logs = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        this.logs.push(msg.params);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        this.logs.push({ type: 'exception', args: [{ value: JSON.stringify(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text) }] });
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
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'evaluate failed');
    return res.result.value;
  }
}

const SEED = {
  app: 'art-supply-manager',
  version: 1,
  folders: [
    { id: 'atelier', name: 'アトリエ', color: '#c96f4a', parentId: null },
    { id: 'home', name: '家', color: '#4a7bc9', parentId: null },
  ],
  items: [
    { id: 'p1', name: 'ホルベイン 油絵具 ウルトラマリン ブルー', maker: 'ホルベイン', brand: '', category: 'oil', series: '油絵具', colorName: 'ウルトラマリン ブルー', colorCode: 'H-191', size: '6号(20ml)', folderId: 'atelier', qty: 2, status: 'low', favorite: false, jan: '', shop: '', price: 900, memo: '', imageUrl: '', purchaseLog: [], createdAt: '2026-11-17T00:00:00.000Z', updatedAt: '2026-11-17T00:00:00.000Z' },
    { id: 'p2', name: 'ホルベイン 油絵具 コバルトブルー', maker: 'ホルベイン', brand: '', category: 'oil', series: '油絵具', colorName: 'コバルトブルー', colorCode: 'H-192', size: '6号(20ml)', folderId: 'atelier', qty: 1, status: 'low', favorite: false, jan: '', shop: '', price: 1100, memo: '', imageUrl: '', purchaseLog: [], createdAt: '2026-11-17T00:00:00.000Z', updatedAt: '2026-11-17T00:00:00.000Z' },
  ],
  settings: { sort: 'updated', layout: 'list', askBeforeDelete: true, theme: 'light', rakutenAppId: '', rakutenAccessKey: '', imageProxyUrl: '', pro: true, proPreview: false },
  updatedAt: '2026-11-17T00:00:00.000Z',
};

async function withBrowser(fn, { reducedMotion = false } = {}) {
  const server = await serve(ROOT);
  const port = 9600 + Math.floor(Math.random() * 200);
  const serverPort = server.address().port;
  const chrome = spawn(CHROME, [
    '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/artiko-motion-${process.pid}-${Date.now()}`,
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
    if (reducedMotion) {
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    }
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/` });
    await sleep(1200);
    await cdp.eval(`localStorage.setItem('art-supply-manager/v1', ${JSON.stringify(JSON.stringify(SEED))}); localStorage.setItem('art-supply-manager/sample-seeded', '1');`);
    await cdp.send('Page.reload');
    await sleep(1600);
    await fn(cdp, serverPort);
    // コンソールのエラー（exception・console.error）が0件
    const errors = cdp.logs.filter((l) => l.type === 'exception'
      || (l.type === 'error')
      || (l.type === 'log' && false));
    assert.deepEqual(errors.map((e) => e.args?.[0]?.value ?? e.type), [], 'コンソールにエラーが出ています');
  } finally {
    try { ws?.close(); } catch { /* 無視 */ }
    chrome.kill('SIGKILL');
    server.close();
  }
}

test('実ブラウザ: GSAP を同梱から読み、シート・＋・星・トーストで実際に動く', { skip: SKIP, timeout: 120000 }, async () => {
  await withBrowser(async (cdp) => {
    // 同梱の GSAP が読めている（window.gsap）
    assert.equal(await cdp.eval('typeof window.gsap === "object" && typeof window.gsap.to === "function"'), true, 'window.gsap がありません');
    assert.equal(await cdp.eval('window.gsap.version'), '3.15.1');
    // 動かせる状態（視差効果を減らす設定ではない）
    assert.equal(await cdp.eval('window.matchMedia("(prefers-reduced-motion: reduce)").matches'), false);
    // 「すべての画材」を開いて、一覧を出す（ルートは「未分類」だけなので）
    await cdp.eval(`document.querySelector('#smartGrid .stile[data-folder="all-items"]').click()`);
    await sleep(400);
    // メーカー → シリーズの見出しを開いて、行を出す
    await cdp.eval(`(() => { const h = document.querySelector('#itemList .mg > [data-g-maker], #itemList .mg > .mgrow > [data-g-maker]'); if (h) h.click(); })()`);
    await sleep(300);
    await cdp.eval(`(() => { const h = document.querySelector('#itemList .sgroup > [data-g-series]'); if (h) h.click(); })()`);
    await sleep(300);
    assert.ok(await cdp.eval(`document.querySelectorAll('#itemList [data-swipe-id]').length`) >= 2, '一覧が出ていません');

    // シートを開く: 開いた直後は transform が付いている（下から上がってくる）
    await cdp.eval(`document.getElementById('btnAdd').click()`);
    const opened = await cdp.eval(`(() => {
      const el = document.getElementById('sheetAdd');
      const st = el.style;
      return { open: el.classList.contains('open'), transform: st.transform || '', opacity: st.opacity || '' };
    })()`);
    assert.equal(opened.open, true, 'シートが開いていません');
    assert.match(opened.transform, /matrix|translate/, `開いた直後に動きの指定が無い: ${JSON.stringify(opened)}`);    await sleep(500);
    // 動き終わったら、インラインの transform は残さない（レイアウトに影響させない）
    assert.equal(await cdp.eval(`document.getElementById('sheetAdd').style.transform`), '', '動いたあとに transform が残っています');

    // 閉じる: アニメーションのあとに display が消える（状態は今までどおり）
    await cdp.eval(`document.querySelector('#sheetAdd [data-close="sheetAdd"]').click()`);
    await sleep(400);
    assert.equal(await cdp.eval(`document.getElementById('sheetAdd').classList.contains('open')`), false, 'シートが閉じていません');
    assert.equal(await cdp.eval(`getComputedStyle(document.getElementById('sheetAdd')).display`), 'none');

    // シートから次のシートへ移る（「自分で入力」）: 前のシートはその場で消え、次が上がってくる
    await cdp.eval(`document.getElementById('btnAdd').click()`);
    await sleep(60);
    await cdp.eval(`document.getElementById('btnAddManual').click()`);
    const swapped = await cdp.eval(`(() => ({
      add: document.getElementById('sheetAdd').classList.contains('open'),
      item: document.getElementById('sheetItem').classList.contains('open'),
      itemTransform: document.getElementById('sheetItem').style.transform || '',
    }))()`);
    assert.equal(swapped.add, false, '前のシートが残っています（重なっている）');
    assert.equal(swapped.item, true, '次のシートが開いていません');
    assert.match(swapped.itemTransform, /matrix|translate/, '次のシートが上がってこない');
    await sleep(500);
    assert.equal(await cdp.eval(`getComputedStyle(document.getElementById('sheetAdd')).display`), 'none');
    assert.equal(await cdp.eval(`document.getElementById('sheetItem').style.transform`), '', '動いたあとに transform が残っています');
    await cdp.eval(`document.querySelector('#sheetItem [data-close="sheetItem"]').click()`);
    await sleep(400);

    // リストの＋: 押したボタンと数に反応が付き、在庫は1つ増える
    const plusAt = await cdp.eval(`(() => {
      const b = document.querySelector('#itemList [data-step="1"][data-id="p1"]');
      if (!b) return null;
      b.click();
      return { qty: document.querySelector('#itemList [data-id="p1"] .qty')?.textContent || '' };
    })()`);
    assert.ok(plusAt, '＋ボタンが見つかりません');
    await sleep(60);
    const animating = await cdp.eval(`(() => {
      const row = document.querySelector('#itemList [data-swipe-id="p1"]');
      const n = row?.querySelector('.qty');
      return { transform: n?.style.transform || '', qty: n?.textContent || '' };
    })()`);
    assert.match(animating.transform, /matrix|scale|translate/, `数の反応が付いていません: ${JSON.stringify(animating)}`);
    assert.equal(animating.qty.replace(/\s/g, ''), '3点');
    const saved = await cdp.eval(`JSON.parse(localStorage.getItem('art-supply-manager/v1')).items.find((i) => i.id === 'p1').qty`);
    assert.equal(saved, 3, '＋で在庫が増えていません');

    // 星: 押すとお気に入りになり、星がふくらむ
    await cdp.eval(`document.querySelector('#itemList [data-fav="p1"]').click()`);
    await sleep(40);
    assert.equal(await cdp.eval(`document.querySelector('#itemList [data-fav="p1"]').getAttribute('aria-pressed')`), 'true');
    assert.match(await cdp.eval(`document.querySelector('#itemList [data-fav="p1"]').style.transform`), /matrix|scale|translate/);

    // トースト: 中央寄せ（translateX(-50%)）を保ったまま出る
    const toast = await cdp.eval(`(() => {
      const el = document.getElementById('toast');
      return { show: el.classList.contains('show'), transform: el.style.transform || '', text: el.textContent };
    })()`);
    assert.equal(toast.show, true, 'トーストが出ていません');
    assert.match(toast.transform, /matrix|translate/, 'トーストに動きが付いていません');

    // 補充タブ: 「＋」→確定バーが下から出る
    await cdp.eval(`document.querySelector('#tabbar button[data-tab="shopping"]').click()`);
    await sleep(300);
    await cdp.eval(`(() => { const h = document.querySelector('#shoppingList .mg > [data-g-maker], #shoppingList .mg > .mgrow > [data-g-maker]'); if (h) h.click(); })()`);
    await sleep(300);
    await cdp.eval(`(() => { const h = document.querySelector('#shoppingList .sgroup > [data-g-series]'); if (h) h.click(); })()`);
    await sleep(300);
    const barState = await cdp.eval(`(() => {
      const b = document.querySelector('#shoppingList [data-step="1"][data-id="p2"]');
      if (!b) return null;
      b.click();
      const bar = document.getElementById('restockBar');
      return { hidden: bar.hidden, transform: bar.style.transform || '' };
    })()`);
    assert.ok(barState, '補充タブの＋が見つかりません');
    assert.equal(barState.hidden, false, '確定バーが出ていません');
    assert.match(barState.transform, /matrix|translate/, '確定バーに動きが付いていません');
    await sleep(120);
    assert.equal(await cdp.eval(`document.querySelectorAll('#shoppingList .badge.bump').length`), 1);
  });
});

test('実ブラウザ: 「視差効果を減らす」が有効なら、動かさずにその場で開閉する', { skip: SKIP, timeout: 120000 }, async () => {
  await withBrowser(async (cdp) => {
    assert.equal(await cdp.eval('typeof window.gsap === "object"'), true);
    assert.equal(await cdp.eval('window.matchMedia("(prefers-reduced-motion: reduce)").matches'), true);
    await cdp.eval(`document.querySelector('#smartGrid .stile[data-folder="all-items"]').click()`);
    await sleep(300);
    await cdp.eval(`(() => { const h = document.querySelector('#itemList .mg > [data-g-maker], #itemList .mg > .mgrow > [data-g-maker]'); if (h) h.click(); })()`);
    await sleep(200);
    await cdp.eval(`(() => { const h = document.querySelector('#itemList .sgroup > [data-g-series]'); if (h) h.click(); })()`);
    await sleep(200);
    assert.ok(await cdp.eval(`document.querySelector('#itemList [data-step="1"][data-id="p1"]') !== null`), '＋ボタンが見つかりません');
    await cdp.eval(`document.getElementById('btnAdd').click()`);
    // アニメーションの指定（transform）が付かない＝0秒で終わりの状態
    assert.equal(await cdp.eval(`document.getElementById('sheetAdd').style.transform`), '', '視差効果を減らす設定なのに動いている');
    assert.equal(await cdp.eval(`document.getElementById('sheetAdd').classList.contains('open')`), true);
    await cdp.eval(`document.querySelector('#sheetAdd [data-close="sheetAdd"]').click()`);
    // 閉じるのも、その場（次の描画までに）消えている
    assert.equal(await cdp.eval(`document.getElementById('sheetAdd').classList.contains('open')`), false, '閉じるのに時間がかかっている');
    assert.equal(await cdp.eval(`getComputedStyle(document.getElementById('sheetAdd')).display`), 'none');
    // ＋を押しても、数の反応（transform）は付かない
    await cdp.eval(`document.querySelector('#itemList [data-step="1"][data-id="p1"]').click()`);
    assert.equal(await cdp.eval(`(() => { const n = document.querySelector('#itemList [data-swipe-id="p1"] .qty'); return n ? n.style.transform : ''; })()`), '');
  }, { reducedMotion: true });
});
