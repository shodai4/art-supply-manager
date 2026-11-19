// 2026-11-19: Google Drive「AI秘書 / 05_副業・開発」の JAN_<メーカー>網羅_統合.csv（15社）から
// 46,733件を取り込んだ（38,140 → 84,873件。2026-11-19 に新規11社 14,333件を足して 99,206件）。取り込みが欠けないように、15社それぞれの
// 代表JANが引けること・メーカーが正しいこと・検索で見つかることを見る回帰テスト。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JAN_DICTIONARY, JAN_PREFIXES } from '../jan-database.js';
import { CATEGORIES, lookupJAN, detectMaker, searchDictionary } from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 15社の代表JAN（CSV取り込み分から1件ずつ） */
const SAMPLE = [
  { maker: 'コクヨ', jan: '4901480025896', series: 'キャンパスルーズリーフ', min: 15000 },
  { maker: 'パイロット', jan: '4902505003066', series: 'ノート', min: 8000 },
  { maker: '三菱鉛筆', jan: '4548351000110', series: 'クリフター', min: 6000 },
  { maker: 'ぺんてる', jan: '4902506070883', series: 'エナージェル', min: 4500 },
  { maker: 'サクラクレパス', jan: '0000049001907', series: 'マット水彩', min: 4000 },
  { maker: 'ホルベイン', jan: '4900669018506', series: 'POP絵具', min: 7000 },
  { maker: 'トンボ', jan: '0000049177008', series: 'モノ消しゴム', min: 2500 },
  { maker: 'ターナー', jan: '4993453000443', series: 'ポスターカラー', min: 2500 },
  { maker: 'ステッドラー', jan: '4006608127572', series: 'ノリスクラブ', min: 1800 },
  { maker: 'コピック', jan: '4511338000021', series: 'コピックインク', min: 1700 },
  { maker: 'ターレンス', jan: '4573588451701', series: 'ペインティングナイフ', min: 2200 },
  { maker: 'クサカベ', jan: '4933317510077', series: 'ゼファ', min: 1600 },
  { maker: 'シュミンケ', jan: '4012380000071', series: 'ムッシーニ', min: 900 },
  { maker: 'ウィンザー＆ニュートン', jan: '0094376550221', series: 'プロフェッショナル', min: 800 },
  { maker: 'リキテックス', jan: '4989901554927', series: 'ガッシュ', min: 900 },
];

const byJan = new Map(JAN_DICTIONARY.map((d) => [d.jan, d]));

test('15社の代表JANが内蔵辞書にあり、メーカー・カテゴリ・出典が正しい', () => {
  const ids = new Set(CATEGORIES.map((c) => c.id));
  for (const s of SAMPLE) {
    const d = byJan.get(s.jan);
    assert.ok(d, `${s.maker} の ${s.jan} が辞書にありません`);
    assert.equal(d.maker, s.maker, `${s.jan} のメーカー`);
    assert.ok(ids.has(d.category), `${s.jan} のカテゴリ: ${d.category}`);
    assert.match(d.source, /^https:\/\//, `${s.jan} の出典`);
    assert.ok(d.name.length > 1, `${s.jan} の商品名`);
  }
});

test('15社それぞれの件数が、取り込み前より増えている', () => {
  for (const s of SAMPLE) {
    const n = JAN_DICTIONARY.filter((d) => d.maker === s.maker).length;
    assert.ok(n >= s.min, `${s.maker} が少なすぎます: ${n}`);
  }
});

test('代表JANは JAN 一致でも、シリーズ名でも引ける', () => {
  for (const s of SAMPLE) {
    assert.equal(lookupJAN(s.jan)?.maker, s.maker, `${s.jan} が lookupJAN で引けない`);
    const hits = searchDictionary(JAN_DICTIONARY, s.series, { limit: 5 });
    assert.ok(hits.items.length > 0, `「${s.series}」で検索できない（${s.maker}）`);
  }
});

test('JAN事業者コードから15社のメーカーが引ける（プレフィックス登録）', () => {
  for (const s of SAMPLE) {
    const d = detectMaker(s.jan);
    assert.ok(d, `${s.jan} のプレフィックスが未登録`);
    const p = JAN_PREFIXES.find((x) => x.prefix === d.prefix);
    assert.ok(p && p.makers.includes(s.maker), `${s.jan} のメーカー ${s.maker} がプレフィックス ${d.prefix} に無い`);
  }
});

test('辞書のデータは data/ のパートに分かれ、1ファイル12MB未満', () => {
  const parts = fs.readdirSync(path.join(ROOT, 'data')).filter((f) => /^jan-part-\d+\.js$/.test(f));
  assert.ok(parts.length >= 3, `パート数: ${parts.length}`);
  const total = parts.reduce((n, f) => n + fs.statSync(path.join(ROOT, 'data', f)).size, 0);
  for (const f of parts) {
    const bytes = fs.statSync(path.join(ROOT, 'data', f)).size;
    assert.ok(bytes < 12 * 1024 * 1024, `${f} が大きすぎます: ${(bytes / 1048576).toFixed(1)}MB`);
  }
  // 分割してもデータは減っていない（1件あたり約200バイト × 99,206件）
  assert.ok(total > 14 * 1024 * 1024, `データが小さすぎます: ${(total / 1048576).toFixed(1)}MB`);
});
