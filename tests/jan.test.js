import test from 'node:test';
import assert from 'node:assert/strict';
import { JAN_DICTIONARY, JAN_PREFIXES, VERIFIED_AT } from '../jan-database.js';
import { isValidJAN, detectMaker, CATEGORIES } from '../core.js';

test('辞書は十分な件数を持ち、各項目が13桁JANとして妥当', () => {
  assert.ok(JAN_DICTIONARY.length >= 34000, `収録件数: ${JAN_DICTIONARY.length}`);
  for (const e of JAN_DICTIONARY) {
    assert.match(e.jan, /^\d{13}$/, `${e.jan} ${e.name}`);
    assert.ok(isValidJAN(e.jan), `チェックディジット不正: ${e.jan} ${e.name}`);
    assert.notEqual(e.jan, '0000000000000', `JAN未設定のプレースホルダー: ${e.name}`);
  }
});

test('JANはJAN/EAN-13（日本の45/49と海外、UPC-A由来の0始まり）', () => {
  for (const e of JAN_DICTIONARY) {
    assert.equal(/^2/.test(e.jan), false, `店舗内コード: ${e.jan} ${e.name}`);
  }
  const jp = JAN_DICTIONARY.filter((e) => /^(45|49)/.test(e.jan));
  // 輸入画材（シュミンケ・セヌリエ・マイメリ・W&N・リキテックス等）は欧州EAN-13のため、
  // 45/49の比率は過半ではなく「日本国内コードが最大勢力であること」を下限として固定する
  assert.ok(jp.length / JAN_DICTIONARY.length > 0.4, `国コード45/49の比率: ${jp.length}/${JAN_DICTIONARY.length}`);
  const overseas = JAN_DICTIONARY.filter((e) => /^[3-8]/.test(e.jan));
  assert.ok(overseas.length > 1000, `海外EAN-13の件数: ${overseas.length}`);
  for (const e of overseas) {
    assert.match(e.jan, /^\d{13}$/);
    assert.ok(isValidJAN(e.jan), `チェックディジット不正: ${e.jan} ${e.name}`);
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
    assert.ok(CATEGORIES.some((c) => c.id === e.category), `カテゴリ不正: ${e.jan} ${e.category}`);
    assert.match(e.source, /^https:\/\//, `出典URLなし: ${e.jan}`);
    assert.equal(e.verifiedAt, VERIFIED_AT);
  }
});

test('出典は実在ページ（まつえだ・世界堂・ステッドラー公式・たのめーる）に限られ、商品名に実体参照が残らない', () => {
  for (const e of JAN_DICTIONARY) {
    assert.match(e.source, /^https:\/\/(www\.matueda\.com\/\?pid=\d+|webshop\.sekaido\.co\.jp\/product\/[A-Z0-9]+|www\.staedtler\.jp\/|www\.askul\.co\.jp\/|www\.tanomail\.com\/product\/\d+\/)/, `出典が不正: ${e.jan} ${e.source}`);
    assert.equal(/&(amp|lt|gt|quot|#\d+);/.test(e.name), false, `実体参照が残る: ${e.jan} ${e.name}`);
    assert.equal(/^[★☆※]/.test(e.name), false, `販売店の装飾が残る: ${e.jan} ${e.name}`);
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

  // 世界堂オンラインショップ由来（2026-11-15に追加）
  const sekaido = JAN_DICTIONARY.find((e) => e.jan === '4511338058503');
  assert.equal(sekaido.maker, 'コピック');
  assert.match(sekaido.source, /^https:\/\/webshop\.sekaido\.co\.jp\/product\/[A-Z0-9]+$/);
  assert.match(sekaido.name, /コピックインク/);

  const pigma = JAN_DICTIONARY.find((e) => e.jan === '4901881812965');
  assert.equal(pigma.maker, 'サクラクレパス');
  assert.match(pigma.name, /ピグマ/);
});

test('一般文具（ノート・筆記具・ファイル・カッター）の実在JANが辞書で引ける', () => {
  const campus = JAN_DICTIONARY.find((e) => e.jan === '4901480070001');
  assert.equal(campus.maker, 'コクヨ');
  assert.equal(campus.category, 'paper');
  assert.match(campus.name, /キャンパスノート/);
  assert.match(campus.source, /^https:\/\/www\.tanomail\.com\/product\/\d+\/$/);

  const jetstream = JAN_DICTIONARY.find((e) => e.jan === '4902778040744');
  assert.equal(jetstream.maker, '三菱鉛筆');
  assert.match(jetstream.name, /ジェットストリーム/);

  const kingjim = JAN_DICTIONARY.find((e) => e.jan === '4971660002054');
  assert.equal(kingjim.maker, 'キングジム');

  const olfa = JAN_DICTIONARY.find((e) => e.jan === '4901165100467');
  assert.equal(olfa.maker, 'オルファ');
});

test('文具メーカーの収録件数が実用レベルにある', () => {
  const count = (m) => JAN_DICTIONARY.filter((e) => e.maker === m).length;
  assert.ok(count('コクヨ') >= 1000, `コクヨ ${count('コクヨ')}`);
  assert.ok(count('キングジム') >= 50, `キングジム ${count('キングジム')}`);
  assert.ok(count('オルファ') >= 100, `オルファ ${count('オルファ')}`);
  assert.ok(count('プラス') >= 50, `プラス ${count('プラス')}`);
  assert.ok(count('パイロット') >= 300, `パイロット ${count('パイロット')}`);
  assert.ok(count('ゼブラ') >= 150, `ゼブラ ${count('ゼブラ')}`);
  assert.ok(count('三菱鉛筆') >= 400, `三菱鉛筆 ${count('三菱鉛筆')}`);
  assert.ok(count('トンボ') >= 250, `トンボ ${count('トンボ')}`);
});

test('主要メーカーの収録件数が実用レベルにある', () => {
  const count = (m) => JAN_DICTIONARY.filter((e) => e.maker === m).length;
  assert.ok(count('コピック') >= 900, `コピック ${count('コピック')}`);
  assert.ok(count('ホルベイン') >= 3000, `ホルベイン ${count('ホルベイン')}`);
  assert.ok(count('サクラクレパス') >= 400, `サクラクレパス ${count('サクラクレパス')}`);
  assert.ok(count('ターナー') >= 600, `ターナー ${count('ターナー')}`);
  assert.ok(count('リキテックス') >= 600, `リキテックス ${count('リキテックス')}`);
  assert.ok(count('マツダ') >= 500, `マツダ ${count('マツダ')}`);
});

test('油絵具・水彩・アクリルの主要メーカーが揃っている', () => {
  const makers = new Set(JAN_DICTIONARY.map((e) => e.maker));
  for (const m of ['ホルベイン', 'クサカベ', 'ターレンス', 'サクラクレパス', '名村大成堂', '文房堂',
    'コピック', 'リキテックス', 'ウィンザー＆ニュートン', 'マツダ', 'ターナー', 'マルマン',
    'デリーター', 'ミューズ', 'クレサン', '三菱鉛筆', 'ぺんてる', 'トンボ']) {
    assert.ok(makers.has(m), `メーカー欠落: ${m}`);
  }
  const cats = new Set(JAN_DICTIONARY.map((e) => e.category));
  for (const c of ['oil', 'watercolor', 'acrylic', 'medium', 'brush', 'paper']) {
    assert.ok(cats.has(c), `カテゴリ欠落: ${c}`);
  }
});
