/**
 * 検索の「スペース区切りAND」と「かな・全角半角のゆらぎ吸収」。
 *
 *   1) 検索語を半角・全角スペースで区切ると、すべて含むものだけヒットする
 *   2) ひらがなで打ってもカタカナ（逆も）にヒットする
 *   3) 全角英数・半角カナ・大文字小文字のゆらぎも吸収する
 *   4) JANの部分一致は今までどおり
 *   5) 3.7万件でも軽い（辞書側の正規化は1回だけ・配列ごとにキャッシュ）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSearchText, searchTokens, dictionaryHaystack, searchDictionary,
  filterItems, createItem, CATEGORIES,
} from '../core.js';
import { JAN_DICTIONARY } from '../jan-database.js';

const DICT = [
  {
    jan: '4901234567891', name: 'ウルトラマリン', maker: 'ホルベイン', brand: 'HOLBEIN',
    category: 'oil', colorName: 'ウルトラマリン', size: '20ml', code: 'H001',
  },
  {
    jan: '4901234567892', name: 'ウルトラマリン', maker: 'ターレンス', brand: 'TALENS',
    category: 'watercolor', colorName: 'アカ', size: '10ml', code: 'T010',
  },
  {
    jan: '4909876543210', name: 'ジェッソ', maker: 'ホルベイン', brand: 'HOLBEIN',
    category: 'medium', colorName: 'アカ', size: '300ml', code: 'H500',
  },
  {
    jan: '4931234567895', name: '平筆 12号', maker: 'ホルベイン', brand: 'HOLBEIN',
    category: 'brush', colorName: '', size: '12号', code: 'B012',
  },
];

const codes = (query, opts = {}) => searchDictionary(DICT, query, { limit: 10, ...opts }).items.map((d) => d.code);

test('正規化: ひらがな・カタカナ・半角カナ・全角英数・大文字小文字を同じ並びにする', () => {
  assert.equal(normalizeSearchText('ホルベイン'), 'ほるべいん');
  assert.equal(normalizeSearchText('ほるべいん'), 'ほるべいん');
  assert.equal(normalizeSearchText('ﾎﾙﾍﾞｲﾝ'), 'ほるべいん'); // 半角カナ
  assert.equal(normalizeSearchText('ＨＯＬＢＥＩＮ'), 'holbein'); // 全角英字
  assert.equal(normalizeSearchText('Holbein'), 'holbein');
  assert.equal(normalizeSearchText('ジェッソ'), normalizeSearchText('じぇっそ'));
  assert.equal(normalizeSearchText('１２３'), '123');
  assert.equal(normalizeSearchText(null), '');
});

test('検索語の分割: 半角・全角スペースのどちらでも区切れる（連続スペース・前後の空白も捨てる）', () => {
  assert.deepEqual(searchTokens('ホルベイン 赤'), ['ほるべいん', '赤']);
  assert.deepEqual(searchTokens('ホルベイン　赤'), ['ほるべいん', '赤']); // 全角スペース
  assert.deepEqual(searchTokens('  ほるべいん   あか  '), ['ほるべいん', 'あか']);
  assert.deepEqual(searchTokens(''), []);
  assert.deepEqual(searchTokens('　'), []);
});

test('スペース区切りはAND検索（すべて含む商品だけ）', () => {
  // ホルベイン かつ ウルトラマリン → H001 だけ
  assert.deepEqual(codes('ホルベイン ウルトラ'), ['H001']);
  // ホルベイン かつ 平筆 → B012 だけ
  assert.deepEqual(codes('ホルベイン 平筆'), ['B012']);
  // 順番を変えても同じ
  assert.deepEqual(codes('ウルトラ ホルベイン'), ['H001']);
  // 全角スペースでも同じ
  assert.deepEqual(codes('ホルベイン　平筆'), ['B012']);
  // どれか1語でも欠ければヒットしない（ORになっていない）
  assert.deepEqual(codes('ホルベイン アカ ウルトラ'), []);
  assert.deepEqual(codes('ターレンス 平筆'), []);
  assert.deepEqual(codes('ホルベイン ジェッソ 平筆'), []);
});

test('ひらがなで打ってもカタカナの商品名・メーカーにヒットし、カタカナで打ってもひらがなにヒットする', () => {
  // ひらがな入力 → カタカナの商品名／メーカー
  assert.deepEqual(codes('ほるべいん'), ['H001', 'H500', 'B012']);
  assert.deepEqual(codes('うるとら'), ['H001', 'T010']);
  assert.deepEqual(codes('じぇっそ'), ['H500']);
  // カタカナ入力 → ひらがな混じりの色名（アカ / あか）
  const dict = [...DICT, {
    jan: '4931234567896', name: 'あかね色の絵具', maker: 'クサカベ', brand: 'KUSAKABE',
    category: 'oil', colorName: 'あかね', size: '20ml', code: 'K001',
  }];
  assert.deepEqual(searchDictionary(dict, 'アカネ', { limit: 10 }).items.map((d) => d.code), ['K001']);
  assert.deepEqual(searchDictionary(dict, 'あかね', { limit: 10 }).items.map((d) => d.code), ['K001']);
  // ひらがな＋カタカナを混ぜたAND検索
  assert.deepEqual(codes('ほるべいん じぇっそ'), ['H500']);
  assert.deepEqual(codes('ホルベイン ジェッソ'), ['H500']);
});

test('全角英数・半角カナ・大文字小文字のゆらぎを吸収する', () => {
  assert.deepEqual(codes('HOLBEIN'), ['H001', 'H500', 'B012']);
  assert.deepEqual(codes('holbein'), ['H001', 'H500', 'B012']);
  assert.deepEqual(codes('ＨＯＬＢＥＩＮ'), ['H001', 'H500', 'B012']); // 全角
  assert.deepEqual(codes('ﾎﾙﾍﾞｲﾝ'), ['H001', 'H500', 'B012']); // 半角カナ
  assert.deepEqual(codes('holbein うるとら'), ['H001']);
  assert.deepEqual(codes('ｈ００１'), ['H001']); // 全角の品番でも探せる
  assert.deepEqual(codes('Ｈ００１'), ['H001']);
});

test('JANの部分一致は今までどおり（数字だけの語・全角数字・ハイフン入り）', () => {
  assert.equal(searchDictionary(DICT, '4567891', { limit: 10 }).total, 1);
  assert.equal(searchDictionary(DICT, '4901234', { limit: 10 }).total, 2);
  assert.equal(searchDictionary(DICT, '４５６７８９１', { limit: 10 }).total, 1, '全角数字でも探せる');
  assert.deepEqual(searchDictionary(DICT, '4901234567892', { limit: 10 }).items.map((d) => d.code), ['T010']);
  assert.deepEqual(searchDictionary(DICT, '490-1234-567892', { limit: 10 }).items.map((d) => d.code), ['T010']);
  assert.equal(searchDictionary(DICT, '9999999', { limit: 10 }).total, 0);
  // 語と数字の組み合わせもAND
  assert.deepEqual(codes('ホルベイン 4567891'), ['H001']);
  assert.deepEqual(codes('ターレンス 4567892'), ['T010']);
  assert.deepEqual(codes('ホルベイン 4567892'), []);
});

test('メーカー・カテゴリの絞り込みとAND検索は一緒に効く', () => {
  assert.deepEqual(codes('あか', { maker: 'ホルベイン' }), ['H500']);
  assert.deepEqual(codes('あか', { maker: 'ターレンス' }), ['T010']);
  assert.deepEqual(codes('ほるべいん あか', { category: 'medium' }), ['H500']);
  assert.deepEqual(codes('ほるべいん あか', { category: 'oil' }), []);
});

test('辞書側の正規化は配列ごとに1回だけ（毎打鍵で作り直さない）', () => {
  const dict = [{ jan: '1', name: 'ホルベイン 油絵具', maker: 'ホルベイン' }];
  const first = dictionaryHaystack(dict);
  assert.equal(dictionaryHaystack(dict), first, '同じ配列では使い回す');
  // 辞書側も正規化済み（カタカナ→ひらがな・小文字）で持つ
  assert.ok(first[0].includes('ほるべいん'));
  assert.ok(first[0].includes('あぶらえのぐ') === false);
  assert.equal(first[0].includes('ホルベイン'), false);
  // 渡した hay を使っても、自分で作った hay と同じ結果
  assert.deepEqual(
    searchDictionary(dict, 'ほるべいん', { limit: 5, hay: first }).items,
    searchDictionary(dict, 'ほるべいん', { limit: 5 }).items,
  );
  // 3.7万件の内蔵辞書でも、検索語1つ・AND検索のどちらも全件を数えきれる
  const t0 = Date.now();
  const all = searchDictionary(JAN_DICTIONARY, 'ほるべいん', { limit: 10 });
  const and = searchDictionary(JAN_DICTIONARY, 'ほるべいん あか', { limit: 10 });
  const ms = Date.now() - t0;
  assert.ok(all.total >= 0 && and.total <= all.total);
  assert.ok(ms < 3000, `内蔵辞書の検索が遅い（${ms}ms）`);
});

test('在庫の検索も同じゆらぎ吸収・AND検索になる', () => {
  const items = [
    createItem({ name: 'ジェッソ', maker: 'ホルベイン', colorName: 'アカ', category: 'medium' }),
    createItem({ name: 'ウルトラマリン', maker: 'ホルベイン', colorName: 'アオ', category: 'oil' }),
    createItem({ name: 'ウルトラマリン', maker: 'ターレンス', colorName: 'アカ', category: 'oil' }),
  ];
  // ひらがな → カタカナのメーカー・商品名
  assert.equal(filterItems(items, { query: 'ほるべいん' }).length, 2);
  assert.equal(filterItems(items, { query: 'じぇっそ' }).length, 1);
  assert.equal(filterItems(items, { query: 'あか' }).length, 2);
  // AND（半角・全角スペース）
  assert.equal(filterItems(items, { query: 'ホルベイン アカ' }).length, 1);
  assert.equal(filterItems(items, { query: 'ほるべいん　あか' }).length, 1);
  assert.equal(filterItems(items, { query: 'ターレンス アオ' }).length, 0);
  // 全角英数・半角カナのゆらぎ
  assert.equal(filterItems(items, { query: 'ﾎﾙﾍﾞｲﾝ' }).length, 2);
  // 空・スペースだけは絞らない
  assert.equal(filterItems(items, { query: '' }).length, 3);
  assert.equal(filterItems(items, { query: '　 ' }).length, 3);
});

test('内蔵辞書のカテゴリは画面のカテゴリ名にすべて対応している（絞り込みが欠けない）', () => {
  const ids = new Set(CATEGORIES.map((c) => c.id));
  const missing = new Set();
  for (const d of JAN_DICTIONARY) if (!ids.has(String(d.category || 'other'))) missing.add(d.category);
  assert.deepEqual([...missing], []);
});
