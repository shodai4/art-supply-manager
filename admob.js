// アトリコ AdMob バナー（iOSアプリのネイティブ起動時だけ、画面の最下部に出す）
//
// 【いまは本番広告（2026-11-19・v1.42.2 / App Store 申請用ビルドから）】
//   TestFlight でバナーの位置（タブバー・FAB・一覧の下端が隠れないこと）と、
//   Pro にしたときに広告が消えて余白も詰まることを確かめ終えたので、本番の広告を出します。
//     アプリID: ca-app-pub-5739782559889389~2686704558（Info.plist の GADApplicationIdentifier）
//     バナー  : ca-app-pub-5739782559889389/1132135646（アトリコ_バナー）
//   isTesting / initializeForTesting は false（本番広告なのでテスト扱いにしない）。
//
// 【もう一度テスト広告で確かめるとき】
//   下の USE_TEST_ADS を true に戻すと、Google 公式のテスト広告へ切り替わります。
//     アプリID : ca-app-pub-3940256099942544~1458002511（Google公式のテスト用）
//     バナー   : ca-app-pub-3940256099942544/2934735716（Google公式のテスト用）
//   テスト広告は自分の広告ではないので、押しても「無効トラフィック」になりません。
//   Info.plist の GADApplicationIdentifier は本番のアプリIDのまま（テスト広告ユニットは
//   自分のアプリIDでもテスト広告を返すので、切り替えるのは USE_TEST_ADS だけでよい）。
//
// 【トラッキングの許可（ATT）】
//   iOS 14 以降は、広告識別子（IDFA）を使う前に必ず許可ダイアログを出さないといけない。
//   出さないまま広告を配信すると App Store 審査で落ちる（2026-11-24 のビルド1.0(94) が
//   Guideline 2.1 - Information Needed でリジェクトされた原因がこれ）。
//   そこで AdBanner.init() は、AdMob.initialize() より先に ensureTrackingAuthorization() を呼ぶ。
//     - まだ聞いていない（notDetermined）ときだけ聞く。拒否・制限・許可済みは尊重して何もしない。
//     - iOS 15 以降は、アプリが前面（表示中）になる前に頼むとダイアログが出ずに
//       notDetermined のまま返ることがある。画面が表示されるのを待ち、ひと呼吸おいてから聞く。
//       それでも notDetermined のままなら、もう一度だけ聞き直す。
//     - 答えが返らないまま固まらないよう待ち時間に上限を置き、過ぎたら広告の初期化へ進む。
//     - Web・Android、拒否（denied）・制限（restricted）、プラグインが無いときもエラーにせず続行する。
//
// 【広告枠の場所】
//   画面の最下部（タブバーのさらに下・セーフエリアの上）。ネイティブのバナーは Web の上に
//   重なって描かれるので、出している間は CSS 変数 --ad-h にバナーの高さを入れ、
//   タブバー・下部ドック・FAB・一覧の下端が隠れないよう余白を持ち上げる（styles.css）。
//   高さは広告の読み込み後にプラグインが知らせる実測値を使い、読めないときは予備値。
//   Webブラウザ／GitHub Pages では何もしない（広告枠も余白も出さない）。
import { isNativeShell } from './scanner.js';

/** 広告枠のスイッチ（true = Google公式のテスト広告で確かめるときだけ。いまは本番広告なので false） */
export const USE_TEST_ADS = false;

/** Google の公式テスト用ID（テスト広告以外では使わない） */
export const ADMOB_TEST_APP_ID = 'ca-app-pub-3940256099942544~1458002511';
export const ADMOB_TEST_BANNER_ID = 'ca-app-pub-3940256099942544/2934735716';

/** 本番ID（AdMob で発行済み。アプリ名「アトリコ」） */
export const ADMOB_PROD_APP_ID = 'ca-app-pub-5739782559889389~2686704558';
export const ADMOB_PROD_BANNER_ID = 'ca-app-pub-5739782559889389/1132135646';

/** いま使うID（テストで確かめるときは USE_TEST_ADS を true にするだけ） */
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

/* ---------------- トラッキングの許可（ATT・iOS 14 以降） ---------------- */

/** ATT の状態（iOS の ATTrackingManager.AuthorizationStatus と同じ値） */
export const ATT_STATUS = {
  AUTHORIZED: 'authorized',
  DENIED: 'denied',
  RESTRICTED: 'restricted',
  NOT_DETERMINED: 'notDetermined',
};

/** アプリが前面（表示中）になるのを待つ上限（ミリ秒） */
export const ATT_VISIBLE_TIMEOUT = 4000;
/** 表示中になってから許可ダイアログを出すまでのひと呼吸（iOS 15+ で早すぎると出ないため） */
export const ATT_SETTLE_MS = 150;
/** ダイアログが出なかったときにもう一度だけ聞き直す回数（初回起動直後の取りこぼし対策） */
export const ATT_ATTEMPTS = 2;
/** 許可ダイアログの答えを待つ上限（ミリ秒）。答えないまま固まらないよう、過ぎたら広告の初期化へ進む */
export const ATT_REQUEST_TIMEOUT = 20000;

/** 時間待ち（テストでは差し替えられるよう、関数で持つ） */
export const waitMs = (ms) => new Promise((resolve) => {
  const n = Number(ms);
  setTimeout(resolve, Number.isFinite(n) && n > 0 ? n : 0);
});

const TIMED_OUT = Symbol('timeout');

/** 上限つきで待つ（過ぎたら TIMED_OUT。待っている約束はそのまま放っておく） */
export async function withTimeout(promise, ms) {
  const limit = Number(ms);
  if (!Number.isFinite(limit) || limit <= 0) return promise;
  let timer;
  const guard = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), limit);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  try {
    return await Promise.race([promise, guard]);
  } finally {
    clearTimeout(timer);
  }
}

/** プラグインの返り値（文字列・{status}）を状態の文字列にそろえる（読めなければ null） */
export function normalizeTrackingStatus(value) {
  const raw = typeof value === 'string' ? value : value?.status;
  if (typeof raw !== 'string') return null;
  const status = raw.trim();
  return status === '' ? null : status;
}

/** 許可ダイアログを出す必要があるか（まだ聞いていないときだけ） */
export function shouldRequestTrackingAuthorization(status) {
  return status === ATT_STATUS.NOT_DETERMINED;
}

/** いま動いている土台（'ios' / 'android' / 'web'。分からなければ空文字） */
export function trackingPlatform(win = typeof window !== 'undefined' ? window : undefined) {
  const getPlatform = win?.Capacitor?.getPlatform;
  if (typeof getPlatform !== 'function') return '';
  try {
    const platform = getPlatform.call(win.Capacitor);
    return typeof platform === 'string' ? platform : '';
  } catch {
    return '';
  }
}

/** 画面が表示中か（分からない環境では「表示中」とみなす。WebView では foreground のとき visible） */
export function isDocumentVisible(doc) {
  const state = doc?.visibilityState;
  if (typeof state === 'string') return state !== 'hidden';
  return true;
}

/**
 * 画面が表示中になるまで待つ（iOS 15+ で、前面に無いあいだに頼むとダイアログが出ないため）。
 * 待ち続けないよう上限を置き、過ぎたら false を返す。
 */
export async function waitUntilVisible({
  win = typeof window !== 'undefined' ? window : undefined,
  doc,
  wait = waitMs,
  timeout = ATT_VISIBLE_TIMEOUT,
  interval = 50,
} = {}) {
  const target = doc ?? win?.document;
  if (isDocumentVisible(target)) return true;
  const span = Number.isFinite(Number(timeout)) && Number(timeout) > 0 ? Number(timeout) : 0;
  const step = Number.isFinite(Number(interval)) && Number(interval) > 0 ? Number(interval) : 50;
  const tries = Math.max(1, Math.ceil(span / step));
  for (let i = 0; i < tries; i += 1) {
    await wait(step);
    if (isDocumentVisible(target)) return true;
  }
  return isDocumentVisible(target);
}

/** いまの許可状態を読む（読めない・プラグインが無いときは null。例外は飲み込む） */
export async function readTrackingAuthorizationStatus(plugin, log) {
  if (!plugin || typeof plugin.trackingAuthorizationStatus !== 'function') return null;
  try {
    return normalizeTrackingStatus(await plugin.trackingAuthorizationStatus());
  } catch (err) {
    if (typeof log === 'function') log('[AdMob] トラッキングの許可状態を読めませんでした', err);
    return null;
  }
}

/**
 * 広告の初期化より前に、iOS のトラッキング許可（ATT）を求める。
 * notDetermined のときだけ聞き、画面が表示されてから出す。何が起きても例外は投げない。
 * @returns {Promise<{status:string|null, requested:boolean, attempts:number, reason:string}>}
 */
export async function ensureTrackingAuthorization({
  plugin,
  win = typeof window !== 'undefined' ? window : undefined,
  doc,
  log,
  wait = waitMs,
  visibleTimeout = ATT_VISIBLE_TIMEOUT,
  settleMs = ATT_SETTLE_MS,
  attempts = ATT_ATTEMPTS,
  requestTimeout = ATT_REQUEST_TIMEOUT,
} = {}) {
  const result = { status: null, requested: false, attempts: 0, reason: '' };
  if (!plugin) { result.reason = 'no-plugin'; return result; }
  const platform = trackingPlatform(win);
  // Android・Web に iOS の許可ダイアログは無い（Web は authorized を返すので、そのまま広告の初期化へ）
  if (platform && platform !== 'ios') { result.reason = `not-ios-${platform}`; return result; }
  if (typeof plugin.requestTrackingAuthorization !== 'function') { result.reason = 'unsupported'; return result; }

  result.status = await readTrackingAuthorizationStatus(plugin, log);
  if (result.status && !shouldRequestTrackingAuthorization(result.status)) {
    // 拒否・制限・許可済み。利用者の答えは変えない（ダイアログも出さない）
    result.reason = `already-${result.status}`;
    return result;
  }
  // 状態が読めず、iOS とも言い切れないときは、ダイアログを出せないので何もしない
  if (!result.status && platform !== 'ios') { result.reason = 'unknown-status'; return result; }

  await waitUntilVisible({ win, doc, wait, timeout: visibleTimeout });
  if (settleMs > 0) await wait(settleMs);

  const tries = Number.isFinite(Number(attempts)) ? Math.max(1, Math.round(Number(attempts))) : 1;
  for (let i = 0; i < tries; i += 1) {
    result.attempts += 1;
    try {
      const answered = await withTimeout(Promise.resolve(plugin.requestTrackingAuthorization()), requestTimeout);
      if (answered !== TIMED_OUT) result.requested = true;
    } catch (err) {
      // ダイアログを出せなくてもアプリは止めない（広告は非パーソナライズで配信される）
      result.reason = 'request-failed';
      if (typeof log === 'function') log('[AdMob] トラッキングの許可を求められませんでした', err);
      return result;
    }
    result.status = await readTrackingAuthorizationStatus(plugin, log);
    if (result.status !== ATT_STATUS.NOT_DETERMINED) {
      result.reason = result.status ? `answered-${result.status}` : 'asked';
      return result;
    }
    // notDetermined のまま = iOS がダイアログを出さなかった。少し待って、もう一度だけ聞き直す
    if (i < tries - 1 && settleMs > 0) await wait(settleMs * 4);
  }
  result.reason = result.requested ? 'still-not-determined' : 'not-shown';
  if (typeof log === 'function') log('[AdMob] トラッキングの許可ダイアログを出せませんでした', result);
  return result;
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
  constructor({ win, doc, log, isPro, wait, att } = {}) {
    this.win = win ?? (typeof window !== 'undefined' ? window : undefined);
    this.doc = doc ?? (typeof document !== 'undefined' ? document : undefined);
    this.log = typeof log === 'function' ? log : () => {};
    // 待ち時間の入れ物（node --test からは縮めるため）。ふつうは既定のまま
    this.wait = typeof wait === 'function' ? wait : undefined;
    this.att = att && typeof att === 'object' ? att : {};
    this.plugin = adMobPlugin(this.win);
    this.native = isNativeShell(this.win);
    // Pro（プレビュー含む）の判定。関数で渡してもらい、切り替わったら sync() で追従する
    this.isPro = typeof isPro === 'function' ? isPro : () => Boolean(isPro);
    this.started = false;
    this.visible = false;
    this.adFreeActive = false; // Proで広告を消している状態
    this.tracking = null; // 起動時のATTの結果（ensureTrackingAuthorization の返り値）
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
      // 広告の初期化より前に、iOS のトラッキング許可（ATT）を求める。
      // ここを飛ばすと許可ダイアログが出ず、App Store 審査でリジェクトされる（Guideline 2.1）。
      await this.prepareTracking();
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
   * 広告を初期化する前に、iOS のトラッキング許可（ATT）を求める。
   * 許可ダイアログは AdMob.initialize() より必ず先・画面が表示されてから出す（iOS 15+ 対策）。
   * 失敗しても広告の初期化は続ける（アプリを止めない）。
   */
  async prepareTracking() {
    try {
      this.tracking = await ensureTrackingAuthorization({
        plugin: this.plugin,
        win: this.win,
        doc: this.doc,
        log: this.log,
        ...(this.wait ? { wait: this.wait } : {}),
        ...this.att,
      });
    } catch (err) {
      this.log('[AdMob] トラッキングの許可の確認でつまずきました', err);
      this.tracking = { status: null, requested: false, attempts: 0, reason: 'error' };
    }
    return this.tracking;
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
