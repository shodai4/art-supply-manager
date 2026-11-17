#!/usr/bin/env node
// 内蔵JAN辞書（jan-database.js）を18カテゴリへ再分類し、
// 商品名から「シリーズ／色名／色番号／号数・容量／整頓後の商品名」を作り直す。
//
//   node scripts/build-dictionary.mjs            … 書き換える
//   node scripts/build-dictionary.mjs --dry-run  … 集計だけ出す（書き換えない）
//   node scripts/build-dictionary.mjs --from <path> … 元データにする jan-database.js を指定
//
// 入力は元の商品名が入った jan-database.js の RAW（出力も同じファイル）。
// すでに分解済みのファイルを渡したときは、分解をやり直さずカテゴリだけ見直す。
// 分解からやり直すときは 1.19 以前のファイルを --from で渡す:
//   git show 1eeac73:jan-database.js > /tmp/jan-database-119.js
//   node scripts/build-dictionary.mjs --from /tmp/jan-database-119.js
// 検索の退行を防ぐため、元の商品名の語が新しい検索対象（名前・シリーズ・色名・
// メーカー・ブランド・号数・色番号・JAN）から漏れたら keywords に残す。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAliases, buildColorLex, buildTokFreq, classifyCategory, decompose,
} from './lib/dict-decompose.mjs';
import { normalizeSearchText } from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'jan-database.js');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const fromIdx = argv.indexOf('--from');
const FROM = fromIdx >= 0 ? path.resolve(process.cwd(), argv[fromIdx + 1]) : '';
if (fromIdx >= 0 && !FROM) throw new Error('--from に元の jan-database.js のパスを渡してください');

/* ---------------- 辞書を読む ---------------- */

const text = fs.readFileSync(FROM || FILE, 'utf8');
const startAt = text.indexOf('const RAW = [');
const endAt = text.indexOf('\n];', startAt);
if (startAt < 0 || endAt < 0) throw new Error('jan-database.js の RAW 配列が見つかりません');
const rawBlock = text.slice(text.indexOf('\n', startAt) + 1, endAt);

const rows = [];
for (const line of rawBlock.split('\n')) {
  const t = line.trim();
  if (!t.startsWith('[')) continue;
  rows.push(JSON.parse(t.replace(/,\s*$/, '')));
}
console.log(`RAW ${rows.length}件を読み込みました`);

/* ---------------- 分解 ---------------- */

const base = rows.map(([jan, name, maker, category, colorName, size, code, src, series, keywords]) => ({
  jan, name, maker, category, colorName, size, code, src, series, keywords,
}));

const aliasList = buildAliases([...new Set(base.map((d) => d.maker))]);
const colorLex = buildColorLex(base);
const tokFreq = buildTokFreq(base);
const ctx = { aliases: aliasList, colorLex, tokFreq };

const catCount = new Map();
const changed = [];
const out = [];
let withSeries = 0;
let withColor = 0;
let withSize = 0;
let nameShorter = 0;
let keywordsAdded = 0;
let nameStartsWithMaker = 0;
let emptyKeyword = 0;

// すでに分解済み（series あり）の辞書を読み込んだときは、分解をやり直さずカテゴリだけ見直す。
// 元の商品名は分解後の name に残っていないので、分解からやり直すときは 1.19 以前の
// jan-database.js（git show 1eeac73:jan-database.js）を --from で渡す。
let builtAlready = 0;
for (const entry of base) {
  if (entry.series !== undefined) builtAlready += 1;
}
if (builtAlready) {
  console.log(`既に分解済みの項目が ${builtAlready}件あります（分解はやり直さずカテゴリだけ見直します）`);
}

for (const entry of base) {
  const { category } = classifyCategory(entry, { aliasList });
  if (entry.series !== undefined) {
    const kept = {
      name: entry.name, colorName: entry.colorName || '', code: entry.code || '', size: entry.size || '', series: entry.series || '',
    };
    const hay = normalizeSearchText([kept.name, kept.colorName, entry.maker, '', kept.size, kept.code, entry.jan, kept.series, entry.keywords || ''].join(' ')).replace(/\s+/g, '');
    const missing = String(entry.keywords || '').split(/\s+/).filter(Boolean);
    for (const tok of normalizeSearchText(entry.name).split(/\s+/).filter(Boolean)) {
      if (!hay.includes(tok) && !missing.includes(tok)) missing.push(tok);
    }
    catCount.set(category, (catCount.get(category) || 0) + 1);
    if (kept.series) withSeries += 1;
    if (kept.colorName) withColor += 1;
    if (kept.size) withSize += 1;
    out.push([entry.jan, kept.name, entry.maker, category, kept.colorName, kept.size, kept.code, entry.src, kept.series, missing.join(' ')]);
    continue;
  }
  if (category !== entry.category) changed.push({ jan: entry.jan, from: entry.category, to: category, name: entry.name });
  const r = decompose({ ...entry, category }, ctx);

  let series = r.series || '';
  let color = r.color || '';
  const size = r.size || '';
  if (series && color && normalize(series) === normalize(color)) series = '';
  let name = r.cleanName || r.name || '';
  name = name.replace(/\s{2,}/g, ' ').trim();
  if (name.length < 2 || !name) name = entry.name;

  const fields = {
    name,
    colorName: color,
    // 商品名から色番を拾えなかったときは、元の色番号欄を残す（既存の登録内容を失わない）
    code: r.code || String(entry.code || '').trim(),
    size,
    series,
  };
  const brand = '';
  // 検索の対象（core.js の dictionaryHaystack と同じ並び）から空白を詰めたもの
  const hay = normalizeSearchText([
    fields.name, fields.colorName, entry.maker, brand, fields.size, fields.code, entry.jan, fields.series,
  ].join(' ')).replace(/\s+/g, '');
  // 括弧を外しただけの語（「パステル(単色)」→「パステル 単色」）は失っていないので数えない
  const loose = (s) => normalizeSearchText(s).replace(/[()（）【】〈〉《》\[\],、，=#]/g, '').replace(/\s+/g, '');
  const hayLoose = loose([
    fields.name, fields.colorName, entry.maker, brand, fields.size, fields.code, entry.jan, fields.series,
  ].join(' '));
  const missing = [];
  for (const tok of normalizeSearchText(entry.name).split(/\s+/).filter(Boolean)) {
    if (hay.includes(tok)) continue;
    if (hayLoose.includes(loose(tok))) continue;
    if (!missing.includes(tok)) missing.push(tok);
  }
  const keywords = missing.join(' ');
  if (keywords) keywordsAdded += 1;

  catCount.set(category, (catCount.get(category) || 0) + 1);
  if (series) withSeries += 1;
  if (color) withColor += 1;
  if (size) withSize += 1;
  if (fields.name.length < entry.name.length) nameShorter += 1;
  if (entry.maker && fields.name.startsWith(entry.maker)) nameStartsWithMaker += 1;
  if (!keywords) emptyKeyword += 1;

  out.push([entry.jan, fields.name, entry.maker, category, fields.colorName, fields.size, fields.code, entry.src, fields.series, keywords]);
}

const total = out.length || 1;
console.log('\nカテゴリ別件数:');
for (const [c, n] of [...catCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${c.padEnd(15)} ${String(n).padStart(6)} (${((n / total) * 100).toFixed(1)}%)`);
}
console.log(`\nカテゴリを変えた件数: ${changed.length}`);
const byMove = new Map();
for (const c of changed) {
  const k = `${c.from} → ${c.to}`;
  byMove.set(k, (byMove.get(k) || 0) + 1);
}
for (const [k, n] of [...byMove.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${k}: ${n}`);
console.log(`\nシリーズあり: ${withSeries} / 色名あり: ${withColor} / 号数あり: ${withSize}`);
console.log(`名前が短くなった: ${nameShorter} / メーカー名で始まる名前: ${nameStartsWithMaker}`);
console.log(`検索語をkeywordsに残した: ${keywordsAdded} / keywords空: ${emptyKeyword}`);

if (DRY) {
  const n = 5;
  console.log('\n例（先頭）:');
  for (const [jan, name, maker, category, colorName, size, code, src, series, keywords] of out.slice(0, n)) {
    console.log(`  ${jan} [${category}] ${maker} | ${name} | series=${series} color=${colorName} size=${size} code=${code} kw=${keywords} src=${src}`);
  }
  const sample = [0.25, 0.5, 0.75].map((p) => out[Math.floor(out.length * p)]);
  console.log('\n例（中ほど）:');
  for (const [jan, name, maker, category, colorName, size, code, src, series, keywords] of sample) {
    console.log(`  ${jan} [${category}] ${maker} | ${name} | series=${series} color=${colorName} size=${size} code=${code} kw=${keywords}`);
  }
  process.exit(0);
}

function normalize(s) {
  return normalizeSearchText(s).replace(/\s+/g, '');
}

/* ---------------- 書き出し ---------------- */

const header = text.slice(0, text.indexOf('\n', startAt) + 1)
  .replace(/収録 (\d+) 件/, `収録 ${out.length} 件`);
const footer = `];
export const JAN_DICTIONARY = RAW.map(([jan, name, maker, category, colorName, size, code, src, series, keywords]) => ({
  jan, name, maker, category, colorName, size, code, series, keywords,
  brand: BRAND_BY_MAKER[maker] || "",
  source: typeof src === "number" ? MATUEDA_ITEM + src
    : (/^[A-Z]\\d+$/.test(String(src)) ? SEKAIDO_ITEM + String(src) : String(src)),
  verifiedAt: VERIFIED_AT,
}));

export default JAN_DICTIONARY;
`;
const body = out.map((t) => `  ${JSON.stringify(t)},`).join('\n');
const next = `${header}${body}\n${footer}`;
fs.writeFileSync(FILE, next);
console.log(`\n${path.relative(ROOT, FILE)} を書き換えました（${out.length}件・${(Buffer.byteLength(next) / 1024 / 1024).toFixed(2)}MB）`);
