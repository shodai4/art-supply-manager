// ネイティブ読取の「起動待ち」を安全に打ち切るための小さな道具。
//
// これまで app.js から scanner.js へ新しい名前を足して import していたが、
// scanner.js は URL に版を付けていない（app.js?v=… だけが付く）ため、
// 端末に残った古い scanner.js（GitHub Pages は max-age=600）を読むと
// 「does not provide an export named …」でアプリ全体が起動しなくなる。
// そのため、この処理は独立したファイルに置く（新しい URL なので古い写しが無い）。

/**
 * ネイティブ読取がカメラ画面を出せないまま固まらないための上限（ミリ秒）。
 * これを過ぎたら待つのをやめ、アプリ内カメラ（html5-qrcode）へ切り替える。
 */
export const NATIVE_SCAN_OPEN_TIMEOUT_MS = 5000;

/**
 * promise が ms 以内に決まらなければ「待つのをやめる」で包む。
 * ネイティブ側が resolve も reject も返さずカメラも開かないときでも、
 * 画面が「カメラ起動中」のまま固まらないようにする（断ったときの後片付けも渡せる）。
 * @param {Promise<any>} promise
 * @param {number} ms
 * @param {(reason: Error) => void} [onTimeout]
 * @returns {Promise<any>}
 */
export function withTimeout(promise, ms, onTimeout) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = new Error('timeout');
      error.code = 'timeout';
      try { if (onTimeout) onTimeout(error); } catch (e) { /* 後片付けの失敗は無視 */ }
      reject(error);
    }, Math.max(0, Number(ms) || 0));
    promise.then(
      (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); },
      (error) => { if (settled) return; settled = true; clearTimeout(timer); reject(error); },
    );
  });
}
