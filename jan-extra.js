// 追加JAN辞書（DBゼロ配信）まわり
// 配信ファイル jan-extra.json を読み込み、内蔵辞書（jan-database.js）と重複なく合成する。
// ネットワークが失敗しても、同梱の2,327件＋localStorageのキャッシュで動く。
// DOMに触れないので node --test からそのまま検証できる。
import { CATEGORIES, calcCheckDigit, normalizeJAN, stripEmoji } from './core.js';

/** 配信ファイルの場所（アプリのルートからの相対パス。GitHub Pages のサブパスでも解決する） */
export const EXTRA_DICT_URL = 'jan-extra.json';
export const EXTRA_CACHE_KEY = 'art-supply-manager/jan-extra/v1';
/** このアプリが理解できる jan-extra.json のスキーマ版 */
export const EXTRA_SCHEMA_VERSION = 1;
/** 通信の待ち時間の上限（ミリ秒）。遅い回線でも起動を止めない */
export const EXTRA_FETCH_TIMEOUT_MS = 6000;

export const ISSUE_NEW_URL = 'https://github.com/shodai4/art-supply-manager/issues/new';

const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));
const CATEGORY_LABELS = new Map(CATEGORIES.map((c) => [c.id, c.label]));

/** メーカー名からブランド表記を作らない（内蔵辞書の brand は空でも良い） */
function clean(value) {
  return stripEmoji(value).trim();
}

/** 出典URLとして受け付ける形（http/https のみ） */
function cleanSource(value) {
  const s = String(value == null ? '' : value).trim();
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : '';
}

/**
 * jan-extra.json の1件を検証して辞書レコードに整える。
 * 不正な項目は理由つきで弾く（黙って壊れたデータを混ぜない）。
 * @returns {{entry: object|null, reason: string}}
 */
export function normalizeExtraEntry(raw) {
  if (!raw || typeof raw !== 'object') return { entry: null, reason: 'オブジェクトではありません' };
  const jan = normalizeJAN(raw.jan);
  if (!/^\d{13}$/.test(jan)) return { entry: null, reason: `JANが13桁ではありません（${raw.jan ?? '空'}）` };
  if (calcCheckDigit(jan.slice(0, 12)) !== Number(jan[12])) {
    return { entry: null, reason: `JANのチェックディジットが合いません（${jan}）` };
  }
  const name = clean(raw.name);
  if (name.length < 2) return { entry: null, reason: `商品名がありません（${jan}）` };
  const maker = clean(raw.maker);
  if (!maker) return { entry: null, reason: `メーカーがありません（${jan}）` };
  const category = String(raw.category || '').trim();
  if (!CATEGORY_IDS.has(category)) return { entry: null, reason: `カテゴリが不正です（${jan}: ${category || '空'}）` };
  const source = cleanSource(raw.source);
  if (!source) return { entry: null, reason: `出典URL（http/https）がありません（${jan}）` };

  return {
    entry: {
      jan,
      name,
      maker,
      brand: clean(raw.brand),
      category,
      colorName: clean(raw.colorName),
      size: clean(raw.size),
      code: clean(raw.code),
      source,
      verifiedAt: String(raw.verifiedAt || '').trim(),
      origin: 'extra',
    },
    reason: '',
  };
}

/**
 * 配信JSONを読み解く。1件でも壊れていれば全体を捨てるのではなく、
 * 正常な項目だけを採用し、弾いた理由を返す（配信側の事故でアプリを止めない）。
 * @returns {{schemaVersion:number, updatedAt:string, items:object[], invalid:Array, duplicates:string[], error:string}}
 */
export function parseExtraDictionary(payload) {
  const out = { schemaVersion: EXTRA_SCHEMA_VERSION, updatedAt: '', items: [], invalid: [], duplicates: [], error: '' };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    out.error = 'jan-extra.json の形式が想定と違います';
    return out;
  }
  if (!Array.isArray(payload.items)) {
    out.error = 'jan-extra.json に items 配列がありません';
    return out;
  }
  out.schemaVersion = Number(payload.version) || EXTRA_SCHEMA_VERSION;
  out.updatedAt = String(payload.updatedAt || '');
  const seen = new Set();
  for (const raw of payload.items) {
    const { entry, reason } = normalizeExtraEntry(raw);
    if (!entry) {
      out.invalid.push({ jan: normalizeJAN(raw && raw.jan), reason });
      continue;
    }
    if (seen.has(entry.jan)) {
      out.duplicates.push(entry.jan);
      continue;
    }
    seen.add(entry.jan);
    out.items.push(entry);
  }
  return out;
}

/**
 * 内蔵辞書と追加辞書を合成する（JANで重複排除）。
 * 同じJANが両方にある場合は内蔵（出典確認済み）を優先し、衝突として数える。
 * @returns {{items:object[], builtin:number, extra:number, added:number, conflicts:string[], total:number, extraJans:string[]}}
 */
export function mergeDictionaries(base = [], extra = []) {
  const items = [];
  const seen = new Set();
  for (const e of base) {
    if (!e || seen.has(e.jan)) continue;
    seen.add(e.jan);
    items.push(e);
  }
  const builtin = items.length;
  const extraJans = [];
  const conflicts = [];
  let added = 0;
  for (const e of extra) {
    if (!e || !e.jan) continue;
    if (seen.has(e.jan)) {
      conflicts.push(e.jan);
      continue;
    }
    seen.add(e.jan);
    items.push(e);
    extraJans.push(e.jan);
    added += 1;
  }
  return { items, builtin, extra: extra.length, added, conflicts, total: items.length, extraJans };
}

/** 合成済み辞書から JAN 一致の1件を引く（追加分も含む） */
export function lookupIn(items, jan) {
  const d = normalizeJAN(jan);
  if (!/^\d{13}$/.test(d)) return null;
  return items.find((e) => e.jan === d) || null;
}

/* ---------------- localStorage キャッシュ ---------------- */

/** 前回の配信内容を読む（壊れていれば null） */
export function readCache(storage, key = EXTRA_CACHE_KEY) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.payload) return null;
    const parsed = parseExtraDictionary(data.payload);
    if (parsed.error) return null;
    return { ...parsed, cachedAt: String(data.cachedAt || '') };
  } catch {
    return null;
  }
}

/** 配信内容を保存する（容量不足などは握りつぶし、失敗を返す） */
export function writeCache(storage, payload, cachedAt = new Date().toISOString(), key = EXTRA_CACHE_KEY) {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify({ cachedAt, payload }));
    return true;
  } catch {
    return false;
  }
}

/** キャッシュを消す（辞書キャッシュの破棄用） */
export function clearCache(storage, key = EXTRA_CACHE_KEY) {
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/* ---------------- 同期 ---------------- */

/**
 * jan-extra.json を取りに行き、キャッシュと合成結果を返す。
 * 通信できない時はキャッシュ、それも無ければ内蔵辞書だけで動く。
 * @returns {Promise<{status:'updated'|'cached'|'none', source:'network'|'cache'|'none',
 *   items:object[], updatedAt:string, cachedAt:string, syncedAt:string,
 *   invalid:Array, duplicates:string[], error:string}>}
 */
export async function syncExtraDictionary({
  base = [],
  fetchImpl,
  storage,
  url = EXTRA_DICT_URL,
  now = () => new Date().toISOString(),
  timeoutMs = EXTRA_FETCH_TIMEOUT_MS,
  key = EXTRA_CACHE_KEY,
} = {}) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const empty = { items: [], updatedAt: '', cachedAt: '', invalid: [], duplicates: [] };

  if (doFetch) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : 0;
    try {
      const res = await doFetch(url, { cache: 'no-store', signal: controller?.signal });
      if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : '?'}`);
      const payload = await res.json();
      const parsed = parseExtraDictionary(payload);
      if (parsed.error) throw new Error(parsed.error);
      const syncedAt = now();
      writeCache(storage, payload, syncedAt, key);
      return { status: 'updated', source: 'network', ...empty, ...parsed, cachedAt: syncedAt, syncedAt };
    } catch (err) {
      const cached = readCache(storage, key);
      if (cached) {
        return { status: 'cached', source: 'cache', ...empty, ...cached, syncedAt: '', error: String(err?.message || err) };
      }
      return { status: 'none', source: 'none', ...empty, syncedAt: '', error: String(err?.message || err) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const cached = readCache(storage, key);
  if (cached) return { status: 'cached', source: 'cache', ...empty, ...cached, syncedAt: '', error: '' };
  return { status: 'none', source: 'none', ...empty, syncedAt: '', error: '通信機能がありません' };
}

/** 「内蔵 2,327件 ＋ 追加配信 30件」の形の1行（桁区切りつき） */
export function describeCounts(merged) {
  const n = (v) => Number(v || 0).toLocaleString('ja-JP');
  return `内蔵 ${n(merged.builtin)}件 ＋ 追加配信 ${n(merged.added)}件（合計 ${n(merged.total)}件）`;
}

/** 同期状態の説明文（画面表示用・絵文字なし） */
export function describeSyncState(result, { cachedCount = 0 } = {}) {
  if (!result) return '未同期（内蔵辞書のみで動作）';
  const stamp = (iso) => {
    const s = String(iso || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return '';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s.slice(0, 10);
    const p = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  if (result.status === 'updated') return `最終同期 ${stamp(result.syncedAt)}（追加 ${result.items.length}件を取得しました）`;
  if (result.status === 'cached') {
    return `オフライン表示中（${stamp(result.cachedAt) || '前回'}取得の追加 ${cachedCount || result.items.length}件で動作）`;
  }
  return '未同期（内蔵辞書のみで動作。オンライン時に自動で取得します）';
}

/* ---------------- みんなの辞書への提案 ---------------- */

/** 提案フォームの値を辞書レコード候補へ整える */
export function proposalFields(item = {}) {
  const jan = normalizeJAN(item.jan);
  return {
    jan,
    name: clean(item.name),
    maker: clean(item.maker || item.brand),
    category: CATEGORY_IDS.has(item.category) ? item.category : 'other',
    colorName: clean(item.colorName),
    size: clean(item.size),
    code: clean(item.colorCode || item.code),
    size2: '',
    source: cleanSource(item.source),
  };
}

/** 提案の見出し（GitHub Issue のタイトル） */
export function proposalTitle(item = {}) {
  const f = proposalFields(item);
  const head = [f.maker, f.colorName || f.name].filter(Boolean).join(' ');
  const title = `[JAN辞書] ${head || f.jan}${f.size ? ` ${f.size}` : ''}`.trim();
  return title.length > 90 ? `${title.slice(0, 89)}…` : title;
}

/** 提案本文（GitHub Issue の本文。項目が無ければ行を出さない） */
export function proposalBody(item = {}) {
  const f = proposalFields(item);
  const rows = [
    ['JANコード', f.jan ? `${f.jan}（チェックディジット確認済み）` : ''],
    ['メーカー', f.maker],
    ['商品名', f.name],
    ['色名', f.colorName],
    ['色番号/品番', f.code],
    ['容量/号数', f.size],
    ['カテゴリ', CATEGORY_LABELS.get(f.category) || f.category],
    ['確認した出典', f.source],
  ].filter(([, v]) => v);
  const list = rows.map(([k, v]) => `- ${k}: ${v}`).join('\n');
  return [
    '## 辞書に追加してほしい商品',
    '',
    list,
    '',
    '## 確認したこと',
    '- [ ] 実物のパッケージでJANを確認した',
    '- [ ] 出典ページにこのJANが載っている',
    '',
    'このフォームは画材管理アプリの「みんなの辞書に提案する」から作成しました。',
  ].join('\n');
}

/** GitHub の新規Issue作成画面のURL（タイトル・本文をプリフィル） */
export function buildIssueUrl(item = {}, { baseUrl = ISSUE_NEW_URL } = {}) {
  const params = new URLSearchParams({ title: proposalTitle(item), body: proposalBody(item) });
  return `${baseUrl}?${params.toString()}`;
}

/** GitHubアカウントが無い人向け：貼り付けるだけのテキスト */
export function buildProposalClipboardText(item = {}) {
  return [
    '【画材管理アプリ：JAN辞書への追加提案】',
    '',
    proposalTitle(item),
    '',
    proposalBody(item),
    '',
    '送り先: shodai121ueda+artsupply@gmail.com',
  ].join('\n');
}
