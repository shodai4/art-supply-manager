import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_IMAGE_PROXY_URL, normalizeProxyUrl, resolveImageProxyUrl, imageProxyUrl,
  pickProxyImageUrl, canUseImageProxy, describeProxyError, shouldFallbackToAppId,
  fetchRakutenImageViaProxy, fetchProductImage, parseProxyProduct, sourceLabel,
  fetchProductViaProxy, fetchProductImageInfo,
} from '../images.js';

const JAN = '4900669001911';
const PROXY = 'https://rakuten-image-proxy.example.workers.dev';

/** 中継サーバーの応答を返す fetch の代わり（呼ばれたURLを記録する） */
function stubFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: (init && init.headers) || {} });
    return handler(String(url), init);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const okBody = {
  jan: JAN,
  imageUrl: 'https://thumbnail.image.rakuten.co.jp/@0_mall/holbein/cabinet/01.jpg?_ex=300x300',
  itemName: 'ホルベイン 透明水彩',
  itemPrice: 1234,
  itemUrl: 'https://item.rakuten.co.jp/holbein/abc/',
  shopName: '画材の店',
};

test('中継サーバーURLは http(s) だけ通し、末尾スラッシュを落とす', () => {
  assert.equal(normalizeProxyUrl(' https://x.workers.dev/ '), 'https://x.workers.dev');
  assert.equal(normalizeProxyUrl('https://x.workers.dev///'), 'https://x.workers.dev');
  assert.equal(normalizeProxyUrl('http://localhost:8787'), 'http://localhost:8787');
  assert.equal(normalizeProxyUrl('x.workers.dev'), '');
  assert.equal(normalizeProxyUrl('javascript:alert(1)'), '');
  assert.equal(normalizeProxyUrl(''), '');
  assert.equal(normalizeProxyUrl(null), '');
});

test('使う中継サーバーは 設定値 → 同梱の既定値 の順で決まる', () => {
  // 同梱の既定値は、2026年11月16日にデプロイしたCloudflare Workers
  assert.equal(DEFAULT_IMAGE_PROXY_URL, 'https://rakuten-image-proxy.shodai121ueda.workers.dev');
  assert.equal(resolveImageProxyUrl({}), DEFAULT_IMAGE_PROXY_URL);
  assert.equal(canUseImageProxy({}), true);

  assert.equal(resolveImageProxyUrl({ imageProxyUrl: PROXY }), PROXY);
  assert.equal(canUseImageProxy({ imageProxyUrl: PROXY }), true);
  // 設定値が壊れているときは同梱の既定値に戻す
  assert.equal(resolveImageProxyUrl({ imageProxyUrl: 'not a url' }), DEFAULT_IMAGE_PROXY_URL);
});

test('中継サーバーへのURLは /?jan=13桁 の形にする', () => {
  assert.equal(imageProxyUrl(PROXY, JAN), `${PROXY}/?jan=${JAN}`);
  assert.equal(imageProxyUrl(`${PROXY}/`, ` ${JAN} `), `${PROXY}/?jan=${JAN}`);
  assert.equal(imageProxyUrl('', JAN), '');
  assert.equal(imageProxyUrl(PROXY, ''), '');
});

test('中継サーバーの応答から画像URLを取り出す（https・300x300）', () => {
  assert.equal(pickProxyImageUrl(okBody), 'https://thumbnail.image.rakuten.co.jp/@0_mall/holbein/cabinet/01.jpg?_ex=300x300');
  assert.equal(
    pickProxyImageUrl({ imageUrl: 'http://thumbnail.image.rakuten.co.jp/a.jpg?_ex=128x128' }),
    'https://thumbnail.image.rakuten.co.jp/a.jpg?_ex=300x300',
  );
  assert.equal(pickProxyImageUrl({ imageUrl: 'javascript:alert(1)' }), '');
  assert.equal(pickProxyImageUrl({}), '');
  assert.equal(pickProxyImageUrl(null), '');
});

test('中継サーバーのエラーを短い案内文にする', () => {
  assert.match(describeProxyError({ error: 'invalid_jan', message: 'JANコードのチェックディジットが合いません' }, 400), /チェックディジット/);
  assert.match(describeProxyError({ error: 'image_not_found' }, 404), /見つかりません/);
  assert.match(describeProxyError({ error: 'rate_limited' }, 429), /混み合って/);
  assert.match(describeProxyError({ error: 'not_configured' }, 500), /未完了/);
  assert.match(describeProxyError({ error: 'upstream_error' }, 502), /中継サーバー/);
  assert.match(describeProxyError({}, 418), /HTTP 418/);
});

test('中継サーバー経由で画像URLを取得する', async () => {
  const fetchImpl = stubFetch(() => ({ ok: true, status: 200, json: async () => okBody }));
  const url = await fetchRakutenImageViaProxy(JAN, PROXY, { fetchImpl });
  assert.equal(url, okBody.imageUrl);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, `${PROXY}/?jan=${JAN}`);
  assert.equal(fetchImpl.calls[0].headers.Accept, 'application/json');
});

test('中継サーバー経由の失敗はコード付きで投げる（呼び出し側の分岐用）', async () => {
  const notFound = stubFetch(() => ({ ok: false, status: 404, json: async () => ({ error: 'image_not_found', message: '商品画像が見つかりませんでした' }) }));
  await assert.rejects(
    () => fetchRakutenImageViaProxy(JAN, PROXY, { fetchImpl: notFound }),
    (err) => err.code === 'image_not_found' && err.status === 404 && /見つかりません/.test(err.message),
  );

  const invalid = stubFetch(() => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_jan', message: 'JANコードは13桁の数字で指定してください' }) }));
  await assert.rejects(
    () => fetchRakutenImageViaProxy(JAN, PROXY, { fetchImpl: invalid }),
    (err) => err.code === 'invalid_jan' && /13桁/.test(err.message),
  );

  const down = stubFetch(() => ({ ok: false, status: 500, json: async () => ({ error: 'not_configured', message: '中継サーバーの設定が未完了です' }) }));
  await assert.rejects(
    () => fetchRakutenImageViaProxy(JAN, PROXY, { fetchImpl: down }),
    (err) => err.status === 500 && shouldFallbackToAppId(err) === true,
  );

  const offline = stubFetch(() => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(
    () => fetchRakutenImageViaProxy(JAN, PROXY, { fetchImpl: offline }),
    (err) => err.code === 'network',
  );

  // 画像URLが空の応答
  const empty = stubFetch(() => ({ ok: true, status: 200, json: async () => ({ jan: JAN }) }));
  await assert.rejects(() => fetchRakutenImageViaProxy(JAN, PROXY, { fetchImpl: empty }), /見つかりません/);

  // 中継サーバー未設定
  await assert.rejects(() => fetchRakutenImageViaProxy(JAN, '', { fetchImpl: stubFetch(() => ({ ok: true, status: 200, json: async () => okBody })) }), /未設定/);
});

test('中継サーバーがあれば設定ゼロで取得する（自分のアプリIDは使わない）', async () => {
  const fetchImpl = stubFetch((url) => {
    if (url.startsWith(PROXY)) return { ok: true, status: 200, json: async () => okBody };
    return { ok: false, status: 500, json: async () => ({ error: 'unexpected' }) };
  });
  const url = await fetchProductImage(JAN, { proxyUrl: PROXY, fetchImpl });
  assert.equal(url, okBody.imageUrl);
  assert.equal(fetchImpl.calls.length, 1);
  assert.ok(fetchImpl.calls[0].url.startsWith(PROXY));
});

test('中継サーバーが落ちているときだけ自分のアプリIDで直接取得する', async () => {
  const fetchImpl = stubFetch((url) => {
    if (url.startsWith(PROXY)) return { ok: false, status: 500, json: async () => ({ error: 'not_configured', message: '未完了' }) };
    return { ok: true, status: 200, json: async () => ({ Items: [{ mediumImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/d.jpg' }] }] }) };
  });
  const url = await fetchProductImage(JAN, { proxyUrl: PROXY, appId: 'appid-1', accessKey: 'key-1', fetchImpl });
  assert.equal(url, 'https://thumbnail.image.rakuten.co.jp/d.jpg');
  assert.equal(fetchImpl.calls.length, 2);
  assert.ok(fetchImpl.calls[1].url.includes('openapi.rakuten.co.jp'));
});

test('中継サーバーが「画像なし」「JAN不正」を返したら直接取得には切り替えない', async () => {
  for (const [status, body] of [[404, { error: 'image_not_found' }], [400, { error: 'invalid_jan', message: 'JANコードを確認してください' }]]) {
    const fetchImpl = stubFetch(() => ({ ok: false, status, json: async () => body }));
    await assert.rejects(
      () => fetchProductImage(JAN, { proxyUrl: PROXY, appId: 'appid-1', accessKey: 'key-1', fetchImpl }),
      (err) => err.status === status,
    );
    assert.equal(fetchImpl.calls.length, 1, '中継サーバーの結果を尊重する');
  }
});

test('設定ゼロでも同梱の中継サーバーで取得できる', async () => {
  const fetchImpl = stubFetch(() => ({ ok: true, status: 200, json: async () => okBody }));
  assert.equal(await fetchProductImage(JAN, { fetchImpl }), okBody.imageUrl);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].url, `${DEFAULT_IMAGE_PROXY_URL}/?jan=${JAN}`);
  // 中継サーバーが落ちていて、自分のアプリIDだけでアクセスキーが無いときは案内する
  const down = stubFetch(() => ({ ok: false, status: 500, json: async () => ({ error: 'not_configured' }) }));
  await assert.rejects(() => fetchProductImage(JAN, { appId: 'appid-1', fetchImpl: down }), /アクセスキー/);
  await assert.rejects(() => fetchProductImage('123', { fetchImpl }), /13桁/);
});

test('同梱の中継サーバーが使えないときは自分の認証情報で直接取得できる（上級者向けの逃げ道）', async () => {
  const fetchImpl = stubFetch((url) => (url.startsWith('https://openapi.rakuten.co.jp')
    ? { ok: true, status: 200, json: async () => ({ Items: [{ mediumImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/e.jpg?_ex=128x128' }] }] }) }
    : { ok: false, status: 500, json: async () => ({ error: 'not_configured' }) }));
  const url = await fetchProductImage(JAN, { appId: 'appid-1', accessKey: 'key-1', fetchImpl });
  assert.equal(url, 'https://thumbnail.image.rakuten.co.jp/e.jpg?_ex=300x300');
  const call = fetchImpl.calls.at(-1);
  assert.equal(url, 'https://thumbnail.image.rakuten.co.jp/e.jpg?_ex=300x300');
  assert.equal(new URL(call.url).searchParams.get('accessKey'), 'key-1');
  assert.equal(new URL(call.url).searchParams.get('applicationId'), 'appid-1');
});

/* ================= 中継サーバーが楽天・Yahoo!のどちらから返しても同じ形で扱える ================= */

/** Yahoo!由来の中継サーバーの応答（画像URLに _ex は付かない） */
const yahooBody = {
  jan: JAN,
  imageUrl: 'https://item-shopping.c.yimg.jp/i/l/art_abc',
  itemName: 'ホルベイン 透明水彩セット',
  itemPrice: 2345,
  itemUrl: 'https://store.shopping.yahoo.co.jp/art/abc.html',
  shopName: '画材の店',
  source: 'yahoo',
};

test('中継サーバーの応答は、楽天由来でもYahoo!由来でも同じ形に整える', () => {
  const yahoo = parseProxyProduct(yahooBody);
  assert.deepEqual(yahoo, {
    imageUrl: 'https://item-shopping.c.yimg.jp/i/l/art_abc',
    itemName: 'ホルベイン 透明水彩セット',
    itemPrice: 2345,
    itemUrl: 'https://store.shopping.yahoo.co.jp/art/abc.html',
    shopName: '画材の店',
    source: 'yahoo',
  });

  // 楽天由来（_ex は 300x300 にそろえる・http は https に）
  const rakuten = parseProxyProduct({ ...okBody, source: 'rakuten', imageUrl: 'http://thumbnail.image.rakuten.co.jp/a.jpg?_ex=128x128' });
  assert.equal(rakuten.imageUrl, 'https://thumbnail.image.rakuten.co.jp/a.jpg?_ex=300x300');
  assert.equal(rakuten.source, 'rakuten');

  // source の無い古い中継サーバーの応答でも動く
  const legacy = parseProxyProduct({ imageUrl: 'https://x/a.jpg' });
  assert.equal(legacy.imageUrl, 'https://x/a.jpg');
  assert.equal(legacy.source, '');
  assert.equal(legacy.itemName, '');

  // 画像URLが無ければ null
  assert.equal(parseProxyProduct({}), null);
  assert.equal(parseProxyProduct(null), null);

  assert.equal(sourceLabel('rakuten'), '楽天');
  assert.equal(sourceLabel('yahoo'), 'Yahoo!');
  assert.equal(sourceLabel(''), '');
  assert.equal(sourceLabel(undefined), '');
});

test('中継サーバー経由で商品名・価格・ショップ名まで受け取れる', async () => {
  const fetchImpl = stubFetch(() => ({ ok: true, status: 200, json: async () => yahooBody }));
  const product = await fetchProductViaProxy(JAN, PROXY, { fetchImpl });
  assert.equal(product.imageUrl, yahooBody.imageUrl);
  assert.equal(product.itemName, 'ホルベイン 透明水彩セット');
  assert.equal(product.source, 'yahoo');

  // これまでの入口（URLだけ返す）もそのまま使える
  const url = await fetchRakutenImageViaProxy(JAN, PROXY, { fetchImpl });
  assert.equal(url, yahooBody.imageUrl);

  // 応答に画像URLが無いときは例外（今までどおり）
  const empty = stubFetch(() => ({ ok: true, status: 200, json: async () => ({ jan: JAN }) }));
  await assert.rejects(() => fetchProductViaProxy(JAN, PROXY, { fetchImpl: empty }), /見つかりません/);
});

test('画像取得の入口は、取得元つきの商品情報を返す（URLだけの入口も維持）', async () => {
  const proxyFetch = stubFetch(() => ({ ok: true, status: 200, json: async () => yahooBody }));
  const info = await fetchProductImageInfo(JAN, { proxyUrl: PROXY, fetchImpl: proxyFetch });
  assert.equal(info.source, 'yahoo');
  assert.equal(info.itemName, 'ホルベイン 透明水彩セット');
  assert.equal(await fetchProductImage(JAN, { proxyUrl: PROXY, fetchImpl: proxyFetch }), yahooBody.imageUrl);

  // 中継サーバーが落ちて自分の楽天アプリIDで取ったときは source を rakuten にする
  const fallbackFetch = stubFetch((url) => {
    if (url.startsWith(PROXY)) return { ok: false, status: 500, json: async () => ({ error: 'not_configured' }) };
    return { ok: true, status: 200, json: async () => ({ Items: [{ mediumImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/d.jpg' }] }] }) };
  });
  const direct = await fetchProductImageInfo(JAN, { proxyUrl: PROXY, appId: 'appid-1', accessKey: 'key-1', fetchImpl: fallbackFetch });
  assert.equal(direct.imageUrl, 'https://thumbnail.image.rakuten.co.jp/d.jpg');
  assert.equal(direct.source, 'rakuten');
  assert.equal(direct.itemName, '');
});
