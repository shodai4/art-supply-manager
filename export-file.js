// アトリコ 書き出し（CSV・バックアップJSON）の保存経路
//
// これまでは <a download="..."> + Blob URL だけで保存していた。これはブラウザでは動くが、
// iOSアプリ（Capacitor / WKWebView）では「保存しました」のトーストが出てもファイルが
// どこにも残らない（ダウンロードとして扱われない）。そこでアプリ内では
//   1) @capacitor/filesystem でキャッシュ領域に一時ファイルとして書く
//   2) @capacitor/share で共有シートを開く（「“ファイル”に保存」「AirDrop」「スプレッドシートで開く」等）
// の順に進める。Webブラウザでは今までどおり <a download> でダウンロードする。
//
// 方針:
//   - CSV の BOM（\uFEFF）はそのまま渡す。encoding:'utf8' の writeFile は BOM を
//     UTF-8 の EF BB BF として書くので、Excel でそのまま開ける状態を保てる。
//   - 共有シートのキャンセル（AbortError / "Share canceled" 等）は失敗ではない。
//     呼び出し側がトーストを出さずに済むよう canceled:true を返す。
//   - 書き込み・共有の本当の失敗だけを error として返す（文言は exportFailureMessage）。
//   - iOS のキャッシュ領域と共有シートだけを使うので、写真の追加許可などの
//     プライバシー許可は要らない。

import { isNativeShell } from './scanner.js';

/** 一時ファイルを置く領域。Directory.Cache と同じ文字列（@capacitor/filesystem の列挙値） */
export const EXPORT_DIRECTORY = 'CACHE';

/** 書き出すファイルの種類と拡張子（CSV=画材一覧 / JSON=バックアップ） */
export const EXPORT_KINDS = {
  csv: { ext: 'csv', prefix: 'art-supply', mime: 'text/csv;charset=utf-8' },
  json: { ext: 'json', prefix: 'art-supply-backup', mime: 'application/json' },
};

/** 日付からファイル名の日付部分（YYYYMMDD）を作る */
export function exportStamp(date = new Date()) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** 書き出しファイル名（CSV: art-supply-YYYYMMDD.csv / JSON: art-supply-backup-YYYYMMDD.json） */
export function exportFileName(kind, date = new Date()) {
  const spec = EXPORT_KINDS[kind] || EXPORT_KINDS.csv;
  return `${spec.prefix}-${exportStamp(date)}.${spec.ext}`;
}

/**
 * Capacitor の Filesystem / Share プラグインを取り出す（未導入なら null）。
 * 通常は window.Capacitor.Plugins に入っている。入っていない版のために
 * registerPlugin でも引けるようにしておく（Webでは使わない前提）。
 */
export function exportPlugins(win = typeof window !== 'undefined' ? window : undefined) {
  const cap = win?.Capacitor;
  if (!cap) return { filesystem: null, share: null };
  const plugins = cap.Plugins || {};
  const pick = (name) => plugins[name] || (typeof cap.registerPlugin === 'function' ? cap.registerPlugin(name) : null);
  return { filesystem: pick('Filesystem'), share: pick('Share') };
}

/** 共有シートのキャンセルか（エラーとして扱わない） */
export function isShareCanceled(error) {
  if (!error) return false;
  const name = String(error.name || '');
  const message = String(error.message || error || '');
  if (name === 'AbortError') return true;
  if (/abort|cancel/i.test(name)) return true;
  return /cancel|中止|キャンセル/i.test(message) && !/cancel.*(fail|error)/i.test(message);
}

/**
 * ネイティブ（iOSアプリ）で共有シートを開く。
 * まずキャッシュに書いてから、その uri を共有する。
 */
export async function shareNativeFile({ filesystem, share, fileName, content }) {
  let written = null;
  try {
    written = await filesystem.writeFile({
      path: fileName,
      data: content,
      directory: EXPORT_DIRECTORY,
      encoding: 'utf8',
    });
  } catch (error) {
    return { ok: false, method: 'share', stage: 'write', error };
  }
  const uri = String(written?.uri || '');
  if (!uri) {
    return { ok: false, method: 'share', stage: 'write', error: new Error('一時ファイルの場所が取れませんでした') };
  }
  try {
    await share.share({ title: fileName, url: uri, dialogTitle: fileName });
  } catch (error) {
    if (isShareCanceled(error)) return { ok: false, method: 'share', stage: 'share', canceled: true };
    return { ok: false, method: 'share', stage: 'share', error };
  }
  return { ok: true, method: 'share', uri };
}

/** Webブラウザ用のダウンロード（従来の <a download> 方式） */
export function downloadBlob({ fileName, content, mime }, download) {
  const blob = new Blob([content], { type: mime });
  if (typeof download === 'function') {
    download(blob, fileName);
    return { ok: true, method: 'download' };
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  return { ok: true, method: 'download' };
}

/**
 * 書き出しの入口。環境に合わせて共有シートかダウンロードかを選ぶ。
 * @returns {Promise<{ok:boolean, method:'share'|'download'|'none', canceled?:boolean,
 *   stage?:string, error?:Error, reason?:string, uri?:string}>}
 */
export async function exportFile({
  kind = 'csv', fileName, content = '', mime, win, download,
} = {}) {
  const spec = EXPORT_KINDS[kind] || EXPORT_KINDS.csv;
  const name = fileName || exportFileName(kind);
  const type = mime || spec.mime;
  const view = win ?? (typeof window !== 'undefined' ? window : undefined);

  if (isNativeShell(view)) {
    const { filesystem, share } = exportPlugins(view);
    if (filesystem?.writeFile && share?.share) {
      return shareNativeFile({ filesystem, share, fileName: name, content });
    }
    // アプリ内なのにプラグインが無い＝保存できない。黙って何もしないのは一番困るので失敗として返す
    return { ok: false, method: 'none', reason: 'no-plugin' };
  }

  try {
    return downloadBlob({ fileName: name, content, mime: type }, download);
  } catch (error) {
    return { ok: false, method: 'download', stage: 'download', error };
  }
}

/** 失敗したときだけ画面に出す文言（キャンセル・成功は空文字＝トーストを出さない） */
export function exportFailureMessage(result) {
  if (!result || result.ok) return '';
  if (result.canceled) return '';
  const detail = result.error?.message ? `（${result.error.message}）` : '';
  if (result.reason === 'no-plugin') return 'この端末では共有シートを開けません。アプリを更新してください';
  if (result.stage === 'write') return `一時ファイルを保存できませんでした${detail}`;
  if (result.stage === 'download') return `書き出しに失敗しました${detail}`;
  return `共有シートを開けませんでした${detail}`;
}

/**
 * 文面だけを共有シートで送る（買い物リスト）。
 * iOSアプリでは @capacitor/share、Webでは navigator.share を使う。
 * どちらも使えないときは { ok:false, reason:'no-share' } を返し、呼び側がコピーへ切り替える。
 */
export async function sharePlainText({ text, title = '買い物リスト', win } = {}) {
  const view = win ?? (typeof window !== 'undefined' ? window : undefined);
  const body = String(text || '');
  if (!body) return { ok: false, reason: 'empty' };
  if (isNativeShell(view)) {
    const { share } = exportPlugins(view);
    if (share?.share) {
      try {
        await share.share({ title, text: body, dialogTitle: title });
        return { ok: true, method: 'share' };
      } catch (error) {
        if (isShareCanceled(error)) return { ok: false, canceled: true };
        return { ok: false, error };
      }
    }
  }
  const nav = view?.navigator;
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ title, text: body });
      return { ok: true, method: 'navigator' };
    } catch (error) {
      if (/abort/i.test(String(error?.name || ''))) return { ok: false, canceled: true };
      return { ok: false, error };
    }
  }
  return { ok: false, reason: 'no-share' };
}
