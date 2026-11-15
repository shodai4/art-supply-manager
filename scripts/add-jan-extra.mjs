#!/usr/bin/env node
// 追加辞書 jan-extra.json に1件を安全に追記する運用スクリプト
//
// 例:
//   node scripts/add-jan-extra.mjs --jan 4900669001911 --name "ホルベイン 油絵具 シルバー 6号" \
//     --maker ホルベイン --category oil --color シルバー --size 6号 --code H191 \
//     --source https://www.matueda.com/?pid=XXXX
//
// 検証:
//   - 13桁JANとチェックディジット
//   - カテゴリ（core.js の CATEGORIES）・出典URL
//   - 内蔵辞書（jan-database.js）との重複 → 追記しない
//   - 追加辞書との重複 → 同一内容なら何もしない / 内容違いは --update で置き換え
//
// オプション:
//   --file <path>   追記するJSON（既定: jan-extra.json）
//   --dry-run       検証だけして書き込まない
//   --update        同じJANの内容違いを置き換える
//   --list          現在の収録件数と一覧を表示
//   --json          結果をJSONで表示（CI向け）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JAN_DICTIONARY } from '../jan-database.js';
import { parseExtraDictionary } from '../jan-extra.js';
import { buildEntry, appendEntry } from './lib/jan-extra-edit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILE = path.join(ROOT, 'jan-extra.json');

const FLAGS = new Set(['dry-run', 'update', 'list', 'json', 'help']);
const ALIASES = {
  jan: 'jan', name: 'name', maker: 'maker', brand: 'brand', category: 'category',
  color: 'colorName', colorName: 'colorName', size: 'size', code: 'code',
  source: 'source', file: 'file',
};

function parseArgs(argv) {
  const out = { flags: new Set(), values: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    if (FLAGS.has(key)) {
      out.flags.add(key);
      continue;
    }
    const value = eq === -1 ? argv[++i] : body.slice(eq + 1);
    const target = ALIASES[key];
    if (!target) throw new Error(`不明なオプションです: --${key}`);
    if (value === undefined) throw new Error(`--${key} の値がありません`);
    out.values[target] = value;
  }
  return out;
}

function readPayload(file) {
  if (!fs.existsSync(file)) return { version: 1, updatedAt: new Date().toISOString(), items: [] };
  const text = fs.readFileSync(file, 'utf8');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${path.basename(file)} がJSONとして読めません`);
  }
  return data;
}

function main(argv) {
  const { flags, values } = parseArgs(argv);
  if (flags.has('help')) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 26).join('\n'));
    return 0;
  }
  const file = values.file ? path.resolve(values.file) : DEFAULT_FILE;
  const payload = readPayload(file);
  const parsed = parseExtraDictionary(payload);
  if (parsed.error) throw new Error(parsed.error);

  if (flags.has('list')) {
    console.log(`追加辞書: ${parsed.items.length}件（${path.basename(file)} / 更新 ${payload.updatedAt || '不明'}）`);
    for (const e of parsed.items) console.log(`  ${e.jan}  ${e.maker}  ${e.name}`);
    if (parsed.invalid.length) {
      console.error(`不正な項目: ${parsed.invalid.length}件（${parsed.invalid.map((i) => i.reason).join(' / ')}）`);
      return 1;
    }
    return 0;
  }

  const entry = buildEntry(values, { verifiedAt: new Date().toISOString().slice(0, 10) });
  const result = appendEntry(payload, entry, {
    update: flags.has('update'),
    builtin: JAN_DICTIONARY,
    checkOnly: flags.has('dry-run'),
  });

  if (flags.has('json')) {
    console.log(JSON.stringify({ ok: result.changed || !flags.has('dry-run'), reason: result.reason, entry }, null, 2));
  } else {
    console.log(`${result.reason}: ${entry.jan} ${entry.maker} ${entry.name}`);
  }

  if (result.payload && result.changed) {
    fs.writeFileSync(file, `${JSON.stringify(result.payload, null, 2)}\n`, 'utf8');
    if (!flags.has('json')) console.log(`書き込みました: ${path.relative(ROOT, file)}（${result.payload.items.length}件）`);
  }
  // 失敗（追記も置換もしていない）は終了コード2で知らせる
  if (!result.changed && !flags.has('dry-run')) {
    const benign = /既に登録済み/.test(result.reason);
    return benign ? 0 : 2;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`エラー: ${err.message}`);
    process.exitCode = 1;
  }
}
