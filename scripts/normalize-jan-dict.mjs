#!/usr/bin/env node
// 内蔵JAN辞書（data/jan-part-*.js）の表記揺れを一括でそろえる。
//
//   node scripts/normalize-jan-dict.mjs             … 書き換える
//   node scripts/normalize-jan-dict.mjs --dry-run   … 集計と差分だけ出す（書き換えない）
//   node scripts/normalize-jan-dict.mjs --report ../work/normalize-report.tsv
//
// ルールは scripts/lib/normalize-jan.mjs にまとめてある（Drive CSV の取り込みでも同じものを使う）。
// JAN（第1要素）と件数は変えない。落とした語は検索用キーワードに残す。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapacityMap, buildSeriesMap, makerKey, normalizeEntry } from './lib/normalize-jan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(ROOT, 'jan-database.js');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const opt = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const REPORT = opt('report');

/* ---------------- パートを読む ---------------- */

const FIELDS = ['jan', 'name', 'maker', 'category', 'colorName', 'size', 'code', 'src', 'series', 'keywords'];

const partFiles = fs.readdirSync(DATA_DIR)
  .filter((f) => /^jan-part-\d+\.js$/.test(f))
  .sort((a, b) => Number(/^jan-part-(\d+)\.js$/.exec(a)[1]) - Number(/^jan-part-(\d+)\.js$/.exec(b)[1]));

const parts = partFiles.map((file) => {
  const text = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
  const startAt = text.indexOf('const RAW = [');
  const endAt = text.indexOf('\n];', startAt);
  if (startAt < 0 || endAt < 0) throw new Error(`${file}: RAW 配列が見つかりません`);
  const header = text.slice(0, startAt);
  const footer = text.slice(endAt);
  const lines = text.slice(startAt, endAt).split('\n');
  const rows = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('[')) continue;
    const tuple = JSON.parse(t.replace(/,\s*$/, ''));
    const obj = {};
    FIELDS.forEach((f, i) => { obj[f] = tuple[i] ?? ''; });
    rows.push(obj);
  }
  return { file, header, footer, rows, lineCount: lines.length };
});

const rows = parts.flatMap((p) => p.rows);
console.log(`パート ${parts.length} 本 / ${rows.length} 件を読み込みました`);

// ブランド名（検索・表示に使う）は jan-database.js の対応表から付ける
const { JAN_DICTIONARY } = await import('../jan-database.js');
const brandByMaker = new Map();
const brandByJan = new Map();
for (const d of JAN_DICTIONARY) {
  if (!brandByMaker.has(d.maker)) brandByMaker.set(d.maker, d.brand || '');
  brandByJan.set(d.jan, d.brand || '');
}
for (const row of rows) row.brand = brandByJan.get(row.jan) ?? brandByMaker.get(row.maker) ?? '';

/* ---------------- 正規化 ---------------- */

const capacityMap = buildCapacityMap(rows);
const seriesMap = buildSeriesMap(rows);

const beforeJan = new Set(rows.map((r) => r.jan));
const changes = [];
const makerRename = new Map();
const normalized = rows.map((row) => {
  const { entry, changes: diff } = normalizeEntry(row, { capacityMap, seriesMap });
  for (const c of diff) changes.push({ jan: row.jan, ...c });
  if (row.maker !== entry.maker) makerRename.set(row.maker, entry.maker);
  return entry;
});

/* ---------------- 集計 ---------------- */

const byRule = new Map();
for (const c of changes) {
  const key = `${c.rule}\u0000${c.field}`;
  byRule.set(key, (byRule.get(key) || 0) + 1);
}
const RULE_LABEL = {
  'half-kana': '半角カタカナ→全角カタカナ',
  'full-alnum': '全角英数字→半角英数字',
  spaces: '空白の整理',
  prefix: 'メーカー前置きの整理',
  'english-color': '英語＋日本語の色名併記',
  'kana-space': 'カタカナ色名の語間スペース',
  'size-capacity': '号数と容量の統一',
  'size-unit': '容量単位の表記統一（mL→ml）',
  'full-hyphen': '全角ハイフン→半角ハイフン',
  'full-punct': '全角ピリオド・％→半角',
  'series-merge': 'シリーズ統合',
};
console.log('\n■ 変更内訳');
const summary = {};
for (const [key, n] of [...byRule.entries()].sort()) {
  const [rule, field] = key.split('\u0000');
  const label = `${RULE_LABEL[rule] || rule}（${field}）`;
  summary[label] = (summary[label] || 0) + n;
  console.log(`  ${label}: ${n}`);
}
const rowsByRule = new Map();
for (const c of changes) rowsByRule.set(c.rule, (rowsByRule.get(c.rule) || 0) + 1);
console.log('\n■ ルール別の変更件数（延べ）');
for (const [rule, n] of [...rowsByRule.entries()].sort()) console.log(`  ${RULE_LABEL[rule] || rule}: ${n}`);
const touched = new Set(changes.map((c) => c.jan)).size;
console.log(`\n変更のあった商品: ${touched} 件 / ${rows.length} 件`);

// シリーズ統合の内訳
const seriesMerges = new Map();
for (const c of changes) if (c.rule === 'series-merge') {
  const k = `${c.from} → ${c.to}`;
  seriesMerges.set(k, (seriesMerges.get(k) || 0) + 1);
}
if (seriesMerges.size) {
  console.log('\n■ シリーズ統合');
  for (const [k, n] of [...seriesMerges.entries()].sort()) console.log(`  ${k}: ${n}件`);
}

// 号数と容量の対応
const caps = [...capacityMap.entries()].map(([k, v]) => {
  const [maker, series, no] = k.split('\u0000');
  return { maker, series, no, cap: v };
});
if (caps.length) {
  console.log(`\n■ 号数→容量の対応（${caps.length}組）`);
  for (const c of caps.slice(0, 40)) console.log(`  ${c.maker} / ${c.series} / ${c.no}号 → ${c.cap}`);
  if (caps.length > 40) console.log(`  …ほか ${caps.length - 40} 組`);
}

const afterJan = new Set(normalized.map((r) => r.jan));
if (normalized.length !== rows.length || afterJan.size !== beforeJan.size) {
  console.error(`件数が変わりました: ${rows.length} → ${normalized.length}`);
  process.exit(1);
}

if (REPORT) {
  const out = path.resolve(ROOT, REPORT);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const lines = ['jan\trule\tfield\tbefore\tafter'];
  for (const c of changes) lines.push([c.jan, c.rule, c.field, c.from, c.to].join('\t'));
  fs.writeFileSync(out, `${lines.join('\n')}\n`);
  console.log(`\n差分を書き出しました: ${path.relative(ROOT, out)}`);
}

if (DRY) {
  console.log('\n--dry-run: 書き換えていません');
  process.exit(0);
}

/* ---------------- パートを書き戻す ---------------- */

const tupleOf = (r) => JSON.stringify(FIELDS.map((f) => r[f] ?? ''));
let at = 0;
for (const part of parts) {
  const body = part.rows.map(() => {
    const row = normalized[at];
    at += 1;
    return `  ${tupleOf(row)},`;
  });
  const out = `${part.header}const RAW = [\n${body.join('\n')}\n${part.footer}`;
  fs.writeFileSync(path.join(DATA_DIR, part.file), out);
}

/* ---------------- JAN_PREFIXES のメーカー名もそろえる ---------------- */

if (makerRename.size) {
  const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  let db = fs.readFileSync(DB_FILE, 'utf8');
  const blockRe = /export const JAN_PREFIXES = \[[\s\S]*?\n\];/;
  const block = blockRe.exec(db);
  if (!block) throw new Error('JAN_PREFIXES が見つかりません');
  const lines = block[0].split('\n').map((line) => {
    if (!line.trim().startsWith('{ prefix:')) return line;
    const info = new Function(`return (${line.trim().replace(/,$/, '')})`)();
    info.maker = makerRename.get(info.maker) || info.maker;
    info.makers = [...new Set((info.makers || [info.maker]).map((m) => makerRename.get(m) || m))];
    return `  { prefix: ${q(info.prefix)}, maker: ${q(info.maker)}, brand: ${q(info.brand)}, makers: [${info.makers.map(q).join(', ')}], count: ${info.count} },`;
  });
  db = db.replace(blockRe, lines.join('\n'));
  fs.writeFileSync(DB_FILE, db);
  console.log(`\nJAN_PREFIXES のメーカー名を更新: ${[...makerRename.entries()].map(([a, b]) => `${a}→${b}`).join(' / ')}`);
}

console.log(`\n書き換えました: ${changes.length} か所 / ${touched} 件`);
