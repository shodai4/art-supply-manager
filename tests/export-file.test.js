import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPORT_DIRECTORY, EXPORT_KINDS, exportStamp, exportFileName, exportPlugins,
  isShareCanceled, shareNativeFile, downloadBlob, exportFile, exportFailureMessage,
} from '../export-file.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const BOM = '\uFEFF';

/** ネイティブ（iOSアプリ）の偽 window */
function nativeWin({ filesystem, share } = {}) {
  return {
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: { Filesystem: filesystem, Share: share },
    },
  };
}

/** writeFile / share の呼び出しを記録する偽プラグイン */
function fakePlugins({ writeError, shareError, uri = 'file:///var/mobile/Caches/art-supply-20261117.csv' } = {}) {
  const calls = { write: [], share: [] };
  const filesystem = {
    async writeFile(options) {
      calls.write.push(options);
      if (writeError) throw writeError;
      return { uri };
    },
  };
  const share = {
    async share(options) {
      calls.share.push(options);
      if (shareError) throw shareError;
      return { activityType: 'com.apple.DocumentsApp' };
    },
  };
  return { filesystem, share, calls };
}

/* ---------------- ファイル名 ---------------- */

test('書き出しファイル名は種類と日付から作る', () => {
  const d = new Date(2026, 10, 17, 23, 5); // 2026-11-17
  assert.equal(exportStamp(d), '20261117');
  assert.equal(exportFileName('csv', d), 'art-supply-20261117.csv');
  assert.equal(exportFileName('json', d), 'art-supply-backup-20261117.json');
  // 知らない種類・壊れた日付でも CSV の名前で今日の日付に倒す（落ちない）
  assert.match(exportFileName('unknown', new Date('壊れた')), /^art-supply-\d{8}\.csv$/);
  // 拡張子とMIMEの対応
  assert.equal(EXPORT_KINDS.csv.mime, 'text/csv;charset=utf-8');
  assert.equal(EXPORT_KINDS.json.mime, 'application/json');
  assert.equal(EXPORT_DIRECTORY, 'CACHE'); // Directory.Cache と同じ文字列
});

/* ---------------- プラグインの取り出し ---------------- */

test('Capacitor の Filesystem / Share を取り出す（registerPlugin にも対応）', () => {
  const filesystem = { writeFile: async () => ({}) };
  const share = { share: async () => ({}) };
  assert.deepEqual(exportPlugins(undefined), { filesystem: null, share: null });
  assert.deepEqual(exportPlugins({}), { filesystem: null, share: null });
  assert.deepEqual(
    exportPlugins({ Capacitor: { Plugins: { Filesystem: filesystem, Share: share } } }),
    { filesystem, share },
  );
  // Plugins に居ない版は registerPlugin で引く
  const registered = exportPlugins({
    Capacitor: { registerPlugin: (name) => ({ name }) },
  });
  assert.equal(registered.filesystem.name, 'Filesystem');
  assert.equal(registered.share.name, 'Share');
});

/* ---------------- ネイティブ: 書き込み → 共有シート ---------------- */

test('アプリ内のCSVはCACHEに一時ファイルとして書き、そのURIを共有シートに渡す', async () => {
  const { filesystem, share, calls } = fakePlugins();
  const content = `${BOM}メーカー,品名\nホルベイン,油絵具\n`;
  const result = await shareNativeFile({ filesystem, share, fileName: 'art-supply-20261117.csv', content });

  assert.equal(result.ok, true);
  assert.equal(result.method, 'share');
  assert.equal(result.uri, 'file:///var/mobile/Caches/art-supply-20261117.csv');
  // writeFile は BOM 付きのまま・CACHE・utf8 で1回だけ
  assert.deepEqual(calls.write, [{
    path: 'art-supply-20261117.csv',
    data: content,
    directory: 'CACHE',
    encoding: 'utf8',
  }]);
  assert.equal(calls.write[0].data.startsWith(BOM), true, 'BOM が落ちています');
  // 共有シートは書き出した uri を開く（件名・タイトルはファイル名）
  assert.deepEqual(calls.share, [{
    title: 'art-supply-20261117.csv',
    url: 'file:///var/mobile/Caches/art-supply-20261117.csv',
    dialogTitle: 'art-supply-20261117.csv',
  }]);
});

test('JSONバックアップも同じ経路で共有シートに渡す', async () => {
  const { filesystem, share, calls } = fakePlugins({ uri: 'file:///var/mobile/Caches/art-supply-backup-20261117.json' });
  const content = JSON.stringify({ app: 'art-supply-manager', items: [] });
  const result = await shareNativeFile({ filesystem, share, fileName: 'art-supply-backup-20261117.json', content });
  assert.equal(result.ok, true);
  assert.equal(calls.write[0].path, 'art-supply-backup-20261117.json');
  assert.equal(calls.write[0].data, content);
  assert.equal(calls.share[0].url, 'file:///var/mobile/Caches/art-supply-backup-20261117.json');
});

test('共有シートのキャンセルはエラーにしない（トーストも出さない）', async () => {
  const cancel = new Error('Share canceled');
  const { filesystem, share } = fakePlugins({ shareError: cancel });
  const result = await shareNativeFile({ filesystem, share, fileName: 'a.csv', content: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.canceled, true);
  assert.equal(result.stage, 'share');
  assert.equal(exportFailureMessage(result), '');

  // DOMException の AbortError もキャンセル扱い
  assert.equal(isShareCanceled(Object.assign(new Error('aborted'), { name: 'AbortError' })), true);
  assert.equal(isShareCanceled(new Error('Share canceled')), true);
  const dom = new Error('The share action was cancelled');
  assert.equal(isShareCanceled(dom), true);
});

test('書き込み失敗・共有失敗はキャンセルと区別して文言を返す', async () => {
  // 一時ファイルが書けない
  const writeFail = fakePlugins({ writeError: new Error('ディスクがいっぱいです') });
  const r1 = await shareNativeFile({
    filesystem: writeFail.filesystem, share: writeFail.share, fileName: 'a.csv', content: 'x',
  });
  assert.equal(r1.ok, false);
  assert.equal(r1.canceled, undefined);
  assert.equal(r1.stage, 'write');
  assert.match(exportFailureMessage(r1), /一時ファイルを保存できませんでした/);
  assert.match(exportFailureMessage(r1), /ディスクがいっぱいです/);
  assert.equal(writeFail.calls.share.length, 0, '書けていないのに共有しない');

  // uri が返らない（書けたか分からない）
  const noUri = await shareNativeFile({
    filesystem: { writeFile: async () => ({}) }, share: { share: async () => ({}) },
    fileName: 'a.csv', content: 'x',
  });
  assert.equal(noUri.ok, false);
  assert.equal(noUri.stage, 'write');

  // 共有シートで本当に失敗（ユーザーの操作ではない）
  const shareFail = fakePlugins({ shareError: new Error('Error sharing item') });
  const r2 = await shareNativeFile({
    filesystem: shareFail.filesystem, share: shareFail.share, fileName: 'a.csv', content: 'x',
  });
  assert.equal(r2.ok, false);
  assert.equal(r2.canceled, undefined);
  assert.equal(r2.stage, 'share');
  assert.match(exportFailureMessage(r2), /共有シートを開けませんでした/);
  // 成功時は文言なし
  assert.equal(exportFailureMessage({ ok: true, method: 'share' }), '');
  assert.equal(exportFailureMessage(null), '');
});

/* ---------------- 環境による振り分け ---------------- */

test('アプリ内では共有シート経路（ダウンロードは使わない）', async () => {
  const { filesystem, share, calls } = fakePlugins();
  let downloaded = 0;
  const result = await exportFile({
    kind: 'csv',
    content: `${BOM}a,b\n`,
    win: nativeWin({ filesystem, share }),
    download: () => { downloaded += 1; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.method, 'share');
  assert.equal(downloaded, 0);
  assert.equal(calls.write.length, 1);
  assert.equal(calls.share.length, 1);
  assert.match(calls.write[0].path, /^art-supply-\d{8}\.csv$/);
});

test('アプリ内でプラグインが無いときは黙って諦めず、案内を返す', async () => {
  let downloaded = 0;
  const result = await exportFile({
    kind: 'json', content: '{}', win: nativeWin({}), download: () => { downloaded += 1; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-plugin');
  assert.equal(downloaded, 0);
  assert.match(exportFailureMessage(result), /アプリを更新/);
});

test('Webブラウザでは従来どおりダウンロード（BOM付きCSVのまま）', async () => {
  const saved = [];
  const win = { navigator: { userAgent: 'Mozilla/5.0' } }; // Capacitor なし
  const content = `${BOM}メーカー,品名\n`;
  const result = await exportFile({
    kind: 'csv', content, win, download: (blob, fileName) => saved.push({ blob, fileName }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.method, 'download');
  assert.equal(saved.length, 1);
  assert.match(saved[0].fileName, /^art-supply-\d{8}\.csv$/);
  assert.equal(saved[0].blob.type, 'text/csv;charset=utf-8');
  // Blob.text() は先頭のBOMを落として返すので、バイト列で BOM を確かめる
  assert.deepEqual([...new Uint8Array(await saved[0].blob.arrayBuffer()).slice(0, 3)], [0xEF, 0xBB, 0xBF]);
  assert.equal(await saved[0].blob.text(), content.slice(1));

  // JSON も同じ（application/json）
  const savedJson = [];
  const r2 = await exportFile({
    kind: 'json', content: '{"a":1}', win, download: (blob, fileName) => savedJson.push({ blob, fileName }),
  });
  assert.equal(r2.method, 'download');
  assert.match(savedJson[0].fileName, /^art-supply-backup-\d{8}\.json$/);
  assert.equal(savedJson[0].blob.type, 'application/json');
  assert.equal(await savedJson[0].blob.text(), '{"a":1}');
});

test('ダウンロード経路の失敗は文言つきで返す（例外を投げっぱなしにしない）', async () => {
  const result = await exportFile({
    kind: 'csv', content: 'x', win: {}, download: () => { throw new Error('保存できません'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'download');
  assert.match(exportFailureMessage(result), /書き出しに失敗しました/);
});

test('downloadBlob は拡張子どおりの Blob を渡す', () => {
  const seen = [];
  downloadBlob({ fileName: 'x.csv', content: 'a', mime: 'text/csv' }, (blob, fileName) => seen.push([blob.type, fileName]));
  assert.deepEqual(seen, [['text/csv', 'x.csv']]);
});

/* ---------------- アプリ側の配線 ---------------- */

test('app.js のCSV保存・バックアップ保存は共通の書き出し処理を通る', () => {
  const app = read('app.js');
  assert.match(app, /from '\.\/export-file\.js'/);
  assert.match(app, /exportFile\(\{ kind: 'csv'/);
  assert.match(app, /exportFile\(\{ kind: 'json'/);
  // 従来の <a download> をCSV/バックアップで直接やらない（iOSで保存されない原因）
  assert.equal(/a\.download = `art-supply/.test(app), false, '旧ダウンロード処理が残っています');
  assert.equal(/a\.href = URL\.createObjectURL\(blob\)/.test(app), false, '旧Blobダウンロードが残っています');
  // キャンセル時はトーストを出さない（exportFailureMessage が空文字を返す）
  assert.match(app, /exportFailureMessage\(result\)/);
});

test('export-file.js は配布物とService Workerのキャッシュに入っている', async () => {
  const { WEB_ASSETS } = await import('../scripts/build.mjs');
  assert.ok(WEB_ASSETS.includes('export-file.js'), 'export-file.js が WEB_ASSETS にありません');
  assert.ok(fs.existsSync(path.join(ROOT, 'export-file.js')));
  assert.match(read('sw.js'), /'\.\/export-file\.js'/);
  // 新しいJSを確実に届けるためキャッシュ名も上げる
  assert.match(read('sw.js'), /art-supply-manager-v65/);
  // Falls back to 404 を避ける: index.html が読む版と package.json が一致
  const pkg = JSON.parse(read('package.json'));
  assert.match(read('index.html'), new RegExp(`app\\.js\\?v=${pkg.version.replace(/\./g, '\\.')}`));
});

test('iOSの共有シート用プラグインが package.json に入っている（core 6.2 と同系）', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.dependencies['@capacitor/filesystem'], /^(\^|~)6\./);
  assert.match(pkg.dependencies['@capacitor/share'], /^(\^|~)6\./);
  assert.match(pkg.dependencies['@capacitor/core'], /^\^6\.2/);
  // キャッシュ領域と共有シートだけを使うので写真の追加許可は要らない
  const configure = read('scripts/configure-ios.mjs');
  assert.equal(/NSPhotoLibraryAddUsageDescription/.test(configure), false);
});
