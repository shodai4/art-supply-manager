// Capacitor iOS の土台: www/ を作る（公開ファイルと同一のものをそのままコピー）
// 使い方: npm run build
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WWW_DIR = path.join(ROOT, 'www');

/** Web版として公開しているファイル（capacitor.config.json の webDir に入れるもの） */
export const WEB_ASSETS = [
  'index.html',
  'privacy.html',
  'terms.html',
  'support.html',
  'styles.css',
  'core.js',
  'motion.js',
  'icloud.js',
  'links.js',
  'pro.js',
  'iap.js',
  'samples.js',
  'theme.js',
  'tutorial.js',
  'images.js',
  'jan-database.js',
  'jan-extra.js',
  'jan-extra.json',
  'shops.js',
  'scanner.js',
  'scan-guard.js',
  'scan-open-gate.js',
  'scan-flow.js',
  'auto-image.js',
  'admob.js',
  'export-file.js',
  'app.js',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'vendor/html5-qrcode.min.js',
  'vendor/gsap.min.js',
  'assets/tutorial/stock-1.webp',
  'assets/tutorial/stock-2.webp',
  'assets/tutorial/stock-3.webp',
  'assets/tutorial/restock-1.webp',
  'assets/tutorial/catalog-1.webp',
  'assets/tutorial/catalog-2.webp',
  'assets/tutorial/settings-1.webp',
];

/**
 * ASSETS を www/ へコピーする。
 * @returns {{copied:string[], missing:string[]}}
 */
export function buildWebDir({ root = ROOT, outDir = WWW_DIR, assets = WEB_ASSETS } = {}) {
  const copied = [];
  const missing = [];
  fs.mkdirSync(outDir, { recursive: true });
  // 内蔵辞書のデータ（data/jan-part-*.js）は数が増えるので、ディレクトリを読んで全部コピーする
  const dataDir = path.join(root, 'data');
  const dataAssets = fs.existsSync(dataDir)
    ? fs.readdirSync(dataDir).filter((f) => f.endsWith('.js')).map((f) => `data/${f}`)
    : [];
  for (const rel of [...assets, ...dataAssets]) {
    const src = path.join(root, rel);
    if (!fs.existsSync(src)) {
      missing.push(rel);
      continue;
    }
    const dest = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied.push(rel);
  }
  return { copied, missing };
}

/**
 * 壊れた iOS プロジェクトの掃除。
 * CI は `if [ ! -d ios ]; then npx cap add ios; fi` のあと `npx cap sync ios` を実行するため、
 * ios/ が「あるが中身が足りない」（Podfile や xcodeproj が無い）状態で残っていると、
 * cap add が飛ばされて sync が ENOENT で落ちる。iOS プロジェクトは生成物（gitignore 済み）なので、
 * その形のときだけ丸ごと消して、次の cap add で作り直させる。
 */
export function cleanBrokenIos({ root = ROOT } = {}) {
  const iosDir = path.join(root, 'ios');
  if (!fs.existsSync(iosDir)) return { removed: false, reason: 'no-ios' };
  const complete = fs.existsSync(path.join(iosDir, 'App', 'Podfile'))
    && fs.existsSync(path.join(iosDir, 'App', 'App.xcodeproj', 'project.pbxproj'));
  if (complete) return { removed: false, reason: 'complete' };
  fs.rmSync(iosDir, { recursive: true, force: true });
  return { removed: true, reason: 'incomplete' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ios = cleanBrokenIos();
  if (ios.removed) console.log('[build] 壊れた ios/ を消しました（次の cap add ios で作り直します）');
  const { copied, missing } = buildWebDir();
  console.log(`[build] www/ へ ${copied.length} ファイルをコピーしました`);
  if (missing.length) {
    console.error(`[build] 見つかりません: ${missing.join(', ')}`);
    process.exitCode = 1;
  }
}
