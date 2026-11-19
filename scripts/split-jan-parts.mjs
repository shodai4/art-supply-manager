#!/usr/bin/env node
// 内蔵JAN辞書のデータを data/jan-part-*.js に分ける（1回だけの移行スクリプト）。
//
//   node scripts/split-jan-parts.mjs [--dry-run]
//
// 2026-11-19、Drive の15社分（46,733件）を取り込むにあたり、jan-database.js が
// 単一ファイルでは 12MB の上限を超えるため、データ（RAW 配列）を data/ 配下の
// パートファイルへ移した。以後の追加は scripts/import-drive-jans.mjs が
// 新しいパートを足すだけで済む（jan-database.js は読み込みと結合だけを持つ）。
//
// このスクリプトは「今の jan-database.js の中の RAW」を data/jan-part-1.js へ出し、
// jan-database.js を「プレフィックス＋ブランド＋読み込み」だけの形に書き換える。
// 件数と中身が変わっていないことを最後に確かめる（ハッシュ比較）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'jan-database.js');
const DATA_DIR = path.join(ROOT, 'data');
const DRY = process.argv.includes('--dry-run');

const text = fs.readFileSync(FILE, 'utf8');
const startAt = text.indexOf('\nconst RAW = [');
const endAt = text.indexOf('\n];', startAt);
if (startAt < 0 || endAt < 0) throw new Error('jan-database.js に const RAW = [ が見つかりません');

const header = text.slice(0, text.indexOf('const MATUEDA_ITEM')).trimEnd();
const rowsText = text.slice(startAt + 1 + 'const RAW = ['.length, endAt);
const rowCount = rowsText.split('\n').filter((l) => l.trim().startsWith('[')).length;
const tail = text.slice(endAt + 3).trimStart(); // "];" の後ろ（JAN_DICTIONARY の組み立て）

const before = await import('../jan-database.js');
const digest = (list) => createHash('sha256').update(JSON.stringify(list)).digest('hex');
const beforeHash = digest(before.JAN_DICTIONARY);

const partHeader = `// 内蔵JAN辞書のデータ（1/1）— jan-database.js から読み込む
// このファイルは scripts/split-jan-parts.mjs が jan-database.js の中の RAW を移したもの。
// 出典: 世界堂オンラインショップ https://webshop.sekaido.co.jp/product/<品番>（商品ページのJSON-LD gtin13）
//       額のまつえだ https://www.matueda.com/ ／ ステッドラー日本公式 ／ 笹部洋画材料店 ／ アスクル ／ e-画材.com
// 収録 ${rowCount} 件（2026-11-19 時点・チェックディジット検証済み）
// [JAN, 商品名, メーカー, カテゴリ, 色名, 号数/容量, 品番, 出典(まつえだpid / 世界堂品番), シリーズ, キーワード]
export const RAW = [
${rowsText}
];
`;

const newFile = `${header}

const MATUEDA_ITEM = "https://www.matueda.com/?pid=";
const SEKAIDO_ITEM = "https://webshop.sekaido.co.jp/product/";

// データ本体は data/ のパートファイル（1パート = 12MB 未満。追加は新しいパートを足すだけ）
import { RAW as RAW_PART_1 } from './data/jan-part-1.js';

const RAW = [...RAW_PART_1];

${tail}`;

if (DRY) {
  console.log(`rows=${rowCount} / 新しい jan-database.js は ${newFile.split('\n').length} 行（--dry-run なので書きません）`);
  process.exit(0);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(DATA_DIR, 'jan-part-1.js'), partHeader);
fs.writeFileSync(FILE, newFile);

const after = await import(`../jan-database.js?t=${Date.now()}`);
const afterHash = digest(after.JAN_DICTIONARY);
console.log(`rows=${rowCount} / JAN_DICTIONARY=${after.JAN_DICTIONARY.length}`);
console.log(`中身のハッシュ before=${beforeHash.slice(0, 12)} after=${afterHash.slice(0, 12)} ${beforeHash === afterHash ? '一致' : '不一致！'}`);
if (beforeHash !== afterHash) process.exit(1);
