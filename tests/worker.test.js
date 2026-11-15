import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleRequest, cacheKey, CACHE_KEY_PREFIX, CACHE_TTL_SECONDS, DEFAULT_ALLOWED_ORIGINS,
  RAKUTEN_SEARCH_ENDPOINT, DEFAULT_RAKUTEN_REFERER, YAHOO_ITEM_SEARCH_ENDPOINT,
  normalizeJan, isValidJan, allowedOrigins, isOriginAllowed, corsHeaders, rakutenApiUrl,
  rakutenRequestHeaders, normalizeImageUrl, pickItem, mapRakutenError, rakutenErrorMessage,
  rakutenAppId, yahooClientId, providerOrder, yahooApiUrl, pickYahooItem, yahooErrorMessage,
  mapYahooError, chooseFailure, fetchFromRakuten, fetchFromYahoo,
} from '../workers/rakuten-image-proxy/src/index.js';

const JAN = '4900669001911'; // チェックディジットが合う13桁
const ENV = {
  RAKUTEN_APPLICATION_ID: 'app-id-123',
  RAKUTEN_ACCESS_KEY: 'secret-access-key-999',
};

function makeCache() {
  const store = new Map();
  return {
    store,
    async match(key) {
      const hit = store.get(key);
      return hit ? hit.clone() : undefined;
    },
    async put(key, res) {
      store.set(key, res.clone());
    },
  };
}

function searchPayload(overrides = {}) {
  return {
    Items: [{
      itemName: 'ホルベイン 透明水彩セット',
      itemPrice: 1234,
      itemUrl: 'https://item.rakuten.co.jp/holbein/abc/',
      shopName: '画材の店',
      mediumImageUrls: [{ imageUrl: 'http://thumbnail.image.rakuten.co.jp/@0_mall/holbein/cabinet/01.jpg?_ex=128x128' }],
      ...overrides,
    }],
  };
}

/** fetch の代わり。呼ばれたURLとヘッダーを記録する */
function stubFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: (init && init.headers) || {} });
    return handler(String(url), init, calls.length);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function req(jan = JAN, { origin = 'https://shodai4.com', method = 'GET', path = '/' } = {}) {
  const url = `https://proxy.example.workers.dev${path}${jan === null ? '' : `?jan=${jan}`}`;
  const headers = origin ? { Origin: origin } : {};
  return new Request(url, { method, headers });
}

test('JANを13桁に正規化し、チェックディジットまで見る', () => {
  assert.equal(normalizeJan(' 4900669-001911 '), JAN);
  assert.equal(normalizeJan('４９００６６９００１９１１'), JAN); // 全角
  assert.equal(isValidJan(JAN), true);
  assert.equal(isValidJan('4900669001912'), false);            // チェックディジット違い
  assert.equal(isValidJan('490066900191'), false);             // 12桁
  assert.equal(isValidJan('abcdefghijklm'), false);
});

test('13桁JANで商品画像を返し、認証情報はURLにも応答にも出さない', async () => {
  const cache = makeCache();
  const fetchImpl = stubFetch(() => new Response(JSON.stringify(searchPayload()), { status: 200 }));

  const res = await handleRequest(req(), ENV, { fetchImpl, cache });
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://shodai4.com');
  assert.equal(res.headers.get('Vary'), 'Origin');
  assert.equal(res.headers.get('Cache-Control'), `public, max-age=${CACHE_TTL_SECONDS}`);
  assert.equal(res.headers.get('X-Proxy-Cache'), 'MISS');

  const data = JSON.parse(body);
  assert.equal(data.jan, JAN);
  assert.equal(data.imageUrl, 'https://thumbnail.image.rakuten.co.jp/@0_mall/holbein/cabinet/01.jpg?_ex=300x300');
  assert.equal(data.itemName, 'ホルベイン 透明水彩セット');
  assert.equal(data.itemPrice, 1234);
  assert.equal(data.itemUrl, 'https://item.rakuten.co.jp/holbein/abc/');
  assert.equal(data.shopName, '画材の店');

  // 楽天APIの叩き方
  assert.equal(fetchImpl.calls.length, 1);
  const call = fetchImpl.calls[0];
  assert.ok(call.url.startsWith(RAKUTEN_SEARCH_ENDPOINT));
  assert.match(call.url, new RegExp(`keyword=${JAN}`));
  assert.match(call.url, /formatVersion=2/);
  // アプリIDは楽天の仕様でクエリ必須、アクセスキーは秘密なのでヘッダー
  assert.equal(new URL(call.url).searchParams.get('applicationId'), 'app-id-123');
  assert.equal(call.headers.accessKey, 'secret-access-key-999');
  assert.equal(call.headers.Referer, DEFAULT_RAKUTEN_REFERER);
  // アクセスキーはURL・応答に出さない。アプリIDも応答には出さない
  assert.equal(call.url.includes('secret-access-key-999'), false);
  assert.equal(body.includes('secret-access-key-999'), false);
  assert.equal(body.includes('app-id-123'), false);

  // キャッシュへ保存されている
  assert.equal(cache.store.has(cacheKey(JAN)), true);
  assert.equal(cacheKey(JAN), `${CACHE_KEY_PREFIX}${JAN}`);
});

test('同じJANはキャッシュから返し、CORSヘッダーはオリジンごとに付け直す', async () => {
  const cache = makeCache();
  const fetchImpl = stubFetch(() => new Response(JSON.stringify(searchPayload()), { status: 200 }));

  const first = await handleRequest(req(), ENV, { fetchImpl, cache });
  assert.equal(first.headers.get('X-Proxy-Cache'), 'MISS');

  const second = await handleRequest(req(JAN, { origin: 'capacitor://localhost' }), ENV, { fetchImpl, cache });
  assert.equal(second.status, 200);
  assert.equal(second.headers.get('X-Proxy-Cache'), 'HIT');
  assert.equal(second.headers.get('Access-Control-Allow-Origin'), 'capacitor://localhost');
  assert.equal(fetchImpl.calls.length, 1, '同じJANで楽天APIを2回叩かない');

  // オリジンが違ってもキャッシュキーは同じ（キャッシュはデータだけを持つ）
  assert.equal(cacheKey(JAN), `${CACHE_KEY_PREFIX}${JAN}`);
  const data = await second.json();
  assert.equal(data.imageUrl, 'https://thumbnail.image.rakuten.co.jp/@0_mall/holbein/cabinet/01.jpg?_ex=300x300');
});

test('JANの不備は400を返し、楽天APIを叩かない', async () => {
  const fetchImpl = stubFetch(() => new Response('{}', { status: 200 }));
  const cases = [
    [null, 'missing_jan'],
    ['', 'missing_jan'],
    ['123', 'invalid_jan'],
    ['490066900191', 'invalid_jan'],       // 12桁
    ['49006690019110', 'invalid_jan'],     // 14桁
    ['abcdefghijklm', 'invalid_jan'],
    ['4900669001912', 'invalid_jan'],      // チェックディジット違い
  ];
  for (const [jan, code] of cases) {
    const res = await handleRequest(req(jan), ENV, { fetchImpl, cache: makeCache() });
    const body = await res.json();
    assert.equal(res.status, 400, `jan=${jan}`);
    assert.equal(body.error, code, `jan=${jan}`);
    assert.ok(body.message.length > 0);
    // 400でもブラウザがエラー本文を読めるようCORSは付ける
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://shodai4.com');
  }
  assert.equal(fetchImpl.calls.length, 0);
});

test('CORS: 許可オリジンのみ通し、追加はALLOWED_ORIGINSで行う', async () => {
  const fetchImpl = stubFetch(() => new Response(JSON.stringify(searchPayload()), { status: 200 }));

  for (const origin of DEFAULT_ALLOWED_ORIGINS) {
    assert.equal(isOriginAllowed(origin, {}), true, origin);
  }
  assert.equal(isOriginAllowed('https://evil.example.com', {}), false);
  assert.equal(isOriginAllowed('', {}), true); // Origin無し（ネイティブ/サーバー間）

  const blocked = await handleRequest(req(JAN, { origin: 'https://evil.example.com' }), ENV, { fetchImpl, cache: makeCache() });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error, 'origin_not_allowed');
  assert.equal(blocked.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(fetchImpl.calls.length, 0);

  const env2 = { ...ENV, ALLOWED_ORIGINS: 'https://example.com, https://new.example.jp/' };
  assert.deepEqual(allowedOrigins(env2).slice(-2), ['https://example.com', 'https://new.example.jp']);
  const ok = await handleRequest(req(JAN, { origin: 'https://new.example.jp' }), env2, { fetchImpl, cache: makeCache() });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://new.example.jp');

  // ネイティブ（Origin無し）は通し、ACAOは付けない
  const native = await handleRequest(req(JAN, { origin: '' }), ENV, { fetchImpl, cache: makeCache() });
  assert.equal(native.status, 200);
  assert.equal(native.headers.get('Access-Control-Allow-Origin'), null);
});

test('OPTIONSは204、GET以外は405、未知のパスは404', async () => {
  const fetchImpl = stubFetch(() => new Response('{}', { status: 200 }));

  const pre = await handleRequest(req(JAN, { method: 'OPTIONS' }), ENV, { fetchImpl, cache: makeCache() });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'https://shodai4.com');
  assert.match(pre.headers.get('Access-Control-Allow-Methods'), /GET/);

  const preBlocked = await handleRequest(req(JAN, { method: 'OPTIONS', origin: 'https://evil.example.com' }), ENV, { fetchImpl, cache: makeCache() });
  assert.equal(preBlocked.status, 403);

  const post = await handleRequest(req(JAN, { method: 'POST' }), ENV, { fetchImpl, cache: makeCache() });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('Allow'), 'GET, OPTIONS');

  const wrongPath = await handleRequest(req(JAN, { path: '/other' }), ENV, { fetchImpl, cache: makeCache() });
  assert.equal(wrongPath.status, 404);
  assert.equal(fetchImpl.calls.length, 0);
});

test('楽天APIの失敗を中継サーバーのエラーに読み替え、秘密は返さない', async () => {
  const cases = [
    [403, { errors: { errorCode: 403, errorMessage: 'Invalid Access Key' } }, 500, 'not_configured'],
    [403, { errors: { errorCode: 403, errorMessage: 'REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING' } }, 500, 'not_configured'],
    [400, { error: 'wrong_parameter', error_description: 'specify valid applicationId' }, 500, 'not_configured'],
    [429, { errors: { errorCode: 429, errorMessage: 'Too many requests' } }, 429, 'rate_limited'],
    [500, { errors: { errorCode: 500, errorMessage: 'internal' } }, 502, 'upstream_error'],
  ];
  for (const [status, payload, expectedStatus, expectedError] of cases) {
    const fetchImpl = stubFetch(() => new Response(JSON.stringify(payload), { status }));
    const res = await handleRequest(req(), ENV, { fetchImpl, cache: makeCache() });
    const body = await res.json();
    assert.equal(res.status, expectedStatus, JSON.stringify(payload));
    assert.equal(body.error, expectedError, JSON.stringify(payload));
    assert.equal(JSON.stringify(body).includes('secret-access-key-999'), false);
    assert.equal(JSON.stringify(body).includes('app-id-123'), false);
  }

  assert.equal(rakutenErrorMessage({ errors: { errorMessage: 'x' } }), 'x');
  assert.equal(rakutenErrorMessage({ error_description: 'y' }), 'y');
  assert.equal(mapRakutenError({}, 429).error, 'rate_limited');
});

test('商品が無い/通信できないときは404・502を返す', async () => {
  const empty = stubFetch(() => new Response(JSON.stringify({ Items: [] }), { status: 200 }));
  const notFound = await handleRequest(req(), ENV, { fetchImpl: empty, cache: makeCache() });
  assert.equal(notFound.status, 404);
  assert.equal((await notFound.json()).error, 'image_not_found');

  const boom = stubFetch(() => { throw new TypeError('network down'); });
  const failed = await handleRequest(req(), ENV, { fetchImpl: boom, cache: makeCache() });
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).error, 'upstream_unreachable');
});

test('RAKUTEN_APPLICATION_ID未設定なら500で、楽天APIは叩かない', async () => {
  const fetchImpl = stubFetch(() => new Response('{}', { status: 200 }));
  const res = await handleRequest(req(), { RAKUTEN_ACCESS_KEY: 'k' }, { fetchImpl, cache: makeCache() });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'not_configured');
  assert.equal(fetchImpl.calls.length, 0);
});

test('エンドポイント差し替えとアフィリエイトIDの付与', () => {
  const env = { ...ENV, RAKUTEN_AFFILIATE_ID: '1234abcd.5678efgh', RAKUTEN_REFERER: 'https://shodai4.com/app/' };
  const url = new URL(rakutenApiUrl(env, JAN));
  assert.equal(url.origin + url.pathname, RAKUTEN_SEARCH_ENDPOINT);
  assert.equal(url.searchParams.get('affiliateId'), '1234abcd.5678efgh');
  assert.equal(url.searchParams.get('keyword'), JAN);
  assert.equal(url.searchParams.get('applicationId'), 'app-id-123', '楽天の仕様でアプリIDはクエリ必須');

  const headers = rakutenRequestHeaders(env);
  assert.equal(headers.accessKey, 'secret-access-key-999');
  assert.equal(headers.applicationId, undefined, 'アプリIDはクエリで渡す');
  assert.equal(headers.Referer, 'https://shodai4.com/app/');

  const legacy = { ...ENV, RAKUTEN_API_ENDPOINT: 'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601' };
  assert.ok(rakutenApiUrl(legacy, JAN).startsWith('https://app.rakuten.co.jp/'));
  // 不正な差し替え値は既定に戻す
  assert.ok(rakutenApiUrl({ ...ENV, RAKUTEN_API_ENDPOINT: 'http://evil.example.com' }, JAN).startsWith(RAKUTEN_SEARCH_ENDPOINT));
});

test('画像URLの正規化と商品の取り出し', () => {
  assert.equal(normalizeImageUrl('http://thumbnail.image.rakuten.co.jp/a.jpg'), 'https://thumbnail.image.rakuten.co.jp/a.jpg');
  assert.equal(normalizeImageUrl('https://x/a.jpg?_ex=128x128'), 'https://x/a.jpg?_ex=300x300');
  assert.equal(normalizeImageUrl('javascript:alert(1)'), '');
  assert.equal(normalizeImageUrl(null), '');

  const v2 = pickItem({ Items: [{ mediumImageUrls: [{ imageUrl: 'https://x/a.jpg' }], itemName: 'a', itemPrice: '100' }] });
  assert.deepEqual(v2, { imageUrl: 'https://x/a.jpg', itemName: 'a', itemPrice: 100, itemUrl: '', shopName: '' });

  const legacy = pickItem({ items: [{ Item: { smallImageUrls: ['https://x/b.jpg'] } }] });
  assert.equal(legacy.imageUrl, 'https://x/b.jpg');

  assert.equal(pickItem({ Items: [{ itemName: 'no image' }] }), null);
  assert.equal(pickItem({}), null);
  assert.equal(pickItem(null), null);

  // CORSヘッダー単体
  assert.equal(corsHeaders('https://shodai4.com', {})['Access-Control-Allow-Origin'], 'https://shodai4.com');
  assert.equal(corsHeaders('https://evil.example.com', {})['Access-Control-Allow-Origin'], undefined);
});

/* ================= 楽天API + Yahoo!ショッピングAPI（v3）の併用 ================= */

const YAHOO_ENV = { YAHOO_CLIENT_ID: 'yahoo-client-id-777' };
const BOTH_ENV = { ...ENV, ...YAHOO_ENV };

/** Yahoo!の商品検索API（v3）の応答 */
function yahooPayload(overrides = {}) {
  return {
    totalResultsAvailable: 1,
    totalResultsReturned: 1,
    firstResultsPosition: 1,
    request: { jan_code: JAN },
    hits: [{
      index: 1,
      name: 'ホルベイン 透明水彩セット',
      price: 2345,
      url: 'https://store.shopping.yahoo.co.jp/art/abc.html',
      seller: { sellerId: 'art', name: '画材の店' },
      image: {
        small: 'https://item-shopping.c.yimg.jp/i/c/art_abc',
        medium: 'https://item-shopping.c.yimg.jp/i/g/art_abc',
      },
      exImage: { url: 'https://item-shopping.c.yimg.jp/i/l/art_abc', width: 300, height: 300 },
      ...overrides,
    }],
  };
}

/** どちらのAPIを叩かれたかで応答を切り替える fetch の代わり */
function routeFetch({ rakuten, yahoo }) {
  const fetchImpl = async (url) => {
    fetchImpl.calls.push({ url: String(url) });
    if (String(url).startsWith(YAHOO_ITEM_SEARCH_ENDPOINT)) return yahoo();
    if (String(url).startsWith(RAKUTEN_SEARCH_ENDPOINT)) return rakuten();
    return new Response('{}', { status: 404 });
  };
  fetchImpl.calls = [];
  return fetchImpl;
}

const okRakuten = () => new Response(JSON.stringify(searchPayload()), { status: 200 });
const okYahoo = () => new Response(JSON.stringify(yahooPayload()), { status: 200 });

test('Secret名は別名も受け、試す順番は 楽天→Yahoo!（楽天が未設定ならYahoo!先行）', () => {
  assert.equal(rakutenAppId({ RAKUTEN_APPLICATION_ID: ' a ' }), 'a');
  assert.equal(rakutenAppId({ RAKUTEN_APP_ID: 'b' }), 'b');
  assert.equal(rakutenAppId({}), '');
  assert.equal(yahooClientId({ YAHOO_CLIENT_ID: ' c ' }), 'c');
  assert.equal(yahooClientId({ YAHOO_APP_ID: 'd' }), 'd');
  assert.equal(yahooClientId({}), '');

  assert.deepEqual(providerOrder({}), []);
  assert.deepEqual(providerOrder({ YAHOO_CLIENT_ID: 'y' }), ['yahoo']);
  assert.deepEqual(providerOrder({ RAKUTEN_APPLICATION_ID: 'r' }), ['rakuten']);
  assert.deepEqual(providerOrder(BOTH_ENV), ['rakuten', 'yahoo']);
});

test('楽天のキーが無くても、Yahoo!のClient IDだけで画像を返す', async () => {
  const cache = makeCache();
  const fetchImpl = stubFetch(() => okYahoo());

  const res = await handleRequest(req(), YAHOO_ENV, { fetchImpl, cache });
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Proxy-Source'), 'yahoo');
  assert.equal(res.headers.get('X-Proxy-Cache'), 'MISS');

  const data = JSON.parse(body);
  assert.equal(data.jan, JAN);
  assert.equal(data.source, 'yahoo');
  assert.equal(data.imageUrl, 'https://item-shopping.c.yimg.jp/i/l/art_abc');
  assert.equal(data.itemName, 'ホルベイン 透明水彩セット');
  assert.equal(data.itemPrice, 2345);
  assert.equal(data.itemUrl, 'https://store.shopping.yahoo.co.jp/art/abc.html');
  assert.equal(data.shopName, '画材の店');

  // Yahoo!の叩き方（appid・jan_code・image_size=300・results=1）
  assert.equal(fetchImpl.calls.length, 1);
  const call = fetchImpl.calls[0];
  assert.ok(call.url.startsWith(YAHOO_ITEM_SEARCH_ENDPOINT));
  const params = new URL(call.url).searchParams;
  assert.equal(params.get('appid'), 'yahoo-client-id-777');
  assert.equal(params.get('jan_code'), JAN);
  assert.equal(params.get('image_size'), '300');
  assert.equal(params.get('results'), '1');

  // Client ID は応答に出さない
  assert.equal(body.includes('yahoo-client-id-777'), false);

  // キャッシュにも同じ形で入る（2回目はAPIを叩かない）
  assert.equal(cache.store.has(cacheKey(JAN)), true);
  const second = await handleRequest(req(JAN, { origin: 'capacitor://localhost' }), YAHOO_ENV, { fetchImpl, cache });
  assert.equal(second.headers.get('X-Proxy-Cache'), 'HIT');
  assert.equal(second.headers.get('X-Proxy-Source'), 'yahoo');
  assert.equal(fetchImpl.calls.length, 1);
});

test('両方設定されているときは楽天を先に試し、楽天が落ちていればYahoo!で補完する', async () => {
  // 楽天はメンテナンス（503）で落ちている
  const fetchImpl = routeFetch({
    rakuten: () => new Response(JSON.stringify({ errors: { errorMessage: 'Service unavailable' } }), { status: 503 }),
    yahoo: okYahoo,
  });

  const res = await handleRequest(req(), BOTH_ENV, { fetchImpl, cache: makeCache() });
  const data = await res.json();

  assert.equal(res.status, 200, 'Yahoo!で補完して200を返す');
  assert.equal(data.source, 'yahoo');
  assert.equal(data.imageUrl, 'https://item-shopping.c.yimg.jp/i/l/art_abc');
  assert.equal(fetchImpl.calls.length, 2);
  assert.ok(fetchImpl.calls[0].url.startsWith(RAKUTEN_SEARCH_ENDPOINT));
  assert.ok(fetchImpl.calls[1].url.startsWith(YAHOO_ITEM_SEARCH_ENDPOINT));
});

test('楽天で画像付きの商品が無ければYahoo!で探し、楽天で取れたらYahoo!は叩かない', async () => {
  const emptyThenYahoo = routeFetch({
    rakuten: () => new Response(JSON.stringify({ Items: [] }), { status: 200 }),
    yahoo: okYahoo,
  });
  const first = await handleRequest(req(), BOTH_ENV, { fetchImpl: emptyThenYahoo, cache: makeCache() });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).source, 'yahoo');
  assert.equal(emptyThenYahoo.calls.length, 2);

  const rakutenOnly = routeFetch({ rakuten: okRakuten, yahoo: okYahoo });
  const second = await handleRequest(req(), BOTH_ENV, { fetchImpl: rakutenOnly, cache: makeCache() });
  const data = await second.json();
  assert.equal(data.source, 'rakuten');
  assert.equal(data.imageUrl, 'https://thumbnail.image.rakuten.co.jp/@0_mall/holbein/cabinet/01.jpg?_ex=300x300');
  assert.equal(rakutenOnly.calls.length, 1, '楽天で取れたらYahoo!は叩かない');
});

test('楽天の認証が通らずYahoo!も拒否されたら、設定の見直しを促す（秘密は返さない）', async () => {
  const fetchImpl = routeFetch({
    rakuten: () => new Response(JSON.stringify({ errors: { errorMessage: 'Invalid Access Key' } }), { status: 403 }),
    yahoo: () => new Response(JSON.stringify({ Error: { Message: 'Your Request was Forbidden' } }), { status: 403 }),
  });
  const res = await handleRequest(req(), BOTH_ENV, { fetchImpl, cache: makeCache() });
  const body = await res.text();

  assert.equal(res.status, 500);
  const data = JSON.parse(body);
  assert.equal(data.error, 'not_configured');
  assert.match(data.message, /API設定（楽天・Yahoo!）/);
  assert.equal(body.includes('yahoo-client-id-777'), false);
  assert.equal(body.includes('secret-access-key-999'), false);
  assert.equal(fetchImpl.calls.length, 2);
});

test('全員「商品なし」なら404、回数制限があれば429を優先する', async () => {
  const noHit = routeFetch({
    rakuten: () => new Response(JSON.stringify({ Items: [] }), { status: 200 }),
    yahoo: () => new Response(JSON.stringify({ totalResultsAvailable: 0, hits: [] }), { status: 200 }),
  });
  const notFound = await handleRequest(req(), BOTH_ENV, { fetchImpl: noHit, cache: makeCache() });
  assert.equal(notFound.status, 404);
  assert.equal((await notFound.json()).error, 'image_not_found');
  assert.equal(noHit.calls.length, 2);

  const rateLimited = routeFetch({
    rakuten: () => new Response(JSON.stringify({ errors: { errorMessage: 'Too many requests' } }), { status: 429 }),
    yahoo: () => new Response(JSON.stringify({ hits: [] }), { status: 200 }),
  });
  const limited = await handleRequest(req(), BOTH_ENV, { fetchImpl: rateLimited, cache: makeCache() });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, 'rate_limited');
});

test('どちらのキーも無ければ500で、どのAPIも叩かない', async () => {
  const fetchImpl = stubFetch(() => okYahoo());
  const res = await handleRequest(req(), {}, { fetchImpl, cache: makeCache() });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).error, 'not_configured');
  assert.equal(fetchImpl.calls.length, 0);
});

test('Yahoo!の応答から画像を取る（exImage → medium → small、画像なしの商品は飛ばす）', () => {
  assert.deepEqual(pickYahooItem(yahooPayload()), {
    imageUrl: 'https://item-shopping.c.yimg.jp/i/l/art_abc',
    itemName: 'ホルベイン 透明水彩セット',
    itemPrice: 2345,
    itemUrl: 'https://store.shopping.yahoo.co.jp/art/abc.html',
    shopName: '画材の店',
  });

  // exImage が無ければ medium（146px）、それも無ければ small（76px）
  const medium = pickYahooItem(yahooPayload({ exImage: undefined }));
  assert.equal(medium.imageUrl, 'https://item-shopping.c.yimg.jp/i/g/art_abc');
  const small = pickYahooItem(yahooPayload({ exImage: undefined, image: { small: 'https://item-shopping.c.yimg.jp/i/c/art_abc' } }));
  assert.equal(small.imageUrl, 'https://item-shopping.c.yimg.jp/i/c/art_abc');

  // 画像の無い商品は飛ばして次の商品を見る
  const skipped = pickYahooItem({
    hits: [
      { name: '画像なし', url: 'https://x/1' },
      { name: 'こちら', price: '500', seller: { sellerId: 'shop1' }, image: { medium: 'http://item-shopping.c.yimg.jp/i/g/shop1_1' } },
    ],
  });
  assert.equal(skipped.imageUrl, 'https://item-shopping.c.yimg.jp/i/g/shop1_1'); // http は https にそろえる
  assert.equal(skipped.itemName, 'こちら');
  assert.equal(skipped.itemPrice, 500);
  assert.equal(skipped.shopName, 'shop1', 'ストア名が無ければストアIDにする');

  assert.equal(pickYahooItem({ hits: [] }), null);
  assert.equal(pickYahooItem({ totalResultsAvailable: 0 }), null);
  assert.equal(pickYahooItem(null), null);
});

test('Yahoo!のURL組み立てとエラーの読み替え（秘密は含めない）', () => {
  const url = new URL(yahooApiUrl(YAHOO_ENV, JAN));
  assert.equal(url.origin + url.pathname, YAHOO_ITEM_SEARCH_ENDPOINT);
  assert.equal(url.searchParams.get('appid'), 'yahoo-client-id-777');
  assert.equal(url.searchParams.get('jan_code'), JAN);
  assert.equal(url.searchParams.get('image_size'), '300');
  assert.equal(url.searchParams.get('affiliate_id'), null);

  const affiliate = new URL(yahooApiUrl({ ...YAHOO_ENV, YAHOO_AFFILIATE_ID: 'vc-123' }, JAN));
  assert.equal(affiliate.searchParams.get('affiliate_type'), 'vc', '種類の指定が無ければ vc');
  assert.equal(affiliate.searchParams.get('affiliate_id'), 'vc-123');

  assert.equal(yahooErrorMessage({ Error: { Message: 'x' } }), 'x');
  assert.equal(mapYahooError({}, 401).error, 'not_configured', 'appidなし');
  assert.equal(mapYahooError({ Error: { Message: 'Your Request was Forbidden' } }, 403).error, 'not_configured');
  assert.equal(mapYahooError({}, 429).error, 'rate_limited');
  assert.equal(mapYahooError({ Error: { Message: 'Too Many Requests' } }, 400).error, 'rate_limited');
  assert.equal(mapYahooError({ Error: { Message: 'Request failed' } }, 400).error, 'upstream_rejected');
  assert.equal(mapYahooError({}, 503).error, 'upstream_error');
  assert.equal(mapYahooError({}, 500).status, 502);
  for (const status of [401, 403, 429, 500]) {
    assert.equal(JSON.stringify(mapYahooError({ Error: { Message: 'x' } }, status)).includes('yahoo-client-id-777'), false);
  }
});

test('取得先ごとの失敗の寄せ方（chooseFailure）', () => {
  assert.equal(chooseFailure([]).error, 'upstream_error');
  assert.equal(chooseFailure([{ kind: 'no_item', status: 404, error: 'image_not_found' }]).status, 404);
  assert.equal(chooseFailure([
    { kind: 'not_configured', status: 500, error: 'not_configured', message: 'a' },
  ]).message, 'a', '片方だけの設定不備はその案内をそのまま返す');
  assert.equal(chooseFailure([
    { kind: 'not_configured', status: 500, error: 'not_configured', message: 'a' },
    { kind: 'not_configured', status: 500, error: 'not_configured', message: 'b' },
  ]).message, '中継サーバーのAPI設定（楽天・Yahoo!）を確認してください');
  assert.equal(chooseFailure([
    { kind: 'no_item', status: 404, error: 'image_not_found' },
    { kind: 'not_configured', status: 500, error: 'not_configured', message: 'a' },
  ]).error, 'not_configured', '設定不備があると「無い」とは言い切らない');
  assert.equal(chooseFailure([
    { kind: 'rate_limited', status: 429, error: 'rate_limited', message: 'r' },
    { kind: 'upstream', status: 502, error: 'upstream_error', message: 'u' },
  ]).status, 429);
});

test('取得先ごとの関数は、単体でも同じ形の結果を返す', async () => {
  const rakuten = await fetchFromRakuten(JAN, ENV, stubFetch(() => okRakuten()));
  assert.equal(rakuten.ok, true);
  assert.equal(rakuten.source, 'rakuten');
  assert.equal(rakuten.item.imageUrl, 'https://thumbnail.image.rakuten.co.jp/@0_mall/holbein/cabinet/01.jpg?_ex=300x300');

  const yahoo = await fetchFromYahoo(JAN, YAHOO_ENV, stubFetch(() => okYahoo()));
  assert.equal(yahoo.ok, true);
  assert.equal(yahoo.source, 'yahoo');
  assert.equal(yahoo.item.itemPrice, 2345);

  const failed = await fetchFromYahoo(JAN, YAHOO_ENV, stubFetch(() => { throw new TypeError('network down'); }));
  assert.equal(failed.ok, false);
  assert.equal(failed.kind, 'upstream');
  assert.equal(failed.error, 'upstream_unreachable');

  const none = await fetchFromRakuten(JAN, ENV, stubFetch(() => new Response(JSON.stringify({ Items: [] }), { status: 200 })));
  assert.equal(none.kind, 'no_item');
  assert.equal(none.error, 'image_not_found');
});
