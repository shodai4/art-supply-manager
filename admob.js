// アトリコ AdMob バナー（iOSアプリのネイティブ起動時だけ、画面の最下部に出す）
//
// 【いまはテスト広告だけ】
//   USE_TEST_ADS = true の間は、Google が公開している「公式テストID」しか使いません。
//   テスト広告は収益が発生せず、自分の広告を押してしまう「無効トラフィック」にもなりません。
//     アプリID : ca-app-pub-3940256099942544~1458002511（Info.plist の GADApplicationIdentifier）
//     バナー   : ca-app-pub-3940256099942544/2934735716
//   本番IDを発行したら、このファイルの定数と scripts/configure-ios.mjs のアプリIDを差し替え、
//   USE_TEST_ADS を false にする（画面側の作りは変えなくてよい）。
//
// 【広告枠の場所】
//   画面の最下部（タブバーのさらに下・セーフエリアの上）。ネイティブのバナーは Web の上に
//   重なって描かれるので、出している間は CSS 変数 --ad-h にバナーの高さを入れ、
//   タブバー・下部ドック・FAB・一覧の下端が隠れないよう余白を持ち上げる（styles.css）。
//   高さは広告の読み込み後にプラグインが知らせる実測値を使い、読めないときは予備値。
//   Webブラウザ／GitHub Pages では何もしない（広告枠も余白も出さない）。
import { isNativeShell } from './scanner.js';

/** 広告枠のスイッチ（テスト広告の間は true） */
export const USE_TEST_ADS = true;

/** Google の公式テスト用ID（テスト広告以外では使わない） */
export const ADMOB_TEST_APP_ID = 'ca-app-pub-3940256099942544~1458002511';
export const ADMOB_TEST_BANNER_ID = 'ca-app-pub-3940256099942544/2934735716';

/** いま使うID（テスト中は空にしない。本番IDが未発行なのでテストIDのまま） */
export const ADMOB_APP_ID = USE_TEST_ADS ? ADMOB_TEST_APP_ID : '';
export const ADMOB_BANNER_ID = USE_TEST_ADS ? ADMOB_TEST_BANNER_ID : '';

/** バナーの高さ（実測できないときの予備。約50〜60px） */
export const ADMOB_BANNER_FALLBACK_HEIGHT = 56;

/** 余白に入れてよい高さの範囲（おかしな値をそのまま余白にしない） */
export const ADMOB_BANNER_MIN_HEIGHT = 32;
export const ADMOB_BANNER_MAX_HEIGHT = 120;

/** CSS変数の名前（styles.css と合わせる） */
export const AD_HEIGHT_VAR = '--ad-h';

/** Capacitor の AdMob プラグイン（未導入なら null） */
export function adMobPlugin(win = typeof window !== 'undefined' ? window : undefined) {
  const plugins = win?.Capacitor?.Plugins;
  return plugins?.AdMob || null;
}

/** この環境でバナーを出してよいか（iOSアプリのネイティブ起動時だけ） */
export function shouldShowAdBanner({ native = false, hasPlugin = false } = {}) {
  return Boolean(native && hasPlugin);
}

/** 広告の高さ（px）。読めない・0・極端な値は予備値に倒す */
export function bannerLiftHeight(height, fallback = ADMOB_BANNER_FALLBACK_HEIGHT) {
  const h = Math.round(Number(height));
  if (!Number.isFinite(h) || h <= 0) {
    const f = Math.round(Number(fallback));
    return Number.isFinite(f) && f > 0 ? f : ADMOB_BANNER_FALLBACK_HEIGHT;
  }
  return Math.min(ADMOB_BANNER_MAX_HEIGHT, Math.max(ADMOB_BANNER_MIN_HEIGHT, h));
}

/** initialize に渡すオプション（テスト中はテスト端末として登録する） */
export function bannerInitializeOptions() {
  return {
    initializeForTesting: USE_TEST_ADS,
    testingDevices: [],
  };
}

/**
 * showBanner に渡すオプション。
 * 最下部（BOTTOM_CENTER）・余白0・画面幅いっぱいのアダプティブバナー。
 * isTesting を必ず添えて、実機テスト中の誤クリックが本番広告の無効トラフィックにならないようにする。
 */
export function bannerShowOptions() {
  return {
    adId: ADMOB_BANNER_ID,
    adSize: 'ADAPTIVE_BANNER',
    position: 'BOTTOM_CENTER',
    margin: 0,
    isTesting: USE_TEST_ADS,
  };
}

/** バナーのぶん、下のUIを持ち上げる（高さをCSS変数に入れる） */
export function applyBannerLift(doc, height) {
  if (!doc?.documentElement) return 0;
  const h = bannerLiftHeight(height);
  doc.documentElement.style.setProperty(AD_HEIGHT_VAR, `${h}px`);
  if (doc.body?.setAttribute) doc.body.setAttribute('data-ad-banner', 'true');
  return h;
}

/** 持ち上げを解除する（広告が出ない・消えたとき。余白を残さない） */
export function clearBannerLift(doc) {
  if (!doc?.documentElement) return;
  doc.documentElement.style.setProperty(AD_HEIGHT_VAR, '0px');
  if (doc.body?.removeAttribute) doc.body.removeAttribute('data-ad-banner');
}

/**
 * バナーの出し入れ。広告の状態（読み込み・大きさ・失敗）に合わせて余白を合わせる。
 * win / doc を渡せるのは node --test から動かすため。
 */
export class AdBanner {
  constructor({ win, doc, log } = {}) {
    this.win = win ?? (typeof window !== 'undefined' ? window : undefined);
    this.doc = doc ?? (typeof document !== 'undefined' ? document : undefined);
    this.log = typeof log === 'function' ? log : () => {};
    this.plugin = adMobPlugin(this.win);
    this.native = isNativeShell(this.win);
    this.started = false;
    this.visible = false;
  }

  /** この環境で出すか（Webブラウザでは出さない） */
  get enabled() {
    return shouldShowAdBanner({ native: this.native, hasPlugin: Boolean(this.plugin) });
  }

  /** 初期化してバナーを出す（二重起動しない） */
  async init() {
    if (!this.enabled || this.started) return false;
    this.started = true;
    try {
      await this.plugin.initialize(bannerInitializeOptions());
      this.bindEvents();
      await this.show();
      return true;
    } catch (err) {
      this.log('[AdMob] 初期化できませんでした', err);
      clearBannerLift(this.doc);
      return false;
    }
  }

  /** 広告の状態に合わせて余白を合わせる */
  bindEvents() {
    const listen = (name, handler) => {
      try {
        const sub = this.plugin.addListener?.(name, handler);
        if (sub && typeof sub.catch === 'function') sub.catch(() => {});
      } catch { /* 古い実装ではイベントが無い（余白は読み込み時の予備値のまま） */ }
    };
    // 実測の高さが来たらそれに合わせる
    listen('bannerAdSizeChanged', (info) => {
      const h = Number(info?.height) || 0;
      if (h > 0) { applyBannerLift(this.doc, h); this.visible = true; }
    });
    // 読み込めたら予備の高さで先に余白を確保しておく（実測値で上書きされる）
    listen('bannerAdLoaded', () => {
      applyBannerLift(this.doc, ADMOB_BANNER_FALLBACK_HEIGHT);
      this.visible = true;
    });
    // 出せなかったときは余白を残さない（下に空白を作らない）
    listen('bannerAdFailedToLoad', () => {
      clearBannerLift(this.doc);
      this.visible = false;
    });
  }

  /** バナーを出す（出せなければ余白は 0 のまま） */
  async show() {
    if (!this.enabled) return false;
    try {
      await this.plugin.showBanner(bannerShowOptions());
      return true;
    } catch (err) {
      this.log('[AdMob] バナーを出せませんでした', err);
      clearBannerLift(this.doc);
      return false;
    }
  }

  /** バナーを隠す（余白も戻す） */
  async hide() {
    clearBannerLift(this.doc);
    this.visible = false;
    if (!this.enabled) return;
    try {
      await this.plugin.hideBanner();
    } catch (err) {
      this.log('[AdMob] バナーを隠せませんでした', err);
    }
  }
}

/** 起動時に1回だけ呼ぶ入口（Webブラウザでは何もしない） */
export function setupAdBanner(options = {}) {
  const banner = new AdBanner(options);
  if (!banner.enabled) {
    clearBannerLift(banner.doc);
    return banner;
  }
  banner.init();
  return banner;
}
