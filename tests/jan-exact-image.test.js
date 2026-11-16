import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleRequest, yahooApiUrl, rakutenApiUrl } from '../workers/rakuten-image-proxy/src/index.js';
import { fetchProductImageInfo, fetchRakutenImage, rakutenSearchUrl, pickRakutenImageUrl } from '../images.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const JAN = '4900669001911';

/* 方針: 画像は「JANが一致した商品」のものだけ。見つからなければ空のまま（似ている商品で埋めない） */

const ENV = { RAKUTEN_APPLICATION_ID: 'app-id-123', RAKUTEN_ACCESS_KEY: 'secret' };
const YAHOO_ENV = { YAHOO_CLIENT_ID: 'yahoo-client' };

function req(jan = JAN) {
  return new Request(`https://proxy.example.workers.dev/?jan=${jan}`, { headers: { Origin: 'https://shodai4.com' } });
}

function routeFetch({ rakuten, yahoo }) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('shopping.yahooapis.jp')) return yahoo();
    return rakuten();
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('中継サーバー: 楽天が「似ている別商品」しか返さないときは 404（画像を返さない）', async () => {
  const near = () => new Response(JSON.stringify({
    Items: [{
      itemName: 'ホルベイン 油絵具 ウルトラマリン（別サイズ）',
      itemUrl: 'https://item.rakuten.co.jp/shop/other-item/',
      mediumImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/near.jpg' }],
    }],
  }), { status: 200 });
  const fetchImpl = routeFetch({ rakuten: near, yahoo: () => new Response(JSON.stringify({ hits: [] }), { status: 200 }) });

  const res = await handleRequest(req(), ENV, { fetchImpl });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'image_not_found');
});

test('中継サーバー: Yahoo!が別JANの商品を返しても使わない（404）', async () => {
  const yahoo = () => new Response(JSON.stringify({
    hits: [{ name: '似ている色', janCode: '4900669001928', url: 'https://store.shopping.yahoo.co.jp/x/1', exImage: { url: 'https://item-shopping.c.yimg.jp/i/j/other' } }],
  }), { status: 200 });
  const fetchImpl = routeFetch({ rakuten: () => new Response(JSON.stringify({ Items: [] }), { status: 200 }), yahoo });

  const res = await handleRequest(req(), YAHOO_ENV, { fetchImpl });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'image_not_found');
});

test('中継サーバー: JANが一致する商品が返れば200でその画像を返す', async () => {
  const yahoo = () => new Response(JSON.stringify({
    hits: [{ name: 'ホルベイン 油絵具 ウルトラマリン', janCode: JAN, url: 'https://store.shopping.yahoo.co.jp/x/2', exImage: { url: 'https://item-shopping.c.yimg.jp/i/j/hit' } }],
  }), { status: 200 });
  const res = await handleRequest(req(), YAHOO_ENV, { fetchImpl: routeFetch({ rakuten: () => new Response('{}', { status: 404 }), yahoo }) });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.imageUrl, 'https://item-shopping.c.yimg.jp/i/j/hit');
  assert.equal(data.jan, JAN);
});

test('どこも商品名検索をしていない（問い合わせはJANだけ）', () => {
  // 中継サーバー: Yahoo!は jan_code、楽天は JAN を keyword に渡すだけ
  const yahoo = new URL(yahooApiUrl(YAHOO_ENV, JAN)).searchParams;
  assert.equal(yahoo.get('jan_code'), JAN);
  assert.equal(yahoo.get('query'), null);
  assert.equal(yahoo.get('keyword'), null);
  const rakuten = new URL(rakutenApiUrl(ENV, JAN)).searchParams;
  assert.equal(rakuten.get('keyword'), JAN);
  assert.equal(rakuten.get('jan'), null);

  // アプリ直叩きの経路も同じ
  const direct = new URL(rakutenSearchUrl('app-id-123', JAN)).searchParams;
  assert.equal(direct.get('keyword'), JAN);

  // 画面側は JAN だけを渡す（商品名や色名で取り直さない）
  const app = read('app.js');
  assert.match(app, /fetchAutoImage\(jan, \{ settings: state\.settings, inFlight: autoImageInFlight \}\)/);
  assert.match(app, /fetchAutoImage\(item\.jan, \{ settings: state\.settings, inFlight: autoImageInFlight \}\)/);
  assert.equal(/fetchAutoImage\([^)]*(item\.name|displayName|colorName)/.test(app), false);
});

test('アプリ側: 似ている商品の結果では画像URLを返さない（例外のまま）', async () => {
  const payload = {
    Items: [{
      itemName: 'ホルベイン 油絵具 ウルトラマリン（3本セット）',
      itemUrl: 'https://item.rakuten.co.jp/shop/set/',
      mediumImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/set.jpg' }],
    }],
  };
  assert.equal(pickRakutenImageUrl(payload, JAN), '');
  await assert.rejects(
    () => fetchRakutenImage(JAN, 'app-id', { accessKey: 'key', fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload }) }),
    /商品画像が見つかりません/,
  );
});

test('アプリ側: 中継サーバーが404を返したら、画像なしのまま（代替の問い合わせをしない）', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return { ok: false, status: 404, json: async () => ({ error: 'image_not_found' }) };
  };
  await assert.rejects(() => fetchProductImageInfo(JAN, { proxyUrl: 'https://proxy.example.workers.dev', fetchImpl }), /見つかりません|商品画像/);
  assert.equal(calls.length, 1, '1回問い合わせて終わる（名前で探し直さない）');
  assert.ok(calls[0].includes(`jan=${JAN}`));
});
