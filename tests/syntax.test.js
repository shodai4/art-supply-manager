/**
 * 配信する JS が構文として壊れていないことを確かめる。
 *
 * 画面（app.js）は DOM を触るため node:test からは実行できないので、
 * これまでは文字列の一致だけで見ていた。括弧やテンプレート literal を1つ落とすと
 * テストは通ったままアプリだけが真っ白になるため、`node --check` で構文を検める。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
  'app.js', 'core.js', 'pro.js', 'samples.js', 'theme.js', 'jan-extra.js', 'images.js',
  'auto-image.js', 'scanner.js', 'scan-flow.js', 'shops.js', 'links.js', 'admob.js',
  'workers/rakuten-image-proxy/src/index.js',
];

test('配信する JS は構文エラーが無い（node --check）', () => {
  for (const file of FILES) {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) continue; // 中継サーバーは別リポジトリ相当の置き方も許す
    execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' });
  }
});

test('index.html の script は app.js だけ（書き換えで壊れていない）', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const srcs = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(srcs.map((s) => s.split('?')[0]), ['app.js']);
  // 画面の骨（在庫・検索・編集シート）が残っている
  for (const id of ['view-stock', 'view-search', 'folderGrid', 'itemList', 'dictResults', 'fFav']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} がありません`);
  }
});
