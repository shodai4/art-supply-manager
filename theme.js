// 表示テーマ（自動 / ライト / ダーク）。
// DOMに触れない判定だけをここに置き、node --test から検証できるようにする。
// 画面への適用（data-theme 属性・theme-color・チップの表示）は app.js が行う。

/** 端末に保存するキー（描画前に読んで、白い画面が一瞬出ないようにする） */
export const THEME_STORAGE_KEY = 'art-supply-manager/theme';

/** 選べるテーマ（自動＝端末の設定に合わせる） */
export const THEME_MODES = [
  { id: 'auto', label: '自動' },
  { id: 'light', label: 'ライト' },
  { id: 'dark', label: 'ダーク' },
];

/** ブラウザのUI（ステータスバー）に使う色。ヘッダーの色に合わせる */
export const THEME_COLORS = {
  light: '#ffffff',
  dark: '#12161c',
};

/** 保存値・設定値を既知のテーマに整える（不明な値は自動） */
export function normalizeTheme(value) {
  const v = String(value ?? '').trim();
  return THEME_MODES.some((m) => m.id === v) ? v : 'auto';
}

/** 実際に使うテーマ（自動のときだけ端末の設定を見る） */
export function resolveTheme(mode, prefersDark = false) {
  const m = normalizeTheme(mode);
  if (m === 'dark') return 'dark';
  if (m === 'light') return 'light';
  return prefersDark ? 'dark' : 'light';
}

/** theme-color に入れる色 */
export function themeColor(theme) {
  return theme === 'dark' ? THEME_COLORS.dark : THEME_COLORS.light;
}

/** チップに出す短い名前 */
export function themeLabel(mode) {
  const m = normalizeTheme(mode);
  return THEME_MODES.find((t) => t.id === m).label;
}

/** テーマの並び順（自動→ライト→ダーク）で次のもの（設定のタップ切替用） */
export function nextTheme(mode) {
  const m = normalizeTheme(mode);
  const i = THEME_MODES.findIndex((t) => t.id === m);
  return THEME_MODES[(i + 1) % THEME_MODES.length].id;
}

/** 保存済みのテーマ（読めない・無いときは自動） */
export function readStoredTheme(storage) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return 'auto';
    return normalizeTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

/** テーマを保存する（保存できなくても表示は続けられる） */
export function writeStoredTheme(storage, mode) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return false;
    storage.setItem(THEME_STORAGE_KEY, normalizeTheme(mode));
    return true;
  } catch {
    return false;
  }
}

/** 端末がダーク設定か（matchMedia が無い環境はライト扱い） */
export function prefersDark(win) {
  try {
    return Boolean(win?.matchMedia?.('(prefers-color-scheme: dark)')?.matches);
  } catch {
    return false;
  }
}
