import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* 商品画像の見え方: 実画像が載ったら、下地の「画像なし」アイコンを透かさず隠す */

test('実画像が読み込めたら枠に hasimg を付ける（読み込み失敗時は付けない）', () => {
  const app = read('app.js');
  assert.match(app, /document\.addEventListener\('load', \(e\) => \{/);
  assert.match(app, /if \(img\.classList\.contains\('imgfail'\)\) return;[\s\S]{0,200}img\.parentElement\?\.classList\.add\('hasimg'\);/);
  // 画像の種類は棚（shelfimg）と色見本（swimg）の両方
  assert.match(app, /img\.classList\.contains\('shelfimg'\) && !img\.classList\.contains\('swimg'\)/);
});

test('グリッドの棚・リストのサムネイル・色見本の下地は、画像があるとき全部隠れる', () => {
  const css = read('styles.css');
  // グリッド: チューブ形のSVG・棚板の線・接地の影
  assert.match(css, /\.tile \.sw\.hasimg \.inh,\s*\.tile \.sw\.hasimg::before,\s*\.tile \.sw\.hasimg::after \{ display: none; \}/);
  assert.match(css, /\.tile \.sw\.hasimg \{ background: var\(--img-pad\); \}/);
  // リスト: カテゴリアイコン
  assert.match(css, /\.item \.thumb\.hasimg \.ic \{ display: none; \}/);
  // 色見本: 色名から作った下地の色
  assert.match(css, /\.swt \.swc\.hasimg \.swfill \{ display: none; \}/);
});

test('在庫切れのグレー表示でも写真が白飛びしない（画像があると分かる）', () => {
  const css = read('styles.css');
  const tile = /\.tile\.item-card--empty \.shelfimg \{ filter: grayscale\(([\d.]+)\); opacity: ([\d.]+); \}/.exec(css);
  assert.ok(tile, '在庫切れの画像フィルタがありません');
  assert.ok(Number(tile[1]) < 1, 'グレーは弱めにする');
  assert.ok(Number(tile[2]) >= 0.8, '薄くしすぎない（写真が消えて見えない）');
  const row = /\.item\.item-card--empty \.thumb img\.shelfimg \{ filter: grayscale\(([\d.]+)\); opacity: ([\d.]+); \}/.exec(css);
  assert.ok(row, 'リストの在庫切れ画像フィルタがありません');
  assert.ok(Number(row[1]) < 1 && Number(row[2]) >= 0.8);
});

test('サンプル8点はどれも https の商品画像URLを持つ（最初から写真が並ぶ）', async () => {
  const { SAMPLE_SEEDS } = await import('../samples.js');
  assert.equal(SAMPLE_SEEDS.length, 8);
  for (const seed of SAMPLE_SEEDS) {
    assert.match(String(seed.imageUrl), /^https:\/\//, `${seed.id} に商品画像が無い`);
  }
});
