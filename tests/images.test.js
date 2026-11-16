import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fitWithin, upgradeRakutenImage, pickRakutenImageUrl, rakutenSearchUrl, itemMatchesJan,
  describeRakutenError, fetchRakutenImage, RAKUTEN_SEARCH_ENDPOINT,
  MAX_EDGE, JPEG_QUALITY,
} from '../images.js';
import { createItem, importState, normalizeImageUrl, exportState, blankState, upsertItem } from '../core.js';

test('写真の縮小サイズは長辺480px・縦横比を保つ（拡大しない）', () => {
  assert.equal(MAX_EDGE, 480);
  assert.equal(JPEG_QUALITY, 0.75);
  assert.deepEqual(fitWithin(640, 480), { width: 480, height: 360 });
  assert.deepEqual(fitWithin(480, 640), { width: 360, height: 480 });
  assert.deepEqual(fitWithin(4032, 3024), { width: 480, height: 360 }); // iPhone写真
  assert.deepEqual(fitWithin(480, 480), { width: 480, height: 480 }); // ちょうどはそのまま
  assert.deepEqual(fitWithin(320, 320), { width: 320, height: 320 }); // 旧サイズの写真もそのまま読める
  assert.deepEqual(fitWithin(100, 80), { width: 100, height: 80 });    // 小さい画像は拡大しない
  assert.deepEqual(fitWithin(1000, 500, 200), { width: 200, height: 100 });
  assert.deepEqual(fitWithin(0, 0), { width: 1, height: 1 });         // 異常値でも壊れない
});

test('画像URLは http(s) のみ受け付ける', () => {
  assert.equal(normalizeImageUrl('https://thumbnail.image.rakuten.co.jp/a.jpg'), 'https://thumbnail.image.rakuten.co.jp/a.jpg');
  assert.equal(normalizeImageUrl('  http://example.com/b.png  '), 'http://example.com/b.png');
  assert.equal(normalizeImageUrl('javascript:alert(1)'), '');
  assert.equal(normalizeImageUrl('ftp://example.com/c.jpg'), '');
  assert.equal(normalizeImageUrl('example.com/d.jpg'), '');
  assert.equal(normalizeImageUrl(''), '');
  assert.equal(normalizeImageUrl(null), '');
});

test('アイテムの imageUrl は保存・エクスポート・インポートで保たれる', () => {
  const it = createItem({ name: 'ホルベイン シルバー', imageUrl: 'https://example.com/silver.jpg' });
  assert.equal(it.imageUrl, 'https://example.com/silver.jpg');
  assert.equal(createItem({ name: 'X', imageUrl: 'javascript:alert(1)' }).imageUrl, '');

  let state = blankState();
  state = upsertItem(state, it);
  const back = importState(exportState(state));
  assert.equal(back.items[0].imageUrl, 'https://example.com/silver.jpg');
  // 旧バックアップ（imageUrlなし）も読める
  const legacy = importState(JSON.stringify({ folders: [{ id: 'home', name: '家' }], items: [{ name: '旧', folderId: 'home' }] }));
  assert.equal(legacy.items[0].imageUrl, '');
});

test('楽天の画像URLは _ex を 300x300 に上げる', () => {
  assert.equal(
    upgradeRakutenImage('https://thumbnail.image.rakuten.co.jp/@0_mall/holbein/cabinet/01.jpg?_ex=128x128'),
    'https://thumbnail.image.rakuten.co.jp/@0_mall/holbein/cabinet/01.jpg?_ex=300x300',
  );
  assert.equal(
    upgradeRakutenImage('https://thumbnail.image.rakuten.co.jp/x.jpg?_ex=100x100&foo=1'),
    'https://thumbnail.image.rakuten.co.jp/x.jpg?_ex=300x300&foo=1',
  );
  assert.equal(upgradeRakutenImage('https://example.com/a.jpg'), 'https://example.com/a.jpg');
  assert.equal(upgradeRakutenImage('javascript:alert(1)'), '');
  assert.equal(upgradeRakutenImage(''), '');
});

test('楽天APIの応答から商品画像を取り出す（v2/旧形式・小画像フォールバック）', () => {
  const JAN = '4900669001911';
  const v2 = {
    Items: [{
      itemName: 'ホルベイン 油絵具',
      itemCode: 'holbein:4900669001911',
      mediumImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/a.jpg?_ex=128x128' }],
    }],
  };
  assert.equal(pickRakutenImageUrl(v2, JAN), 'https://thumbnail.image.rakuten.co.jp/a.jpg?_ex=300x300');

  const legacy = { Items: [{ Item: { mediumImageUrls: ['https://thumbnail.image.rakuten.co.jp/b.jpg?_ex=128x128'], itemUrl: 'https://item.rakuten.co.jp/shop/4900669001911/' } }] };
  assert.equal(pickRakutenImageUrl(legacy, JAN), 'https://thumbnail.image.rakuten.co.jp/b.jpg?_ex=300x300');

  const smallOnly = { Items: [{ smallImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/c.jpg' }], itemName: 'JAN 4900669001911' }] };
  assert.equal(pickRakutenImageUrl(smallOnly, JAN), 'https://thumbnail.image.rakuten.co.jp/c.jpg');

  assert.equal(pickRakutenImageUrl({ Items: [] }, JAN), '');
  assert.equal(pickRakutenImageUrl({ Items: [{ itemName: '画像なし' }] }, JAN), '');
  assert.equal(pickRakutenImageUrl(null, JAN), '');
  // JANを渡さない・一致しない商品しか無いときは空（似ている別商品の画像で埋めない）
  assert.equal(pickRakutenImageUrl(v2), '');
  assert.equal(pickRakutenImageUrl({ Items: [{ itemName: '別の色', mediumImageUrls: [{ imageUrl: 'https://x/other.jpg' }] }] }, JAN), '');
  assert.equal(itemMatchesJan({ itemCode: 'shop:4900669001911' }, JAN), true);
  assert.equal(itemMatchesJan({ itemUrl: 'https://item.rakuten.co.jp/shop/4900669001911' }, JAN), true);
  assert.equal(itemMatchesJan({ itemName: 'ホルベイン 4900669001911' }, JAN), true);
  assert.equal(itemMatchesJan({ itemName: 'ホルベイン 4900669001912' }, JAN), false);
  assert.equal(itemMatchesJan({ itemName: 'ホルベイン' }, JAN), false);
  assert.equal(itemMatchesJan({ itemName: 'ホルベイン 4900669001911' }, ''), false);
});

test('楽天商品検索APIのURLを組み立てる（現行のopenapi版を使う）', () => {
  assert.equal(RAKUTEN_SEARCH_ENDPOINT, 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701');
  const url = rakutenSearchUrl('1234567890', '4900669001911');
  assert.ok(url.startsWith(`${RAKUTEN_SEARCH_ENDPOINT}?`));
  const q = new URL(url).searchParams;
  assert.equal(q.get('applicationId'), '1234567890');
  assert.equal(q.get('keyword'), '4900669001911');
  assert.equal(q.get('hits'), '1');
  assert.equal(q.get('format'), 'json');
  assert.equal(q.get('formatVersion'), '2');
});

test('JANから画像を取得（成功・未設定・APIエラー・画像なし・通信エラー）', async () => {
  const calls = [];
  const okFetch = (u, init) => {
    calls.push({ url: u, headers: (init && init.headers) || {} });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ Items: [{ itemCode: 'shop:4900669001911', mediumImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/p.jpg?_ex=128x128' }] }] }) });
  };
  const url = await fetchRakutenImage('4900669001911', 'appid-1', { accessKey: 'key-1', fetchImpl: okFetch });
  assert.equal(url, 'https://thumbnail.image.rakuten.co.jp/p.jpg?_ex=300x300');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes('keyword=4900669001911'));
  // ブラウザ直叩きの経路はCORSのプリフライトを避けるため accessKey をクエリに入れる
  assert.equal(new URL(calls[0].url).searchParams.get('accessKey'), 'key-1');

  await assert.rejects(() => fetchRakutenImage('4900669001911', '', { accessKey: 'key-1', fetchImpl: okFetch }), /楽天アプリID/);
  await assert.rejects(() => fetchRakutenImage('4900669001911', 'appid-1', { fetchImpl: okFetch }), /アクセスキー/);
  await assert.rejects(() => fetchRakutenImage('123', 'appid-1', { accessKey: 'key-1', fetchImpl: okFetch }), /13桁/);
  await assert.rejects(
    () => fetchRakutenImage('4900669001911', 'bad', { accessKey: 'key-1', fetchImpl: () => Promise.resolve({ ok: false, status: 403, json: async () => ({ errors: { errorCode: 403, errorMessage: 'Invalid Access Key' } }) }) }),
    /アクセスキー/,
  );
  await assert.rejects(
    () => fetchRakutenImage('4900669001911', 'appid-1', { accessKey: 'key-1', fetchImpl: () => Promise.resolve({ ok: false, status: 400, json: async () => ({ error: 'wrong_parameter', error_description: 'specify valid applicationId' }) }) }),
    /アプリID/,
  );
  await assert.rejects(
    () => fetchRakutenImage('4900669001911', 'appid-1', { accessKey: 'key-1', fetchImpl: () => Promise.resolve({ ok: false, status: 429, json: async () => ({ error: 'too_many_requests' }) }) }),
    /回数制限/,
  );
  await assert.rejects(
    () => fetchRakutenImage('4900669001911', 'appid-1', { accessKey: 'key-1', fetchImpl: () => Promise.resolve({ ok: true, status: 200, json: async () => ({ Items: [] }) }) }),
    /商品画像が見つかりません/,
  );
  // JANが一致しない（似ている別商品の）結果では画像を返さない
  await assert.rejects(
    () => fetchRakutenImage('4900669001911', 'appid-1', {
      accessKey: 'key-1',
      fetchImpl: () => Promise.resolve({ ok: true, status: 200, json: async () => ({ Items: [{ itemName: 'ホルベイン 別の色', mediumImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/other.jpg' }] }] }) }),
    }),
    /商品画像が見つかりません/,
  );
  await assert.rejects(
    () => fetchRakutenImage('4900669001911', 'appid-1', { accessKey: 'key-1', fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')) }),
    /通信できません/,
  );
});

test('楽天APIのエラーは短い案内文にする', () => {
  assert.match(describeRakutenError({ error: 'wrong_application_id' }, 400), /アプリID/);
  assert.match(describeRakutenError({ error: 'too_many_requests' }, 429), /回数制限/);
  assert.match(describeRakutenError({ errors: { errorCode: 403, errorMessage: 'Invalid Access Key' } }, 403), /アクセスキー/);
  assert.match(describeRakutenError({ errors: { errorCode: 403, errorMessage: 'REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING' } }, 403), /許可サイト/);
  assert.match(describeRakutenError({}, 404), /見つかりません/);
  assert.match(describeRakutenError({}, 500), /HTTP 500/);
  assert.match(describeRakutenError({ error: 'unknown' }, 400), /unknown/);
});
