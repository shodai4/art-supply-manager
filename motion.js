/**
 * アトリコの「触った手触り」の動き（GSAP を同梱して使う）。
 *
 * 方針:
 *   1) 落ち着いたアイボリー基調のシンプルさを壊さない。動きは短く（0.1〜0.35秒）、
 *      跳ねは控えめ（back.out は 1.6 まで）。シートは「透かさず」下から上げるので、
 *      動いている間に後ろのボタンが透けて見えない。
 *   2) GSAP が読めない環境（Node のテスト・CDN も同梱も無いとき）では何もしない。
 *      呼び出し側は「返り値 false なら、その場で終わりの状態にする」だけでよい。
 *   3) OS の「視差効果を減らす（prefers-reduced-motion: reduce）」が有効なら、
 *      アニメーションをせずに終わりの状態へ即座に切り替える（0秒）。
 *   4) 例外は投げない（UIの操作を止めない）。GSAP の中でこけても、操作はそのまま進む。
 *
 * 画面（app.js）はこのモジュールの関数だけを呼び、GSAP を直接触らない
 * （`gsap` の直接利用が無いことは tests/motion.test.js で確かめている）。
 */

/** 「視差効果を減らす」の問い合わせ（テストからも同じ文字列を使う） */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** 動きの長さ（秒）。テストで「重くない」ことを確かめるために外に出している */
export const MOTION_TIMING = Object.freeze({
  sheetIn: 0.34,   // シートが下から上がってくる
  sheetOut: 0.17,  // シートが下へ抜ける
  mask: 0.24,      // 背景の暗幕
  press: 0.34,     // 押した指の反応（縮んで戻る）
  bump: 0.32,      // 数のポンッ
  enter: 0.32,     // 増えた行・カードが落ち着く
  toast: 0.26,     // トースト
  bar: 0.28,       // 下から出る「補充を確定」バー
});

/** 一度に動かす量の上限（秒）。これを超える指定はしない */
export const MAX_MOTION_SECONDS = 0.4;

const mqlCache = new WeakMap();

/** root（ふつうは window）から GSAP を取り出す。読めない・形が違うときは null */
export function gsapEngine(root = globalThis) {
  try {
    const g = root && root.gsap;
    if (!g || typeof g.to !== 'function' || typeof g.fromTo !== 'function' || typeof g.set !== 'function') return null;
    return g;
  } catch {
    return null;
  }
}

/** OS の「視差効果を減らす」が有効か。matchMedia が無い環境は false */
export function prefersReducedMotion(root = globalThis) {
  try {
    if (!root || typeof root.matchMedia !== 'function') return false;
    let mql = mqlCache.get(root);
    if (mql === undefined) {
      mql = root.matchMedia(REDUCED_MOTION_QUERY) || null;
      mqlCache.set(root, mql);
    }
    return Boolean(mql && mql.matches);
  } catch {
    return false;
  }
}

/** いまアニメーションしてよいか（GSAP があり、視差効果を減らす設定でない） */
export function motionAllowed(root = globalThis) {
  return Boolean(gsapEngine(root)) && !prefersReducedMotion(root);
}

/**
 * 動きの関数一式を作る。root を差し替えられるのはテストのため
 * （`createMotion({ gsap: fake })` で GSAP の呼ばれ方を確かめる）。
 */
export function createMotion(root = globalThis) {
  /** 閉じかけのシート（開き直したときに、その場で隠すため） */
  const closing = new Set();

  const engine = () => gsapEngine(root);
  const allowed = () => motionAllowed(root);

  /** 要素を「無指定」に戻す（動いたあとのインライン style を残さない） */
  function clear(el, props = 'transform,opacity') {
    const g = engine();
    if (!g || !el) return;
    try {
      g.set(el, { clearProps: props });
    } catch {
      // style を戻せなくても、見た目はそのまま使える
    }
  }

  /** 閉じかけのシートを、その場で隠してしまう（別のシートを開くとき）
   *  同じシートを開き直したときは、閉じる処理を取り消す（開いたのに消えないように） */
  function finishClosing(el) {
    if (!el) return;
    for (const pending of [...closing]) {
      if (pending.el === el) pending.cancel();
      else pending.finish();
    }
  }

  return {
    /** いま動かせるか（呼び出し側の分岐に使う） */
    enabled: allowed,

    /**
     * シート・モーダルを開く: 下から少し上がってくる（透けさせないので、後ろのボタンが透けて見えない）。
     * @returns {boolean} 動かしたら true（false なら呼び出し側は何もしなくてよい）
     */
    sheetIn(el, mask = null) {
      if (!el) return false;
      finishClosing(el);
      if (!allowed()) return false;
      const g = engine();
      try {
        g.killTweensOf(el);
        g.fromTo(el,
          { y: 26 },
          {
            y: 0,
            duration: MOTION_TIMING.sheetIn,
            ease: 'power3.out',
            overwrite: true,
            onComplete: () => clear(el),
          });
        if (mask) {
          g.killTweensOf(mask);
          g.fromTo(mask,
            { opacity: 0 },
            { opacity: 1, duration: MOTION_TIMING.mask, ease: 'power2.out', overwrite: true, onComplete: () => clear(mask, 'opacity') });
        }
        return true;
      } catch {
        return false;
      }
    },

    /**
     * シート・モーダルを閉じる: 少し下へ抜けてから隠す。
     * `done` は「隠す」処理（クラスを外す）。動かせないときは false を返すので、
     * 呼び出し側がその場で `done()` を呼ぶ。二重に呼ばれても1回しか実行しない。
     * @returns {boolean} 動かしたら true
     */
    sheetOut(el, done = () => {}, mask = null) {
      let finished = false;
      const entry = {
        el,
        finish: () => {
          if (finished) return;
          finished = true;
          closing.delete(entry);
          try {
            done();
          } catch {
            // 隠す処理でこけても、動きの後始末だけは済ませる
          }
        },
        // 開き直したときは、閉じる処理を呼ばずに取り消す
        cancel: () => {
          finished = true;
          closing.delete(entry);
        },
      };
      if (!el || !allowed()) return false;
      const g = engine();
      try {
        g.killTweensOf(el);
        closing.add(entry);
        g.to(el, {
          y: 18,
          duration: MOTION_TIMING.sheetOut,
          ease: 'power2.in',
          overwrite: true,
          onComplete: () => {
            clear(el);
            entry.finish();
          },
        });
        if (mask) {
          g.killTweensOf(mask);
          g.to(mask, {
            opacity: 0,
            duration: MOTION_TIMING.sheetOut,
            ease: 'power1.in',
            overwrite: true,
            onComplete: () => {
              clear(mask, 'opacity');
              entry.finish();
            },
          });
        }
        return true;
      } catch {
        closing.delete(entry);
        return false;
      }
    },

    /**
     * 押したボタンの反応: きゅっと縮んで、控えめに戻る（＋／−／星など）。
     */
    press(el, { scale = 0.88, overshoot = 1.6 } = {}) {
      if (!el || !allowed()) return false;
      const g = engine();
      try {
        g.killTweensOf(el);
        g.timeline({ overwrite: true, onComplete: () => clear(el) })
          .to(el, { scale, duration: 0.09, ease: 'power2.in' })
          .to(el, { scale: 1, duration: MOTION_TIMING.press, ease: `back.out(${overshoot})` });
        return true;
      } catch {
        return false;
      }
    },

    /** 数（在庫数・バッジ）のポンッとした反応 */
    bump(el, { scale = 1.16 } = {}) {
      if (!el || !allowed()) return false;
      const g = engine();
      try {
        g.killTweensOf(el);
        g.fromTo(el,
          { scale: 1 },
          { scale, duration: 0.1, ease: 'power2.out', yoyo: true, repeat: 1, overwrite: true, onComplete: () => clear(el) });
        return true;
      } catch {
        return false;
      }
    },

    /** 増えた行・カードが、ふわっと落ち着く（画材の追加・編集のあと） */
    enter(el, { y = 8 } = {}) {
      if (!el || !allowed()) return false;
      const g = engine();
      try {
        g.killTweensOf(el);
        g.fromTo(el,
          { opacity: 0, y },
          { opacity: 1, y: 0, duration: MOTION_TIMING.enter, ease: 'power2.out', overwrite: true, onComplete: () => clear(el) });
        return true;
      } catch {
        return false;
      }
    },

    /** トースト: わずかに下から上がって、ふわっと出る（中央寄せの translateX(-50%) は保つ） */
    toast(el, { y = 10 } = {}) {
      if (!el || !allowed()) return false;
      const g = engine();
      try {
        g.killTweensOf(el);
        g.fromTo(el,
          { xPercent: -50, y, opacity: 0 },
          {
            xPercent: -50,
            y: 0,
            opacity: 1,
            duration: MOTION_TIMING.toast,
            ease: 'power2.out',
            overwrite: true,
            onComplete: () => clear(el, 'transform,opacity'),
          });
        return true;
      } catch {
        return false;
      }
    },

    /** 「補充を確定」バーが下から出てくる */
    bar(el, { y = 14 } = {}) {
      if (!el || !allowed()) return false;
      const g = engine();
      try {
        g.killTweensOf(el);
        g.fromTo(el,
          { y, opacity: 0 },
          { y: 0, opacity: 1, duration: MOTION_TIMING.bar, ease: 'power3.out', overwrite: true, onComplete: () => clear(el) });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** 画面で使う動き一式（ふつうは window の GSAP） */
export const motion = createMotion(typeof window !== 'undefined' ? window : globalThis);
