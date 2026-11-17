/**
 * 画面の小さな整理（v1.26.0）。
 *
 *   1) 右下の「＋」は、いきなり入力シートを開かず「カタログから選ぶ / 自分で入力」の2択を出す
 *   2) ヘッダーの「全○種」は出さない
 *   3) 右上の虫眼鏡と⋯は「在庫」タブのときだけ
 *   4) パンくずのフォルダ名は読みやすい大きさ（15px）にする
 *   5) 在庫カードの「他○か所」は写真の角に小さなピルで乗せ、星・数量の行の高さを揃える
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const app = read('app.js');
const html = read('index.html');
const css = read('styles.css');

/* ---------------- 1) ＋の2択メニュー ---------------- */

test('「＋」は2択メニューを出し、カタログへ移る／入力シートを開くを選べる', () => {
  const sheet = html.slice(html.indexOf('id="sheetAdd"'), html.indexOf('id="sheetMore"'));
  assert.ok(sheet, '追加メニューのシートがありません');
  assert.match(sheet, /role="dialog"/);
  assert.match(sheet, /<div class="menulist">/);
  assert.match(sheet, /<button type="button" class="menubtn" id="btnAddCatalog">カタログから選ぶ<\/button>/);
  assert.match(sheet, /<button type="button" class="menubtn" id="btnAddManual">自分で入力<\/button>/);
  // 閉じるボタンと背景タップ（#mask）で閉じられる
  assert.match(sheet, /data-close="sheetAdd"/);
  const mask = app.slice(app.indexOf("$('mask').addEventListener('click'"));
  assert.match(mask, /\[\.\.\.openSheets\]\.forEach\(closeSheet\)/);
  // 余計な説明文・絵文字は入れない（ボタンの2行だけ）
  assert.equal(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(sheet), false, '追加メニューに絵文字がある');
  assert.equal((sheet.match(/<button/g) || []).length, 3, 'ボタンは 閉じる・2択 の3つだけ');

  // 押したときの動き
  assert.match(app, /\$\('btnAdd'\)\.addEventListener\('click', \(\) => openSheet\('sheetAdd'\)\);/);
  assert.equal(/btnAdd'\)\.addEventListener\('click', \(\) => openItemSheet/.test(app), false, '＋が直接シートを開いている');
  assert.match(app, /\$\('btnAddCatalog'\)\.addEventListener\('click', \(\) => \{[\s\S]{0,120}closeSheet\('sheetAdd'\);[\s\S]{0,80}selectTab\('catalog'\);/);
  assert.match(app, /\$\('btnAddManual'\)\.addEventListener\('click', \(\) => \{[\s\S]{0,120}closeSheet\('sheetAdd'\);[\s\S]{0,80}openItemSheet\(null\);/);
  // タブ切り替えは1か所（下タブも同じ処理を通る）
  assert.match(app, /function selectTab\(tab\) \{/);
  assert.match(app, /\$\('tabbar'\)\.addEventListener\('click', \(e\) => \{[\s\S]{0,200}selectTab\(b\.dataset\.tab\);/);
  // カタログへ移るときは検索の開閉も整える
  assert.match(app, /if \(tab !== 'stock'\) \{ exitSelect\(\); ui\.searchOpen = false; ui\.query = ''; \$\('q'\)\.value = ''; \}/);
});

/* ---------------- 2) ヘッダーの種数と、虫眼鏡・⋯の出し分け ---------------- */

test('ヘッダーは「アトリコ」だけで、虫眼鏡と⋯は在庫タブのときだけ出す', () => {
  const header = html.slice(html.indexOf('<header class="app-header">'), html.indexOf('</header>'));
  assert.equal(header.includes('hdrTotal'), false, '「全○種」が残っている');
  assert.match(header, /<h1>アトリコ<\/h1>/);
  assert.match(header, /id="quotaNote"/, '右側の「N / 100点」は残す');
  assert.match(app, /const stockTab = ui\.tab === 'stock';/);
  assert.match(app, /\$\('btnSearch'\)\.hidden = !stockTab;/);
  assert.match(app, /\$\('btnMore'\)\.hidden = !stockTab;/);
  assert.match(css, /\.hbtn\[hidden\]\s*\{[^}]*display:\s*none/);
});

/* ---------------- 3) パンくずの文字 ---------------- */

test('パンくずのフォルダ名は15px（家アイコン17px）で読みやすく押しやすくする', () => {
  const name = /\.crumb \.cbtn\.name\s*\{([^}]*)\}/.exec(css);
  assert.ok(name, 'パンくずの文字のスタイルがありません');
  assert.match(name[1], /font-size:\s*15px/);
  assert.match(name[1], /line-height:\s*1\.4/);
  assert.match(name[1], /padding:\s*2px 0/, '押しやすい高さを確保する');
  assert.match(css, /\.crumb \.cbtn \.ic\s*\{[^}]*width:\s*17px[^}]*height:\s*17px/);
});

/* ---------------- 4) 在庫カードの「他○か所」 ---------------- */

test('「他○か所」は写真枠の角に小さなピルで乗せ、星・数量の行を揃える', () => {
  // 名前の行ではなく、写真枠（.sw）の中に置く
  const tile = app.slice(app.indexOf('function itemTile'), app.indexOf('function itemRow'));
  const sw = tile.slice(tile.indexOf('<span class="sw">'), tile.indexOf('<span class="tname">'));
  assert.ok(sw.includes('class="tother"'), '写真枠の中に「他○か所」がない');
  assert.equal(/<span class="tname">[\s\S]{0,80}tother/.test(tile), false, '名前の下に残っている');
  assert.match(tile, /const otherNote = otherPlaces \? `他\$\{otherPlaces\}か所` : '';/);

  const tother = /\.tile \.tother\s*\{([^}]*)\}/.exec(css);
  assert.ok(tother, '.tother のスタイルがありません');
  assert.match(tother[1], /position:\s*absolute/);
  assert.match(tother[1], /border-radius:\s*999px/, 'ピル（角丸）にする');
  assert.match(tother[1], /background:\s*rgba\(16, 24, 36, \.62\)/, '半透明の下地で写真の上でも読める');
  assert.match(tother[1], /pointer-events:\s*none/, 'タップは下のカードに通す');

  // 名前が1行でも2行分の高さを取り、足（星・数量）は下端に揃える
  const tname = /\.tile \.tname\s*\{([^}]*)\}/.exec(css);
  assert.match(tname[1], /min-height:\s*2\.5em/);
  assert.match(css, /\.tilefoot\s*\{[^}]*margin-top:\s*auto/);
  assert.match(css, /\.tilewrap > \.swipe-inner\s*\{[^}]*height:\s*100%/);
});
