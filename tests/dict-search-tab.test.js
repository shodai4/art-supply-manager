/**
 * 下タブの「検索」（内蔵JAN辞書のカタログ検索）。
 *
 *   1) 5タブ（在庫・メーカー・補充・検索・設定）の検索タブにある
 *   2) 商品名・メーカー・JANで絞れ、メーカーとカテゴリでも絞れる
 *   3) 3.7万件でも軽い（デバウンス＋メーカー見出しだけを先に描く＋開いた分だけ描く）
 *   4) 結果からそのまま在庫へ追加でき、登録済みのものは分かる
 *   5) 既存の「メーカー」タブ（自分の在庫をメーカー別に見る）はそのまま
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchDictionary, dictionaryHaystack, CATEGORIES, createItem, upsertItem, blankState } from '../core.js';
import { JAN_DICTIONARY } from '../jan-database.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

/** テスト用の小さな辞書（実データと同じ形） */
const DICT = [
  { jan: '4901234567891', name: 'ウルトラマリン', maker: 'ホルベイン', brand: 'HOLBEIN', category: 'oil', colorName: 'ウルトラマリン', size: '20ml', code: 'H001' },
  { jan: '4901234567892', name: 'ウルトラマリン', maker: 'ターレンス', brand: 'TALENS', category: 'watercolor', colorName: 'ウルトラマリン', size: '10ml', code: 'T010' },
  { jan: '4909876543210', name: '平筆 12号', maker: 'ホルベイン', brand: 'HOLBEIN', category: 'brush', colorName: '', size: '12号', code: 'B012' },
];

test('商品名・メーカー・JANで探せる（件数は全件・描画は上限まで）', () => {
  assert.equal(searchDictionary(DICT, '', { limit: 10 }).total, 3);
  assert.deepEqual(searchDictionary(DICT, 'ウルトラ', { limit: 10 }).items.map((d) => d.jan), ['4901234567891', '4901234567892']);
  assert.deepEqual(searchDictionary(DICT, 'ホルベイン', { limit: 10 }).items.map((d) => d.name), ['ウルトラマリン', '平筆 12号']);
  assert.equal(searchDictionary(DICT, '4567891', { limit: 10 }).total, 1, 'JANの一部で探せる');
  // 描画上限を超えても total は全件（件数の表示・メーカー別の集計に使う）
  const limited = searchDictionary(DICT, '', { limit: 1 });
  assert.equal(limited.items.length, 1);
  assert.equal(limited.total, 3);
});

test('メーカーとカテゴリで絞れる（カタログ検索用のオプション）', () => {
  assert.equal(searchDictionary(DICT, '', { limit: 10, maker: 'ホルベイン' }).total, 2);
  assert.equal(searchDictionary(DICT, '', { limit: 10, maker: 'ターレンス' }).total, 1);
  assert.deepEqual(searchDictionary(DICT, '', { limit: 10, maker: 'ホルベイン', category: 'brush' }).items.map((d) => d.code), ['B012']);
  assert.equal(searchDictionary(DICT, 'ウルトラ', { limit: 10, maker: 'ターレンス' }).total, 1);
  assert.equal(searchDictionary(DICT, 'ウルトラ', { limit: 10, maker: 'クサカベ' }).total, 0);
  assert.equal(searchDictionary(DICT, '', { limit: 10, category: 'oil' }).total, 1);
  // hay を渡しても同じ結果（画面はキャッシュした hay を使う）
  const hay = dictionaryHaystack(DICT);
  assert.equal(searchDictionary(DICT, 'ウルトラ', { limit: 10, hay, maker: 'ホルベイン' }).total, 1);
});

test('内蔵辞書のカテゴリは画面のカテゴリ名にすべて対応している（検索タブの絞り込みが欠けない）', () => {
  const ids = new Set(CATEGORIES.map((c) => c.id));
  const missing = new Set();
  for (const d of JAN_DICTIONARY) if (!ids.has(String(d.category || 'other'))) missing.add(d.category);
  assert.deepEqual([...missing], []);
  assert.ok(JAN_DICTIONARY.length >= 37000, `内蔵辞書が少ない: ${JAN_DICTIONARY.length}`);
});

test('画面: 下タブの「検索」に内蔵辞書の検索・メーカー・カテゴリ・結果がある', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');

  for (const id of ['view-search', 'dictQTab', 'dictQTabClear', 'dictMakerSel', 'dictCatSec', 'dictCatChips', 'dictResults', 'dictResCount', 'dictTabNote']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} がありません`);
  }
  // 補充と設定のあいだに「検索」タブ
  const tabs = [...html.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ['stock', 'maker', 'shopping', 'search', 'settings']);
  assert.match(html, /<button data-tab="search" aria-selected="false">検索<\/button>/);

  // 軽さ: デバウンス・（50件などで打ち切らずに）メーカー見出しだけを先に並べ、開いた分だけ描く
  assert.match(app, /const DICT_TAB_DEBOUNCE_MS = 180;/);
  assert.match(app, /clearTimeout\(dictTabTimer\);[\s\S]{0,200}setTimeout\(\(\) => \{ dictTabQuery = value; renderSearchTab\(\); \}, DICT_TAB_DEBOUNCE_MS\)/);
  assert.match(app, /dictGroups = groupDictionarySearch\(mergedDict, dictTabQuery, \{\n\s*hay: dictionaryHaystack\(mergedDict\), maker: dictTabMaker, category: dictTabCategory,/);
  assert.match(app, /\$\('dictResCount'\)\.textContent = `\$\{total\.toLocaleString\('ja-JP'\)\}件`;/);

  // メーカー → そのメーカーのカテゴリ、の順に絞る
  assert.match(app, /function dictCategoryList\(\)[\s\S]{0,400}dictTabMaker/);
  assert.match(app, /\$\('dictCatSec'\)\.hidden = !showCats;/);
  assert.match(app, /data-dict-cat/);

  // 既存のメーカータブ（自分の在庫をメーカー別に）はそのまま
  assert.ok(html.includes('id="view-maker"'), 'メーカータブが消えている');
  assert.match(app, /renderMakerView\(\)/);

  // 375pxでも崩れない（入力は16pxで自動拡大を防ぐ・結果は折り返さず縦に並ぶ）
  assert.match(css, /\.dict-search input \{[^}]*font-size:\s*16px/);
  assert.match(css, /\.dres-main \{[^}]*min-width:\s*0/);
});

test('結果からそのまま在庫へ追加でき、追加済みは「登録済み」になる', () => {
  const app = read('app.js');

  // 無料枠を超えていたらPro案内へ（既存の登録と同じ扱い）
  assert.match(app, /function addDictToStock\(d\) \{[\s\S]{0,400}canAddItem\(state, state\.settings\)\.ok\) \{ openProSheet\('item'\); return; \}/);
  assert.match(app, /function addDictToStock\(d\) \{[\s\S]{0,900}state = upsertItem\(state, item\);/);
  // 辞書の項目（名前・メーカー・カテゴリ・色名・品番・サイズ・JAN）をそのまま登録に使う
  assert.match(app, /function dictPreset\(d\) \{/);
  assert.match(app, /colorCode: d\.code \|\| ''/);
  // 追加ボタンと、登録済みの表示
  assert.match(app, /data-dict-add=/);
  assert.match(app, /<span class="dres-have">登録済み<\/span>/);
  // 商品名をタップすると、その内容で登録フォームが開く
  assert.match(app, /data-dict-pick=/);
  assert.match(app, /openItemSheet\(null, dictPreset\(d\)\)/);
});

test('辞書から追加した画材は、JANで在庫に残る（あとから登録済みと分かる）', () => {
  const d = DICT[2];
  let state = blankState();
  const item = createItem({
    name: d.name, maker: d.maker, brand: d.brand, category: d.category,
    colorName: d.colorName, colorCode: d.code, size: d.size, jan: d.jan,
    folderId: state.folders[0].id, qty: 1,
  });
  state = upsertItem(state, item);
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].jan, '4909876543210');
  assert.equal(state.items[0].category, 'brush');
  assert.equal(state.items[0].colorCode, 'B012');
  assert.equal(new Set(state.items.map((i) => i.jan)).has(d.jan), true);
});
