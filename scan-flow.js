// バーコードの連続スキャン（カメラを閉じずに続けて在庫へ反映する）ロジック。
// DOM に触らないので node --test で検証できる。
// 画面側（app.js）は「クールダウン → 状態の更新 → ログ」の順でこの関数を呼ぶだけにする。
//
// 同じJANの画材は、保管場所（folderId）ごとに別の在庫として数える。
// 「自宅に1本・アトリエに1本」を分けて持ちたいので、読み取りも「JAN × フォルダ」で探す。
import {
  normalizeJAN, isValidJAN, detectMaker, lookupJAN, createItem, adjustStock,
  recordPurchase, upsertItem, findItemByJanInFolder, itemsByJanInOtherFolders, DEFAULT_FOLDERS,
} from './core.js';
import { canAddItem } from './pro.js';

/**
 * 同じJANを続けて数えない間隔（ミリ秒）。
 * カメラの前でラベルが止まったままだと1秒に何度も同じ値が来るため、
 * その間隔ぶんは同じJANを無視する（別のJANはすぐ受け付ける）。
 */
export const SCAN_COOLDOWN_MS = 2800;

/** 連続スキャンの1回ぶんの状態（直近に読んだJANと時刻） */
export function createScanSession({ cooldownMs = SCAN_COOLDOWN_MS } = {}) {
  return { jan: '', at: 0, cooldownMs };
}

/** 画面を開き直したとき用（ログは消さずにクールダウンだけ戻す） */
export function resetScanSession(session) {
  if (!session) return createScanSession();
  session.jan = '';
  session.at = 0;
  return session;
}

/**
 * クールダウン判定。
 * @returns {{accepted:boolean, waitMs:number, same:boolean}}
 */
export function checkCooldown(session, jan, now = Date.now()) {
  const key = normalizeJAN(jan);
  if (!key) return { accepted: false, waitMs: 0, same: false };
  const last = session || {};
  const cooldown = Number(last.cooldownMs) > 0 ? Number(last.cooldownMs) : SCAN_COOLDOWN_MS;
  const same = String(last.jan || '') === key;
  const at = Number(last.at) || 0;
  const elapsed = Math.max(0, Number(now) - at);
  if (same && at > 0 && elapsed < cooldown) {
    return { accepted: false, waitMs: cooldown - elapsed, same: true };
  }
  return { accepted: true, waitMs: 0, same };
}

/** 読み取ったJANをセッションへ記録する（受け付けたときだけ呼ぶ） */
export function markScanned(session, jan, now = Date.now()) {
  const s = session || createScanSession();
  s.jan = normalizeJAN(jan);
  s.at = Number(now) || Date.now();
  return s;
}

/**
 * JANの種類を見分ける（状態は変えない）。
 * registered = その保管場所に登録済み / dictionary = 辞書にある未登録 / unknown = 未収録 / invalid = 読取値が不正
 *
 * folderId を渡すと、そのフォルダにある同じJANだけを「登録済み」とみなす
 * （別のフォルダにある同じJANは登録済みにしない＝新しい場所に独立して登録できる）。
 * 渡さないときは、これまでどおりフォルダを問わず探す。
 */
export function classifyJAN(jan, { items = [], dict = [], prefixes, folderId } = {}) {
  const d = normalizeJAN(jan);
  if (!/^\d{13}$/.test(d)) {
    return { kind: 'invalid', jan: d, message: '13桁のJANではありません' };
  }
  if (!isValidJAN(d)) {
    return { kind: 'invalid', jan: d, message: 'JANのチェックディジットが合いません' };
  }
  const list = Array.isArray(items) ? items : [];
  const scope = String(folderId ?? '');
  const existing = scope
    ? findItemByJanInFolder(list, d, scope)
    : list.find((it) => normalizeJAN(it?.jan) === d) || null;
  if (existing) return { kind: 'registered', jan: d, item: existing };
  const entry = lookupJAN(d, dict);
  if (entry) return { kind: 'dictionary', jan: d, entry };
  const maker = detectMaker(d, prefixes);
  return { kind: 'unknown', jan: d, maker: maker?.maker || '', brand: maker?.brand || '' };
}

/** 新規登録する画材の置き場所（いま見ているフォルダ。全体表示なら先頭のフォルダ） */
export function scanFolderId(state, folderId) {
  const folders = state?.folders || [];
  const wanted = String(folderId || '');
  if (wanted && folders.some((f) => String(f.id) === wanted)) return wanted;
  return folders[0]?.id || DEFAULT_FOLDERS[0].id;
}

/** 未収録JANの仮登録名（メーカーが分かればメーカー名＋JAN、分からなければJANだけ） */
export function draftName(jan, maker = '') {
  const d = normalizeJAN(jan);
  const m = String(maker || '').trim();
  return m ? `${m} ${d}` : d;
}

/**
 * 1回の読み取りを状態へ反映する（純粋関数）。
 *
 * - 同じ保管場所に登録済み: 在庫を＋1（買い足しログも既存の recordPurchase と同じ扱い）
 * - 辞書ヒット: 辞書の内容で在庫1のまま自動登録
 * - 未収録: メーカー名＋JANで仮登録（あとで一覧・編集から直せる）
 * - 別のフォルダにしか同じJANが無い: その画材は触らず、いまのフォルダに新しく登録する
 * - 無料上限: 新規登録だけ止める（登録済みの＋1は上限に関係なく通す）
 *
 * @returns {{state:object, result:{kind:'incremented'|'added'|'drafted'|'limit'|'invalid', jan:string, label:string, name:string, message:string, item?:object, qty?:number, otherFolders?:number}}}
 */
export function applyScan(state, jan, { dict = [], prefixes, folderId, now = new Date().toISOString() } = {}) {
  // 読み取り先のフォルダは最初に1つ決める（探すのも、新規登録するのも同じ場所）
  const targetFolder = scanFolderId(state, folderId);
  const found = classifyJAN(jan, { items: state?.items || [], dict, prefixes, folderId: targetFolder });
  if (found.kind === 'invalid') {
    return {
      state,
      result: {
        kind: 'invalid', jan: found.jan, label: '不可', name: '', message: found.message, changed: false,
      },
    };
  }

  // 同じJANが別のフォルダにあるかは、案内に添えるためだけに数える（その画材は触らない）
  const otherFolders = itemsByJanInOtherFolders(state?.items || [], found.jan, targetFolder).length;
  const elsewhere = otherFolders ? `（ほかのフォルダに${otherFolders}点）` : '';

  if (found.kind === 'registered') {
    const prev = found.item;
    const next = adjustStock(recordPurchase(prev, 1, now), 1);
    const qty = Math.max(0, Number(next.qty) || 0);
    return {
      state: upsertItem(state, next),
      result: {
        kind: 'incremented', jan: found.jan, label: '＋1', name: prev.name || found.jan, item: next, qty,
        message: `${prev.name || found.jan} を＋1（${qty}）`, changed: true, otherFolders,
      },
    };
  }

  const allowed = canAddItem(state, state.settings);
  const limitResult = (name) => ({
    state,
    result: {
      kind: 'limit', jan: found.jan, label: '上限', name,
      message: `無料は${allowed.quota.limit}点まで（新規登録を止めました）`, changed: false, otherFolders,
    },
  });

  if (found.kind === 'dictionary') {
    const entry = found.entry;
    const item = createItem({
      name: entry.name || entry.colorName || found.jan,
      maker: entry.maker,
      brand: entry.brand,
      category: entry.category,
      colorName: entry.colorName,
      colorCode: entry.code,
      size: entry.size,
      jan: entry.jan || found.jan,
      qty: 1,
      folderId: targetFolder,
      updatedAt: now,
      createdAt: now,
    });
    if (!allowed.ok) return limitResult(item.name);
    return {
      state: upsertItem(state, item),
      result: {
        kind: 'added', jan: found.jan, label: '登録', name: item.name, item,
        message: `${item.name} を登録${elsewhere}`, changed: true, otherFolders,
      },
    };
  }

  // 未収録JANは止めずに仮登録（メーカー名＋JAN・数量1）
  const name = draftName(found.jan, found.maker);
  if (!allowed.ok) return limitResult(name);
  const item = createItem({
    name,
    maker: found.maker,
    brand: found.brand,
    category: 'other',
    jan: found.jan,
    qty: 1,
    folderId: targetFolder,
    memo: '未収録JANの仮登録',
    createdAt: now,
    updatedAt: now,
  });
  return {
    state: upsertItem(state, item),
    result: {
      kind: 'drafted', jan: found.jan, label: '仮登録', name, item,
      message: `${name} を仮登録${elsewhere}`, changed: true, otherFolders,
    },
  };
}

/** ログの件数（読み取れた本数） */
export function scanLogCount(entries = []) {
  return (entries || []).filter((e) => e && e.kind !== 'invalid' && e.kind !== 'limit').length;
}

/** ログの内訳を短い文にする（完了時の通知・ログの見出し用） */
export function describeScanLog(entries = []) {
  const list = entries || [];
  const added = list.filter((e) => e.kind === 'added').length;
  const drafted = list.filter((e) => e.kind === 'drafted').length;
  const incremented = list.filter((e) => e.kind === 'incremented').length;
  const parts = [];
  if (added) parts.push(`登録${added}点`);
  if (drafted) parts.push(`仮登録${drafted}点`);
  if (incremented) parts.push(`＋1 ${incremented}本`);
  return parts.length ? parts.join('・') : 'まだ読み取りはありません';
}

/** 同じJANかどうか（ログの直近品を強調するとき用） */
export function isSameJan(a, b) {
  const x = normalizeJAN(a);
  const y = normalizeJAN(b);
  return Boolean(x) && x === y;
}
