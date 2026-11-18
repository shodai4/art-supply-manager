#!/usr/bin/env node
// 内蔵JAN辞書（jan-database.js）の「色名・色番号・規格の欠落」と「シリーズ名の細分化」を直す移行スクリプト。
//
//   node scripts/fix-dict-labels.mjs --raw <分解前の jan-database.js> [--dry-run]
//   例) git show 1eeac73:jan-database.js > /tmp/jan-119.js
//       node scripts/fix-dict-labels.mjs --raw /tmp/jan-119.js
//
// なぜ必要だったか（2026-11-18）:
//   scripts/build-dictionary.mjs の分解で、商品名の中ほどにある色番（S005・SE-0・WFCT01 など）が
//   どの欄にも入らず keywords に落ちていた。そのため seriesItemLabel がシリーズ名だけを返し、
//   カタログの行が「アーチストソフトパステル」252件のように同じ名前で並んでいた。
//   さらに、分解が色名・セット名・色番までシリーズ名に吸い込んで、件数1〜2の細分化シリーズが
//   乱立していた（アーチスト色鉛筆 #1 / アーチスト色鉛筆 パステルカラー など）。
//
// やること:
//   1) 分解前の商品名と今の各欄を突き合わせ、どの欄にも残っていない語（＝落ちた識別子）を拾い直す。
//      色番らしき語 → code / 号数・容量らしき語 → size / 色名らしき語 → colorName。
//      当てはまらない語は keywords に残したまま（検索は今までどおり効く）。
//   2) シリーズ名の正規化。件数1〜2の細分化シリーズだけを対象に、
//      「基準シリーズ + 色名・色番・セット名」に分け直す（大きな製品ラインは触らない）。
//   3) 変更内容を docs/dict-repair-report.json に書き出す（あとから検証できるように）。
//
// 推測で埋めない: 拾い直す語は、元の商品ページから取った商品名に実在する語だけ。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'jan-database.js');
const REPORT = path.join(ROOT, 'docs', 'dict-repair-report.json');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const rawIdx = argv.indexOf('--raw');
const RAW_FILE = rawIdx >= 0 ? path.resolve(process.cwd(), argv[rawIdx + 1] || '') : '';

const NF = (s) => String(s || '').normalize('NFKC');
const stripBr = (s) => String(s || '').replace(/[（）()【[\]】〈〉《》＜＞<>]/g, '');
const bare = (s) => stripBr(NF(s)).toLowerCase().replace(/[\s　・=:]/g, '');

/* ---------------- 辞書を読む ---------------- */

function readRawRows(file) {
  const text = fs.readFileSync(file, 'utf8');
  const startAt = text.indexOf('const RAW = [');
  const endAt = text.indexOf('\n];', startAt);
  if (startAt < 0 || endAt < 0) throw new Error(`${file} に RAW 配列が見つかりません`);
  return text.slice(text.indexOf('\n', startAt) + 1, endAt).split('\n')
    .map((line) => line.trim()).filter((line) => line.startsWith('['))
    .map((line) => JSON.parse(line.replace(/,\s*$/, '')));
}

if (!RAW_FILE) {
  console.error('分解前の商品名が必要です: --raw <git show 1eeac73:jan-database.js の出力先>');
  process.exit(2);
}
const rawNames = new Map(readRawRows(RAW_FILE).map((row) => [row[0], row[1]]));

const rows = readRawRows(FILE);
const entries = rows.map(([jan, name, maker, category, colorName, size, code, src, series, keywords]) => ({
  jan, name, maker, category, colorName, size, code, src, series, keywords,
}));
console.log(`内蔵辞書 ${entries.length}件 / 分解前の商品名 ${rawNames.size}件`);

// 店頭の注記やメーカー名は、色名として拾わない（「在庫限ホルベイン」のような語）
const MAKER_WORDS = new Set();
{
  const dict = await import('../jan-database.js');
  for (const p of dict.JAN_PREFIXES || []) {
    for (const w of [p.maker, p.brand, ...(p.makers || [])]) if (w) MAKER_WORDS.add(bare(w));
  }
}
const NOTE_RE = /在庫限|限定|セール|特価|アウトレット|訳あり|新品|お取り寄せ/;
const isStoreNote = (t) => NOTE_RE.test(t) || MAKER_WORDS.has(bare(t));

/* ---------------- 語の種類 ---------------- */

const CODE_RES = [
  /^[#＃]\d{1,6}$/,
  /^No\.?\d{1,5}$/i,
  /^品番[:：]?\d+$/,
  /^[A-Za-z]{1,6}#\d{1,4}$/,
  /^[A-Za-z]{1,6}-?\d{1,6}[A-Za-z]{0,3}$/,
  /^\d{1,3}-\d{1,4}$/,
  /^[A-Za-z0-9]{1,10}-[A-Za-z0-9]{1,10}$/,
  /^\d{3,6}$/,
  /^[A-Za-z]{2,6}\d{1,6}$/,
  /^[A-Z]{2,4}$/,
];
const GRADE_RE = /^(?:\d{1,2})?(?:H|HB|B|F|S|M|L|LL|XS|XL|2S)$/i;
const SIZE_RES = [
  /^\d+(?:\.\d+)?(?:ml|g|kg|ℓ|l|L|cc|号|本|枚|色|切|cm|mm|m|%|インチ|ポンド|坪|度)$/,
  /^\d+(?:\.\d+)?[×xX]\d+(?:\.\d+)?(?:mm|cm|m)?$/,
  /^\d+(?:色セット|本セット|本入り|本入|本組|枚入り|枚入|枚セット|個入|個|組|片|段|色|本)$/,
];
const SET_WORDS = new Set([
  'セット', 'セット品', '単色', '詰合', '詰め合', '詰合せ', '詰合わせ', 'アソート', 'バラ', '業務用', '大容量',
  '特価', 'セール', '化粧箱', '木箱', '紙函', '紙函セット', 'ブリスター', 'ケース', '箱', '缶', 'チューブ',
  '瓶入り', 'ボトル', 'ハーフパン', 'フルパン', 'ケーキ', 'スモール', 'ラージ', 'ブレンダー', 'ダース',
  '入', '用', '付', 'タイプ', 'サイズ', '厚', '薄', '軽量', '限定', '在庫限', 'オリジナル', 'モデル',
  'シリーズ', 'ライン', 'カラー', 'メルツペンツイン', 'ウッドボックス', 'お徳用', '徳用',
]);
const COLOR_SUFFIX = /(ホワイト|ブラック|グレー|グレイ|レッド|ブルー|イエロー|グリーン|ブラウン|ピンク|オレンジ|パープル|バイオレット|ネイビー|ベージュ|オリーブ|ライム|カーキ|ワイン|ボルドー|アイボリー|クリーム|セピア|アンバー|シェンナ|オーカー|コバルト|ウルトラマリン|セルリアン|ターコイズ|ラベンダー|ライラック|モーブ|コーラル|サーモン|スカーレット|バーミリオン|クリムソン|カーマイン|マゼンタ|シアン|ゴールド|シルバー|パール|メタリック|ルミナス|蛍光|色)$/;
const COLOR_WORDS = new Set(['赤', '青', '黄', '緑', '紫', '桃', '橙', '白', '黒', '灰', '茶', '水色', '空色', '金', '銀', '山吹', '若草', '群青', '臙脂', '弁柄', '代赭', '生成', '朱', '藍']);

const PAINT_CATS = new Set(['oil', 'watercolor', 'acrylic', 'pastel', 'colored_pencil', 'crayon', 'nihonga', 'copic', 'marker', 'pen']);
const colorFreq = new Map();
for (const e of entries) {
  if (!PAINT_CATS.has(e.category)) continue;
  const c = NF(e.colorName || '').trim();
  if (!c) continue;
  for (const w of c.split(/\s+/)) colorFreq.set(w, (colorFreq.get(w) || 0) + 1);
}
const colorVocab = new Set([...colorFreq.entries()].filter(([, n]) => n >= 3).map(([w]) => w));

const isCode = (t) => CODE_RES.some((re) => re.test(t));
const isSize = (t) => SIZE_RES.some((re) => re.test(t));
const isGrade = (t) => GRADE_RE.test(NF(t));
const isSetWord = (t) => SET_WORDS.has(NF(t));
const isColorWord = (t) => COLOR_WORDS.has(NF(t)) || COLOR_SUFFIX.test(NF(t)) || colorVocab.has(NF(t));
const isVariantToken = (t) => isCode(t) || isSize(t) || isGrade(t) || isSetWord(t) || isColorWord(t);
const isLineupToken = (t) => /(カラー|シリーズ|セレクト|アソート)$/.test(NF(t));
/** 筆の形など、シリーズ名に残すべき語（色名と取り違えない） */
const SHAPE_RE = /^(フラット|ラウンド|オーバル|フィルバート|ソード|ライナー|モップ|ファン|アングル|スクエア|ダブ|スポンジ|平筆|丸筆|面相|彩色|ぼかし|ドライ|ウォッシュ|平|丸)$/;
/** 色名・セット名などの「バリエーション」を表す、括弧や語尾で切り出した断片 */
function piecesOf(token) {
  const out = [token];
  for (const part of token.split(/[（(【[\]〈《＜<]/)) if (part.trim()) out.push(part.trim());
  for (const part of token.split(/[）)】[\]〉》＞>]/)) if (part.trim()) out.push(part.trim());
  // 「ワーグマンブック(厚口)GM-F0」のように括弧のあとに品番が続く場合
  const tail = token.match(/^(.*?)([#＃][0-9]{1,6}|[A-Za-z]{1,6}-[A-Za-z0-9]{1,6}|[A-Za-z]{1,6}[0-9]{2,6}|[0-9]{3,5})$/);
  if (tail && tail[1]) out.push(tail[2], tail[1].trim());
  return [...new Set(out)];
}

/* ---------------- 1) 落ちた識別子（色番・規格・色名）を拾い直す ---------------- */

const recovered = { code: 0, size: 0, colorName: 0, grade: 0 };
for (const e of entries) {
  const raw = rawNames.get(e.jan);
  if (!raw) continue; // 分解後に足した項目（keywords に元の語が残っている）
  const hay = bare([e.name, e.series, e.colorName, e.size, e.code, e.maker].join(''));
  const missing = [];
  for (const token of NF(raw).split(/[\s　]+/).filter(Boolean)) {
    for (const piece of piecesOf(token)) {
      const b = bare(piece);
      if (!b || hay.includes(b)) continue;
      const word = stripBr(piece).trim();
      if (word && !missing.includes(word)) missing.push(word);
    }
  }
  if (!missing.length) continue;
  if (!e.code) {
    const hit = missing.find(isCode);
    if (hit) { e.code = hit; recovered.code += 1; }
  }
  const rest = missing.filter((t) => !isCode(t));
  // 色名として拾うのは、色を持つカテゴリ（絵具・色鉛筆・パステル・マーカー等）とその他だけ。
  // 紙・筆・キャンバス・額縁は規格や厚みの語が多く、色名に入れると誤りになる。
  const colorOk = PAINT_CATS.has(e.category) || e.category === 'other';
  if (!e.size) {
    const hit = rest.find(isSize);
    if (hit) { e.size = hit; recovered.size += 1; }
  }
  if (!e.colorName && colorOk) {
    const hit = rest.find(isColorWord);
    if (hit) { e.colorName = hit; recovered.colorName += 1; }
  }
  if (!e.size && !e.colorName) {
    const hit = rest.find(isGrade);
    if (hit) { e.size = hit; recovered.grade += 1; }
  }
  if (!e.colorName && colorOk) {
    // 元の商品名にだけ残っていた短い語（＜ナチュラル＞ など）は色名として拾う
    const hit = rest.find((t) => /^[ぁ-んァ-ヶー一-龯]{2,12}$/.test(t)
      && !isSetWord(t) && !isGrade(t) && !isStoreNote(t));
    if (hit) { e.colorName = hit; recovered.colorName += 1; }
  }
}
console.log('拾い直し:', recovered);

/* ---------------- 1.5) 名前に混ざった店頭注記・品番を落とす ---------------- */
// 「【在庫限】ホルベイン アートバッグ …」「品番:01 パーマネントバイオレット …」のように、
// 店頭の注記や品番が商品名の頭に残っていると、行の名前が長くなって読みにくい。
// 品番は code に入っているので、名前からは落として検索語（keywords）にだけ残す。
let tidied = 0;
for (const e of entries) {
  let name = String(e.name || '').trim();
  const before = name;
  name = name.replace(/^(?:【?在庫限り?】?)[\s　]*/, '');
  const tokens = name.split(/\s+/);
  const keep = [];
  const moved = [];
  for (const token of tokens) {
    const m = token.match(/^品番[:：]?(\d+)$/);
    if (m && String(e.code || '') === m[1]) { moved.push(token); continue; }
    keep.push(token);
  }
  name = keep.join(' ').trim();
  if (name && name !== before) {
    e.name = name;
    if (moved.length) e.keywords = [e.keywords, ...moved].filter(Boolean).join(' ');
    tidied += 1;
  }
}
console.log('名前の整理:', tidied, '件');

/* ---------------- 2) シリーズ名の正規化 ---------------- */

const merges = [];
for (let pass = 0; pass < 4; pass += 1) {
  let changed = 0;
  const byMaker = new Map();
  for (const e of entries) {
    if (!byMaker.has(e.maker)) byMaker.set(e.maker, []);
    byMaker.get(e.maker).push(e);
  }
  for (const [maker, list] of byMaker) {
    const count = new Map();
    for (const e of list) if (e.series) count.set(e.series, (count.get(e.series) || 0) + 1);
    const kinds = new Map(); // 接頭辞 → その接頭辞で始まるシリーズ名の種類数
    for (const series of count.keys()) {
      const tokens = series.split(/\s+/);
      for (let k = 1; k < tokens.length; k += 1) {
        const prefix = tokens.slice(0, k).join(' ');
        if (!kinds.has(prefix)) kinds.set(prefix, new Set());
        kinds.get(prefix).add(series);
      }
    }
    for (const e of list) {
      const series = String(e.series || '').trim();
      if (!series) continue;
      const tokens = series.split(/\s+/);
      if (tokens.length < 2) continue;
      const selfN = count.get(series) || 0;
      if (selfN > 2) continue; // 大きい製品ラインは動かさない（細分化した1〜2件だけを畳む）
      for (let k = tokens.length - 1; k >= 1; k -= 1) {
        const base = tokens.slice(0, k).join(' ');
        const rest = tokens.slice(k);
        const exists = count.has(base);
        const baseN = count.get(base) || 0;
        const nKinds = kinds.get(base)?.size || 0;
        if (!exists && nKinds < 2) continue;
        if (exists && baseN < selfN) continue;
        const strict = rest.every((t) => isVariantToken(t) || isLineupToken(t));
        const relaxed = !strict && exists && baseN >= 3 && rest.length <= 3
          && rest.every((t) => !SHAPE_RE.test(NF(t)));
        if (!strict && !relaxed) continue;
        merges.push({ maker, from: series, to: base, rest: rest.join(' '), n: selfN, baseN });
        e.series = base;
        const restText = rest.join(' ').trim();
        if (restText && !e.colorName) e.colorName = restText;
        changed += 1;
        break;
      }
    }
  }
  console.log(`シリーズ名の統合 pass${pass + 1}: ${changed}件`);
  if (!changed) break;
}

/* ---------------- 3) 結果をまとめる ---------------- */

const out = entries.map((e) => [
  e.jan, e.name, e.maker, e.category, e.colorName, e.size, e.code, e.src, e.series, e.keywords,
]);
const seriesCount = new Map();
for (const e of entries) {
  if (!e.series) continue;
  const key = `${e.maker}\u0000${e.series}`;
  seriesCount.set(key, (seriesCount.get(key) || 0) + 1);
}
const singletons = [...seriesCount.values()].filter((n) => n === 1).length;
console.log(`\nシリーズ ${seriesCount.size}件（うち1件だけ ${singletons}件）`);

const before = JSON.parse(fs.existsSync(REPORT) ? fs.readFileSync(REPORT, 'utf8') : '{}');
const report = {
  generatedAt: new Date().toISOString(),
  source: 'scripts/fix-dict-labels.mjs',
  rawNames: RAW_FILE ? path.relative(ROOT, RAW_FILE) : '',
  total: entries.length,
  recovered,
  seriesMerges: merges.length,
  seriesGroups: seriesCount.size,
  singleItemSeries: singletons,
  merges,
  ...(before.notes ? { notes: before.notes } : {}),
};
fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 1)}\n`);
console.log(`変更内容: ${path.relative(ROOT, REPORT)}`);

if (DRY) {
  console.log('\n--dry-run のため jan-database.js は書き換えていません');
  process.exit(0);
}

/* ---------------- 4) jan-database.js を書き戻す ---------------- */

const text = fs.readFileSync(FILE, 'utf8');
const startAt = text.indexOf('const RAW = [');
const endAt = text.indexOf('\n];', startAt);
const header = text.slice(0, text.indexOf('\n', startAt) + 1).replace(/収録 \d+ 件/, `収録 ${out.length} 件`);
const footer = text.slice(endAt + 1);
const body = out.map((row) => `  ${JSON.stringify(row)},`).join('\n');
const next = `${header}${body}${footer}`;
fs.writeFileSync(FILE, next);
console.log(`jan-database.js を書き換えました（${out.length}件・${(Buffer.byteLength(next) / 1024 / 1024).toFixed(2)}MB）`);
