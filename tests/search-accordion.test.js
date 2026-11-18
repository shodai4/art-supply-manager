/**
 * 検索タブのメーカー見出し（開け閉め）と、メーカー名の五十音順。
 *
 *   1) メーカー名はカタカナ・ひらがなを混ぜても「あいうえお順」に並ぶ（に→へ/ぺ など）
 *   2) 検索タブの見出しはヒットした全メーカー分（50件で打ち切らない）
 *   3) 検索文字もメーカー選択も無いときは、全部閉じた状態で見出しだけ並べる
 *   4) 検索文字を入れた／メーカーを選んだときは、該当メーカーを自動で開く（手で閉じたものは閉じたまま）
 *   5) 開いたメーカーは50件ずつ描き、残りは「もっと見る」で足せる（1社に何千件あっても重くならない）
 *   6) 自動展開が何十社に広がるときは行数に上限を置く（画面が重くならない）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  makerSortKey, compareMakerName, groupDictionarySearch, planDictGroups, groupDictionaryByMaker,
  listMakers, sortItems, DICT_MAKER_PAGE, DICT_AUTO_OPEN_ROWS,
} from '../core.js';
import { JAN_DICTIONARY } from '../jan-database.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const HAY = null; // 初回だけ作る（数万件の正規化をテストごとに繰り返さない）

const dict = (maker, name = 'テスト') => ({ jan: '1', name, maker, category: 'oil' });

test('五十音順: カタカナとひらがなが分断されず、あいうえお順に並ぶ', () => {
  const names = ['ぺんてる', 'ニチバン', 'ホルベイン', 'あかしや', 'アクリサンデー', 'こどものかお', 'コクヨ', 'メーカー不明'];
  assert.deepEqual(
    [...names].sort(compareMakerName),
    ['あかしや', 'アクリサンデー', 'コクヨ', 'こどものかお', 'ニチバン', 'ぺんてる', 'ホルベイン', 'メーカー不明'],
  );
  // 同じメーカーでも、ひらがな・カタカナ・半角カナで並ぶ位置が変わらない
  const base = [...names].sort(compareMakerName);
  const at = base.indexOf('ホルベイン');
  for (const alias of ['ホルベイン', 'ほるべいん', 'ﾎﾙﾍﾞｲﾝ']) {
    const others = names.filter((n) => n !== 'ホルベイン');
    assert.equal([...others, alias].sort(compareMakerName).indexOf(alias), at, `${alias} の並ぶ位置が違う`);
  }
  // 「に」は「へ／ぺ」より前（ニチバン → ぺんてる → ホルベイン）
  assert.deepEqual(['ホルベイン', 'ぺんてる', 'ニチバン'].sort(compareMakerName), ['ニチバン', 'ぺんてる', 'ホルベイン']);
});

test('五十音順のキー: 濁点・半濁点・小書き・長音・全角半角・大文字小文字をならす', () => {
  assert.equal(makerSortKey('ホルベイン'), 'ほるへいん'); // 濁点を落として同じ場所に並べる
  assert.equal(makerSortKey('ほるべいん'), 'ほるへいん');
  assert.equal(makerSortKey('ﾎﾙﾍﾞｲﾝ'), 'ほるへいん'); // 半角カナ
  assert.equal(makerSortKey('ペンテル'), makerSortKey('ぺんてる')); // カタカナ＝ひらがな
  assert.equal(makerSortKey('が'), 'か');
  assert.equal(makerSortKey('ぱ'), 'は');
  assert.equal(makerSortKey('ヴィック'), 'ういつく'); // ヴ＝う
  assert.equal(makerSortKey('カー'), 'かあ'); // 長音は直前の母音
  assert.equal(makerSortKey('キー'), 'きい');
  assert.equal(makerSortKey('コピック'), makerSortKey('こぴつく')); // 小書きのっ＝つ
  assert.equal(makerSortKey('ＨＯＬＢＥＩＮ'), 'holbein'); // 全角英字・大文字
  assert.equal(makerSortKey('  あかしや '), 'あかしや');
  assert.equal(makerSortKey(null), '');
  // 並びが同じときも毎回同じ順（はしごが入れ替わらない）
  assert.deepEqual(['は', 'ば', 'ぱ'].sort(compareMakerName), ['は', 'ば', 'ぱ']);
  assert.deepEqual(['ぱ', 'ば', 'は'].sort(compareMakerName), ['は', 'ば', 'ぱ']);
});

test('メーカータブ（在庫の一覧）の見出しも五十音順になる', () => {
  const items = [dict('ぺんてる'), dict('ニチバン'), dict('あかしや'), dict('ホルベイン')];
  assert.deepEqual(listMakers(items), ['あかしや', 'ニチバン', 'ぺんてる', 'ホルベイン']);
  assert.deepEqual(sortItems(items, 'maker').map((i) => i.maker), ['あかしや', 'ニチバン', 'ぺんてる', 'ホルベイン']);
  assert.deepEqual(groupDictionaryByMaker([dict('ぺんてる'), dict('ニチバン'), dict('あかしや')]).map((g) => g.maker),
    ['あかしや', 'ニチバン', 'ぺんてる']);
});

test('検索タブ: ヒットした全メーカーの見出しを返す（50件で打ち切らない）', () => {
  const { groups, total } = groupDictionarySearch(JAN_DICTIONARY, '');
  assert.equal(total, JAN_DICTIONARY.length);
  assert.ok(groups.length > 100, `メーカーが少なすぎる: ${groups.length}`);
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), total); // 取りこぼさない
  // 50件を超えるメーカーも、件数は全件で数えている
  assert.ok(groups.some((g) => g.items.length > 200));
  // 見出しは五十音順（カタカナ・ひらがなが混ざっても）
  assert.deepEqual(groups.map((g) => g.maker), [...groups.map((g) => g.maker)].sort(compareMakerName));
  // 検索語で絞っても、同じ条件の searchDictionary と同じ件数
  const hit = groupDictionarySearch(JAN_DICTIONARY, 'ぺんてる');
  assert.equal(hit.total, 532);
  assert.deepEqual(hit.groups.map((g) => g.maker), ['ぺんてる']);
  assert.equal(hit.groups[0].items.length, 532);
  // メーカー選択でも同じ（1社ぶんの見出し）
  const one = groupDictionarySearch(JAN_DICTIONARY, '', { maker: 'ニチバン' });
  assert.deepEqual(one.groups.map((g) => g.maker), ['ニチバン']);
});

test('開閉の計画: 空の検索では全部閉じて見出しだけ、検索やメーカー選択では開く', () => {
  const groups = [
    { maker: 'あかしや', items: Array.from({ length: 120 }, (_, i) => ({ jan: `a${i}` })) },
    { maker: 'ニチバン', items: Array.from({ length: 3 }, (_, i) => ({ jan: `n${i}` })) },
  ];
  // 検索文字もメーカー選択も無い → 全メーカーを閉じた状態（中の行は1行も描かない）
  const closed = planDictGroups(groups, {});
  assert.deepEqual(closed.map((p) => p.open), [false, false]);
  assert.deepEqual(closed.map((p) => p.shown.length), [0, 0]);
  assert.deepEqual(closed.map((p) => p.rest), [120, 3]); // 件数は見出しに出す

  // 検索文字を入れた → 該当メーカーを自動で開く（50件まで＋残りは「もっと見る」）
  const searched = planDictGroups(groups, { query: 'あ' });
  assert.equal(searched[0].open, true);
  assert.equal(searched[0].shown.length, DICT_MAKER_PAGE);
  assert.equal(searched[0].rest, 120 - DICT_MAKER_PAGE);

  // メーカーを選んだ → そのメーカーを開く
  const picked = planDictGroups([groups[1]], { maker: 'ニチバン' });
  assert.equal(picked[0].open, true);
  assert.equal(picked[0].shown.length, 3);
  assert.equal(picked[0].rest, 0);

  // 自動展開でも、手で閉じたメーカーは閉じたまま
  const hand = planDictGroups(groups, { query: 'あ', closed: new Set(['あかしや']) });
  assert.equal(hand[0].open, false);
  // 「もっと見る」を押したあとでも、手で閉じたら閉じたまま
  const handMore = planDictGroups(groups, { query: 'あ', closed: new Set(['あかしや']), more: new Map([['あかしや', 100]]) });
  assert.equal(handMore[0].open, false);
  // 空の検索でも、手で開いたメーカーは開く
  const opened = planDictGroups(groups, { open: new Set(['あかしや']) });
  assert.equal(opened[0].open, true);
  assert.equal(opened[0].shown.length, DICT_MAKER_PAGE);
  // 空の配列・欠けた項目でも落ちない
  assert.deepEqual(planDictGroups([]), []);
  assert.equal(planDictGroups([{ maker: 'x' }])[0].total, 0);
});

test('「もっと見る」: 1社に何千件あっても50件ずつ足していける', () => {
  const groups = [{ maker: 'ホルベイン', items: Array.from({ length: 4700 }, (_, i) => ({ jan: `h${i}` })) }];
  const first = planDictGroups(groups, { maker: 'ホルベイン' });
  assert.equal(first[0].shown.length, 50);
  assert.equal(first[0].rest, 4650);
  const more = planDictGroups(groups, { maker: 'ホルベイン', more: new Map([['ホルベイン', 150]]) });
  assert.equal(more[0].shown.length, 200);
  assert.equal(more[0].rest, 4500);
  // 最後まで開くと残りは0（ボタンを出さない）
  const all = planDictGroups(groups, { maker: 'ホルベイン', more: new Map([['ホルベイン', 99999]]) });
  assert.equal(all[0].shown.length, 4700);
  assert.equal(all[0].rest, 0);
});

test('自動展開が何十社に広がるときは行数に上限を置く（重くならない）', () => {
  const groups = Array.from({ length: 40 }, (_, m) => ({
    maker: `メーカー${m}`, items: Array.from({ length: 100 }, (_, i) => ({ jan: `${m}-${i}` })),
  }));
  const plan = planDictGroups(groups, { query: 'あ' });
  const rows = plan.reduce((n, p) => n + p.shown.length, 0);
  assert.equal(rows, DICT_AUTO_OPEN_ROWS);
  assert.ok(plan.some((p) => !p.open), '上限を超えたメーカーは閉じた見出しにする');
  assert.ok(plan.filter((p) => p.open).every((p) => p.total > 0));
  // 手で開いたメーカーは上限に関係なく開く
  const tapped = planDictGroups(groups, { query: 'あ', open: new Set(['メーカー39']) });
  assert.equal(tapped[39].open, true);
  assert.equal(tapped[39].shown.length, DICT_MAKER_PAGE);
});

test('画面: 見出しをタップで開け閉めし、条件が変わったら開閉の記憶を捨てる', () => {
  const app = read('app.js');
  // 見出しのタップで開閉（aria-expanded を見て切り替える）。見出しは全画面共通の data-g-maker
  assert.match(app, /const head = e\.target\.closest\('\[data-g-maker\]'\);/);
  // いまの開閉（aria-expanded）を見て、次の状態を決める
  assert.match(app, /const isSeries = head\.hasAttribute\('data-g-series'\);/);
  // 開け閉めは全画面共通の1つの仕組み（カタログも同じ。面ごとに状態を覚える）
  assert.match(app, /toggleGroupOpen\(surface, isSeries \? 'series' : 'maker', maker, name\);/);
  assert.match(app, /if \(surface === 'catalog'\) \{ renderSearchTab\(\); return; \}/);
  // シリーズの「もっと見る」で50件ずつ足す
  assert.match(app, /const smore = e\.target\.closest\('\[data-dict-smore\]'\);/);
  assert.match(app, /dictMoreSeries\.set\(key, \(dictMoreSeries\.get\(key\) \|\| 0\) \+ DICT_MAKER_PAGE\);/);
  // 検索条件が変わったら、手で開け閉めした状態は捨てて自動展開し直す
  assert.match(app, /const scope = `\$\{dictTabQuery\}\\u0000\$\{dictTabMaker\}\\u0000\$\{dictTabCategory\}\\u0000\$\{dictTabSeries\}`;/);
  assert.match(app, /if \(scope !== dictOpenScope\) \{\s*dictOpenScope = scope;\s*dictGroupState\.reset\(\);/);
  // メーカーのプルダウンも五十音順
  assert.match(app, /\.sort\(\(a, b\) => compareMakerName\(a\[0\], b\[0\]\)\)/);
  // 中身を描くのは開いているメーカーだけ（閉じている見出しは DOM に行を置かない）
  assert.equal(/groupDictionaryByMaker\(hit\)/.test(app), false, '古い描き方が残っている');
});
