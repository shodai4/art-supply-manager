#!/usr/bin/env node
// Drive に置かれた「JAN_<メーカー>網羅_統合.csv」を内蔵辞書へ取り込む。
//
//   node scripts/import-drive-jans.mjs --dir ../work/drive-jan-20261119        # 本番
//   node scripts/import-drive-jans.mjs --dir <dir> --dry-run                    # 下見（書き込まない）
//
// 何をするか:
//   1) CSV（JAN,商品名,メーカー,ブランド,カテゴリ,シリーズ,色名,サイズ・容量,色番・品番,キーワード,出典URL）を読む
//   2) JAN の桁・チェックディジット、商品名・メーカーの空欄を検証（不正は取り込まずに報告）
//   3) すでに内蔵辞書にある JAN は既存を優先して飛ばす（重複0件）
//   4) シリーズ名の整理（既存辞書と同じ考え方）:
//        - 商品名と同じシリーズ名は落とす
//        - 結合後の件数が1件だけのシリーズは落とす（件数1のシリーズが乱立して
//          カタログのシリーズ選択が使いにくくなるのを防ぐ）
//   5) data/jan-part-<N>.js に追記（1パート 4MB 目安。12MB を超えない）
//      jan-database.js の import 一覧と `const RAW = [...];` を更新
//   6) JAN_PREFIXES（事業者コード→メーカー）を全件から再集計して書き戻す
//   7) docs/dict-import-log.json に「いつ・どのファイルから・何件」を残す
//
// 取り込み後に必ず: npm test → npm run build（www/ へコピー）→ 版を上げて push。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = path.join(ROOT, 'jan-database.js');
const DATA_DIR = path.join(ROOT, 'data');
const LOG_FILE = path.join(ROOT, 'docs', 'dict-import-log.json');
const MAX_PART_BYTES = 4 * 1024 * 1024; // 1パートの目安（テストの上限は 12MB）

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const DRY = flag('dry-run');
const DIR = path.resolve(ROOT, opt('dir', path.join(ROOT, '..', 'work', 'drive-jan-20261119')));
if (!DIR || !fs.existsSync(DIR)) {
  console.error(`CSV のフォルダがありません: ${DIR || '(未指定)'}（--dir <フォルダ> で指定）`);
  process.exit(2);
}

const { JAN_DICTIONARY, JAN_PREFIXES } = await import('../jan-database.js');
const { buildCapacityMap, buildEnglishNameMap, buildSeriesMap, normalizeEntry } = await import('./lib/normalize-jan.mjs');
const { isValidJAN, normalizeJAN, CATEGORIES } = await import('../core.js');
const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

/* ---------------- CSV ---------------- */

/** 引用符・改行・カンマを含むCSVを素直に読む（BOMは落とす） */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cur += '"'; i += 1; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; }
    else if (c !== '\r') cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const COLUMNS = ['jan', 'name', 'maker', 'brand', 'category', 'series', 'colorName', 'size', 'code', 'keywords', 'source'];
const clean = (v) => String(v ?? '').replace(/[\u200D\uFE0F]/g, '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim();

/** 商品名の整頓（表示方針に合わせる。推測で書き換えず、同じ語の重複だけを落とす） */
function polishName(name, maker, size) {
  let out = String(name)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  // メーカー名の二重（「ぺんてる ぺんてるくれよん」）
  if (maker && out.startsWith(`${maker} ${maker}`)) out = `${maker} ${out.slice(maker.length * 2 + 1).trim()}`;
  // 末尾で号数・サイズがもう一度繰り返されない（「大筆3号 3号」）
  if (size && out.endsWith(size)) {
    const head = out.slice(0, -size.length).replace(/[\s　・]+$/, '');
    if (head.includes(size)) out = head;
  }
  return clean(out);
}

/** 出典URLを短く持つ（世界堂は品番だけ、まつえだはpidだけ。jan-database.js がURLへ戻す） */
function sourceOf(url) {
  const u = clean(url);
  let m = /^https?:\/\/webshop\.sekaido\.co\.jp\/product\/([A-Z]\d+)\/?$/.exec(u);
  if (m) return m[1];
  m = /^https?:\/\/(?:www\.)?matueda\.com\/\?pid=(\d+)$/.exec(u);
  if (m) return Number(m[1]);
  return u;
}

/* ---------------- 読み込みと検証 ---------------- */

const existingJan = new Set(JAN_DICTIONARY.map((d) => d.jan));
const files = fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.csv')).sort();
if (!files.length) {
  console.error(`${DIR} に CSV がありません`);
  process.exit(2);
}

const accepted = [];
const report = { files: [], invalid: [], skippedExisting: 0, duplicatesInBatch: 0 };
for (const file of files) {
  const rows = parseCSV(fs.readFileSync(path.join(DIR, file), 'utf8'));
  const header = rows[0].map((h) => clean(h).replace(/^\uFEFF/, ''));
  const index = {};
  for (const c of COLUMNS) {
    const at = header.indexOf(c === 'colorName' ? '色名' : c === 'size' ? 'サイズ・容量'
      : c === 'code' ? '色番・品番' : c === 'keywords' ? 'キーワード' : c === 'source' ? '出典URL'
        : c === 'jan' ? 'JAN' : c === 'name' ? '商品名' : c === 'maker' ? 'メーカー'
          : c === 'brand' ? 'ブランド' : c === 'category' ? 'カテゴリ' : 'シリーズ');
    if (at < 0) throw new Error(`${file}: 列「${c}」がありません`);
    index[c] = at;
  }
  const before = accepted.length;
  let skipped = 0;
  let invalid = 0;
  const seen = new Set();
  for (const row of rows.slice(1)) {
    if (!row.length || !clean(row[index.jan])) continue;
    const jan = normalizeJAN(row[index.jan]);
    const maker = clean(row[index.maker]);
    const size = clean(row[index.size]);
    const name = polishName(clean(row[index.name]), maker, size);
    const category = clean(row[index.category]) || 'other';
    const where = `${file}:${clean(row[index.jan])}`;
    if (!isValidJAN(jan)) { report.invalid.push(`${where}（JANが不正）`); invalid += 1; continue; }
    if (!name) { report.invalid.push(`${where}（商品名が空）`); invalid += 1; continue; }
    if (!maker) { report.invalid.push(`${where}（メーカーが空）`); invalid += 1; continue; }
    if (existingJan.has(jan)) { skipped += 1; continue; }
    if (seen.has(jan)) { report.duplicatesInBatch += 1; continue; }
    seen.add(jan);
    accepted.push({
      jan,
      name,
      maker,
      category: CATEGORY_IDS.has(category) ? category : 'other',
      series: clean(row[index.series]),
      colorName: clean(row[index.colorName]),
      size,
      code: clean(row[index.code]),
      keywords: clean(row[index.keywords]),
      brand: clean(row[index.brand]),
      source: sourceOf(row[index.source]),
      file,
    });
  }
  report.skippedExisting += skipped;
  report.files.push({ file, rows: rows.length - 1, added: accepted.length - before, skippedExisting: skipped, invalid });
  if (invalid) console.warn(`  ! ${file}: 不正 ${invalid} 件`);
}

console.log(`読み込み ${files.length} ファイル / 新規 ${accepted.length} 件 / 既存と重複 ${report.skippedExisting} 件 / 不正 ${report.invalid.length} 件`);

/* ---------------- 表記の正規化（scripts/normalize-jan-dict.mjs と同じルール） ---------------- */

// 既存辞書と今回の分を合わせて対応表を作り、1件ずつそろえる
// （半角カナ→全角カナ・全角英数→半角英数・英語＋日本語の色名・カタカナ色名の空白・号数と容量・前置き）
const capacityMap = buildCapacityMap([...JAN_DICTIONARY, ...accepted]);
const seriesMap = buildSeriesMap([...JAN_DICTIONARY, ...accepted]);
const englishName = buildEnglishNameMap([...JAN_DICTIONARY, ...accepted]);
const normalized = { halfKana: 0, fullAlnum: 0, kanaSpace: 0, sizeCapacity: 0, prefix: 0, englishColor: 0, series: 0 };
for (let i = 0; i < accepted.length; i += 1) {
  const { entry, changes } = normalizeEntry(accepted[i], { capacityMap, seriesMap, englishName });
  for (const rule of new Set(changes.map((c) => c.rule))) {
    if (rule === 'half-kana') normalized.halfKana += 1;
    else if (rule === 'full-alnum' || rule.includes('hyphen') || rule === 'full-punct') normalized.fullAlnum += 1;
    else if (rule === 'kana-space') normalized.kanaSpace += 1;
    else if (rule === 'size-capacity' || rule === 'size-unit') normalized.sizeCapacity += 1;
    else if (rule === 'prefix') normalized.prefix += 1;
    else if (rule === 'english-color') normalized.englishColor += 1;
    else if (rule === 'series-merge') normalized.series += 1;
  }
  accepted[i] = entry;
}
console.log(`表記の正規化: 半角カナ ${normalized.halfKana} / 全角英数 ${normalized.fullAlnum} / カタカナ空白 ${normalized.kanaSpace} / 号数容量 ${normalized.sizeCapacity} / 前置き ${normalized.prefix} / 英語色名 ${normalized.englishColor} / シリーズ ${normalized.series}`);

/* ---------------- シリーズ名の整理 ---------------- */

const seriesCounts = new Map();
const keyOf = (maker, series) => `${maker}\u0000${series}`;
for (const d of JAN_DICTIONARY) {
  if (d.series) seriesCounts.set(keyOf(d.maker, d.series), (seriesCounts.get(keyOf(d.maker, d.series)) || 0) + 1);
}
for (const r of accepted) {
  if (r.series) seriesCounts.set(keyOf(r.maker, r.series), (seriesCounts.get(keyOf(r.maker, r.series)) || 0) + 1);
}
const dropped = { equalsName: 0, single: 0 };
for (const r of accepted) {
  if (!r.series) continue;
  if (r.series === r.name) { r.series = ''; dropped.equalsName += 1; continue; }
  if ((seriesCounts.get(keyOf(r.maker, r.series)) || 0) < 2) { r.series = ''; dropped.single += 1; }
}
console.log(`シリーズ整理: 商品名と同じ ${dropped.equalsName} 件 / 1件だけのシリーズ ${dropped.single} 件 を落としました`);

if (!accepted.length) {
  console.log('追加する商品はありませんでした（すべて取り込み済み）。');
  process.exit(0);
}

/* ---------------- パートファイルへ書き出す ---------------- */

const tupleOf = (r) => JSON.stringify([
  r.jan, r.name, r.maker, r.category, r.colorName, r.size, r.code, r.source, r.series, r.keywords,
]);

if (DRY) {
  const bytes = accepted.reduce((n, r) => n + Buffer.byteLength(tupleOf(r)) + 4, 0);
  console.log(`--dry-run: 書き込むと約 ${(bytes / 1048576).toFixed(2)}MB（${Math.ceil(bytes / MAX_PART_BYTES)} パート）`);
  console.log('メーカー別:', Object.entries(accepted.reduce((m, r) => ({ ...m, [r.maker]: (m[r.maker] || 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(' / '));
  process.exit(0);
}

const partFiles = fs.readdirSync(DATA_DIR).filter((f) => /^jan-part-\d+\.js$/.test(f));
let partNo = Math.max(0, ...partFiles.map((f) => Number(/^jan-part-(\d+)\.js$/.exec(f)[1])));
const madeParts = [];
let lines = [];
let bytes = 0;
let total = 0;
const flush = () => {
  if (!lines.length) return;
  partNo += 1;
  const name = `jan-part-${partNo}.js`;
  madeParts.push(name);
  const header = `// 内蔵JAN辞書のデータ（パート${partNo}）— jan-database.js から読み込む
// このファイルは scripts/import-drive-jans.mjs が Drive の「JAN_<メーカー>網羅_統合.csv」から作ったもの。
// 出典: 世界堂オンラインショップ https://webshop.sekaido.co.jp/product/<品番> ほか（CSVの「出典URL」列）
// 取り込み ${new Date().toISOString().slice(0, 10)} / 収録 ${lines.length} 件
// [JAN, 商品名, メーカー, カテゴリ, 色名, 号数/容量, 品番, 出典(まつえだpid / 世界堂品番 / URL), シリーズ, キーワード]
export const RAW = [
${lines.join('\n')}
];
`;
  fs.writeFileSync(path.join(DATA_DIR, name), header);
  total += lines.length;
  lines = [];
  bytes = 0;
};
for (const r of accepted) {
  const line = `  ${tupleOf(r)},`;
  lines.push(line);
  bytes += Buffer.byteLength(line) + 1;
  if (bytes >= MAX_PART_BYTES) flush();
}
flush();
console.log(`パートを作成: ${madeParts.join(', ')}（合計 ${total} 件）`);

/* ---------------- jan-database.js の読み込み一覧を更新 ---------------- */

const allParts = fs.readdirSync(DATA_DIR)
  .filter((f) => /^jan-part-\d+\.js$/.test(f))
  .map((f) => Number(/^jan-part-(\d+)\.js$/.exec(f)[1]))
  .sort((a, b) => a - b);
const importBlock = allParts.map((n) => `import { RAW as RAW_PART_${n} } from './data/jan-part-${n}.js';`).join('\n');
const spread = allParts.map((n) => `...RAW_PART_${n}`).join(', ');

let db = fs.readFileSync(DB_FILE, 'utf8');
const importRe = /\/\/ データ本体は[\s\S]*?const RAW = \[[^\]]*\];/;
if (!importRe.test(db)) throw new Error('jan-database.js の読み込みブロックが見つかりません');
db = db.replace(importRe, `// データ本体は data/ のパートファイル（1パート = 12MB 未満。追加は新しいパートを足すだけ）
${importBlock}

const RAW = [${spread}];`);

/* ---------------- JAN_PREFIXES の再集計 ---------------- */

const brandOf = new Map(JAN_PREFIXES.map((p) => [p.maker, p.brand]));
const byMaker = new Map();
for (const p of JAN_PREFIXES) for (const m of p.makers || [p.maker]) if (!byMaker.has(m)) byMaker.set(m, p.brand);
const prefixInfo = new Map();
for (const p of JAN_PREFIXES) {
  prefixInfo.set(p.prefix, { maker: p.maker, brand: p.brand, makers: [...(p.makers || [p.maker])], count: 0, original: true });
}
const addToPrefix = (jan, maker) => {
  const key = jan.slice(0, 7);
  if (!prefixInfo.has(key)) {
    prefixInfo.set(key, { maker, brand: brandOf.get(maker) ?? byMaker.get(maker) ?? '', makers: [], count: 0, tallies: new Map() });
  }
  const info = prefixInfo.get(key);
  info.count += 1;
  if (!info.tallies) info.tallies = new Map();
  info.tallies.set(maker, (info.tallies.get(maker) || 0) + 1);
};
for (const d of JAN_DICTIONARY) addToPrefix(d.jan, d.maker);
for (const r of accepted) addToPrefix(r.jan, r.maker);

const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const prefixLines = [...prefixInfo.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([prefix, info]) => {
  const tally = [...(info.tallies || new Map()).entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
  // 代表メーカー: 既存の代表はそのまま、新しいプレフィックスは件数の多いメーカー
  const maker = info.original ? info.maker : (tally[0] || info.maker);
  const makers = [...new Set([...(info.makers || []), ...tally])];
  const brand = info.brand ?? brandOf.get(maker) ?? '';
  return `  { prefix: ${q(prefix)}, maker: ${q(maker)}, brand: ${q(brand)}, makers: [${makers.map(q).join(', ')}], count: ${info.count} },`;
});
const prefixBlockRe = /export const JAN_PREFIXES = \[[\s\S]*?\n\];/;
if (!prefixBlockRe.test(db)) throw new Error('JAN_PREFIXES が見つかりません');
db = db.replace(prefixBlockRe, `export const JAN_PREFIXES = [\n${prefixLines.join('\n')}\n];`);
db = db.replace(/\/\/ 収録 \d+ 件 \/ プレフィックス \d+ 件。/,
  `// 収録 ${JAN_DICTIONARY.length + accepted.length} 件 / プレフィックス ${prefixInfo.size} 件。`);
fs.writeFileSync(DB_FILE, db);

/* ---------------- 取り込み履歴 ---------------- */

const entry = {
  importedAt: new Date().toISOString().slice(0, 10),
  source: `Google Drive「AI秘書 / 05_副業・開発」の JAN_<メーカー>網羅_統合.csv（${files.length}ファイル）`,
  dir: path.relative(ROOT, DIR),
  files: report.files,
  skippedExisting: report.skippedExisting,
  duplicatesInBatch: report.duplicatesInBatch,
  invalid: report.invalid.slice(0, 50),
  seriesDropped: dropped,
  before: JAN_DICTIONARY.length,
  added: accepted.length,
  after: JAN_DICTIONARY.length + accepted.length,
  parts: madeParts.map((f) => `data/${f}`),
};
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
const log = fs.existsSync(LOG_FILE) ? JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')) : [];
log.push(entry);
fs.writeFileSync(LOG_FILE, `${JSON.stringify(log, null, 2)}\n`);

/* ---------------- 確認 ---------------- */

const after = await import(`../jan-database.js?t=${Date.now()}`);
const unique = new Set(after.JAN_DICTIONARY.map((d) => d.jan)).size;
console.log(`JAN_DICTIONARY: ${JAN_DICTIONARY.length} → ${after.JAN_DICTIONARY.length} 件（ユニーク ${unique}）/ プレフィックス ${after.JAN_PREFIXES.length} 件`);
console.log(`履歴: ${path.relative(ROOT, LOG_FILE)}`);
if (after.JAN_DICTIONARY.length !== JAN_DICTIONARY.length + accepted.length) {
  console.error('件数が合いません');
  process.exit(1);
}
