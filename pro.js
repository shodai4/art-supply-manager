// Pro（有料プラン）の判定と無料上限。
// 課金の実装（App Store の StoreKit）はまだ繋いでいないので、
// いまは設定の「Proプレビュー」で同じ状態を再現して動作確認できる。
// StoreKit を繋ぐときは、購入済みかどうかを applyProEntitlement(settings, owned) に渡すだけでよい。

/** 無料プランの登録上限（点数） */
export const FREE_ITEM_LIMIT = 100;
/**
 * 無料プランで「あとから作れる」フォルダの上限。
 * 最初から入っている4つの保管場所（BASE_FOLDER_IDS）はこの枠に数えない
 * （数えていたため、無料のままだと最初から 4/3 で新規作成ができない状態だった）。
 */
export const FREE_FOLDER_LIMIT = 3;
/** 最初から用意される保管場所のID（無料枠に数えない・名前を変えてもIDはそのまま） */
export const BASE_FOLDER_IDS = ['home', 'atelier', 'carry', 'stock'];
/** Pro は上限なし */
export const UNLIMITED = Number.POSITIVE_INFINITY;

/** Pro で開放する特典（画面に出す短い名前だけ） */
export const PRO_BENEFITS = [
  { id: 'limit', label: '上限なし' },
  { id: 'cost', label: '画材費とCSV' },
  { id: 'icloud', label: 'iCloudバックアップ' },
];

/** Pro で開放する機能ID（上限以外） */
export const PRO_FEATURES = ['cost', 'icloud'];

/** Pro の状態か（プレビュー中も Pro と同じ扱い） */
export function isPro(settings = {}) {
  return Boolean(settings?.pro) || Boolean(settings?.proPreview);
}

export function itemLimit(settings = {}) {
  return isPro(settings) ? UNLIMITED : FREE_ITEM_LIMIT;
}

export function folderLimit(settings = {}) {
  return isPro(settings) ? UNLIMITED : FREE_FOLDER_LIMIT;
}

/** 最初からある保管場所か（既定の4つ。無料枠に数えない） */
export function isBaseFolder(folder = {}) {
  return BASE_FOLDER_IDS.includes(String(folder?.id ?? ''));
}

/** あとから作った自分のフォルダの数（子フォルダ・孫フォルダも1つとして数える） */
export function customFolderCount(folders = []) {
  const list = Array.isArray(folders) ? folders : [];
  return list.filter((f) => !isBaseFolder(f)).length;
}

/** 使用数と上限から残り枠を作る */
export function quota(used, limit) {
  const u = Math.max(0, Math.trunc(Number(used) || 0));
  const l = limit === UNLIMITED ? UNLIMITED : Math.max(0, Math.trunc(Number(limit) || 0));
  return {
    used: u,
    limit: l,
    unlimited: l === UNLIMITED,
    full: l !== UNLIMITED && u >= l,
    remaining: l === UNLIMITED ? UNLIMITED : Math.max(0, l - u),
  };
}

/** 点数（登録数）の枠 */
export function itemQuota(state = {}, settings = {}) {
  return quota((state.items || []).length, itemLimit(settings));
}

/** フォルダ数の枠（既定の4つは数えず、あとから作った分だけ） */
export function folderQuota(state = {}, settings = {}) {
  return quota(customFolderCount(state.folders), folderLimit(settings));
}

/** 新規登録してよいか（既存データは点数が上限を超えていても消さない・編集は許可） */
export function canAddItem(state = {}, settings = {}) {
  const q = itemQuota(state, settings);
  return { ok: !q.full, quota: q };
}

/** 新しいフォルダを作ってよいか */
export function canAddFolder(state = {}, settings = {}) {
  const q = folderQuota(state, settings);
  return { ok: !q.full, quota: q };
}

/** 画材費などの Pro 機能が使えるか */
export function canUseFeature(settings = {}, feature = '') {
  if (!PRO_FEATURES.includes(feature)) return true;
  return isPro(settings);
}

/**
 * 枠の表示（例: `12 / 100点`）。Pro は `12点`。
 * 文字を増やしたくないので、単位まで含めて短く返す。
 */
export function describeQuota(q, unit = '点') {
  if (!q) return '';
  if (q.unlimited) return `${q.used}${unit}`;
  return `${q.used} / ${q.limit}${unit}`;
}

/** 無料プランの残りが少ないか（一覧にそっと出す目安） */
export function isQuotaTight(q, ratio = 0.9) {
  if (!q || q.unlimited || q.limit <= 0) return false;
  return q.used / q.limit >= ratio;
}

/**
 * StoreKit の購入結果を設定へ反映する（接続点）。
 * owned = true で Pro、false で無料に戻す。プレビューは購入状態が来たら消す。
 */
export function applyProEntitlement(settings = {}, owned) {
  const next = { ...settings, pro: Boolean(owned) };
  if (owned && settings.proPreview) next.proPreview = false;
  return next;
}
