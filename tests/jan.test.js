import test from 'node:test';
import assert from 'node:assert/strict';
import { JAN_DICTIONARY, JAN_PREFIXES, VERIFIED_AT } from '../jan-database.js';
import { isValidJAN, detectMaker, CATEGORIES } from '../core.js';

test('辞書は空でなく、各項目が13桁JANとして妥当', () => {
  assert.ok(JAN_DICTIONARY.length >= 30, `収録件数: ${JAN_DICTIONARY.length}`);
  for (const e of JAN_DICTIONARY) {
    assert.match(e.jan, /^\d{13}$/, `${e.name}`);
    assert.ok(isValidJAN(e.jan), `チェックディジット不正: ${e.jan} ${e.name}`);
    assert.ok(/^49|^45/.test(e.jan), `日本のJANでない: ${e.jan}`);
  }
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
    assert.ok(CATEGORIES.some((c) => c.id === e.category), `カテゴリ不正: ${e.jan}`);
    assert.match(e.source, /^https:\/\//, `出典URLなし: ${e.jan}`);
    assert.equal(e.verifiedAt, VERIFIED_AT);
  }
});

test('辞書のメーカーとプレフィックス判別が矛盾しない', () => {
  for (const e of JAN_DICTIONARY) {
    const d = detectMaker(e.jan);
    assert.ok(d, `プレフィックス未登録: ${e.jan} (${e.maker})`);
    assert.equal(d.maker, e.maker, `${e.jan} の判別結果が辞書と不一致`);
  }
  assert.ok(JAN_PREFIXES.every((p) => /^\d{4,8}$/.test(p.prefix)));
});

test('代表的な実在JANが引ける', () => {
  const silver = JAN_DICTIONARY.find((e) => e.code === 'H191');
  assert.equal(silver.jan, '4900669001911');
  assert.equal(silver.colorName, 'シルバー');
  assert.equal(detectMaker('4900669001911').maker, 'ホルベイン');
});
