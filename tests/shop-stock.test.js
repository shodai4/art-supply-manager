/**
 * 通販シートのYahoo!在庫・参考価格。
 *
 *   - JANがあるときだけ問い合わせる（無い・13桁でないときは今までどおりリンクだけ）
 *   - 応答のJANが違う・形が違うときは出さない（別商品の在庫を出さない）
 *   - 在庫あり（¥◯◯〜）／在庫なし／確認できませんでした、の3つに分ける
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  stockApiUrl, parseStockPayload, stockLabel, priceLabel, STOCK_NOTE, STOCK_PROXY_PATH,
} from '../shops.js';
import { handleRequest, stockCacheKey, STOCK_CACHE_KEY_PREFIX } from '../workers/rakuten-image-proxy/src/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const JAN = '4900669001911';

test('問い合わせURLはJANが13桁のときだけ作る', () => {
  assert.equal(stockApiUrl('https://proxy.example.workers.dev', JAN), `https://proxy.example.workers.dev${STOCK_PROXY_PATH}?jan=${JAN}`);
  assert.equal(stockApiUrl('https://proxy.example.workers.dev/', JAN), `https://proxy.example.workers.dev${STOCK_PROXY_PATH}?jan=${JAN}`);
  assert.equal(stockApiUrl('', JAN), '');
  assert.equal(stockApiUrl('http://insecure.example', JAN), '');
  assert.equal(stockApiUrl('https://proxy.example.workers.dev', '123'), '');
});

test('応答のJANが違う・形が違うときは出さない', () => {
  assert.equal(parseStockPayload(null), null);
  assert.equal(parseStockPayload({ jan: '4900000000001', offers: 3 }, JAN), null);
  const info = parseStockPayload({ jan: JAN, offers: 4, inStockOffers: 2, lowestPrice: '1200', source: 'yahoo' }, JAN);
  assert.deepEqual(info, {
    jan: JAN, offers: 4, inStockOffers: 2, available: true, lowestPrice: 1200, source: 'yahoo', checkedAt: '',
  });
});

test('表示は 在庫あり（¥◯◯〜）／在庫なし／確認できませんでした', () => {
  assert.equal(stockLabel({ offers: 3, available: true, lowestPrice: 1200 }), '在庫あり（¥1,200〜）');
  assert.equal(stockLabel({ offers: 3, available: true, lowestPrice: 0 }), '在庫あり');
  assert.equal(stockLabel({ offers: 2, available: false, lowestPrice: 0 }), '在庫なし');
  assert.equal(stockLabel({ offers: 0, available: false }), '在庫を確認できませんでした');
  assert.equal(stockLabel(null), '');
  assert.equal(priceLabel(1200), '¥1,200');
  assert.match(STOCK_NOTE, /Yahoo!ショッピングの検索結果/);
});

test('画面: 通販シートを開くとJAN付きの画材だけ在庫を聞きに行く', () => {
  const app = read('app.js');
  const html = read('index.html');
  assert.match(html, /id="shopStock" hidden/);
  assert.match(app, /loadShopStock\(item\);/);
  assert.match(app, /const url = stockApiUrl\(resolveImageProxyUrl\(state\.settings\), jan\);/);
  assert.match(app, /const info = parseStockPayload\(await res\.json\(\), jan\);/);
  assert.match(app, /el\.className = `shop-stock \$\{state\}`;/);
  // オフラインのときは聞きに行かない（待たせない）
  assert.match(app, /if \(!isOnline\(\)\) return;/);
});

/* ---------------- 中継サーバー（/stock） ---------------- */

const STOCK_ENV = { YAHOO_CLIENT_ID: 'client-id-xyz' };

function makeCache() {
  const store = new Map();
  return {
    store,
    async match(key) { const hit = store.get(key); return hit ? hit.clone() : undefined; },
    async put(key, res) { store.set(key, res.clone()); },
  };
}

function req(jan = JAN, { path: p = '/stock', origin = 'https://shodai4.com' } = {}) {
  return new Request(`https://proxy.example.workers.dev${p}?jan=${jan}`, { headers: origin ? { Origin: origin } : {} });
}

const YAHOO_STOCK = {
  hits: [
    { name: 'ホルベイン ウルトラマリン', price: 1200, inStock: true, janCode: JAN, url: 'https://store.shopping.yahoo.co.jp/a/1.html' },
    { name: 'ホルベイン ウルトラマリン', price: 900, inStock: false, janCode: JAN, url: 'https://store.shopping.yahoo.co.jp/b/2.html' },
    { name: '別の商品', price: 500, inStock: true, janCode: '4900000000001', url: 'https://store.shopping.yahoo.co.jp/c/3.html' },
  ],
  totalResultsAvailable: 3,
};

test('/stock は在庫あり件数と最安の参考価格を返す（別JANは数えない）', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(String(url)); return new Response(JSON.stringify(YAHOO_STOCK), { status: 200 }); };
  const res = await handleRequest(req(), STOCK_ENV, { fetchImpl, cache: makeCache() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.jan, JAN);
  assert.equal(body.offers, 2);
  assert.equal(body.inStockOffers, 1);
  assert.equal(body.lowestPrice, 1200);
  assert.equal(body.available, true);
  assert.equal(body.source, 'yahoo');
  assert.equal(res.headers.get('X-Proxy-Cache'), 'MISS');
  assert.match(res.headers.get('Cache-Control') || '', /max-age=1800/);
  // 認証情報（Client ID）はURLに出るが、応答には出さない
  assert.equal(JSON.stringify(body).includes('client-id-xyz'), false);
  assert.match(calls[0], new RegExp(`jan_code=${JAN}`));
});

test('/stock は商品が無くても 200 で「在庫なし」を返す（エラーにしない）', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ hits: [] }), { status: 200 });
  const res = await handleRequest(req(), STOCK_ENV, { fetchImpl, cache: makeCache() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.offers, 0);
  assert.equal(body.available, false);
});

test('/stock の結果は30分キャッシュし、画像のキャッシュとは混ざらない', async () => {
  const cache = makeCache();
  let hits = 0;
  const fetchImpl = async () => { hits += 1; return new Response(JSON.stringify(YAHOO_STOCK), { status: 200 }); };
  await handleRequest(req(), STOCK_ENV, { fetchImpl, cache });
  const second = await handleRequest(req(), STOCK_ENV, { fetchImpl, cache });
  assert.equal(hits, 1);
  assert.equal(second.headers.get('X-Proxy-Cache'), 'HIT');
  assert.equal((await second.json()).lowestPrice, 1200);
  assert.equal(cache.store.has(stockCacheKey(JAN)), true);
  assert.notEqual(STOCK_CACHE_KEY_PREFIX, undefined);
});

test('/stock はキー未設定なら設定不備、上流の制限は429として返す', async () => {
  const unconfigured = await handleRequest(req(), {}, { fetchImpl: async () => { throw new Error('no'); }, cache: makeCache() });
  assert.equal(unconfigured.status, 500);
  assert.equal((await unconfigured.json()).error, 'not_configured');

  const limited = await handleRequest(req(), STOCK_ENV, {
    fetchImpl: async () => new Response(JSON.stringify({ Error: { Code: 'TooManyRequests', Message: 'too many' } }), { status: 429 }),
    cache: makeCache(),
  });
  assert.equal(limited.status, 429);
});

test('/stock 以外のパスは今までどおり 404（画像の取得は壊さない）', async () => {
  const res = await handleRequest(req(JAN, { path: '/other' }), STOCK_ENV, {
    fetchImpl: async () => new Response('{}', { status: 200 }), cache: makeCache(),
  });
  assert.equal(res.status, 404);
});
