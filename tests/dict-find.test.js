import test from 'node:test';
import assert from 'node:assert/strict';
import { searchDictionary, dictionaryHaystack } from '../core.js';
import { JAN_DICTIONARY } from '../jan-database.js';

const DICT = [
  { jan: '4900669001911', name: 'ホルベイン 油絵具 シルバー 6号', maker: 'ホルベイン', brand: '', colorName: 'シルバー', code: 'H191', size: '6号', category: 'oil' },
  { jan: '4900669001928', name: 'ホルベイン 油絵具 シルバーホワイト 6号', maker: 'ホルベイン', brand: '', colorName: 'シルバーホワイト', code: 'H192', size: '6号', category: 'oil' },
  { jan: '4902820123456', name: 'ターナー アクリルガッシュ ジャパネスクカラー 朱', maker: 'ターナー', brand: 'ターナー', colorName: '朱', code: 'T-1', size: '20ml', category: 'acrylic' },
];

test('辞書を商品名・色名・メーカー・品番・JANで探せる', () => {
  assert.deepEqual(searchDictionary(DICT, 'シルバー').items.map((d) => d.code), ['H191', 'H192']);
  assert.deepEqual(searchDictionary(DICT, 'ジャパネスク').items.map((d) => d.code), ['T-1']);
  assert.deepEqual(searchDictionary(DICT, 'ターナー').items.map((d) => d.code), ['T-1']);
  assert.deepEqual(searchDictionary(DICT, 'H192').items.map((d) => d.code), ['H192']);
  assert.deepEqual(searchDictionary(DICT, '4900669001911').items.map((d) => d.code), ['H191']);
});

test('JANの一部（4桁以上）でも探せる・当たらない数字は0件', () => {
  assert.equal(searchDictionary(DICT, '1911').total, 1);
  assert.equal(searchDictionary(DICT, '490066').total, 2);
  assert.equal(searchDictionary(DICT, '999999').total, 0);
  // 空の入力は全件（件数だけ返し、描画は上限まで）
  assert.equal(searchDictionary(DICT, '').total, 3);
});

test('描画上限を守りつつ、全体の件数は返す', () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ jan: String(4900000000000 + i), name: `絵具 ${i}`, maker: 'テスト' }));
  const { items, total, limit } = searchDictionary(many, '絵具', { limit: 40 });
  assert.equal(items.length, 40);
  assert.equal(total, 120);
  assert.equal(limit, 40);
  const zero = searchDictionary(many, '絵具', { limit: 0 });
  assert.equal(zero.items.length, 0);
  assert.equal(zero.total, 120);
});

test('検索文字列は辞書の配列ごとに1回だけ作る（毎打鍵で作り直さない）', () => {
  const dict = [...DICT];
  const first = dictionaryHaystack(dict);
  assert.equal(dictionaryHaystack(dict), first, '同じ配列では使い回す');
  assert.equal(first.length, dict.length);
  // 辞書側はひらがな・小文字にそろえて持つ（ひらがな入力でも当たる）
  assert.ok(first[0].includes('しるばー'));
  // 別の配列（合成後の辞書など）なら作り直す
  const other = [...DICT];
  assert.notEqual(dictionaryHaystack(other), first);
  // 外から渡した hay を使えば、そのまま検索に使える
  const { total } = searchDictionary(dict, 'ターナー', { hay: first });
  assert.equal(total, 1);
});

test('内蔵辞書（34,365件）でも実用的な速さで探せる', () => {
  assert.ok(JAN_DICTIONARY.length >= 30000, `内蔵辞書: ${JAN_DICTIONARY.length}件`);
  const t0 = performance.now();
  const { items, total } = searchDictionary(JAN_DICTIONARY, 'ホルベイン', { limit: 40 });
  const ms = performance.now() - t0;
  assert.ok(total > 100, `ヒット件数: ${total}`);
  assert.equal(items.length, 40);
  assert.ok(ms < 1500, `検索に ${Math.round(ms)}ms かかった`);
  // 2回目は索引を使い回すのでもっと速い
  const t1 = performance.now();
  searchDictionary(JAN_DICTIONARY, 'ホルベイン', { limit: 40 });
  assert.ok(performance.now() - t1 <= ms + 50, '索引の使い回しで遅くなっている');
});

// 画面側（編集シートの「辞書から探す」）は v1.24.0 で外した。
// カタログタブの導線と、外したことの確認は tests/item-sheet-layout.test.js で見る。
