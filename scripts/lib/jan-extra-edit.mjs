// scripts/add-jan-extra.mjs の中身（検証・重複チェック・追記）を純粋関数にしたもの
// 13桁JANのチェックディジット検証と、内蔵辞書/既存の追加辞書との重複チェックを行う。
// 壊れた1件でファイル全体を壊さないよう、書き込みは検証を通った時だけ。
import { normalizeExtraEntry, parseExtraDictionary } from '../../jan-extra.js';

/** 13桁JANか（数字・チェックディジット） */
export function checkJan(jan) {
  const { entry, reason } = normalizeExtraEntry({
    jan, name: '確認用', maker: '確認用', category: 'other', source: 'https://example.com',
  });
  return { ok: Boolean(entry), reason: reason.replace(/（.*）$/, '') };
}

/**
 * 追記する1件を組み立てる。不正なら例外（日本語のメッセージ）。
 * @returns {object} 正規化済みの辞書レコード
 */
export function buildEntry(input = {}, { verifiedAt = '' } = {}) {
  const { entry, reason } = normalizeExtraEntry({
    jan: input.jan,
    name: input.name,
    maker: input.maker,
    brand: input.brand,
    category: input.category || 'other',
    colorName: input.colorName,
    size: input.size,
    code: input.code,
    source: input.source,
    verifiedAt,
  });
  if (!entry) throw new Error(reason);
  return entry;
}

/** 既存項目と辞書レコードが同じ内容か（追記の重複判定用） */
export function sameEntry(a, b) {
  const keys = ['jan', 'name', 'maker', 'brand', 'category', 'colorName', 'size', 'code', 'source'];
  return keys.every((k) => String(a?.[k] || '') === String(b?.[k] || ''));
}

/**
 * 重複を判定する。
 * @returns {{kind:'none'|'builtin'|'extra-identical'|'extra-different', index?:number}}
 */
export function findDuplicate(entry, builtin = [], extraItems = []) {
  if (builtin.some((e) => e.jan === entry.jan)) return { kind: 'builtin' };
  const index = extraItems.findIndex((e) => e.jan === entry.jan);
  if (index === -1) return { kind: 'none' };
  return { kind: sameEntry(extraItems[index], entry) ? 'extra-identical' : 'extra-different', index };
}

/**
 * 配信JSONに1件追記した新しいJSONオブジェクトを返す（元は変更しない）。
 * @returns {{payload:object, changed:boolean, reason:string}}
 */
export function appendEntry(payload, entry, { now = new Date().toISOString(), update = false, builtin = [], checkOnly = false } = {}) {
  const parsed = parseExtraDictionary(payload);
  if (parsed.error) return { payload, changed: false, reason: parsed.error };
  const extraItems = parsed.items;
  const dup = findDuplicate(entry, builtin, extraItems);
  if (dup.kind === 'builtin') return { payload, changed: false, reason: `内蔵辞書に既にあります（${entry.jan}）` };
  if (dup.kind === 'extra-identical') return { payload, changed: false, reason: `既に登録済みです（${entry.jan}）` };
  if (checkOnly) return { payload, changed: false, reason: '検証のみ（書き込みなし）' };

  let items;
  if (dup.kind === 'extra-different') {
    if (!update) {
      return { payload, changed: false, reason: `同じJANが別の内容で登録済みです（${entry.jan}）。--update で置き換えできます` };
    }
    items = extraItems.map((e, i) => (i === dup.index ? entry : e));
  } else {
    items = [...extraItems, entry];
  }
  return {
    payload: {
      version: Number(payload?.version) || 1,
      updatedAt: now,
      items: items.map(toFileShape),
    },
    changed: true,
    reason: dup.kind === 'extra-different' ? '置き換えました' : '追記しました',
  };
}

/** ファイルに書くときの並び（読みやすい固定順・origin は保存しない） */
export function toFileShape(entry) {
  return {
    jan: entry.jan,
    name: entry.name,
    maker: entry.maker,
    brand: entry.brand || '',
    category: entry.category,
    colorName: entry.colorName || '',
    size: entry.size || '',
    code: entry.code || '',
    source: entry.source,
    verifiedAt: entry.verifiedAt || '',
  };
}
