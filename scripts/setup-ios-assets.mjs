#!/usr/bin/env node
// resources/AppIcon.appiconset と resources/splash.png を、Capacitor が作った Xcode プロジェクトへ反映する。
// ios/ が無いとき（Web版だけの状態）は何もせず終了する。冪等。
// 使い方: npm run ios:assets && node scripts/setup-ios-assets.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_DIR = path.join(ROOT, 'resources', 'AppIcon.appiconset');
export const SPLASH_SOURCE = path.join(ROOT, 'resources', 'splash.png');
export const TARGET_DIR = path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');
export const SPLASH_TARGET_DIR = path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset');

/**
 * AppIcon.appiconset の中身を置き換える（source に無い png は消す）。
 * Capacitor の初期アイコンが残ると「未使用の画像」警告になるため。
 * @returns {{copied:number, removed:string[]}|null} target が無ければ null
 */
export function copyIconSet({ sourceDir = SOURCE_DIR, targetDir = TARGET_DIR } = {}) {
  if (!fs.existsSync(sourceDir) || !fs.existsSync(targetDir)) return null;
  const sources = fs.readdirSync(sourceDir).filter((n) => fs.statSync(path.join(sourceDir, n)).isFile());
  for (const name of sources) fs.copyFileSync(path.join(sourceDir, name), path.join(targetDir, name));
  const removed = [];
  for (const name of fs.readdirSync(targetDir)) {
    if (!name.endsWith('.png')) continue;
    if (sources.includes(name)) continue;
    fs.rmSync(path.join(targetDir, name));
    removed.push(name);
  }
  return { copied: sources.length, removed };
}

/**
 * 起動画面の画像を差し替える。Capacitor の Splash.imageset は
 * splash-2732x2732.png / -1 / -2 のように複数ファイルを持つので、
 * ある png をすべて同じ絵で上書きする（名前が変わっても追従する）。
 * @returns {number} 上書きした枚数（target が無ければ 0）
 */
export function copySplash({ splashFile = SPLASH_SOURCE, targetDir = SPLASH_TARGET_DIR } = {}) {
  if (!fs.existsSync(splashFile) || !fs.existsSync(targetDir)) return 0;
  let count = 0;
  for (const name of fs.readdirSync(targetDir)) {
    if (!name.toLowerCase().endsWith('.png')) continue;
    fs.copyFileSync(splashFile, path.join(targetDir, name));
    count += 1;
  }
  return count;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(SOURCE_DIR) || !fs.existsSync(SPLASH_SOURCE)) {
    console.log('[assets] 先に python3 scripts/generate-ios-assets.py を実行してください。');
    process.exit(0);
  }
  if (!fs.existsSync(TARGET_DIR)) {
    console.log('[assets] ios/ がまだありません（npx cap add ios の後に実行）。');
    process.exit(0);
  }
  const icons = copyIconSet();
  const splashes = copySplash();
  if (!icons) {
    console.log('[assets] AppIcon.appiconset が見つかりません。');
  } else {
    console.log(`[assets] AppIcon を ${icons.copied} ファイル反映（不要 ${icons.removed.length} 枚を削除）`);
  }
  console.log(splashes
    ? `[assets] 起動画面を ${splashes} 枚差し替え`
    : '[assets] Splash.imageset が無いため起動画面はそのまま');
}
