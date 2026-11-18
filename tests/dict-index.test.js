/**
 * カタログの高速化。
 *
 *   1) メーカー・カテゴリ・シリーズで絞るときは、事前に作った索引から取り出す
 *      （3.7万件を毎回走査しない）
 *   2) 検索用の文字列は、読んだ1件だけを作る（起動時に数万件を正規化しない）
 *   3) 索引・検索の結果は、これまでと同じ（同じ件数・同じ並び・同じ当たり）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dictionaryIndex, dictionaryCandidates, dictionaryMakerCounts, dictionaryCategoryCounts,
  groupDictionarySearch, dictionaryHaystack, dictionaryHayAt, searchDictionary,
  dictionarySeriesList, compareMakerName, normalizeSearchText, dictionaryIndex as indexOf,
} from '../core.js';
import { JAN_DICTIONARY } from '../jan-database.js';

const DICT = [
  { jan: '4900000000001', name: 'ウルトラマリン', maker: 'ホルベイン', series: '油絵具', category: 'oil', colorName: 'ウルトラマリン' },
  { jan: '4900000000002', name: 'シルバー', maker: 'ホルベイン', series: '油絵具', category: 'oil', colorName: 'シルバー' },
  { jan: '4900000000003', name: 'ジェッソ', maker: 'ホルベイン', series: '', category: 'medium', colorName: '' },
  { jan: '4900000000004', name: 'ウルトラマリン', maker: 'ターレンス', series: 'レンブラント', category: 'oil', colorName: 'ウルトラマリン' },
  { jan: '4900000000005', name: '平筆 12号', maker: 'ターレンス', series: 'レンブラント', category: 'brush', colorName: '' },
  { jan: '4900000000006', name: '透明水彩', maker: 'クサカベ', series: '透明水彩', category: 'watercolor', colorName: '' },
];

test('索引は辞書の全件を、メーカー・カテゴリ・シリーズで引ける', () => {
  const index = dictionaryIndex(DICT);
  assert.equal([...index.makers.values()].reduce((n, list) => n + list.length, 0), DICT.length);
  assert.deepEqual(index.makers.get('ホルベイン'), [0, 1, 2]);
  assert.deepEqual(index.makerSeries.get(`ターレンス\u0000レンブラント`), [3, 4]);
  assert.deepEqual(index.categories.get('oil'), [0, 1, 3]);
  // 同じ辞書では作り直さない
  assert.equal(dictionaryIndex(DICT), index);
});

test('絞り込みの位置は索引から取り、条件が無いときだけ全件を見る', () => {
  assert.equal(dictionaryCandidates(DICT, {}), null);
  assert.deepEqual(dictionaryCandidates(DICT, { maker: 'ホルベイン' }), [0, 1, 2]);
  assert.deepEqual(dictionaryCandidates(DICT, { maker: 'ホルベイン', category: 'medium' }), [2]);
  assert.deepEqual(dictionaryCandidates(DICT, { category: 'oil' }), [0, 1, 3]);
  assert.deepEqual(dictionaryCandidates(DICT, { series: 'レンブラント' }), [3, 4]);
  assert.deepEqual(dictionaryCandidates(DICT, { maker: 'ターレンス', series: 'レンブラント' }), [3, 4]);
  // 辞書に無いメーカーは空（全件走査に戻らない）
  assert.deepEqual(dictionaryCandidates(DICT, { maker: '存在しないメーカー' }), []);
});

test('索引を使った検索は、全件を順に見たときと同じ結果になる', () => {
  for (const maker of ['ホルベイン', 'ターレンス', 'クサカベ']) {
    const viaIndex = groupDictionarySearch(DICT, '', { maker });
    const brute = DICT.filter((d) => d.maker === maker);
    assert.equal(viaIndex.total, brute.length, maker);
    assert.deepEqual(viaIndex.groups.flatMap((g) => g.items.map((d) => d.jan)), brute.map((d) => d.jan), maker);
  }
  // 検索語との重ね合わせも同じ
  const a = groupDictionarySearch(DICT, 'うるとら', { maker: 'ホルベイン' });
  const b = groupDictionarySearch(DICT, 'うるとら');
  assert.equal(a.total, 1);
  assert.equal(b.total, 2);
  assert.deepEqual(a.groups.flatMap((g) => g.items.map((d) => d.jan)), ['4900000000001']);
  // シリーズの選択肢も索引の範囲で数える
  assert.deepEqual(dictionarySeriesList(DICT, '', { maker: 'ターレンス' }), [{ name: 'レンブラント', count: 2 }]);
});

test('メーカー・カテゴリの件数は索引から数える（選択肢の並びは五十音順）', () => {
  const makers = dictionaryMakerCounts(DICT).sort((a, b) => compareMakerName(a.name, b.name));
  assert.deepEqual(makers.map((m) => m.name), ['クサカベ', 'ターレンス', 'ホルベイン'].sort(compareMakerName));
  assert.deepEqual(makers.find((m) => m.name === 'ホルベイン'), { name: 'ホルベイン', count: 3 });
  const cats = dictionaryCategoryCounts(DICT, 'ホルベイン');
  assert.equal(cats.get('oil'), 2);
  assert.equal(cats.get('medium'), 1);
  assert.equal(cats.get('brush'), undefined);
});

test('検索用の文字列は、読んだ1件だけを作る（起動時に数万件を正規化しない）', () => {
  const dict = [...DICT];
  const hay = dictionaryHaystack(dict);
  // まだ1件も読んでいない（疎な配列）
  assert.equal(Object.keys(hay).length, 0);
  assert.equal(hay.length, dict.length);
  // 条件だけで検索語が無いときは、文字列を1つも作らない
  searchDictionary(dict, '', { maker: 'クサカベ' });
  assert.equal(Object.keys(hay).length, 0);
  // メーカーで絞った検索は、そのメーカーの分だけ作る
  searchDictionary(dict, 'すいさい', { maker: 'クサカベ', hay });
  assert.equal(Object.keys(hay).length, 1);
  // 全件検索は全件を作る（2回目は作り直さない）
  searchDictionary(dict, 'うるとら', { hay });
  assert.equal(Object.keys(hay).length, dict.length);
  // 読み出した値は正規化済み（ひらがな・小文字）
  assert.equal(dictionaryHayAt(dict, 0, hay), normalizeSearchText('ウルトラマリン 油絵具 ウルトラマリン ホルベイン 4900000000001').replace(/\s+/g, ''));
});

test('3.7万件でも、メーカーの切り替えは全件走査しない（合計が数十msに収まる）', () => {
  const dict = JAN_DICTIONARY;
  const index = indexOf(dict);
  const makers = [...index.makers.keys()].filter(Boolean).slice(0, 30);
  assert.ok(makers.length >= 10, '辞書にメーカーが足りない');
  const t0 = Date.now();
  for (const maker of makers) {
    const { groups, total } = groupDictionarySearch(dict, '', { maker });
    assert.equal(groups.length <= 1, true);
    assert.equal(total, (index.makers.get(maker) || []).length);
  }
  const ms = Date.now() - t0;
  // 全件（3.7万件）を30回走査すると数百msかかる。索引からなら数十msに収まる
  assert.ok(ms < 250, `メーカー切り替え30回で ${ms}ms かかった`);
});

test('内蔵辞書の索引は、辞書の件数と一致する', () => {
  const index = dictionaryIndex(JAN_DICTIONARY);
  const total = [...index.makers.values()].reduce((n, list) => n + list.length, 0);
  assert.equal(total, JAN_DICTIONARY.length);
  // どのメーカーの一覧も、そのメーカーの商品だけ
  for (const [maker, list] of [...index.makers].slice(0, 20)) {
    for (const i of list.slice(0, 5)) assert.equal(String(JAN_DICTIONARY[i].maker || 'メーカー不明'), maker);
  }
});
