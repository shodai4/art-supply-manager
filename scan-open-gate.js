// ネイティブ読取の「カメラ画面が開くまで」を安全に待つための小さな道具。
//
// これまでは startScan（利用者が読み取るか閉じるまで返らない）に対して数秒の上限を
// 掛けていたため、カメラ画面が正常に出て利用者がバーコードをかざしている最中に
// 時間切れが起き、ネイティブの画面を閉じてアプリ内カメラへ落ちてしまっていた。
//
// そこで、ネイティブ側から「画面を出せた」合図（scanOpened）を受け取るまでは上限を数え、
// 合図が来たら上限を解除して、読み取るまで（何秒かかっても）待つ。
// 合図が来ないまま上限を過ぎたときだけ「開けなかった」として切り替える。
//
// app.js は URL に版が付くが、この処理は独立したファイル（新しい URL）に置く。
// 古い写しを掴んで「export が無い」で起動しなくなるのを避けるため。
// scanner.js など版の付かない部品へ新しい名前を足してはいけない。

/** ネイティブのカメラ画面が「開いた」合図を待つ上限（ミリ秒）。合図が来たら解除する */
export const NATIVE_SCAN_OPEN_TIMEOUT_MS = 8000;

/**
 * 起動待ちの関門。
 *
 *   const gate = createOpenGate();
 *   native.addListener('scanOpened', () => gate.confirmOpened());
 *   await gate.wait(native.startScan(options));
 *
 * - wait() のあいだだけ時間を数える（合図が来たら数えるのをやめる）
 * - 時間切れのときは code: 'open-timeout' の Error で wait() が終わる
 * - enable: false（合図を受け取れない古いネイティブ）のときは時間切れにしない
 */
export function createOpenGate({
  timeoutMs = NATIVE_SCAN_OPEN_TIMEOUT_MS,
  enable = true,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let timer = null;
  let opened = false;
  let cancelled = false;
  let rejectOnTimeout = null;

  const stopTimer = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const gate = {
    /** カメラ画面が出た合図を受けたか */
    get opened() { return opened; },
    /** もう時間を数えていないか（合図を受けた・終わった） */
    get done() { return cancelled; },
    /** 時間を数え始める（wait が呼ぶ。二重には数えない） */
    start() {
      if (!enable || cancelled || timer !== null) return gate;
      timer = setTimer(() => {
        timer = null;
        if (cancelled) return;
        cancelled = true;
        const error = new Error('カメラ画面の起動が確認できませんでした');
        error.code = 'open-timeout';
        if (rejectOnTimeout) rejectOnTimeout(error);
      }, Math.max(0, Number(timeoutMs) || 0));
      return gate;
    },
    /** カメラ画面が出た合図。以降は時間切れにしない（読み取るまで待つ） */
    confirmOpened() {
      opened = true;
      cancelled = true;
      stopTimer();
      return gate;
    },
    /** 待つのをやめる（読み取れた・閉じた・切り替えた） */
    cancel() {
      cancelled = true;
      stopTimer();
      return gate;
    },
    /** promise を、起動が確認できるまでの時間切れつきで待つ */
    wait(promise) {
      return new Promise((resolve, reject) => {
        rejectOnTimeout = reject;
        gate.start();
        Promise.resolve(promise).then(
          (value) => { gate.cancel(); resolve(value); },
          (error) => { gate.cancel(); reject(error); },
        );
      });
    },
  };
  return gate;
}
