/**
 * アプリ内で「利用規約」「プライバシー」「サポート」を開けること。
 *
 *   1) 同梱の3ページ（terms/privacy/support）をリンクから見分ける（legalDocKey）
 *   2) iOS（WKWebView）では target="_blank" が開けないので、リンクを横取りして
 *      アプリ内の読み物シート（sheetLegal）に本文を出す
 *   3) 同梱ページを読めないときは、公開している同じページをSafariで開く（逃げ道）
 *   4) シートは見出しと閉じるを固定し、本文だけスクロールする（長くても閉じられる）
 *
 * 設定下部のフッターと、プランカード（Pro）の中の両方に同じリンクがあるので、
 * どちらから押しても同じシートで読めることを、HTML と app.js の両方から確かめる。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGAL_DOCS, legalDocKey } from '../links.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

const NATIVE_BASE = 'capacitor://localhost/index.html';
const WEB_BASE = 'https://shodai4.com/art-supply-manager/index.html';

/* ---------------- 1) リンクの見分け ---------------- */

test('同梱の3ページ（利用規約・プライバシー・サポート）を見分ける', () => {
  assert.deepEqual(LEGAL_DOCS.map((d) => d.key), ['terms', 'privacy', 'support']);
  assert.deepEqual(LEGAL_DOCS.map((d) => d.file), ['terms.html', 'privacy.html', 'support.html']);
  assert.deepEqual(LEGAL_DOCS.map((d) => d.title), ['利用規約', 'プライバシーポリシー', 'サポート']);

  // アプリ内（capacitor://）の相対リンク＝いま問題になっている形
  assert.equal(legalDocKey('terms.html', NATIVE_BASE), 'terms');
  assert.equal(legalDocKey('privacy.html', NATIVE_BASE), 'privacy');
  assert.equal(legalDocKey('support.html', NATIVE_BASE), 'support');
  assert.equal(legalDocKey('./terms.html', NATIVE_BASE), 'terms');
  assert.equal(legalDocKey('capacitor://localhost/privacy.html', NATIVE_BASE), 'privacy');
  // 同じサイトの公開ページ（Web版のURL）も同じ扱い
  assert.equal(legalDocKey('terms.html', WEB_BASE), 'terms');
  assert.equal(legalDocKey('/art-supply-manager/support.html', 'https://shodai4.com/art-supply-manager/'), 'support');
});

test('法務ページでないリンクは拾わない（通常のタップ・外部ブラウザのまま）', () => {
  // 別サイト・別オリジンの同名ページは横取りしない
  assert.equal(legalDocKey('https://example.com/terms.html', NATIVE_BASE), '');
  assert.equal(legalDocKey('https://example.com/terms.html', WEB_BASE), '');
  // アプリの別ページ・アンカー・空
  assert.equal(legalDocKey('index.html', NATIVE_BASE), '');
  assert.equal(legalDocKey('#stock', NATIVE_BASE), '');
  assert.equal(legalDocKey('', NATIVE_BASE), '');
  assert.equal(legalDocKey(null, NATIVE_BASE), '');
  assert.equal(legalDocKey(undefined, NATIVE_BASE), '');
  // 通販・GitHub・メールは法務ページではない
  assert.equal(legalDocKey('https://www.amazon.co.jp/s?k=ホルベイン', NATIVE_BASE), '');
  assert.equal(legalDocKey('https://github.com/shodai4/art-supply-manager/issues/new', NATIVE_BASE), '');
  assert.equal(legalDocKey('mailto:shodai121ueda@gmail.com', NATIVE_BASE), '');
});

/* ---------------- 2) 画面（シート）の用意 ---------------- */

test('読み物シート（sheetLegal）が見出し・本文・閉じるを持つ', () => {
  const html = read('index.html');
  for (const id of ['sheetLegal', 'legalTitle', 'legalBody']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} がありません`);
  }
  const sheet = html.slice(html.indexOf('<div class="sheet legal" id="sheetLegal"'), html.indexOf('id="sheetLegal"') + 900);
  assert.match(sheet, /class="sheet legal"/);
  assert.match(sheet, /aria-labelledby="legalTitle"/);
  // 閉じる手段は2つ（右上の×と、下の「閉じる」ボタン）
  const closes = [...sheet.matchAll(/data-close="sheetLegal"/g)];
  assert.equal(closes.length, 2, `閉じるボタンの数: ${closes.length}`);
  assert.match(sheet, /class="legal-doc" id="legalBody"/);
  // 本文は空で置き、押されたページだけを入れる
  assert.match(sheet, /id="legalBody"><\/div>/);
});

test('設定下部とプランカードの両方に、3ページへのリンクがある', () => {
  const html = read('index.html');
  const app = read('app.js');

  // 設定の最下部（フッター）
  const foot = html.slice(html.indexOf('foot-links'), html.indexOf('foot-links') + 400);
  for (const file of ['privacy.html', 'terms.html', 'support.html']) {
    assert.ok(foot.includes(`href="${file}"`), `フッターに ${file} がありません`);
  }
  assert.match(foot, /target="_blank"/); // Web版はこれまでどおり別タブで開く
  // プランカードの中（renderPlan → renderProOffer）
  assert.match(app, /const links = '<a href="terms\.html" target="_blank" rel="noopener noreferrer">利用規約<\/a> ・ '/);
  assert.match(app, /\+ '<a href="privacy\.html" target="_blank" rel="noopener noreferrer">プライバシー<\/a>';/);
});

/* ---------------- 3) アプリ内での開き方 ---------------- */

test('アプリ内では法務リンクを横取りして、同梱HTMLをシートに出す', () => {
  const app = read('app.js');
  assert.match(app, /import \{ shouldOpenExternally, openInExternalBrowser, legalDocKey, LEGAL_DOCS \} from '\.\/links\.js';/);
  assert.match(app, /async function openLegalDoc\(key\)/);
  // 同梱ページを取りに行き、本文（main）だけを入れる（＝通信が無くても読める）
  assert.match(app, /await fetch\(new URL\(doc\.file, location\.href\)\.href, \{ cache: 'no-store' \}\)/);
  assert.match(app, /new DOMParser\(\)\.parseFromString\(await res\.text\(\), 'text\/html'\)/);
  assert.match(app, /const main = parsed\.querySelector\('main'\) \|\| parsed\.body;/);
  assert.match(app, /\$\('legalBody'\)\.innerHTML = main\.innerHTML;/);
  assert.match(app, /\$\('legalBody'\)\.scrollTop = 0;/);
  // ページ内の「アプリに戻る」は出さない／中のリンクはシートの中で開き直す
  assert.match(app, /main\.querySelectorAll\('a\.back'\)\.forEach\(\(a\) => a\.remove\(\)\)/);
  assert.match(app, /a\.removeAttribute\('target'\)/);
  // 押されたページの見出しを出す
  assert.match(app, /\$\('legalTitle'\)\.firstChild\.textContent = doc\.title;/);

  // ネイティブのリンク横取りで、外部ブラウザ行きより先に法務ページを見る
  const handler = app.slice(app.indexOf("document.addEventListener('click', (e) => {\n  if (!isNativeShell(window)) return;"));
  assert.ok(handler.length > 0, 'ネイティブのリンク横取りがありません');
  assert.match(handler, /const legal = legalDocKey\(href, location\.href\);/);
  const legalAt = handler.indexOf('openLegalDoc(legal)');
  const externalAt = handler.indexOf('shouldOpenExternally(href, { native: true, base: location.href })');
  assert.ok(legalAt > 0 && externalAt > legalAt, '法務ページの判定が外部リンクの判定より後ろにある');
  assert.match(handler, /e\.preventDefault\(\);\n    e\.stopPropagation\(\);\n    openLegalDoc\(legal\);/);
});

test('同梱ページを読めないときは、公開している同じページをSafariで開く', () => {
  const app = read('app.js');
  assert.match(app, /const LEGAL_DOC_HOST = 'https:\/\/shodai4\.com\/art-supply-manager\/';/);
  assert.match(app, /closeSheet\('sheetLegal'\);\n    \/\/ 最後の手段は外部ブラウザ（Safari）。それもだめならURLをコピーする\n    return openExternal\(`\$\{LEGAL_DOC_HOST\}\$\{doc\.file\}`\);/);
});

test('読み物シートは見出しと閉じるを固定し、本文だけスクロールする', () => {
  const css = read('styles.css');
  assert.match(css, /\.sheet\.legal\.open \{ display: flex; flex-direction: column; overflow: hidden; \}/);
  assert.match(css, /\.legal-doc \{ flex: 1 1 auto; min-height: 0; overflow-y: auto;/);
  // 本文の見出し・表・注記は、アプリのテーマ（ライト／ダーク）に合わせる
  for (const rule of ['.legal-doc h1', '.legal-doc h2', '.legal-doc p, .legal-doc li', '.legal-doc .box', '.legal-doc th, .legal-doc td']) {
    assert.ok(css.includes(rule), `${rule} のスタイルがありません`);
  }
  assert.match(css, /\.legal-doc a \{ color: var\(--accent\);/);
  // 同梱ページは自前のCSSを持つので、アプリ側で読みやすさを付け直す（背景色は持ち込まない）
  assert.equal(/\.legal-doc[^{]*\{[^}]*background:\s*var\(--bg\)/.test(css), false);
});
