/**
 * 文具（ボールペン・マーカー・シャープペン・消しゴム）174件の内蔵辞書。
 *
 * 2026-11-17 に work/dict-analysis/stationery で集めた「定番文具のJAN」を
 * アスクルの商品ページから転記して追加した分。ここでは
 *
 *   1) 174件がそろっていて、JAN・カテゴリ・出典の形が正しい
 *   2) 代表的な文具が lookupJAN / searchDictionary で引ける
 *   3) 蛍光ペン（マイルドライナー・フリクションライト）は「マーカー」に入る
 *   4) 消しゴムは受け皿がないので「その他」（ユーザーの指示）
 *
 * を確かめる。辞書全体の件数は tests/dict-18-categories.test.js が見ている。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JAN_DICTIONARY } from '../jan-database.js';
import { CATEGORIES, lookupJAN, searchDictionary, calcCheckDigit } from '../core.js';

const ASKUL = 'https://www.askul.co.jp/p/';

/** 2026-11-17 に追加した文具174件のJAN（この一覧がそのまま追加分の定義） */
const STATIONERY_JANS = new Set(`
  4901681688739 4901681351312 4902778323014 4902778319321 4901681401727 4902778323052
  4902505375279 4901681580484 4901681323821 4901681451227 4902505596674 4902778022252
  4901681580477 4901681351220 4902778261255 4902778261002 4901681401772 4902505375293
  4902506142146 4902505375286 4902506329509 4901681143061 4901681351442 4901681351459
  4901681323890 4901681401741 4901681688722 4902506314413 4901681143078 4902505375064
  4901681223862 4901681351428 4901681323845 4902505463068 4902505674082 4902778323038
  4902778022245 4902505596667 4901681143276 4901681102266 4901681102259 4901681400713
  4901681688746 4902778148464 4901881187421 4901681143047 4902505375057 4901681223886
  4901681223893 4902778261095 4901681351350 4902506125064 4902505375101 4901681143153
  4901681323883 4902778261279 4901681525027 4902778311288 4901681580491 4902505596636
  4901681143085 4901991062960 4902778261309 4901681351244 4902505463099 4902505437991
  4902506349675 4902505463075 4902506142924 4902505126321 4902505463112 4902505463105
  4901681688715 4902778261316 4901681351435 4902505463082 4902505596681 4901681351411
  4901681143092 4901681223848 4902505437984 4901681143283 4902778323045 4902778720806
  4901681451272 4902778261026 4901681351367 4901681423873 4902778323946 4901681400720
  4901681143177 4902506141040 4901991005936 4901681143344 4901681143184 4902505674105
  4901681143191 4901681351480 4901681525010 4901681580453 4902778311271 4901681143146
  4901681223855 4902505674112 4902778022214 4901681451470 4902505126345 4901681351237
  4901681143160 4902778323663 4901681580422 4901681143269 4901681143290 4901681351282
  4901681351374 4901681580408 4901681351466 4901681223879 4901681580415 4901681451371
  4902778261262 4901681351473 4902778148433 4901681142989 4901681351275 4901991005929
  4902505375071 4901681688753 4902778141922 4902506142917 4902778311295 4902505375088
  4901681401796 4902506141026 4902778167939 4902505596643 4901681577231 4901681143252
  4902505375095 4901681451425 4901681525034 4901681351268 4901681323876 4902778141946
  4902778167991 4902505438028 4902505568671 4901681143245 4902505674099 4901681401758
  4902778260982 4902505126338 4902778311257 4901681351343 4902778693414 4902778319338
  4902778325469 4902778720790 4902778323601 4901681323869 4901681451326 4902505438011
  4901681143498 4901681351336 4902778311264 4902778309605 4902505596650 4901681351381
  4901681102242 4901681143054 4901681323852 4902778720813 4901681351329 4901681351213
`.trim().split(/\s+/));

const stationery = JAN_DICTIONARY.filter((e) => STATIONERY_JANS.has(e.jan));

/** JANのチェックディジットが合っているか */
function validJAN(jan) {
  if (!/^\d{13}$/.test(jan)) return false;
  return Number(jan[12]) === calcCheckDigit(jan.slice(0, 12));
}

test('文具174件が内蔵辞書に入っている（JAN・カテゴリ・出典）', () => {
  assert.equal(STATIONERY_JANS.size, 174);
  assert.equal(stationery.length, 174, `文具が ${stationery.length}件しか引けない`);
  const ids = CATEGORIES.map((c) => c.id);
  for (const e of stationery) {
    assert.ok(validJAN(e.jan), `JANが不正: ${e.jan}`);
    assert.match(e.source, /^https:\/\/www\.askul\.co\.jp\/p\/[A-Z0-9]+\/$/, `出典が不正: ${e.jan} ${e.source}`);
    assert.ok(ids.includes(e.category), `カテゴリが18種類にない: ${e.jan} ${e.category}`);
    assert.ok(e.name && e.name.length > 1, `品名なし: ${e.jan}`);
    assert.ok(e.maker, `メーカーなし: ${e.jan}`);
    assert.equal(/[●【】]/.test(e.name), false, `品名に商品ページの記号が残る: ${e.jan} ${e.name}`);
  }
  // 同じJANを二重に持たない
  assert.equal(new Set(JAN_DICTIONARY.map((e) => e.jan)).size, JAN_DICTIONARY.length);
});

test('文具のカテゴリ内訳（ペン123 / マーカー43 / 鉛筆5 / その他3）', () => {
  const counts = stationery.reduce((acc, e) => ({ ...acc, [e.category]: (acc[e.category] || 0) + 1 }), {});
  assert.deepEqual(counts, { pen: 123, marker: 43, pencil: 5, other: 3 });
});

test('サラサクリップは色・太さ・型番まで引ける', () => {
  const e = lookupJAN('4901681351312');
  assert.ok(e, 'サラサクリップ 0.5mm グレー が引けない');
  assert.equal(e.name, 'サラサクリップ グレー 0.5mm');
  assert.equal(e.maker, 'ゼブラ');
  assert.equal(e.category, 'pen');
  assert.equal(e.series, 'サラサクリップ');
  assert.equal(e.colorName, 'グレー');
  assert.equal(e.size, '0.5mm');
  assert.equal(e.code, 'JJ15-GR');
  assert.equal(e.source, `${ASKUL}5414753/`);
});

test('マイルドライナーはマーカー（蛍光ペン）で、太細のサイズを持つ', () => {
  const e = lookupJAN('4901681688739');
  assert.ok(e, 'マイルドライナー マイルドミモザイエロー が引けない');
  assert.equal(e.category, 'marker');
  assert.equal(e.series, 'マイルドライナー');
  assert.equal(e.colorName, 'マイルドミモザイエロー');
  assert.equal(e.size, '太4.0mm/細1.0mm');
  assert.equal(e.code, 'WKT7-MMY');
});

test('フリクションライトも蛍光ペンとしてマーカーに入る（6件の取りこぼしをしない）', () => {
  const lights = stationery.filter((e) => e.series === 'フリクションライト');
  assert.equal(lights.length, 18);
  assert.ok(lights.every((e) => e.category === 'marker'), 'フリクションライトにマーカー以外が混ざる');
  const e = lookupJAN('4902505596674');
  assert.equal(e.name, 'フリクションライト スカイブルー 3.3mm');
  assert.equal(e.category, 'marker');
});

test('ユニボールワンのインク色と太さ（0.38mm 焼きりんご色）', () => {
  const e = lookupJAN('4902778323014');
  assert.ok(e, 'ユニボールワン 焼きりんご色 が引けない');
  assert.equal(e.series, 'ユニボールワン');
  assert.equal(e.colorName, '焼きりんご色');
  assert.equal(e.size, '0.38mm');
  assert.equal(e.category, 'pen');
});

test('シャープペン（クルトガ KS・グラフ1000）は鉛筆カテゴリ', () => {
  for (const jan of ['4902778319321', '4902506329509', '4902506314413']) {
    const e = lookupJAN(jan);
    assert.ok(e, `${jan} が引けない`);
    assert.equal(e.category, 'pencil', `${jan} ${e.name}`);
  }
});

test('モノ消しゴム3件は「その他」（18カテゴリに受け皿がないため）', () => {
  const monoes = stationery.filter((e) => e.series === 'モノ');
  assert.equal(monoes.length, 3);
  for (const e of monoes) {
    assert.equal(e.category, 'other', `${e.jan} ${e.name}`);
    assert.equal(e.maker, 'トンボ', `${e.jan} のメーカー表記が「トンボ」でない`);
  }
  const e = lookupJAN('4901991005929');
  assert.equal(e.name, 'モノ 大 白');
  assert.equal(e.size, '大');
});

test('シリーズ名でまとめて引ける（サラサクリップ64 / マイルドライナー22 / ユニボールワン17）', () => {
  const cases = [
    ['サラサクリップ', 64],
    ['マイルドライナー', 22],
    ['ユニボールワン', 17],
  ];
  for (const [word, want] of cases) {
    const inStationery = stationery.filter((e) => `${e.series} ${e.name}`.includes(word));
    assert.equal(inStationery.length, want, `${word} の追加分が ${inStationery.length}件`);
    const { total } = searchDictionary(JAN_DICTIONARY, word, { limit: 0 });
    assert.ok(total >= want, `${word} のヒットが ${total}件`);
  }
});

test('「蛍光ペン」「ボールペン」「消しゴム」でも文具に当たる（keywords に入れてある）', () => {
  const highlight = searchDictionary(JAN_DICTIONARY, '蛍光ペン', { limit: 200 });
  const highlights = stationery.filter((e) => e.category === 'marker' && e.series !== 'マッキーノック太字');
  for (const e of highlights) {
    assert.ok(highlight.items.some((x) => x.jan === e.jan), `${e.jan} ${e.name} が「蛍光ペン」で引けない`);
  }
  const ballpoint = searchDictionary(JAN_DICTIONARY, 'ボールペン', { limit: 0 }).total;
  assert.ok(ballpoint >= 100, `ボールペンのヒットが少ない: ${ballpoint}`);
  for (const jan of ['4901991062960', '4901991005929', '4901991005936']) {
    const hit = searchDictionary(JAN_DICTIONARY, '消しゴム', { limit: 100 }).items.some((e) => e.jan === jan);
    assert.ok(hit, `${jan} が「消しゴム」で引けない`);
  }
});

test('同じ品名の重複を作らない（シリーズ＋色＋サイズで一意）', () => {
  const keys = new Map();
  for (const e of stationery) {
    const key = `${e.name}|${e.size}`;
    assert.equal(keys.has(key), false, `品名が重なる: ${key} (${e.jan} / ${keys.get(key)})`);
    keys.set(key, e.jan);
  }
});
