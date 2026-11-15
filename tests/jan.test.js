import test from 'node:test';
import assert from 'node:assert/strict';
import { JAN_DICTIONARY, JAN_PREFIXES, VERIFIED_AT } from '../jan-database.js';
import { isValidJAN, detectMaker, CATEGORIES } from '../core.js';

test('辞書は十分な件数を持ち、各項目が13桁JANとして妥当', () => {
  assert.ok(JAN_DICTIONARY.length >= 2000, `収録件数: ${JAN_DICTIONARY.length}`);
  for (const e of JAN_DICTIONARY) {
    assert.match(e.jan, /^\d{13}$/, `${e.jan} ${e.name}`);
    assert.ok(isValidJAN(e.jan), `チェックディジット不正: ${e.jan} ${e.name}`);
  }
});

test('JANはJAN/EAN-13（日本の45/49と海外、UPC-A由来の0始まり）', () => {
  for (const e of JAN_DICTIONARY) {
    assert.equal(/^2/.test(e.jan), false, `店舗内コード: ${e.jan} ${e.name}`);
  }
  const jp = JAN_DICTIONARY.filter((e) => /^(45|49)/.test(e.jan));
  assert.ok(jp.length / JAN_DICTIONARY.length > 0.85, `国コード45/49の比率: ${jp.length}/${JAN_DICTIONARY.length}`);
});

test('JANの重複がない', () => {
  const seen = new Set();
  for (const e of JAN_DICTIONARY) {
    assert.equal(seen.has(e.jan), false, `重複JAN: ${e.jan}`);
    seen.add(e.jan);
  }
});

test('必須項目と出典URLが揃っている', () => {
  for (const e of JAN_DICTIONARY) {
    assert.ok(e.name && e.name.length > 1, `商品名なし: ${e.jan}`);
    assert.ok(e.maker, `メーカーなし: ${e.jan}`);
    assert.ok(CATEGORIES.some((c) => c.id === e.category), `カテゴリ不正: ${e.jan} ${e.category}`);
    assert.match(e.source, /^https:\/\//, `出典URLなし: ${e.jan}`);
    assert.equal(e.verifiedAt, VERIFIED_AT);
  }
});

test('辞書のメーカーがプレフィックス登録メーカーに含まれる', () => {
  for (const e of JAN_DICTIONARY) {
    const d = detectMaker(e.jan);
    assert.ok(d, `プレフィックス未登録: ${e.jan} (${e.maker})`);
    const p = JAN_PREFIXES.find((x) => x.prefix === d.prefix);
    assert.ok(p.makers.includes(e.maker), `${e.jan} のメーカー ${e.maker} がプレフィックス ${p.prefix} の登録にない`);
  }
  assert.ok(JAN_PREFIXES.every((p) => /^\d{4,8}$/.test(p.prefix)));
});

test('絵文字を含まない（表示方針）', () => {
  const re = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  for (const e of JAN_DICTIONARY) {
    assert.equal(re.test(`${e.name}${e.colorName}${e.maker}${e.size}`), false, `絵文字入り: ${e.jan}`);
  }
});

test('代表的な実在JANが引ける', () => {
  const silver = JAN_DICTIONARY.find((e) => e.code === 'H191');
  assert.equal(silver.jan, '4900669001911');
  assert.equal(silver.colorName, 'シルバー');
  assert.equal(detectMaker('4900669001911').maker, 'ホルベイン');

  const kusakabe = JAN_DICTIONARY.find((e) => e.jan === '4933317202613');
  assert.equal(kusakabe.maker, 'クサカベ');
  assert.equal(kusakabe.category, 'oil');
  assert.equal(kusakabe.colorName, 'アイボリーブラック');

  const staedtler = JAN_DICTIONARY.find((e) => e.jan === '4007817131480');
  assert.equal(staedtler.maker, 'ステッドラー');
  assert.match(staedtler.source, /staedtler\.jp/);
});

test('油絵具・水彩・アクリルの主要メーカーが揃っている', () => {
  const makers = new Set(JAN_DICTIONARY.map((e) => e.maker));
  for (const m of ['ホルベイン', 'クサカベ', 'ターレンス', 'サクラクレパス', '名村大成堂', '文房堂']) {
    assert.ok(makers.has(m), `メーカー欠落: ${m}`);
  }
  const cats = new Set(JAN_DICTIONARY.map((e) => e.category));
  for (const c of ['oil', 'watercolor', 'acrylic', 'medium', 'brush', 'paper']) {
    assert.ok(cats.has(c), `カテゴリ欠落: ${c}`);
  }
});
