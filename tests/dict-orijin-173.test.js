/**
 * ベルク名義だった173件をオリジンへ直したことの検証（2026-11-21・v1.43.1）。
 *
 * JAN 4520385 は株式会社オリジンの事業者コード（アルフレームのカタログに
 * 「JANコードは、4520385以下の数字を記載しております」と明記）で、額のまつえだの
 * 商品ページにも「製造メーカー：株式会社オリジン(アルフレーム)」と載っている。
 * 辞書に残っていた「ベルク」名義の173件（笹部158件・まつえだ15件）をオリジンに統一した。
 *
 *   1) 「ベルク」名義のレコードが残っていない
 *   2) プレフィックス 4520385 の登録がオリジン1社になっている
 *   3) 4520385 の全レコード（2,234件）がオリジンになっている
 *   4) 直した173件の代表が、メーカー・カテゴリ・シリーズ・出典つきで引ける
 *
 * を確かめる。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JAN_DICTIONARY, JAN_PREFIXES } from '../jan-database.js';
import { lookupJAN, calcCheckDigit } from '../core.js';

const byJan = new Map(JAN_DICTIONARY.map((d) => [d.jan, d]));
const entry = (jan) => {
  const d = byJan.get(jan);
  assert.ok(d, `辞書に ${jan} がありません`);
  return d;
};
const isValid = (jan) => /^\d{13}$/.test(jan) && calcCheckDigit(jan.slice(0, 12)) === Number(jan[12]);

test('「ベルク」名義のレコードは残っていない', () => {
  const left = JAN_DICTIONARY.filter((d) => d.maker === 'ベルク');
  assert.equal(left.length, 0, `ベルク名義が残っている: ${left.slice(0, 3).map((d) => d.jan).join(' ')}`);
  for (const d of JAN_DICTIONARY) {
    assert.equal(String(d.series || '').startsWith('ベルク'), false, `シリーズにベルクが残る: ${d.jan} ${d.series}`);
  }
});

test('プレフィックス 4520385 はオリジン1社の登録になっている', () => {
  const p = JAN_PREFIXES.find((x) => x.prefix === '4520385');
  assert.ok(p, '4520385 の登録がない');
  assert.equal(p.maker, 'オリジン');
  assert.deepEqual(p.makers, ['オリジン']);
  assert.equal(p.count, JAN_DICTIONARY.filter((d) => d.jan.startsWith('4520385')).length);
});

test('4520385 の全レコードがオリジンになっている', () => {
  const rows = JAN_DICTIONARY.filter((d) => d.jan.startsWith('4520385'));
  assert.equal(rows.length, 2234);
  for (const d of rows) {
    assert.equal(d.maker, 'オリジン', `${d.jan} のメーカーが ${d.maker}`);
    assert.ok(isValid(d.jan), `チェックディジット不正: ${d.jan}`);
  }
});

test('直した173件の代表が、オリジンとして引ける', () => {
  // 笹部（仮縁 C-20 ゴールド F4）
  const c20 = entry('4520385106594');
  assert.equal(c20.maker, 'オリジン');
  assert.equal(c20.name, '仮縁 Fサイズ ゴールド');
  assert.match(c20.source, /^https:\/\/www\.sasabegazai\.co\.jp\/pop\.html\?id=9921005$/);
  assert.equal(lookupJAN('4520385106594')?.maker, 'オリジン');

  // 笹部（BH-03J ゴールド インチ判）
  const bh = entry('4520385100011');
  assert.equal(bh.maker, 'オリジン');
  assert.equal(bh.source, 'https://www.sasabegazai.co.jp/pop.html?id=8800001');

  // まつえだ（ワイヤー吊金具・ディスプレイメイツ）はカテゴリ額縁のまま
  const wire = entry('4520385801000');
  assert.equal(wire.maker, 'オリジン');
  assert.equal(wire.category, 'frame');
  assert.equal(wire.series, 'ワイヤー吊金具');
  assert.match(wire.source, /^https:\/\/www\.matueda\.com\/\?pid=\d+$/);

  // まつえだ（ユニフォーム額）
  const uniform = entry('4520385214541');
  assert.equal(uniform.maker, 'オリジン');
  assert.equal(uniform.series, 'ユニフォーム額');
});
