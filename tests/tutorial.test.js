/**
 * 使い方（チュートリアル）の点検。
 *
 * 見たいこと:
 *   1. 4つのタブ（在庫・補充・カタログ・設定）がアコーディオンになっている
 *   2. 各タブの写真が「画像1 → 画像2 …」と横にめくれる形になっている
 *   3. 説明は短く、絵文字を使っていない
 *   4. 画像ファイルが実在し、Service Worker と www/（iOSバンドル）にも入る
 *   5. 設定の「チュートリアルを見る」と初回案内の両方から開ける
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TUTORIAL_LEAD, TUTORIAL_TABS, TUTORIAL_SLIDE_TOTAL, TUTORIAL_ASSET_DIR, GUIDE_SEEN_KEY,
  tutorialHtml, tutorialImages, slideIndexAt, readGuideSeen, writeGuideSeen,
} from '../tutorial.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;
const PNG_OR_WEBP = /\.(webp|png|jpe?g)$/i;

test('タブは「1. 在庫」「2. 補充」「3. カタログ」「4. 設定」の4つ', () => {
  assert.deepEqual(
    TUTORIAL_TABS.map((tab) => tab.title),
    ['1. 在庫', '2. 補充', '3. カタログ', '4. 設定'],
  );
  assert.deepEqual(TUTORIAL_TABS.map((tab) => tab.id), ['stock', 'restock', 'catalog', 'settings']);
  for (const tab of TUTORIAL_TABS) {
    assert.ok(tab.note && tab.note.length <= 16, `${tab.title} の補足が長い: ${tab.note}`);
  }
});

test('写真の割り当ては 在庫3枚・補充1枚・カタログ2枚・設定1枚（計7枚）', () => {
  const counts = Object.fromEntries(TUTORIAL_TABS.map((tab) => [tab.id, tab.slides.length]));
  assert.deepEqual(counts, { stock: 3, restock: 1, catalog: 2, settings: 1 });
  assert.equal(TUTORIAL_SLIDE_TOTAL, 7);
  assert.equal(tutorialImages().length, 7);
  assert.equal(new Set(tutorialImages()).size, 7, '同じ画像が2回使われている');
  // バーコードの画面（4枚目）は外した（探すのは右上の読取ボタンから）
  assert.equal(tutorialImages().some((image) => /stock-4\./.test(image)), false, 'stock-4 がまだ使われている');
  for (const file of ['tutorial.js', 'scripts/build.mjs', 'sw.js']) {
    assert.equal(/stock-4\.webp/.test(read(file)), false, `${file} に stock-4.webp が残っている`);
  }
  assert.equal(fs.existsSync(path.join(ROOT, `${TUTORIAL_ASSET_DIR}/stock-4.webp`)), false, 'stock-4.webp が残っている');
});

test('画像は assets/tutorial/ に実在し、WebP として軽い（1枚100KB未満）', () => {
  for (const image of tutorialImages()) {
    assert.match(image, PNG_OR_WEBP, `画像の拡張子が想定外: ${image}`);
    assert.ok(image.startsWith(`${TUTORIAL_ASSET_DIR}/`), `置き場所が違う: ${image}`);
    const file = path.join(ROOT, image);
    assert.ok(fs.existsSync(file), `画像がありません: ${image}`);
    const size = fs.statSync(file).size;
    assert.ok(size < 100 * 1024, `${image} が重い: ${Math.round(size / 1024)}KB`);
    // WebP のコンテナ（RIFF....WEBP）で始まる
    const head = fs.readFileSync(file).subarray(0, 12);
    assert.equal(head.toString('latin1', 0, 4), 'RIFF', `${image} が WebP ではない`);
    assert.equal(head.toString('latin1', 8, 12), 'WEBP', `${image} が WebP ではない`);
  }
});

test('写真は縦長で、ステータスバーと広告帯を切った比率になっている', () => {
  for (const tab of TUTORIAL_TABS) {
    for (const slide of tab.slides) {
      assert.equal(slide.w, 720, `${slide.image} の幅が720でない`);
      const ratio = slide.h / slide.w;
      // 元の画面（945x2048）から上下を切ったあとの比率。縦に潰れていない
      assert.ok(ratio > 1.7 && ratio < 2.0, `${slide.image} の縦横比が想定外: ${ratio.toFixed(2)}`);
    }
  }
});

test('正方形の枠に切り取る位置（focus）が、全スライドに 0〜1 で入っている', () => {
  for (const tab of TUTORIAL_TABS) {
    for (const slide of tab.slides) {
      const focus = Number(slide.focus);
      assert.equal(Number.isFinite(focus), true, `${slide.image} に focus がない`);
      assert.ok(focus >= 0 && focus <= 1, `${slide.image} の focus が範囲外: ${focus}`);
    }
  }
  // HTML の img にも、その位置が object-position として入る（--core のCSSだけでは切り取る位置を変えられない）
  const html = tutorialHtml();
  assert.equal((html.match(/style="object-position:50% \d+%"/g) || []).length, TUTORIAL_SLIDE_TOTAL);
  // 下端の広告帯に説明とページャーを隠されないよう、枠は正方形に近い高さで切り取る
  const stock3 = TUTORIAL_TABS[0].slides[2];
  assert.equal(stock3.focus, 1, '＋メニューの画面は下端（＋のメニュー）を見せる');
});

test('説明は短く（1〜2行）、絵文字を使っていない', () => {
  assert.equal(EMOJI.test(TUTORIAL_LEAD), false, '冒頭の文に絵文字がある');
  for (const tab of TUTORIAL_TABS) {
    assert.equal(EMOJI.test(tab.title + tab.note), false, `${tab.title} に絵文字がある`);
    for (const slide of tab.slides) {
      assert.equal(EMOJI.test(slide.caption + slide.alt), false, `${slide.image} の文に絵文字がある`);
      assert.ok(slide.caption.length <= 60, `説明が長い（${slide.caption.length}文字）: ${slide.caption}`);
      assert.ok(/。$/.test(slide.caption), `説明が文になっていない: ${slide.caption}`);
      assert.ok(slide.alt.length >= 10, `alt が短すぎる: ${slide.image}`);
    }
  }
});

test('HTMLはタブごとのアコーディオン（details）と横スライド・ドット・左右ボタンになる', () => {
  const html = tutorialHtml();
  // タブの数だけ <details> があり、最初は閉じている（open 属性を付けない）
  assert.equal((html.match(/<details class="gacc"/g) || []).length, 4);
  assert.equal(/<details[^>]*\sopen/.test(html), false, '最初から開いているタブがある');
  for (const tab of TUTORIAL_TABS) {
    assert.ok(html.includes(`data-gtab="${tab.id}"`), `${tab.id} のタブがない`);
    assert.ok(html.includes(`data-gswipe="${tab.id}"`), `${tab.id} の横スライドがない`);
    assert.ok(html.includes(`data-gdots="${tab.id}"`), `${tab.id} のドットがない`);
    // 画像はそのタブの枚数だけ、順番どおりに入る
    const from = html.indexOf(`data-gtab="${tab.id}"`);
    const nextTab = html.indexOf('<details class="gacc"', from + 1);
    const part = html.slice(from, nextTab === -1 ? undefined : nextTab);
    const images = [...part.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(images.slice(0, tab.slides.length), tab.slides.map((s) => s.image));
    // ドットと「n/N」の番号もスライドの数だけ
    assert.equal((part.match(/data-goto="/g) || []).length, tab.slides.length);
    assert.equal((part.match(/class="gnum"/g) || []).length, tab.slides.length);
  }
  // 横スライドの器と、左右ボタン
  assert.match(html, /class="gswipe"/);
  assert.ok(html.includes('data-gnav="-1"'), '前のボタンがない');
  assert.ok(html.includes('data-gnav="1"'), '次のボタンがない');
  // 遅延読み込み（開いたときだけ取りに行く）
  assert.equal((html.match(/loading="lazy"/g) || []).length, TUTORIAL_SLIDE_TOTAL);
});

test('横スクロールの位置から何枚目かを出せる', () => {
  assert.equal(slideIndexAt(0, 300, 4), 0);
  assert.equal(slideIndexAt(149, 300, 4), 0);
  assert.equal(slideIndexAt(151, 300, 4), 1);
  assert.equal(slideIndexAt(600, 300, 4), 2);
  // 端では、はみ出さない
  assert.equal(slideIndexAt(5000, 300, 4), 3);
  assert.equal(slideIndexAt(-50, 300, 4), 0);
  // 幅が決まっていないとき（0）は1枚目
  assert.equal(slideIndexAt(120, 0, 4), 0);
  assert.equal(slideIndexAt(120, 300, 0), 0);
});

test('設定の「チュートリアルを見る」と初回案内の両方から開ける', () => {
  const html = read('index.html');
  const app = read('app.js');
  // 設定のボタン（残す）と、初回案内のカード
  assert.ok(html.includes('id="btnGuide"'), '設定の「チュートリアルを見る」がない');
  assert.ok(html.includes('id="guideIntro"'), '初回案内のカードがない');
  assert.ok(html.includes('id="btnGuideIntro"'), '初回案内のボタンがない');
  assert.ok(html.includes('id="btnGuideIntroClose"'), '初回案内を閉じるボタンがない');
  assert.match(html, /id="guideList"/);
  // シートの中身は JS が作る（古い長文の一覧は残さない）
  assert.equal(/class="gstep"/.test(html), false, '古いチュートリアルの一覧が残っている');
  assert.equal(/画材を追加する<\/b>/.test(html), false, '古い説明文が残っている');
  // どちらの入り口も openGuide() を通る
  assert.match(app, /\$\('btnGuide'\)\.addEventListener\('click', \(\) => openGuide\(\)\)/);
  assert.match(app, /\$\('btnGuideIntro'\)\.addEventListener\('click', \(\) => openGuide\('stock'\)\)/);
  assert.match(app, /function openGuide\(tabId\)/);
  // 初回案内は「見た」印で消える
  assert.match(app, /readGuideSeen\(safeStorage\(\)\)/);
  assert.match(app, /writeGuideSeen\(safeStorage\(\), true\)/);
  assert.match(app, /renderGuideIntro\(\)/);
});

test('「使い方を見た」印は保存でき、読めない保存先でも落ちない', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  assert.equal(readGuideSeen(storage), false);
  assert.equal(readGuideSeen(null), false);
  writeGuideSeen(storage);
  assert.equal(store.get(GUIDE_SEEN_KEY), '1');
  assert.equal(readGuideSeen(storage), true);
  writeGuideSeen(storage, false);
  assert.equal(readGuideSeen(storage), false);
  // 保存できない環境（容量不足・プライベートモード）でも例外を出さない
  const broken = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
  assert.equal(readGuideSeen(broken), false);
  assert.equal(writeGuideSeen(broken), false);
});

test('Service Worker と www/（iOSバンドル）にも画像と tutorial.js が入る', async () => {
  const { WEB_ASSETS } = await import('../scripts/build.mjs');
  assert.ok(WEB_ASSETS.includes('tutorial.js'), 'tutorial.js が www/ に入らない');
  for (const image of tutorialImages()) {
    assert.ok(WEB_ASSETS.includes(image), `${image} が www/ に入らない`);
  }
  // Service Worker（オフラインでも写真が出る）
  const sw = read('sw.js');
  assert.match(sw, /art-supply-manager-v53/);
  assert.ok(sw.includes("'./tutorial.js'"), 'sw.js に tutorial.js がない');
  for (const image of tutorialImages()) {
    assert.ok(sw.includes(`'./${image}'`), `sw.js に ${image} がない`);
  }
});

test('初回案内のカードは既定で隠しておく（JSが出す）', () => {
  const html = read('index.html');
  const card = html.slice(html.indexOf('id="guideIntro"') - 200, html.indexOf('id="guideIntro"') + 400);
  assert.match(card, /class="card firstrun"/);
  assert.match(card, /hidden/, '初期状態で隠していない');
  assert.match(card, /はじめての方へ/);
});

test('使い方のCSS（アコーディオン・横スナップ・ドット）が揃っている', () => {
  const css = read('styles.css');
  assert.match(css, /\.gacc\[open\]/);
  assert.match(css, /\.gswipe \{[^}]*overflow-x: auto/);
  assert.match(css, /scroll-snap-type: x mandatory/);
  assert.match(css, /\.gslide \{[^}]*scroll-snap-align: center/);
  assert.match(css, /\.gdot\[aria-selected="true"\]/);
  // 写真は正方形に近い枠に切り取り、説明文とページャーが広告帯の上に収まるようにする
  assert.match(css, /\.gslide img \{[^}]*height:\s*min\(320px,\s*42vh\)/);
  assert.match(css, /\.gslide img \{[^}]*object-fit:\s*cover/);
  // 広告バナーが出ている間は、シート自体をバナーの上で終わらせる（説明とページャーを隠さない）
  assert.match(css, /body\[data-ad-banner="true"\] #sheetGuide \{[^}]*bottom:\s*calc\(var\(--ad-h\)/);
  assert.match(css, /body\[data-ad-banner="true"\] #sheetGuide \{[^}]*max-height:\s*calc\(92vh - var\(--ad-h\)\)/);
  // 絵文字は使わない
  assert.equal(EMOJI.test(css), false, 'CSSに絵文字がある');
});

test('画面写真の枠は、白い画面の写真でも背景に溶けないよう枠線と影で囲む（ライト・ダーク両方）', () => {
  const css = read('styles.css');
  // 枠線（1.5px〜2px の実線）と、下へ落ちるうっすらした影
  assert.match(css, /\.gslide img \{[^}]*border:\s*1\.5px solid var\(--frame-line\)/);
  assert.match(css, /\.gslide img \{[^}]*box-shadow:\s*var\(--frame-shadow\)/);
  // ライトとダークの両方で、枠線の色と影の濃さを持つ（片方だけだと、そのテーマで枠が消える）
  const light = css.slice(0, css.indexOf(':root[data-theme="dark"]'));
  const dark = css.slice(css.indexOf(':root[data-theme="dark"]'));
  for (const [name, block] of [['ライト', light], ['ダーク', dark]]) {
    assert.match(block, /--frame-line:\s*#[0-9a-f]{6}/i, `${name}テーマに --frame-line がない`);
    assert.match(block, /--frame-shadow:\s*0 1px/, `${name}テーマに --frame-shadow がない`);
  }
  // 枠線の色は、シートの面（--surface）と写真の下地（--surface-2）のどちらとも別の色にする
  const line = light.match(/--frame-line:\s*(#[0-9a-f]{6})/i)[1].toLowerCase();
  assert.notEqual(line, light.match(/--surface:\s*(#[0-9a-f]{6})/i)[1].toLowerCase(), '枠線がシートの面と同じ色');
  assert.notEqual(line, light.match(/--surface-2:\s*(#[0-9a-f]{6})/i)[1].toLowerCase(), '枠線が写真の下地と同じ色');
  // 高さと切り取り方は変えない（説明文とページャーが広告帯に隠れないため）
  assert.match(css, /\.gslide img \{[^}]*height:\s*min\(320px,\s*42vh\)/);
  assert.match(css, /\.gslide img \{[^}]*object-fit:\s*cover/);
});
