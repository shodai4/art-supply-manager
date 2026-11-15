import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleRequest, cacheKey, CACHE_KEY_PREFIX, CACHE_TTL_SECONDS, DEFAULT_ALLOWED_ORIGINS,
  RAKUTEN_SEARCH_ENDPOINT, DEFAULT_RAKUTEN_REFERER,
  normalizeJan, isValidJan, allowedOrigins, isOriginAllowed, corsHeaders, rakutenApiUrl,
  rakutenRequestHeaders, normalizeImageUrl, pickItem, mapRakutenError, rakutenErrorMessage,
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
