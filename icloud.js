// iCloud自動バックアップ（iOSアプリだけ）
//
// ねらい: アプリを削除して入れ直しても、同じApple IDなら在庫・フォルダ・設定・
// お気に入り（フォルダ／メーカー）が裏で戻る。ログインもコード入力も要らない。
//
// 仕組み:
//   - ネイティブの小さなプラグイン（plugins/art-icloud-sync）が
//     NSUbiquitousKeyValueStore（iCloudのキー・バリュー保存）を読み書きする。
//   - 保存するのは、これまでのJSON書き出しと同じ中身（exportState）＋保存時刻。
//   - 手元写真・色見本の画像（IndexedDBのBlob）は容量が大きく、iCloud KVSの
//     上限（1MB）を超えやすいので載せない。端末内保存のままにする
//     （JSON書き出しも同じ方針。なくしたら撮り直す前提）。
//
// 事故を防ぐ決まり:
//   - 自動で戻すのは「この端末にまだ何も無い（初回起動）」ときだけ。
//     手元にデータがあるときに、黙ってiCloudの内容で置き換えない。
//   - 手元にデータがあるときは、手元のほうが新しい場合だけiCloudへ送る。
//     iCloudのほうが新しいときは送らず、設定の「iCloudから復元」で選んでもらう。
//   - 全データ削除のあとは、iCloud側にも空の状態を送る（消したのに戻ってこない）。
//   - iCloudにサインインしていない・Capabilityが無いときは、何もしないで
//     設定に理由を出す（JSON書き出しは今までどおり使える）。

import { exportState, importState } from './core.js';

/** iCloud KVS のキー（アプリを消しても同じキーで戻せる） */
export const ICLOUD_KEY = 'art-supply-manager.state.v1';
/** ネイティブプラグインのJS名（plugins/art-icloud-sync の jsName と同じ） */
export const ICLOUD_PLUGIN = 'ArtICloudSync';
/**
 * iCloud KVS の上限は 1MB（キーと値を合わせて）。余裕を見て 800KB を超える
 * バックアップは送らない（足りないまま送って、途中で切れたJSONを残さない）。
 */
export const MAX_SYNC_BYTES = 800 * 1024;
/** 端末でデータが変わってから、iCloudへ送るまでの待ち時間（連続操作をまとめる） */
export const SYNC_DEBOUNCE_MS = 2500;

/** いまの状態をiCloudへ置く文字列にする（JSON書き出しと同じ形＋保存時刻） */
export function cloudBackupText(state, { now = new Date() } = {}) {
  const at = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const payload = JSON.parse(exportState(state));
  return JSON.stringify({
    ...payload,
    savedAt: at.toISOString(),
    stateUpdatedAt: String(state?.updatedAt || ''),
    itemCount: Array.isArray(state?.items) ? state.items.length : 0,
  });
}

/** 文字列のバイト数（UTF-8。日本語は1文字3バイトなので length では測れない） */
export function byteLength(text) {
  const s = String(text ?? '');
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(s).length;
  return Buffer.byteLength(s, 'utf8');
}

/** 送れる大きさか */
export function canSync(text) {
  const bytes = byteLength(text);
  if (!bytes) return { ok: false, bytes, reason: 'empty' };
  if (bytes > MAX_SYNC_BYTES) return { ok: false, bytes, reason: 'too-large' };
  return { ok: true, bytes, reason: '' };
}

/**
 * iCloudから読んだ文字列をバックアップとして読む。
 * 壊れている・形式が違うときは null（手元のデータを壊さない）。
 */
export function parseCloudBackup(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  try {
    const state = importState(raw);
    const data = JSON.parse(raw);
    return {
      state,
      savedAt: String(data.savedAt || ''),
      stateUpdatedAt: String(data.stateUpdatedAt || ''),
      items: state.items.length,
      folders: state.folders.length,
    };
  } catch {
    return null;
  }
}

/**
 * 起動時に、iCloudのバックアップを使うか決める（純粋関数）。
 * @param {boolean} fresh    この端末にまだデータが無い（初回起動・全削除あと）
 * @param {object|null} cloud parseCloudBackup の結果
 * @param {object} local     いまの状態
 * @returns {{action:'restore'|'push'|'pull'|'none', reason:string}}
 *   restore … 初回起動でiCloudにデータがある → 戻す
 *   push    … 手元のほうが新しい → iCloudへ送る
 *   pull    … iCloudのほうが新しい → 送らずに設定で選んでもらう
 *   none    … どちらもしない
 */
export function decideStartup({ fresh = false, cloud = null, local = null } = {}) {
  if (!cloud || !cloud.items) {
    return { action: fresh ? 'none' : 'push', reason: 'no-cloud-data' };
  }
  if (fresh) return { action: 'restore', reason: 'fresh-install' };
  const localAt = String(local?.updatedAt || '');
  const cloudAt = String(cloud.savedAt || cloud.stateUpdatedAt || '');
  if (!localAt) return { action: 'pull', reason: 'local-blank' };
  if (cloudAt && cloudAt > localAt) return { action: 'pull', reason: 'cloud-newer' };
  return { action: 'push', reason: 'local-newer' };
}

/** 保存時刻の短い表示（11/19 02:40）。読めないときは空 */
export function savedAtLabel(iso) {
  const d = new Date(String(iso || ''));
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ネイティブのプラグインを取り出す（Web・未導入なら null） */
export function icloudPlugin(win = typeof window !== 'undefined' ? window : undefined) {
  const cap = win?.Capacitor;
  if (!cap) return null;
  const plugins = cap.Plugins || {};
  if (plugins[ICLOUD_PLUGIN]) return plugins[ICLOUD_PLUGIN];
  // packageClassList への登録が間に合わない版でも、名前から引けるようにしておく
  try {
    return typeof cap.registerPlugin === 'function' ? cap.registerPlugin(ICLOUD_PLUGIN) : null;
  } catch {
    return null;
  }
}

/** iCloudが使えるか（サインイン・Capability）。失敗しても例外にしない */
export async function cloudStatus(plugin) {
  if (!plugin?.status) return { available: false, reason: 'no-plugin' };
  try {
    const res = await plugin.status();
    return { available: Boolean(res?.available), reason: String(res?.reason || '') };
  } catch (err) {
    return { available: false, reason: String(err?.message || 'error') };
  }
}

/** iCloudから読む（無ければ空文字） */
export async function readCloud(plugin) {
  if (!plugin?.read) return '';
  try {
    const res = await plugin.read({ key: ICLOUD_KEY });
    return String(res?.value || '');
  } catch {
    return '';
  }
}

/** iCloudへ書く。大きすぎる・プラグインが無いときは {ok:false, reason} */
export async function writeCloud(plugin, text) {
  const size = canSync(text);
  if (plugin?.write && size.ok) {
    try {
      const res = await plugin.write({ key: ICLOUD_KEY, value: text });
      return { ok: res?.ok !== false, reason: res?.ok === false ? 'write-failed' : '', bytes: size.bytes };
    } catch (err) {
      return { ok: false, reason: String(err?.message || 'write-failed'), bytes: size.bytes };
    }
  }
  return { ok: false, reason: size.reason || 'no-plugin', bytes: size.bytes };
}

/** 設定に出す短い状態文 */
export function cloudStatusText({ native = false, available, reason, savedAt, pending } = {}) {
  if (!available) {
    if (!native) return 'iCloudバックアップはiPhoneアプリで使えます';
    if (String(reason || '').includes('plugin')) return 'iCloudバックアップを使えません（アプリを更新してください）';
    return 'iCloudにサインインすると自動でバックアップします';
  }
  const at = savedAtLabel(savedAt);
  if (pending) return at ? `iCloudに保存済み（${at}・新しいバックアップあり）` : '新しいバックアップがあります';
  return at ? `iCloudに自動保存（最終 ${at}）` : 'iCloudに自動保存します';
}
