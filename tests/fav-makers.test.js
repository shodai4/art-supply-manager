/**
 * カタログの「お気に入りメーカー」。
 *
 *   - メーカー見出しの星で登録／解除（設定に保存・重複なし・登録順）
 *   - 一覧とプルダウンは今までどおり全部残す（お気に入りは上部のショートカットだけ）
 *   - 上部は普段1行で閉じ、開くと折り返しで並ぶ（横スクロールにしない）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { favoriteMakers, isMakerFavorite, toggleMakerFavorite } from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('お気に入りメーカーは登録順・重複なしで持つ', () => {
  assert.deepEqual(favoriteMakers({}), []);
  assert.deepEqual(favoriteMakers({ favMakers: ['ホルベイン', ' ', 'ホルベイン', 'ターレンス'] }), ['ホルベイン', 'ターレンス']);
  assert.equal(isMakerFavorite({ favMakers: ['ホルベイン'] }, 'ホルベイン'), true);
  assert.equal(isMakerFavorite({ favMakers: ['ホルベイン'] }, 'ターレンス'), false);
  assert.equal(isMakerFavorite({}, ''), false);
});

test('星で登録／解除でき、元の設定は変えない', () => {
  const settings = { sort: 'updated' };
  const on = toggleMakerFavorite(settings, 'ホルベイン');
  assert.deepEqual(on.favMakers, ['ホルベイン']);
  assert.equal(settings.favMakers, undefined, '元の設定を書き換えている');
  const two = toggleMakerFavorite(on, 'ターレンス');
  assert.deepEqual(two.favMakers, ['ホルベイン', 'ターレンス']);
  const off = toggleMakerFavorite(two, 'ホルベイン');
  assert.deepEqual(off.favMakers, ['ターレンス']);
  // 空の名前は増やさない
  assert.deepEqual(toggleMakerFavorite(two, '').favMakers, ['ホルベイン', 'ターレンス']);
});

test('画面: カタログのメーカー見出しに星があり、上部に折りたたみの1行がある', () => {
  const app = read('app.js');
  const html = read('index.html');
  const css = read('styles.css');
  // 星はカタログの見出しだけ（在庫・補充の一覧は今までどおり）
  assert.match(app, /if \(surface !== 'catalog'\) return head;/);
  assert.match(app, /data-fav-maker="\$\{esc\(maker\)\}"/);
  assert.match(app, /toggleFavoriteMaker\(star\.dataset\.favMaker, star\)/);
  // 上部の折りたたみ（0件のときは行ごと出さない）
  assert.match(html, /id="favMakersToggle" aria-expanded="false" aria-controls="favMakersBody"/);
  assert.match(html, /id="favMakersLabel"/);
  assert.match(html, /id="favMakersBody" hidden/);
  assert.match(app, /box\.hidden = list\.length === 0;/);
  assert.match(app, /\$\('favMakersLabel'\)\.textContent = `お気に入りメーカー（\$\{list\.length\}件）`;/);
  // 折り返しで並べる（横スクロールにしない）
  assert.match(css, /\.favmake-body \{[^}]*flex-wrap: wrap;/);
  // 選ぶとメーカーを切り替える（一覧・プルダウンはそのまま）
  assert.match(app, /dictTabMaker = pick\.dataset\.favmakerPick \|\| '';/);
  assert.match(html, /<select id="dictMakerSel" aria-label="メーカーで絞る"><\/select>/);
});

test('お気に入りメーカーの星は、メーカー見出しの開閉を巻き込まない', () => {
  const app = read('app.js');
  // 星は見出しボタンの中ではなく、同じ行の別ボタン（button の入れ子にしない）
  const head = app.slice(app.indexOf('function makerHeadHtml'), app.indexOf('function seriesHeadHtml'));
  assert.match(head, /<div class="mgrow">\$\{head\}<button type="button" class="mgstar/);
  // 星のクリックは開閉の処理より先に受けて、伝播を止める
  const starHandler = app.slice(app.indexOf("const star = e.target.closest('[data-fav-maker]')"), app.indexOf("const pick = e.target.closest('[data-favmaker-pick]')"));
  assert.match(starHandler, /e\.stopPropagation\(\);/);
});
