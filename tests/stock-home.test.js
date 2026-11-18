// 下部タブの「在庫」をもう一度押したら、在庫タブの初期画面（フォルダ一覧のトップ）へ戻る
// （2026-11-19 の追加依頼）。フォルダの中・検索中・絞り込み中・選択中からでも戻る。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STOCK_HOME_FOLDER, needsStockHome } from '../core.js';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

/** 初期画面そのもの */
const HOME = {
  tab: 'stock', stockMode: 'place', folderId: 'all', query: '', searchOpen: false,
  category: 'all', status: 'all', maker: 'all', favoriteOnly: false,
  selectMode: false, selected: [],
};

test('初期画面のときは「戻すもの」が無い（描き直さない）', () => {
  assert.equal(STOCK_HOME_FOLDER, 'all', 'トップのIDが変わっている');
  assert.equal(needsStockHome(HOME), false);
  // tab は見ない（在庫タブの話なので）
  assert.equal(needsStockHome({ ...HOME, tab: 'catalog' }), false);
});

test('フォルダの中・検索・絞り込み・選択・メーカーごとの並びは「戻すもの」がある', () => {
  assert.equal(needsStockHome({ ...HOME, folderId: 'home' }), true, 'フォルダの中');
  assert.equal(needsStockHome({ ...HOME, folderId: 'all-items' }), true, 'すべての画材');
  assert.equal(needsStockHome({ ...HOME, query: 'ウルトラマリン' }), true, '検索語');
  assert.equal(needsStockHome({ ...HOME, searchOpen: true }), true, '検索バーを開いている');
  assert.equal(needsStockHome({ ...HOME, selectMode: true }), true, '選択モード');
  assert.equal(needsStockHome({ ...HOME, selected: ['i1', 'i2'] }), true, '選択中');
  assert.equal(needsStockHome({ ...HOME, favoriteOnly: true }), true, 'お気に入りだけ');
  assert.equal(needsStockHome({ ...HOME, category: 'oil' }), true, 'カテゴリの絞り込み');
  assert.equal(needsStockHome({ ...HOME, status: 'empty' }), true, '在庫状態の絞り込み');
  assert.equal(needsStockHome({ ...HOME, maker: 'ホルベイン' }), true, 'メーカーの絞り込み');
  assert.equal(needsStockHome({ ...HOME, stockMode: 'maker' }), true, 'メーカーごとの並び');
});

test('足りない項目は初期画面と同じとみなす（古い状態でも落ちない）', () => {
  assert.equal(needsStockHome({}), false);
  assert.equal(needsStockHome(null), false);
  assert.equal(needsStockHome({ folderId: 'home' }), true);
});

test('画面: 在庫タブの再タップで初期画面へ戻し、すでに初期画面なら描き直さない', () => {
  // 同じタブの再タップは、在庫だけ「初期画面へ戻す」に回す（ほかのタブは先頭へ戻すだけ）
  assert.match(app, /if \(tab === ui\.tab\) \{\n    if \(tab === 'stock'\) \{ stockHome\(\); return; \}\n    window\.scrollTo\(\{ top: 0 \}\);/);
  assert.match(app, /function stockHome\(\) \{\n  if \(!needsStockHome\(ui\)\) \{/);
  // 戻す中身：トップ・場所ごと・検索を閉じる・絞り込み解除・選択解除・先頭へ
  const body = app.slice(app.indexOf('function stockHome() {'), app.indexOf('// 下タブの切り替え'));
  for (const line of [
    'ui.folderId = STOCK_HOME_FOLDER;',
    "ui.stockMode = 'place';",
    "ui.query = '';",
    "ui.searchOpen = false;",
    'ui.favoriteOnly = false;',
    "ui.category = 'all';",
    "ui.status = 'all';",
    "ui.maker = 'all';",
    'exitSelect();',
    'stopScanner();',
    'render();',
    'window.scrollTo({ top: 0 });',
  ]) {
    assert.ok(body.includes(line), `${line} が無い`);
  }
  // 初期画面で最上部なら、描き直さずに何もしない
  assert.match(body, /if \(\(window\.scrollY \|\| 0\) > 0\) window\.scrollTo\(\{ top: 0 \}\);\n    return false;/);
});
