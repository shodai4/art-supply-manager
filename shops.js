// 通販サイトへの検索リンク（アフィリエイト土台）
// ここ1か所の設定を差し替えるだけで、アプリ内のすべての「通販で探す」リンクに
// アフィリエイトID・タグが自動で付く。未設定のときは通常の検索URLとして動く。
// DOMに触れないので node --test から検証できる。
import { normalizeJAN } from './core.js';

/**
 * アフィリエイト設定（1か所に集約）。
 *
 * - amazonTag        … AmazonアソシエイトのトラッキングID（例: "shodai4-22"）
 * - rakutenAffiliateId … 楽天アフィリエイトのID（例: "1234abcd.5678efgh"）
 * - yahooSid / yahooPid … Yahoo!ショッピング（バリューコマース）の sid / pid
 *
 * 空文字のままなら、どのリンクも「通常の検索URL」になる（成果は付かないが壊れない）。
 * 値はコードに直接書かず、必要になったらここだけを書き換える。
 */
export const SHOP_AFFILIATE_CONFIG = {
  amazonTag: 'shodai4-22',
  rakutenAffiliateId: '598e3f74.c89b09de.598e3f75.325c6ad1',
  // バリューコマース「画材管理」（サイトID 3788358）× Yahoo!ショッピング提携の sid / pid
  yahooSid: '3788358',
  yahooPid: '892749794',
};

/** Amazonアフィリエイトのリンクをまとめるためのホスト（日本） */
export const AMAZON_HOST = 'www.amazon.co.jp';

/** 各ショップの表示名と検索URLの組み立て */
export const SHOPS = [
  { id: 'amazon', label: 'Amazon' },
  { id: 'rakuten', label: '楽天市場' },
  { id: 'yahoo', label: 'Yahoo!' },
];

/**
 * 検索語を決める。JANがあればJANを最優先（最も正確）、無ければ
 * メーカー名＋商品名＋色名を空白でつなぐ。
 */
export function buildSearchQuery(item = {}) {
  const jan = normalizeJAN(item.jan);
  if (/^\d{8,14}$/.test(jan)) return jan;
  const parts = [item.maker || item.brand, item.name, item.colorName]
    .map((v) => String(v == null ? '' : v).trim())
    .filter(Boolean);
  // 同じ語の繰り返し（商品名にメーカー名が入っている等）は1つにまとめる
  const unique = [];
  for (const part of parts) {
    if (unique.some((u) => u.includes(part))) continue;
    const longer = unique.findIndex((u) => part.includes(u));
    if (longer !== -1) unique[longer] = part;
    else unique.push(part);
  }
  return unique.join(' ').replace(/\s+/g, ' ').trim();
}

/** ショップIDごとの「素の検索URL」（アフィリエイト加工前） */
export function plainSearchUrl(shop, query) {
  const q = String(query || '').trim();
  if (!q) return '';
  const enc = encodeURIComponent(q);
  if (shop === 'amazon') return `https://${AMAZON_HOST}/s?k=${enc}`;
  if (shop === 'rakuten') return `https://search.rakuten.co.jp/search/mall/${enc}/`;
  if (shop === 'yahoo') return `https://shopping.yahoo.co.jp/search?p=${enc}`;
  return '';
}

/**
 * アフィリエイト設定を適用したURLを返す（設定が空なら素の検索URL）。
 * 楽天はハイブリッドURL（hb.afl.rakuten.co.jp/hgc/…）、
 * Yahoo!はバリューコマースのリファラル（ck.jp.ap.valuecommerce.com）で包む。
 */
export function applyAffiliate(shop, url, config = SHOP_AFFILIATE_CONFIG) {
  const base = String(url || '');
  if (!base) return '';
  const c = config || {};
  if (shop === 'amazon') {
    const tag = String(c.amazonTag || '').trim();
    if (!tag) return base;
    const glue = base.includes('?') ? '&' : '?';
    return `${base}${glue}tag=${encodeURIComponent(tag)}`;
  }
  if (shop === 'rakuten') {
    const id = String(c.rakutenAffiliateId || '').trim();
    if (!id) return base;
    return `https://hb.afl.rakuten.co.jp/hgc/${encodeURIComponent(id)}/?pc=${encodeURIComponent(base)}&link_type=hybrid_url`;
  }
  if (shop === 'yahoo') {
    const sid = String(c.yahooSid || '').trim();
    const pid = String(c.yahooPid || '').trim();
    if (!sid || !pid) return base;
    return `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=${encodeURIComponent(sid)}&pid=${encodeURIComponent(pid)}&vc_url=${encodeURIComponent(base)}`;
  }
  return base;
}

/**
 * 1つの画材についての通販検索リンク一式。
 * 検索語が作れない（JANも名前も無い）ときは空配列。
 * @returns {Array<{id:string, label:string, url:string, query:string}>}
 */
export function shopSearchLinks(item = {}, config = SHOP_AFFILIATE_CONFIG) {
  const query = buildSearchQuery(item);
  if (!query) return [];
  return SHOPS.map((s) => ({
    id: s.id,
    label: s.label,
    query,
    url: applyAffiliate(s.id, plainSearchUrl(s.id, query), config),
  })).filter((s) => s.url);
}

/** 検索に使った語の説明（画面表示用・絵文字なし） */
export function describeSearchQuery(query, item = {}) {
  const jan = normalizeJAN(item.jan);
  const byJan = /^\d{8,14}$/.test(jan);
  if (!query) return '検索語がありません（JANか商品名を入れてください）';
  return byJan ? `JAN ${query} で検索` : `「${query}」で検索`;
}

/** 画面に出す帰属表示（App Store / ASP規約向けの短い注記） */
export const AFFILIATE_NOTE = '通販サイトへのリンクを含みます。Amazonのアソシエイトとして、適格販売により収入を得ています。';

/* ---------------- 通販シートの在庫・参考価格（Yahoo!ショッピング） ---------------- */

/** 中継サーバーの在庫エンドポイント（画像の中継サーバーに /stock を足したもの） */
export const STOCK_PROXY_PATH = '/stock';

/**
 * 在庫を問い合わせるURL。中継サーバーのURLが無い・JANが13桁でないときは空文字
 * （リンクは今までどおり開けるので、在庫が出ないだけで止まらない）。
 */
export function stockApiUrl(proxyBase, jan) {
  const base = String(proxyBase || '').trim().replace(/\/+$/, '');
  const code = normalizeJAN(jan);
  if (!base || !/^https:\/\//i.test(base)) return '';
  if (!/^\d{13}$/.test(code)) return '';
  return `${base}${STOCK_PROXY_PATH}?jan=${code}`;
}

/**
 * 中継サーバーの応答を画面用の形にそろえる。
 * 応答が想定と違う・JANが一致しないときは null（古い商品の情報を出さない）。
 */
export function parseStockPayload(payload, jan = '') {
  if (!payload || typeof payload !== 'object') return null;
  const code = normalizeJAN(jan);
  const got = normalizeJAN(payload.jan || '');
  if (code && got && got !== code) return null;
  const offers = Math.max(0, Number(payload.offers) || 0);
  const inStock = Math.max(0, Number(payload.inStockOffers ?? payload.inStock) || 0);
  const lowest = Number(payload.lowestPrice) || 0;
  return {
    jan: got || code,
    offers,
    inStockOffers: inStock,
    available: Boolean(payload.available) || inStock > 0,
    lowestPrice: lowest > 0 ? lowest : 0,
    source: String(payload.source || 'yahoo'),
    checkedAt: String(payload.fetchedAt || payload.checkedAt || ''),
  };
}

/** 参考価格の表示（1,200 -> ¥1,200） */
export function priceLabel(value) {
  const n = Math.round(Number(value) || 0);
  return n > 0 ? `¥${n.toLocaleString('ja-JP')}` : '';
}

/**
 * Yahoo!欄に出す短い文（在庫あり（¥1,200〜）／在庫なし／確認できませんでした）。
 * 参考情報なので「〜」を付けて、出品者・送料で変わることを添える。
 */
export function stockLabel(info) {
  if (!info) return '';
  if (!info.offers) return '在庫を確認できませんでした';
  if (!info.available) return '在庫なし';
  const price = priceLabel(info.lowestPrice);
  return price ? `在庫あり（${price}〜）` : '在庫あり';
}

/** 在庫表示の注記（Yahoo!の検索結果にもとづく参考情報であること） */
export const STOCK_NOTE = 'Yahoo!ショッピングの検索結果にもとづく参考情報です（送料・出品者で変わります）';
