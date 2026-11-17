// アトリコ AdMob バナー（iOSアプリのネイティブ起動時だけ、画面の最下部に出す）
//
// 【本番IDで配信中（2026-11-17に切替）】
//   本番のアプリID・バナー広告ユニット（アトリコ_バナー）を発行して、テスト広告から切り替えました。
//     アプリID : ca-app-pub-5739782559889389~2686704558（Info.plist の GADApplicationIdentifier）
//     バナー   : ca-app-pub-5739782559889389/1132135646（アトリコ_バナー）
//   scripts/configure-ios.mjs の ADMOB_APP_ID も同じアプリIDにしてあります（tests/admob.test.js が一致を検査）。
//   App Store 公開までは AdMob 側が「要審査」のことがあり、その間は広告が出ないだけでアプリの動作は変わりません。
//   公開前に実機で自分の広告を押すと「無効トラフィック」になるので、動作確認するときは下の
//   USE_TEST_ADS を true に戻してください（Google 公式のテストIDに切り替わります）。
//
// 【広告枠の場所】
//   画面の最下部（タブバーのさらに下・セーフエリアの上）。ネイティブのバナーは Web の上に
//   重なって描かれるので、出している間は CSS 変数 --ad-h にバナーの高さを入れ、
//   タブバー・下部ドック・FAB・一覧の下端が隠れないよう余白を持ち上げる（styles.css）。
//   高さは広告の読み込み後にプラグインが知らせる実測値を使い、読めないときは予備値。
//   Webブラウザ／GitHub Pages では何もしない（広告枠も余白も出さない）。
import { isNativeShell } from './scanner.js';

/** 広告枠のスイッチ（実機で動作確認するときだけ true に戻す） */
export const USE_TEST_ADS = false;

/** Google の公式テスト用ID（テスト広告以外では使わない） */
export const ADMOB_TEST_APP_ID = 'ca-app-pub-3940256099942544~1458002511';
export const ADMOB_TEST_BANNER_ID = 'ca-app-pub-3940256099942544/2934735716';

/** 本番ID（AdMob で発行済み。アプリ名「アトリコ」） */
export const ADMOB_PROD_APP_ID = 'ca-app-pub-5739782559889389~2686704558';
export const ADMOB_PROD_BANNER_ID = 'ca-app-pub-5739782559889389/1132135646';

/** いま使うID（テストに戻すときは USE_TEST_ADS を true にするだけ） */
export const ADMOB_APP_ID = USE_TEST_ADS ? ADMOB_TEST_APP_ID : ADMOB_PROD_APP_ID;
export const ADMOB_BANNER_ID = USE_TEST_ADS ? ADMOB_TEST_BANNER_ID : ADMOB_PROD_BANNER_ID;

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

/** initialize に渡すオプション（テスト広告の間だけテスト端末として登録する） */
export function bannerInitializeOptions() {
  return {
    initializeForTesting: USE_TEST_ADS,
    testingDevices: [],
  };
}

/**
 * showBanner に渡すオプション。
 * 最下部（BOTTOM_CENTER）・余白0・画面幅いっぱいのアダプティブバナー。
 * isTesting は USE_TEST_ADS と同じ値。本番IDのあいだは false で、Google に「テスト広告です」とは伝えない
 * （テストに戻したときだけ true になり、実機テスト中の誤クリックが無効トラフィックにならない）。
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

/** 持ち上げを解除する（広告が出ない・消えた・Proのとき。余白を残さない） */
export function clearBannerLift(doc) {
  if (!doc?.documentElement) return;
  doc.documentElement.style.setProperty(AD_HEIGHT_VAR, '0px');
  if (doc.body?.setAttribute) doc.body.setAttribute('data-ad-banner', 'false');
}

/**
 * バナーの出し入れ。広告の状態（読み込み・大きさ・失敗）に合わせて余白を合わせる。
 * win / doc を渡せるのは node --test から動かすため。
 */
export class AdBanner {
  constructor({ win, doc, log, isPro } = {}) {
    this.win = win ?? (typeof window !== 'undefined' ? window : undefined);
    this.doc = doc ?? (typeof document !== 'undefined' ? document : undefined);
    this.log = typeof log === 'function' ? log : () => {};
    this.plugin = adMobPlugin(this.win);
    this.native = isNativeShell(this.win);
    // Pro（プレビュー含む）の判定。関数で渡してもらい、切り替わったら sync() で追従する
    this.isPro = typeof isPro === 'function' ? isPro : () => Boolean(isPro);
    this.started = false;
    this.visible = false;
    this.adFreeActive = false; // Proで広告を消している状態
  }

  /** この環境で出すか（Webブラウザでは出さない） */
  get enabled() {
    return shouldShowAdBanner({ native: this.native, hasPlugin: Boolean(this.plugin) });
  }

  /** Pro で広告を消す状態か（判定が失敗したら広告は出す） */
  get adFree() {
    try { return Boolean(this.isPro()); } catch { return false; }
  }

  /** 初期化してバナーを出す（二重起動しない・Proの間は出さない） */
  async init() {
    if (!this.enabled) { clearBannerLift(this.doc); return false; }
    if (this.adFree) {
      // Proの間は広告を出さない（タブバーはセーフエリア直上まで下がる）
      this.adFreeActive = true;
      clearBannerLift(this.doc);
      return false;
    }
    if (this.started) return false;
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

  /**
   * Pro の切り替えに合わせて広告を消す／戻す（何度呼んでもよい）。
   * Proなら即座に余白も 0 に戻し、タブバーとFABを画面最下部へ下げる。
   */
  async sync() {
    if (!this.enabled) { clearBannerLift(this.doc); return false; }
    if (this.adFree) {
      if (this.adFreeActive) return false;
      this.adFreeActive = true;
      if (this.started) await this.hide();
      else clearBannerLift(this.doc);
      return false;
    }
    if (this.adFreeActive) {
      this.adFreeActive = false;
      return this.started ? this.show() : this.init();
    }
    return false;
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
    // 実際に読み込めたときだけ余白を確保する（未配信・ロード失敗のときは下に空白を作らない）
    listen('bannerAdLoaded', () => {
      applyBannerLift(this.doc, ADMOB_BANNER_FALLBACK_HEIGHT);
      this.visible = true;
    });
    // 出せなかったときは余白を残さない（下に空白を作らない）
    listen('bannerAdFailedToLoad', () => {
      clearBannerLift(this.doc);
      this.visible = false;
    });
    // 閉じられたときも余白を戻す
    listen('bannerAdDismissed', () => {
      clearBannerLift(this.doc);
      this.visible = false;
    });
  }

  /** バナーを出す（出せなければ余白は 0 のまま。Proの間は出さない） */
  async show() {
    if (!this.enabled || this.adFree) return false;
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
