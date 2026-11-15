import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHOP_AFFILIATE_CONFIG, buildSearchQuery, plainSearchUrl, applyAffiliate,
  shopSearchLinks, describeSearchQuery, AFFILIATE_NOTE,
} from '../shops.js';

const item = { jan: '4900669001911', name: 'ホルベイン 油絵具 シルバー 6号', maker: 'ホルベイン', colorName: 'シルバー' };
const noJan = { name: 'ホルベイン 油絵具 シルバー', maker: 'ホルベイン', colorName: 'シルバー' };

test('検索語はJANを最優先、無ければメーカー＋商品名＋色名', () => {
  assert.equal(buildSearchQuery(item), '4900669001911');
  assert.equal(buildSearchQuery({ ...item, jan: '４９００６６９００１９１１' }), '4900669001911');
  assert.equal(buildSearchQuery(noJan), 'ホルベイン 油絵具 シルバー');
  assert.equal(buildSearchQuery({ maker: 'ホルベイン', name: 'ホルベイン シルバー', colorName: 'シルバー' }), 'ホルベイン シルバー');
  assert.equal(buildSearchQuery({}), '');
  assert.equal(buildSearchQuery({ jan: '123' }), ''); // 短すぎる数字はJANとして使わない
});

test('各ショップの検索URL', () => {
  assert.equal(plainSearchUrl('amazon', 'テスト'), 'https://www.amazon.co.jp/s?k=%E3%83%86%E3%82%B9%E3%83%88');
  assert.equal(plainSearchUrl('rakuten', 'テスト'), 'https://search.rakuten.co.jp/search/mall/%E3%83%86%E3%82%B9%E3%83%88/');
  assert.equal(plainSearchUrl('yahoo', 'テスト'), 'https://shopping.yahoo.co.jp/search?p=%E3%83%86%E3%82%B9%E3%83%88');
  assert.equal(plainSearchUrl('amazon', ''), '');
  assert.equal(plainSearchUrl('unknown', 'x'), '');
});

test('アフィリエイト未設定なら通常の検索URL', () => {
  const config = { amazonTag: '', rakutenAffiliateId: '', yahooSid: '', yahooPid: '' };
  const links = shopSearchLinks(item, config);
  assert.equal(links.length, 3);
  assert.equal(links[0].url, 'https://www.amazon.co.jp/s?k=4900669001911');
  assert.equal(links[1].url, 'https://search.rakuten.co.jp/search/mall/4900669001911/');
  assert.equal(links[2].url, 'https://shopping.yahoo.co.jp/search?p=4900669001911');
  assert.deepEqual(links.map((l) => l.label), ['Amazon', '楽天市場', 'Yahoo!']);
});

test('アフィリエイト設定を入れると全リンクに自動で付く', () => {
  const config = { amazonTag: 'shodai4-22', rakutenAffiliateId: '1234abcd.5678efgh', yahooSid: '3612345', yahooPid: '890123456' };
  const plain = plainSearchUrl('amazon', '4900669001911');
  assert.equal(applyAffiliate('amazon', plain, config), `${plain}&tag=shodai4-22`);

  const rakuten = applyAffiliate('rakuten', plainSearchUrl('rakuten', '4900669001911'), config);
  assert.ok(rakuten.startsWith('https://hb.afl.rakuten.co.jp/hgc/1234abcd.5678efgh/?pc='));
  assert.ok(rakuten.endsWith('&link_type=hybrid_url'));
  assert.equal(decodeURIComponent(rakuten.split('pc=')[1].split('&')[0]), plainSearchUrl('rakuten', '4900669001911'));

  const yahoo = applyAffiliate('yahoo', plainSearchUrl('yahoo', '4900669001911'), config);
  assert.ok(yahoo.startsWith('https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=3612345&pid=890123456&vc_url='));

  // Yahoo!はsidとpidの両方が揃ったときだけ包む
  assert.equal(applyAffiliate('yahoo', plainSearchUrl('yahoo', 'x'), { yahooSid: '1' }), plainSearchUrl('yahoo', 'x'));
  // 未知のショップ・空URLはそのまま
  assert.equal(applyAffiliate('other', 'https://example.com', config), 'https://example.com');
  assert.equal(applyAffiliate('amazon', '', config), '');
});

test('検索語が作れないときはリンクを出さない', () => {
  assert.deepEqual(shopSearchLinks({}), []);
  assert.deepEqual(shopSearchLinks({ jan: '', name: '', maker: '' }), []);
  assert.match(describeSearchQuery('4900669001911', item), /^JAN 4900669001911 で検索$/);
  assert.match(describeSearchQuery('ホルベイン シルバー', noJan), /^「ホルベイン シルバー」で検索$/);
  assert.match(describeSearchQuery('', {}), /検索語がありません/);
});

test('帰属表示とデフォルト設定は絵文字なし・Amazonタグと楽天IDを設定', () => {
  const re = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  assert.equal(re.test(AFFILIATE_NOTE), false);
  assert.match(AFFILIATE_NOTE, /アフィリエイト|アソシエイト/);
  // Amazonアソシエイトの表示義務（適格販売であることの明記）
  assert.match(AFFILIATE_NOTE, /Amazonのアソシエイトとして、適格販売により収入を得ています。/);
  assert.deepEqual(SHOP_AFFILIATE_CONFIG, {
    amazonTag: 'shodai4-22',
    rakutenAffiliateId: '598e3f74.c89b09de.598e3f75.325c6ad1',
    yahooSid: '',
    yahooPid: '',
  });
});

test('実際の設定でAmazonタグが付き、楽天IDも維持される', () => {
  const amazonPlain = plainSearchUrl('amazon', '4900669001911');
  const amazon = applyAffiliate('amazon', amazonPlain);
  assert.equal(amazon, `${amazonPlain}&tag=shodai4-22`);
  assert.match(amazon, /^https:\/\/www\.amazon\.co\.jp\/s\?k=4900669001911&tag=shodai4-22$/);

  // 検索語がJANでなくても同じようにタグが付く
  const byName = applyAffiliate('amazon', plainSearchUrl('amazon', 'ホルベイン シルバー'));
  assert.ok(byName.endsWith('&tag=shodai4-22'));

  const plain = plainSearchUrl('rakuten', '4900669001911');
  const url = applyAffiliate('rakuten', plain);
  assert.ok(url.startsWith('https://hb.afl.rakuten.co.jp/hgc/598e3f74.c89b09de.598e3f75.325c6ad1/?pc='));
  assert.ok(url.endsWith('&link_type=hybrid_url'));
  assert.equal(decodeURIComponent(url.split('pc=')[1].split('&')[0]), plain);

  // 実設定の全リンク：Amazonだけタグ付き、楽天はハイブリッドURL、Yahoo!は素のまま
  const links = shopSearchLinks(item);
  assert.equal(links.length, 3);
  assert.equal(links.find((l) => l.id === 'amazon').url, `${amazonPlain}&tag=shodai4-22`);
  assert.ok(links.find((l) => l.id === 'rakuten').url.startsWith('https://hb.afl.rakuten.co.jp/hgc/598e3f74.c89b09de.598e3f75.325c6ad1/?pc='));
  assert.equal(links.find((l) => l.id === 'yahoo').url, plainSearchUrl('yahoo', '4900669001911'));
});
