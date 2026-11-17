import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  THEME_MODES, THEME_COLORS, THEME_STORAGE_KEY, normalizeTheme, resolveTheme, themeColor,
  themeLabel, nextTheme, readStoredTheme, writeStoredTheme, prefersDark,
} from '../theme.js';
import { blankState, importState } from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const css = read('styles.css');

/** :root ブロックの CSS 変数を読む */
function cssVars(selector) {
  const at = css.indexOf(selector);
  assert.ok(at >= 0, `${selector} がありません`);
  const open = css.indexOf('{', at);
  const end = css.indexOf('}', open);
  const body = css.slice(open + 1, end);
  const out = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

function rgb(hex) {
  const h = hex.replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const LIGHT = cssVars(':root {');
const DARK = cssVars(':root[data-theme="dark"] {');

test('テーマの値は 自動 / ライト / ダーク の3つ（不明な値は自動）', () => {
  assert.deepEqual(THEME_MODES.map((m) => m.id), ['auto', 'light', 'dark']);
  assert.deepEqual(THEME_MODES.map((m) => m.label), ['自動', 'ライト', 'ダーク']);
  assert.equal(normalizeTheme('dark'), 'dark');
  assert.equal(normalizeTheme('light'), 'light');
  assert.equal(normalizeTheme('auto'), 'auto');
  assert.equal(normalizeTheme('sepia'), 'auto');
  assert.equal(normalizeTheme(undefined), 'auto');
  assert.equal(themeLabel('dark'), 'ダーク');
  assert.equal(nextTheme('auto'), 'light');
  assert.equal(nextTheme('light'), 'dark');
  assert.equal(nextTheme('dark'), 'auto');
});

test('自動は端末の設定に従い、ライト/ダークは固定', () => {
  assert.equal(resolveTheme('auto', true), 'dark');
  assert.equal(resolveTheme('auto', false), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('dark', true), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('nonsense', true), 'dark');
});

test('theme-color はヘッダーの色に合わせる', () => {
  assert.equal(themeColor('dark'), THEME_COLORS.dark);
  assert.equal(themeColor('light'), THEME_COLORS.light);
  assert.notEqual(THEME_COLORS.dark, THEME_COLORS.light);
  assert.match(THEME_COLORS.dark, /^#[0-9a-f]{6}$/);
  assert.match(THEME_COLORS.light, /^#[0-9a-f]{6}$/);
});

test('保存と読み出し（保存できない環境でも落ちない）', () => {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  assert.equal(readStoredTheme(storage), 'auto');
  assert.equal(writeStoredTheme(storage, 'dark'), true);
  assert.equal(store.get(THEME_STORAGE_KEY), 'dark');
  assert.equal(readStoredTheme(storage), 'dark');
  assert.equal(writeStoredTheme(storage, 'nonsense'), true);
  assert.equal(readStoredTheme(storage), 'auto', '不明な値は自動に戻す');
  const broken = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } };
  assert.equal(readStoredTheme(broken), 'auto');
  assert.equal(writeStoredTheme(broken, 'dark'), false);
  assert.equal(readStoredTheme(null), 'auto');
  assert.equal(writeStoredTheme(null, 'dark'), false);
});

test('端末のダーク設定の判定（matchMedia が無くても落ちない）', () => {
  assert.equal(prefersDark({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(prefersDark({ matchMedia: () => ({ matches: false }) }), false);
  assert.equal(prefersDark({}), false);
  assert.equal(prefersDark(null), false);
  assert.equal(prefersDark({ matchMedia() { throw new Error('no'); } }), false);
});

test('設定: テーマは初期値が自動で、バックアップからも戻る', () => {
  const s = blankState();
  assert.equal(s.settings.theme, 'auto');
  const back = importState(JSON.stringify({ folders: [{ id: 'x', name: 'X' }], items: [], settings: { theme: 'dark' } }));
  assert.equal(back.settings.theme, 'dark');
  const missing = importState(JSON.stringify({ folders: [{ id: 'x', name: 'X' }], items: [] }));
  assert.equal(missing.settings.theme, 'auto');
});

test('ダークの配色は変数をまとめて切り替える（面・線・文字・状態色）', () => {
  for (const key of ['bg', 'card', 'surface', 'surface-2', 'surface-3', 'ink', 'ink-2', 'ink-3', 'line', 'accent', 'accent-soft', 'good-soft', 'warn-soft', 'bad-soft', 'tile-ink']) {
    assert.ok(LIGHT[key], `ライトの --${key} がありません`);
    assert.ok(DARK[key], `ダークの --${key} がありません`);
    assert.notEqual(LIGHT[key], DARK[key], `--${key} がダークで変わっていない`);
  }
  assert.equal(LIGHT.bg, '#f1efe9');
  assert.equal(LIGHT.accent, '#2b66c4');
  assert.equal(DARK.bg, '#0f141a');
  // ネイティブの select・入力欄もダークに合わせる
  assert.match(css, /:root\s*\{[^}]*color-scheme:\s*light/);
  assert.match(css, /:root\[data-theme="dark"\]\s*\{[^}]*color-scheme:\s*dark/);
});

test('ダークでも本文・補助文字・バッジが読めるコントラスト', () => {
  const pairs = [
    ['ink', 'bg', 7],
    ['ink', 'card', 7],
    ['ink-2', 'card', 4.5],
    ['ink-3', 'card', 3],
    ['tile-ink', 'shelf', 4.5],
    ['bad', 'bad-soft', 4],
    ['warn', 'warn-soft', 4],
    ['good', 'good-soft', 4],
    ['accent', 'bg', 4.5],
  ];
  for (const [fg, bg, min] of pairs) {
    for (const [name, vars] of [['ライト', LIGHT], ['ダーク', DARK]]) {
      const ratio = contrast(vars[fg], vars[bg]);
      assert.ok(ratio >= min, `${name}の --${fg} / --${bg} は ${ratio.toFixed(2)}（${min} 以上にしたい）`);
    }
  }
});

test('カード・シート・入力欄・タブバー・チップは変数の面を使う（白を直書きしない）', () => {
  const blocks = [
    ['.app-header {', 'background: var(--surface)'],
    ['.hbtn {', 'background: var(--surface)'],
    ['.tabbar {', 'background: var(--surface)'],
    ['.sheet {', 'background: var(--surface)'],
    ['.fchip {', 'background: var(--surface)'],
    ['.field input, .field select, .field textarea {', 'background: var(--surface)'],
    ['.btn {', 'background: var(--surface)'],
    ['.search-row input[type="search"] {', 'background: var(--surface)'],
  ];
  for (const [selector, decl] of blocks) {
    const at = css.indexOf(selector);
    assert.ok(at >= 0, `${selector} がありません`);
    const body = css.slice(at, css.indexOf('}', at));
    assert.ok(body.includes(decl), `${selector} が ${decl} になっていない`);
  }
  // 検索モーダル（辞書・絞込・並替のシート）もシートの面を継承する
  assert.match(css, /#dictQ, #dictFindQ\s*\{[^}]*background:\s*var\(--surface\)/);
});

test('在庫0のグレー表示もダークで沈む（面と文字を変数に）', () => {
  assert.match(css, /\.tile\.item-card--empty \.sw\s*\{[^}]*background:\s*var\(--surface-3\)/);
  assert.match(css, /\.tile\.item-card--empty \.tname\s*\{[^}]*color:\s*var\(--ink-3\)/);
  assert.match(css, /\.item\.item-card--empty\s*\{[^}]*background:\s*var\(--surface-2\)/);
  assert.match(css, /\.item\.item-card--empty \.it-name\s*\{[^}]*color:\s*var\(--ink-3\)/);
  // 棒グラフの下地とバー
  assert.match(css, /\.bar \.bt\s*\{[^}]*background:\s*var\(--surface-3\)/);
  assert.match(css, /\.bar \.bf\s*\{[^}]*var\(--bar-a\)/);
});

test('画面: 設定にテーマ切替、描画前のテーマ適用、theme-colorの連動', () => {
  const html = read('index.html');
  const app = read('app.js');
  assert.match(html, /<meta name="theme-color" content="#ffffff">/);
  assert.match(html, /id="themeChips"/);
  assert.match(html, /id="themeCard"/);
  assert.match(html, />表示</);
  // 白い画面が一瞬出ないよう、head で localStorage を見て data-theme を決める
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.includes("localStorage.getItem('art-supply-manager/theme')"), 'head でテーマを読んでいない');
  assert.ok(head.indexOf("document.documentElement.setAttribute('data-theme'") > 0);
  assert.ok(head.indexOf('art-supply-manager/theme') < html.indexOf('styles.css'), 'テーマの決定はCSSより前に行う');
  // アプリ側: 属性・meta・チップ・端末設定の変化に追従
  assert.match(app, /document\.documentElement\.setAttribute\('data-theme', resolved\)/);
  assert.match(app, /querySelector\('meta\[name="theme-color"\]'\)/);
  assert.match(app, /matchMedia\('\(prefers-color-scheme: dark\)'\)\.addEventListener\('change'/);
  assert.match(app, /data-theme-mode/);
  assert.match(app, /writeStoredTheme\(safeStorage\(\), next\)/);
  assert.match(app, /function setTheme\(mode\)/);
  assert.match(app, /applyTheme\(\);/);
  // 起動時の描画でも適用される
  assert.match(app, /function render\(\) \{\s*applyTheme\(\);/);
});

test('theme.js は配信・iOSビルド・Service Worker に入っている', async () => {
  const sw = read('sw.js');
  assert.match(sw, /'\.\/theme\.js'/);
  assert.match(sw, /art-supply-manager-v44/);
  const { WEB_ASSETS } = await import('../scripts/build.mjs');
  assert.ok(WEB_ASSETS.includes('theme.js'), 'theme.js が WEB_ASSETS にありません');
  // iOSビルドの起動条件は app.js / index.html / styles.css の変更で走る（theme.js は build.mjs 経由で www/ へ入る）
  const workflow = read('.github/workflows/ios-build.yml');
  assert.match(workflow, /- 'app\.js'/);
  assert.match(workflow, /- 'scripts\/\*\*'/);
  // 絵文字なし
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  assert.equal(EMOJI.test(read('theme.js')), false, 'theme.js に絵文字があります');
  assert.equal(EMOJI.test(css), false, 'styles.css に絵文字があります');
});
