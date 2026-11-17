// アトリコ Pro の課金（StoreKit / cordova-plugin-purchase = CdvPurchase v13）
//
// App Store Connect に登録済みの商品（2026-11-17 時点）:
//   買い切り（非消耗型 / ¥1,500）   com.oekaki.artsupply.pro.lifetime
//   月額（自動更新サブスク / ¥150） com.oekaki.artsupply.pro.monthly
//   サブスクグループ「Atoriko Pro」（ID 22587434）
//
// 方針:
//   - iOSアプリ（Capacitor）では、StoreKit の購入・復元の結果だけで Pro を解放する。
//     購入が確認できていないのに Pro を配ることはしない（プラグインが無い・ストアが
//     準備できていないときは購入を中止して案内を出す）。
//   - Web（GitHub Pages）では課金処理を一切しない。ボタンは「iOSアプリから購入できます」
//     の案内になり、いままで通り Pro プレビューで動作を試せる（誤課金を防ぐ）。
//   - 買い切りを買った人には月額プランの導線を出さない（planVisibility）。
//   - 判定・文言は関数に分け、node --test から検証できるようにしている。
//
// 購入の流れ（検証サーバー無し = 既定）:
//   order -> approved -> 端末に保存（settings.pro など）-> finish
//   未完了のトランザクションは起動のたびに approved で再送されるので、
//   finish まで終わらせておけば「購入したのに Pro にならない」を防げる。

import { applyProEntitlement, isPro } from './pro.js';

/** 買い切り（非消耗型）の Product ID */
export const LIFETIME_PRODUCT_ID = 'com.oekaki.artsupply.pro.lifetime';
/** 月額（自動更新サブスク）の Product ID */
export const MONTHLY_PRODUCT_ID = 'com.oekaki.artsupply.pro.monthly';
/** サブスクグループ（App Store Connect の登録値。購入処理では使わないが記録として残す） */
export const SUBSCRIPTION_GROUP_NAME = 'Atoriko Pro';
export const SUBSCRIPTION_GROUP_ID = '22587434';

/**
 * プランの定義。key は画面の data-pro-plan と settings.proPlan に使う。
 * yen は App Store Connect の価格（表示は常にこの円で固定する）。
 */
export const PRO_PLANS = {
  lifetime: {
    key: 'lifetime',
    id: LIFETIME_PRODUCT_ID,
    kind: 'non-consumable',
    title: '買い切り',
    sub: '一度だけ',
    yen: 1500,
    price: '¥1,500',
  },
  monthly: {
    key: 'monthly',
    id: MONTHLY_PRODUCT_ID,
    kind: 'subscription',
    title: '月額',
    sub: '毎月',
    yen: 150,
    price: '¥150 / 月',
  },
};

/** 画面に出す順番（買い切りを先に） */
export const PLAN_ORDER = ['lifetime', 'monthly'];

/** Web（課金できない環境）で出す案内 */
export const WEB_PURCHASE_NOTE = '購入はiOSアプリからできます';

/** サブスクの自動更新の注記（Apple 審査で必要な表示） */
export function subscriptionNoticeText() {
  return '月額プランは、解約するまで毎月自動で更新されます（¥150 / 月）。'
    + '解約は、期間終了の24時間前までに App Store の「サブスクリプション」から行えます。';
}

/** 円の表示（1500 -> ¥1,500） */
export function yenLabel(yen) {
  const n = Math.round(Number(yen));
  if (!Number.isFinite(n) || n <= 0) return '';
  return `¥${n.toLocaleString('ja-JP')}`;
}

/** プランの価格表示（買い切りは「¥1,500」、月額は「¥150 / 月」） */
export function planPriceLabel(key) {
  const plan = PRO_PLANS[key];
  if (!plan) return '';
  return plan.key === 'monthly' ? `${yenLabel(plan.yen)} / 月` : yenLabel(plan.yen);
}

/** 2つの商品の購入状態を、足りない項目を false で埋めて返す */
export function normalizePurchase(purchase = {}) {
  return {
    lifetime: Boolean(purchase?.lifetime),
    monthly: Boolean(purchase?.monthly),
  };
}

/** 保存している設定から、購入状態を復元する（起動直後に画面へ出すため） */
export function purchaseFromSettings(settings = {}) {
  const lifetime = Boolean(settings?.proLifetime);
  const monthly = Boolean(settings?.pro) && !lifetime && settings?.proPlan === 'monthly';
  return { lifetime, monthly };
}

/** どちらかを購入しているか（Pro の解放条件） */
export function hasProPurchase(purchase = {}) {
  const p = normalizePurchase(purchase);
  return p.lifetime || p.monthly;
}

/**
 * 画面に出すプラン。買い切りを買った人には月額を出さない。
 * @returns {{lifetime:boolean, monthly:boolean}}
 */
export function planVisibility(purchase = {}) {
  const p = normalizePurchase(purchase);
  if (p.lifetime) return { lifetime: false, monthly: false };
  return { lifetime: true, monthly: !p.monthly };
}

/** いま有効なプラン名（買い切り / 月額 / 空） */
export function purchasedPlanName(purchase = {}) {
  const p = normalizePurchase(purchase);
  if (p.lifetime) return PRO_PLANS.lifetime.title;
  if (p.monthly) return PRO_PLANS.monthly.title;
  return '';
}

/** 設定の見出し（無料 / Pro（買い切り） / Pro（月額） / Pro（プレビュー）） */
export function planStatusLabel(settings = {}) {
  if (!isPro(settings)) return '無料';
  if (settings?.proLifetime) return `Pro（${PRO_PLANS.lifetime.title}）`;
  if (settings?.pro && settings?.proPlan === 'monthly') return `Pro（${PRO_PLANS.monthly.title}）`;
  if (settings?.proPreview && !settings?.pro) return 'Pro（プレビュー）';
  return 'Pro';
}

/**
 * 購入状態を設定へ反映する（settings.pro / proPlan / proLifetime）。
 * StoreKit の結果が来たらこれを呼ぶだけで、上限・画材費・広告の扱いが切り替わる。
 * プレビュー中の設定は、購入が確認できた時点で消す（applyProEntitlement）。
 */
export function settingsWithPurchase(settings = {}, purchase = {}) {
  const p = normalizePurchase(purchase);
  const owned = p.lifetime || p.monthly;
  const next = applyProEntitlement(settings, owned);
  return {
    ...next,
    proPlan: owned ? (p.lifetime ? 'lifetime' : 'monthly') : '',
    proLifetime: p.lifetime,
  };
}

/** 購入・復元の途中経過を画面に出すための短い文言 */
export function purchaseMessage(kind, purchase = {}) {
  const p = normalizePurchase(purchase);
  switch (kind) {
    case 'restoring':
      return { title: '購入履歴を確認しています', detail: '少しお待ちください' };
    case 'restored':
      return { title: '購入を復元しました', detail: `${purchasedPlanName(p)}プランが有効です` };
    case 'restore-empty':
      return { title: '復元できる購入がありませんでした', detail: 'このApple IDでの購入が見つかりません' };
    case 'restore-failed':
      return { title: '購入の復元に失敗しました', detail: '通信状態のよい場所でもう一度お試しください' };
    case 'purchased':
      return { title: 'Proになりました', detail: `${purchasedPlanName(p)}プランが有効です` };
    case 'already':
      return { title: '購入済みです', detail: 'このプランはすでに有効です' };
    case 'pending':
      return { title: '購入の承認待ちです', detail: '承認されるとProになります' };
    case 'cancelled':
      return { title: '購入を中止しました', detail: '' };
    case 'unavailable':
      return { title: '購入機能を読み込めませんでした', detail: 'アプリを再起動してもう一度お試しください' };
    case 'loading':
      return { title: '商品情報を読み込んでいます', detail: '少し待ってからもう一度お試しください' };
    case 'failed':
      return { title: '購入できませんでした', detail: '通信状態とApp Storeの設定をご確認ください' };
    case 'web':
      return { title: WEB_PURCHASE_NOTE, detail: 'Web版では課金しません' };
    case 'busy':
      return { title: '購入処理中です', detail: '終わるまでお待ちください' };
    default:
      return { title: 'Pro', detail: '' };
  }
}

/** Capacitor のネイティブ起動か（Web では課金しない） */
export function isNativeWindow(win) {
  const cap = win?.Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') return Boolean(cap.isNativePlatform());
  return Boolean(cap.isNative);
}

/**
 * StoreKit（CdvPurchase）との橋渡し。
 *
 *   const proStore = new ProStore({ onPurchase: (p) => {...}, onMessage: (m) => {...} });
 *   proStore.start();               // iOSアプリなら CdvPurchase を待って初期化
 *   proStore.purchase('lifetime');  // 購入
 *   proStore.restore();             // 復元
 *
 * win を渡せるのは node --test から偽の CdvPurchase で動かすため。
 */
export class ProStore {
  constructor({ win, native, onPurchase, onMessage, onReady, log } = {}) {
    this.win = win ?? (typeof window !== 'undefined' ? window : undefined);
    this.native = native === undefined ? isNativeWindow(this.win) : Boolean(native);
    this.onPurchase = typeof onPurchase === 'function' ? onPurchase : () => {};
    this.onMessage = typeof onMessage === 'function' ? onMessage : () => {};
    this.onReady = typeof onReady === 'function' ? onReady : () => {};
    this.log = typeof log === 'function' ? log : () => {};
    this.CdvPurchase = null;
    this.store = null;
    this.started = false;
    this.ready = false;
    this.purchased = { lifetime: false, monthly: false };
    this.pendingKey = null;
    this.timer = null;
    this.reason = 'sync';
    this.errorEmitted = false;
  }

  /** 購入処理ができる状態か（Web では常に false） */
  get available() {
    return Boolean(this.native && this.store && this.ready);
  }

  /** iOSアプリで、ストアの初期化を始める（Web では何もしない） */
  start() {
    if (!this.native || this.started) return false;
    this.started = true;
    const doc = this.win?.document;
    if (doc?.addEventListener) {
      doc.addEventListener('deviceready', () => this.attach(), { once: true });
    }
    // deviceready が来ない場合の保険。CdvPurchase が現れたら初期化する。
    let attempts = 0;
    if (typeof this.win?.setInterval === 'function') {
      this.timer = this.win.setInterval(() => {
        attempts += 1;
        if (this.store || attempts > 40) {
          this.win.clearInterval(this.timer);
          this.timer = null;
          return;
        }
        this.attach();
      }, 250);
    }
    return true;
  }

  /** 商品を探す（プラットフォーム指定と無指定の両方を試す） */
  findProduct(key) {
    if (!this.store) return null;
    const plan = PRO_PLANS[key];
    if (!plan) return null;
    const platform = this.CdvPurchase?.Platform?.APPLE_APPSTORE;
    try {
      return (platform && this.store.get(plan.id, platform)) || this.store.get(plan.id) || null;
    } catch {
      return null;
    }
  }

  /**
   * CdvPurchase を受け取って商品登録・初期化する（冪等）。
   * テストは偽の CdvPurchase を渡してここから動かす。
   * @returns {boolean} 初期化を始められたか
   */
  attach(CdvPurchase) {
    if (this.store) return true;
    const CP = CdvPurchase || this.win?.CdvPurchase;
    if (!CP?.store) return false;
    const ProductType = CP.ProductType || {};
    const Platform = CP.Platform || {};
    const store = CP.store;
    try {
      if (CP.LogLevel?.WARNING !== undefined) store.verbosity = CP.LogLevel.WARNING;
      store.register(PLAN_ORDER.map((key) => ({
        id: PRO_PLANS[key].id,
        type: key === 'monthly' ? ProductType.PAID_SUBSCRIPTION : ProductType.NON_CONSUMABLE,
        platform: Platform.APPLE_APPSTORE,
      })));
      const when = typeof store.when === 'function' ? store.when() : null;
      if (when) {
        when.productUpdated?.((product) => this.onProductUpdated(product));
        when.approved?.((transaction) => this.onApproved(transaction));
        when.verified?.(() => { this.syncEntitlements(); });
        when.finished?.(() => {});
      }
      if (typeof store.error === 'function') {
        store.error((err) => this.onError(err));
      }
      store.ready(() => {
        this.ready = true;
        this.reason = 'sync';
        this.syncEntitlements();
        this.onReady(this.snapshot());
      });
      store.initialize([{ platform: Platform.APPLE_APPSTORE, options: { needAppReceipt: true } }]);
      this.CdvPurchase = CP;
      this.store = store;
      return true;
    } catch (err) {
      this.log('[IAP] ストアを初期化できませんでした', err);
      return false;
    }
  }

  /** 画面に渡す状態 */
  snapshot() {
    return {
      ...this.purchased,
      pro: hasProPurchase(this.purchased),
      ready: this.ready,
      available: this.available,
      native: this.native,
    };
  }

  /** 購入状態を差し替え、変わったときだけ画面へ知らせる */
  setPurchase(next, reason = this.reason) {
    const normalized = normalizePurchase(next);
    const changed = normalized.lifetime !== this.purchased.lifetime
      || normalized.monthly !== this.purchased.monthly;
    this.purchased = normalized;
    if (changed) this.onPurchase(this.snapshot(), reason);
    return changed;
  }

  /** 商品の owned（または検証済みレシート）から購入状態を読む。読めない項目は今のまま */
  syncEntitlements() {
    if (!this.store) return this.snapshot();
    const isOwned = (key) => {
      const product = this.findProduct(key);
      if (!product) return null; // 商品情報がまだ来ていない（今の状態を保つ）
      if (product.owned) return true;
      try {
        if (typeof this.store.findInVerifiedReceipts === 'function'
          && this.store.findInVerifiedReceipts(product)) return true;
      } catch { /* レシート未取得 */ }
      return false;
    };
    const next = { ...this.purchased };
    for (const key of PLAN_ORDER) {
      const owned = isOwned(key);
      if (owned !== null) next[key] = owned;
    }
    this.setPurchase(next);
    return this.snapshot();
  }

  /** 商品情報が更新された（価格・owned が埋まった） */
  onProductUpdated(product) {
    if (!product?.id) return;
    const key = PLAN_ORDER.find((k) => PRO_PLANS[k].id === product.id);
    if (!key) return;
    // owned が true になったときだけ拾う（読み込み途中の false で消さない）
    if (product.owned) this.setPurchase({ ...this.purchased, [key]: true });
  }

  /** StoreKit が「支払いが承認された」と伝えたとき（購入・復元の共通の出口） */
  onApproved(transaction) {
    this.pendingKey = null;
    if (!transaction) return;
    if (transaction.isPending) {
      this.onMessage({ ...purchaseMessage('pending'), kind: 'pending' });
      return;
    }
    const ids = (transaction.products || []).map((p) => (p && (p.id || p.productId)) || '');
    const next = { ...this.purchased };
    for (const key of PLAN_ORDER) {
      if (ids.includes(PRO_PLANS[key].id)) next[key] = true;
    }
    const reason = this.reason === 'restore' ? 'restore' : 'purchase';
    const changed = this.setPurchase(next, reason);
    // 復元のときは restore() がまとめて報告するので、ここでは出さない
    if (changed && reason === 'purchase') {
      this.onMessage({ ...purchaseMessage('purchased', next), kind: 'purchased' });
    }
    // 端末に反映できたのでトランザクションを完了にする（次回起動で再送させない）
    try {
      const finished = transaction.finish?.();
      if (finished && typeof finished.catch === 'function') finished.catch((err) => this.log('[IAP] finish できませんでした', err));
    } catch (err) {
      this.log('[IAP] finish できませんでした', err);
    }
  }

  onError(err) {
    this.pendingKey = null;
    if (!err) return;
    this.errorEmitted = true;
    const cancelled = this.CdvPurchase?.ErrorCode?.PAYMENT_CANCELLED;
    if (cancelled !== undefined && err.code === cancelled) {
      this.onMessage({ ...purchaseMessage('cancelled'), kind: 'cancelled' });
      return;
    }
    this.log('[IAP] ストアのエラー', err.code, err.message);
    const kind = this.reason === 'restore' ? 'restore-failed' : 'failed';
    this.onMessage({ ...purchaseMessage(kind), kind });
  }

  /** プランを買う（Web・未初期化・処理中は何もしない） */
  async purchase(key) {
    const plan = PRO_PLANS[key];
    if (!plan) return false;
    if (!this.native) {
      this.onMessage({ ...purchaseMessage('web'), kind: 'web' });
      return false;
    }
    if (this.purchased[key]) {
      this.onMessage({ ...purchaseMessage('already'), kind: 'already' });
      return false;
    }
    if (this.pendingKey) {
      this.onMessage({ ...purchaseMessage('busy'), kind: 'busy' });
      return false;
    }
    if (!this.store || !this.ready) {
      this.onMessage({ ...purchaseMessage('unavailable'), kind: 'unavailable' });
      return false;
    }
    const product = this.findProduct(key);
    const offer = typeof product?.getOffer === 'function' ? product.getOffer() : null;
    if (!product || !offer) {
      this.onMessage({ ...purchaseMessage('loading'), kind: 'loading' });
      try { this.store.update?.(); } catch { /* 次回の再試行に任せる */ }
      return false;
    }
    this.pendingKey = key;
    this.reason = 'purchase';
    this.errorEmitted = false;
    try {
      const result = await this.store.order(offer);
      // エラーはストアの error イベントでも届く（二重に案内しない）
      if (result) this.pendingKey = null;
      return !result;
    } catch (err) {
      this.pendingKey = null;
      this.onError(err);
      return false;
    }
  }

  /** 購入の復元（機種変更・再インストールのあと） */
  async restore() {
    if (!this.native) {
      this.onMessage({ ...purchaseMessage('web'), kind: 'web' });
      return false;
    }
    if (!this.store) {
      this.onMessage({ ...purchaseMessage('unavailable'), kind: 'unavailable' });
      return false;
    }
    this.reason = 'restore';
    this.errorEmitted = false;
    this.onMessage({ ...purchaseMessage('restoring'), kind: 'restoring' });
    try {
      if (typeof this.store.restorePurchases === 'function') await this.store.restorePurchases();
      if (typeof this.store.update === 'function') await this.store.update();
    } catch (err) {
      this.log('[IAP] 復元できませんでした', err);
      if (!this.errorEmitted) this.onMessage({ ...purchaseMessage('restore-failed'), kind: 'restore-failed' });
      this.reason = 'sync';
      return false;
    }
    this.ready = true;
    this.syncEntitlements();
    const owned = hasProPurchase(this.purchased);
    this.onMessage({
      ...purchaseMessage(owned ? 'restored' : 'restore-empty', this.purchased),
      kind: owned ? 'restored' : 'restore-empty',
    });
    this.reason = 'sync';
    return owned;
  }
}
