#!/usr/bin/env node
// resources/AppIcon.appiconset を Capacitor が作った Xcode プロジェクトへコピーする。
// ios/ が無いとき（Web版だけの状態）は何もせず終了する。冪等。
// 使い方: npm run ios:assets && node scripts/setup-ios-assets.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_DIR = path.join(ROOT, 'resources', 'AppIcon.appiconset');
export const TARGET_DIR = path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');

/** SOURCE_DIR の中身を TARGET_DIR へコピーする（target が無ければ false） */
export function copyIconSet({ sourceDir = SOURCE_DIR, targetDir = TARGET_DIR } = {}) {
  if (!fs.existsSync(sourceDir) || !fs.existsSync(targetDir)) return false;
  for (const name of fs.readdirSync(sourceDir)) {
    const src = path.join(sourceDir, name);
    if (!fs.statSync(src).isFile()) continue;
    fs.copyFileSync(src, path.join(targetDir, name));
  }
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(SOURCE_DIR)) {
    console.log('[assets] 先に python3 scripts/generate-ios-assets.py を実行してください。');
    process.exit(0);
  }
  if (!fs.existsSync(TARGET_DIR)) {
    console.log('[assets] ios/ がまだありません（npx cap add ios の後に実行）。');
    process.exit(0);
  }
  console.log(copyIconSet() ? '[assets] AppIcon を ios/ へコピーしました。' : '[assets] コピーできませんでした。');
}
