/**
 * 仕上げの文言まわり。
 *
 *   1) プラン表示の特典は「上限なし / 画材費とCSV / 広告なし」。
 *      未実装の「iCloudバックアップ」は並べない（審査で指摘されるため）
 *   2) 設定の辞書カードは「対応画材数：37,648件」（カンマ付きの動的件数）
 *   3) 設定下部の注記は、Amazonアソシエイトの1文の後ろに楽天・Yahoo!等のPRを続ける
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRO_BENEFITS, PRO_FEATURES, isPro, canUseFeature } from '../pro.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

/* ---------------- 1) Pro の特典 ---------------- */

test('プランの特典は「上限なし / 画材費とCSV / 広告なし」の3つ', () => {
  assert.deepEqual(PRO_BENEFITS.map((b) => b.id), ['limit', 'cost', 'noads']);
  assert.deepEqual(PRO_BENEFITS.map((b) => b.label), ['上限なし', '画材費とCSV', '広告なし']);
  assert.deepEqual(PRO_FEATURES, ['cost', 'noads']);
  // 画面のチップは3つ（ラベルは12文字以内）
  assert.equal(PRO_BENEFITS.length, 3);
  for (const b of PRO_BENEFITS) assert.ok(b.label.length <= 12, b.label);
  // 広告なしは「Proだけ」の機能として扱う（無料では広告が出る）
  assert.equal(canUseFeature({}, 'noads'), false);
  assert.equal(canUseFeature({ pro: true }, 'noads'), true);
  assert.equal(isPro({ pro: true }), true);
});

test('未実装の「iCloudバックアップ」は、画面・規約・説明から消えている', () => {
  // 利用者に見える場所と Pro の実装からは消す（設計書では「これからの設計」としてだけ触れてよい）
  for (const file of ['pro.js', 'app.js', 'iap.js', 'index.html', 'README.md', 'terms.html', 'privacy.html', 'support.html']) {
    const text = read(file);
    assert.equal(/iCloud/i.test(text), false, `${file} に iCloud の記載が残っている`);
  }
  const plan = read('docs/ios-release-plan.md');
  assert.match(plan, /iCloud[\s\S]{0,80}まだ Pro の特典ではなく/, '設計書が iCloud を Pro の特典として書いている');
  // 画面には「広告なし」が出る（admob.js が Pro の間はバナーを出さない実装と一致）
  const admob = read('admob.js');
  assert.match(admob, /adFree/);
});

/* ---------------- 2) 設定の件数ラベル ---------------- */

test('設定の辞書カードは「対応画材数：◯件」（カンマ付き・動的）', () => {
  const app = read('app.js');
  const html = read('index.html');
  // 件数は合成後の辞書から毎回作る（3桁区切り）
  assert.match(app, /info\.textContent = `対応画材数：\$\{merged\.items\.length\.toLocaleString\('ja-JP'\)\}件\$\{dictSyncing \? '（更新中）' : ''\}`;/);
  // 初期表示（読み込み前）も同じ言い方
  assert.match(html, /<p class="dict-one" id="dictInfo">対応画材数：—<\/p>/);
  // 件数ラベルに「JAN辞書：」は使わない（辞書シートの見出しはそのまま）
  assert.equal(/JAN辞書：/.test(html), false, 'JAN辞書： の件数ラベルが残っている');
  assert.equal(/JAN辞書：/.test(app), false, 'JAN辞書： の件数ラベルが残っている');
  assert.match(html, /<h2 id="dictTitle">JAN辞書/); // 辞書シートの見出しは残す
});

/* ---------------- 3) 設定下部のアフィリエイト注記 ---------------- */

test('設定下部の注記は、Amazonの1文＋楽天・Yahoo!等のPRの1文を同じ行に出す', () => {
  const html = read('index.html');
  const line = html.match(/<p class="micro foot-note">([^<]*)<\/p>/);
  assert.ok(line, 'foot-note の注記がありません');
  assert.equal(line[1], 'Amazonのアソシエイトとして、適格販売により収入を得ています。'
    + 'また、本アプリの一部リンクには楽天・Yahoo!ショッピング等のアフィリエイトリンク（PR）を含みます。');
  // 注記のすぐ下に、法務3ページへのリンクが並ぶ
  const after = html.slice(html.indexOf('foot-note'), html.indexOf('foot-note') + 900);
  for (const file of ['privacy.html', 'terms.html', 'support.html']) {
    assert.ok(after.includes(`href="${file}"`), `${file} のリンクが注記の下にない`);
  }
});
