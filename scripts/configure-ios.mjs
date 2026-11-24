// Capacitor iOS の Info.plist / Podfile / Xcode プロジェクトを整える（冪等）
// - ホーム画面の名前・カメラと写真の用途説明・輸出コンプライアンス
// - 最低対応OSを iOS 15.0 に揃える（2027年4月からのApple要件に先回り）
// 純粋関数を export しているので node --test から検証できる。
// 使い方: node scripts/configure-ios.mjs （ios/ が無いときは何もせず終了）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PLIST_PATH = process.env.IOS_PLIST_PATH
  ? path.resolve(process.env.IOS_PLIST_PATH)
  : path.join(ROOT, 'ios', 'App', 'App', 'Info.plist');
export const PODFILE_PATH = process.env.IOS_PODFILE_PATH
  ? path.resolve(process.env.IOS_PODFILE_PATH)
  : path.join(ROOT, 'ios', 'App', 'Podfile');
export const PODFILE_LOCK_PATH = process.env.IOS_PODFILE_LOCK_PATH
  ? path.resolve(process.env.IOS_PODFILE_LOCK_PATH)
  : path.join(ROOT, 'ios', 'App', 'Podfile.lock');
export const PROJECT_PATH = process.env.IOS_PROJECT_PATH
  ? path.resolve(process.env.IOS_PROJECT_PATH)
  : path.join(ROOT, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
export const CAP_CONFIG_PATH = process.env.IOS_CAP_CONFIG_PATH
  ? path.resolve(process.env.IOS_CAP_CONFIG_PATH)
  : path.join(ROOT, 'ios', 'App', 'App', 'capacitor.config.json');

// ホーム画面・アプリ内に出す正式名称の短縮表記（正式名称は「アトリコ〜画材の在庫を管理するアプリ〜」）
export const APP_DISPLAY_NAME = 'アトリコ';
// CFBundleName は内部名。CI（.github/workflows/ios-build.yml）が APP_NAME で Info.plist を
// 検査しており、その APP_NAME は App Store Connect の登録名「画材管理」のまま。
// ワークフローはApp権限の都合でこちらから変更できないため、登録名を内部名として残しておく
// （ホーム画面に出るのは CFBundleDisplayName なので表示はアトリコになる）。
export const APP_BUNDLE_NAME = '画材管理';
export const MINIMUM_IOS_VERSION = '15.0';

// AdMob のアプリID（Info.plist の GADApplicationIdentifier）。
// 本番のアプリIDで固定（admob.js の ADMOB_PROD_APP_ID と同じ値。tests/admob.test.js が一致を検査）。
// 広告ユニットは admob.js の USE_TEST_ADS で切り替える（本番広告は false。テストで確かめるときだけ true）が、
// テスト広告はどのアプリIDでも返るので、Info.plist のアプリIDはどちらのときも本番のままでよい。
export const ADMOB_APP_ID = 'ca-app-pub-5739782559889389~2686704558';

const CAMERA_USAGE = 'バーコード（JANコード）を読み取るためにカメラを使用します。映像は端末内だけで処理し、外部へ送信しません。';
const PHOTO_USAGE = '画材の実物写真を登録するために、写真を選択します。選んだ写真は端末内にのみ保存します。';

/** mode: 'value' は値まで一致させる / 'presence' はキーの存在だけ確認する */
export const CONFIG_ENTRIES = [
  { key: 'CFBundleDisplayName', value: `<string>${APP_DISPLAY_NAME}</string>`, mode: 'value' },
  { key: 'CFBundleName', value: `<string>${APP_BUNDLE_NAME}</string>`, mode: 'value' },
  { key: 'NSCameraUsageDescription', value: `<string>${CAMERA_USAGE}</string>`, mode: 'value' },
  { key: 'NSPhotoLibraryUsageDescription', value: `<string>${PHOTO_USAGE}</string>`, mode: 'value' },
  { key: 'ITSAppUsesNonExemptEncryption', value: '<false/>', mode: 'value' },
  // iPhone は縦固定（画面は縦前提で作っている）。iPad 用の ~ipad キーは Capacitor の既定（全向き）のまま
  { key: 'UISupportedInterfaceOrientations', value: '<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t</array>', mode: 'value' },
  // 最下部のバナー広告（AdMob）。広告SDKが起動時にアプリIDを読むため、キーが無いと起動時に落ちる
  { key: 'GADApplicationIdentifier', value: `<string>${ADMOB_APP_ID}</string>`, mode: 'value' },
  // 広告の配信元を測るためのネットワーク識別子（Apple が公開している AdMob の推奨リストから主要なものを入れる）
  {
    key: 'SKAdNetworkItems',
    value: '<array>\n'
      + '\t\t<dict><key>SKAdNetworkIdentifier</key><string>cstr6suwn9.skadnetwork</string></dict>\n'
      + '\t\t<dict><key>SKAdNetworkIdentifier</key><string>4fzdc2evr5.skadnetwork</string></dict>\n'
      + '\t\t<dict><key>SKAdNetworkIdentifier</key><string>2fnua5tdw4.skadnetwork</string></dict>\n'
      + '\t\t<dict><key>SKAdNetworkIdentifier</key><string>ydx93a7ass.skadnetwork</string></dict>\n'
      + '\t\t<dict><key>SKAdNetworkIdentifier</key><string>p78axxw29g.skadnetwork</string></dict>\n'
      + '\t</array>',
    mode: 'value',
  },
  // 広告識別子（IDFA）を使う場合の説明。アプリ起動時、AdMob.initialize() より先に
  // 許可ダイアログを出す（admob.js の ensureTrackingAuthorization）。拒否しても全機能は同じように使える。
  { key: 'NSUserTrackingUsageDescription', value: '<string>利用者に合った広告を表示するために広告識別子を使う場合があります。許可しない場合も、画材の登録・読取・在庫管理などすべての機能を同じようにご利用いただけます。</string>', mode: 'value' },
];

function countOccurrences(haystack, needle) {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

const normalizeXml = (xml) => String(xml == null ? '' : xml).replace(/\s+/g, ' ').trim();

/** <key>…</key> の直後から始まる値の終端位置（値が無ければ from を返す） */
export function findValueEnd(text, from) {
  let i = from;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  if (text[i] !== '<') return from;
  const head = /^<([A-Za-z_][\w.-]*)([^>]*?)(\/?)>/.exec(text.slice(i));
  if (!head) return from;
  if (head[3] === '/') return i + head[0].length;
  const tag = head[1];
  let depth = 1;
  let position = i + head[0].length;
  const tagRe = /<\/?([A-Za-z_][\w.-]*)([^>]*?)(\/?)>/g;
  tagRe.lastIndex = position;
  let match;
  while ((match = tagRe.exec(text))) {
    if (match[1] !== tag) continue;
    if (match[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return tagRe.lastIndex;
    } else if (match[3] !== '/') {
      depth += 1;
    }
  }
  return from;
}

/** 同じキーの2件目以降を取り除く */
export function dedupeKey(content, key) {
  const keyTag = `<key>${key}</key>`;
  let result = content;
  let first = true;
  let searchFrom = 0;
  for (;;) {
    const index = result.indexOf(keyTag, searchFrom);
    if (index === -1) break;
    if (first) {
      first = false;
      searchFrom = index + keyTag.length;
      continue;
    }
    let end = findValueEnd(result, index + keyTag.length);
    if (end <= index + keyTag.length) end = index + keyTag.length;
    let start = index;
    while (start > 0 && (result[start - 1] === '\t' || result[start - 1] === ' ')) start -= 1;
    while (end < result.length && /[ \t]/.test(result[end])) end += 1;
    if (result[end] === '\n') end += 1;
    result = result.slice(0, start) + result.slice(end);
    searchFrom = start;
  }
  return result;
}

const entryXml = (entry) => `\t<key>${entry.key}</key>\n\t${entry.value}`;

/**
 * Info.plist の文字列を設定済みにして返す（純粋関数）。
 * @returns {{content:string, modified:boolean, actions:Array<{key:string, action:string}>}}
 */
export function configureContent(input, entries = CONFIG_ENTRIES) {
  let content = String(input == null ? '' : input);
  const actions = [];
  for (const entry of entries) {
    const keyTag = `<key>${entry.key}</key>`;
    const occurrences = countOccurrences(content, keyTag);

    if (occurrences === 0) {
      const lastDict = content.lastIndexOf('</dict>');
      if (lastDict === -1) {
        actions.push({ key: entry.key, action: 'skipped-no-dict' });
        continue;
      }
      content = `${content.slice(0, lastDict)}${entryXml(entry)}\n${content.slice(lastDict)}`;
      actions.push({ key: entry.key, action: 'injected' });
      continue;
    }
    if (occurrences > 1) {
      content = dedupeKey(content, entry.key);
      actions.push({ key: entry.key, action: 'deduped' });
    }
    if (entry.mode !== 'value') {
      if (!actions.some((a) => a.key === entry.key)) actions.push({ key: entry.key, action: 'verified' });
      continue;
    }
    const keyEnd = content.indexOf(keyTag) + keyTag.length;
    const valueEnd = findValueEnd(content, keyEnd);
    const current = valueEnd > keyEnd ? content.slice(keyEnd, valueEnd) : '';
    if (normalizeXml(current) !== normalizeXml(entry.value)) {
      content = `${content.slice(0, keyEnd)}\n\t${entry.value}${content.slice(valueEnd)}`;
      actions.push({ key: entry.key, action: 'updated' });
    } else if (!actions.some((a) => a.key === entry.key)) {
      actions.push({ key: entry.key, action: 'verified' });
    }
  }
  return { content, modified: content !== String(input == null ? '' : input), actions };
}

/** 出力後の Info.plist を点検する（問題点の配列。空なら合格） */
export function verifyContent(content, entries = CONFIG_ENTRIES) {
  const problems = [];
  for (const entry of entries) {
    const keyTag = `<key>${entry.key}</key>`;
    const occurrences = countOccurrences(content, keyTag);
    if (occurrences !== 1) {
      problems.push(`<key>${entry.key}</key> が ${occurrences} 件あります（1件であるべき）`);
      continue;
    }
    if (entry.mode !== 'value') continue;
    const keyEnd = content.indexOf(keyTag) + keyTag.length;
    const valueEnd = findValueEnd(content, keyEnd);
    const current = valueEnd > keyEnd ? content.slice(keyEnd, valueEnd) : '';
    if (normalizeXml(current) !== normalizeXml(entry.value)) {
      problems.push(`<key>${entry.key}</key> の値が想定と違います`);
    }
  }
  const opens = (content.match(/<dict>/g) || []).length;
  const closes = (content.match(/<\/dict>/g) || []).length;
  if (opens !== closes) problems.push(`<dict> と </dict> の数が一致しません (${opens}/${closes})`);
  return problems;
}

/** "15.0" と "13" などを数値配列で比較 */
export function compareVersions(a, b) {
  const parse = (v) => String(v == null ? '' : v).split('.').map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// AdMob プラグイン（@capacitor-community/admob 6.2.0）は Google-Mobile-Ads-SDK 11.3.0 を指定し、
// その依存は GoogleUserMessagingPlatform を「>= 1.1」としか縛らないため、
// 何も指定しないと 3.x が入り、Swift の API 名が変わって ConsentExecutor.swift がコンパイルできない
// （UMPConsentStatus → ConsentStatus、sharedInstance → shared）。
// プラグインが想定する 2.x 系に固定して、CI のビルドを通す。
export const ADMOB_UMP_POD = "pod 'GoogleUserMessagingPlatform', '~> 2.7'";

// バーコード読取のネイティブ化（AVFoundation のハードウェア検出）。
// 外部の CocoaPods 依存は張らず、リポジトリ内の plugins/art-barcode-scanner を
// ローカル Pod として読む（pod install でアプリのターゲットに組み込まれる）。
// リポジトリ直下からの相対パスで書く（Podfile は ios/App にある）。
export const SCANNER_POD = "pod 'ArtBarcodeScanner', :path => '../../plugins/art-barcode-scanner'";
/** Pod に入っている Swift クラス名（capacitor.config.json の packageClassList に書く） */
export const SCANNER_PLUGIN_CLASS = 'ArtBarcodeScannerPlugin';

// iCloud自動バックアップ（NSUbiquitousKeyValueStore）。バーコード読取と同じく
// リポジトリ内のローカル Pod として読む（外部の依存は増やさない）。
export const ICLOUD_POD = "pod 'ArtICloudSync', :path => '../../plugins/art-icloud-sync'";
export const ICLOUD_PLUGIN_CLASS = 'ArtICloudSyncPlugin';
/** iCloudのキー・バリュー保存の権利（entitlements に書くキー） */
export const ICLOUD_ENTITLEMENT_KEY = 'com.apple.developer.ubiquity-kvstore-identifier';
/** 値はチームIDの前置き＋バンドルID（Xcode が自動署名で App ID に権利を足す） */
export const ICLOUD_ENTITLEMENT_VALUE = '$(TeamIdentifierPrefix)com.shodai4.artsupplymanager';
/** Xcode から見た entitlements の場所（ios/App からの相対） */
export const ENTITLEMENTS_REL_PATH = 'App/App.entitlements';
export const ENTITLEMENTS_PATH = process.env.IOS_ENTITLEMENTS_PATH
  ? path.resolve(process.env.IOS_ENTITLEMENTS_PATH)
  : path.join(ROOT, 'ios', 'App', 'App', 'App.entitlements');

/** Podfile の platform :ios を最低バージョンに揃え、AdMob の UMP を 2.x に固定する */
export function configurePodfileContent(input, minimum = MINIMUM_IOS_VERSION) {
  const source = String(input == null ? '' : input);
  const line = `platform :ios, '${minimum}'`;
  const pattern = /^([ \t]*platform[ \t]+:ios[ \t]*,[ \t]*['"])[0-9.]+(['"])/m;
  if (!pattern.test(source)) {
    const anchor = /^([ \t]*use_frameworks!)/m;
    const content = anchor.test(source)
      ? source.replace(anchor, (_m, keep) => `${line}\n${keep}`)
      : `${line}\n${source}`;
    const withPin = addICloudPod(addScannerPod(addUmpPin(content)));
    return { content: withPin, modified: withPin !== source, added: true };
  }
  const upgraded = source.replace(pattern, (_m, head, tail) => `${head}${minimum}${tail}`);
  const content = addICloudPod(addScannerPod(addUmpPin(upgraded)));
  return { content, modified: content !== source, added: false };
}

/** AdMob の UMP 固定行を、target ブロックの中（無ければ capacitor_pods の後ろ）に1行だけ入れる */
export function addUmpPin(content) {
  const source = String(content == null ? '' : content);
  if (source.includes(ADMOB_UMP_POD)) return source;
  const target = /^([ \t]*)target[ \t]+['"]App['"][ \t]+do[ \t]*$/m.exec(source);
  if (target) {
    const at = target.index + target[0].length;
    return `${source.slice(0, at)}\n${target[1]}  ${ADMOB_UMP_POD}${source.slice(at)}`;
  }
  // target がまだ無い（--no-ios の素の Podfile）ときは、関数の末尾に置いておく
  const fn = /^([ \t]*)def[ \t]+capacitor_pods[ \t]*$/m.exec(source);
  if (fn) {
    const end = source.indexOf('end', fn.index);
    if (end > 0) return `${source.slice(0, end)}  ${ADMOB_UMP_POD}\n${source.slice(end)}`;
  }
  return `${source.replace(/\s*$/, '')}\n${ADMOB_UMP_POD}\n`;
}

export function verifyPodfileContent(content, minimum = MINIMUM_IOS_VERSION) {
  const source = String(content == null ? '' : content);
  const found = /^[ \t]*platform[ \t]+:ios[ \t]*,[ \t]*['"]([0-9.]+)['"]/m.exec(source);
  if (!found) return ['Podfile に platform :ios の指定がありません'];
  if (compareVersions(found[1], minimum) < 0) {
    return [`Podfile の platform は iOS ${found[1]} です（iOS ${minimum} 以上にしてください）`];
  }
  const pins = (source.match(/pod 'GoogleUserMessagingPlatform'/g) || []).length;
  if (pins !== 1) return [`GoogleUserMessagingPlatform の指定が ${pins} 件あります（1件であるべき）`];
  const scanners = (source.match(/pod 'ArtBarcodeScanner'/g) || []).length;
  if (scanners !== 1) return [`ArtBarcodeScanner（バーコード読取）の指定が ${scanners} 件あります（1件であるべき）`];
  const clouds = (source.match(/pod 'ArtICloudSync'/g) || []).length;
  if (clouds !== 1) return [`ArtICloudSync（iCloudバックアップ）の指定が ${clouds} 件あります（1件であるべき）`];
  return [];
}

/**
 * バーコード読取のローカル Pod を、target ブロックの中に1行だけ入れる。
 * 外部の pod を取ってこないので、CI でもネットワークの当たり外れが無い。
 */
export function addScannerPod(content) {
  const source = String(content == null ? '' : content);
  if (source.includes("pod 'ArtBarcodeScanner'")) return source;
  const target = /^([ \t]*)target[ \t]+['"]App['"][ \t]+do[ \t]*$/m.exec(source);
  if (target) {
    const at = target.index + target[0].length;
    return `${source.slice(0, at)}\n${target[1]}  ${SCANNER_POD}${source.slice(at)}`;
  }
  // target がまだ無い（素の Podfile）ときは、末尾に置いておく
  return `${source.replace(/\s*$/, '')}\n${SCANNER_POD}\n`;
}

/**
 * iCloud自動バックアップのローカル Pod を、target ブロックの中に1行だけ入れる。
 * バーコード読取と同じく、外部の pod を取ってこない。
 */
export function addICloudPod(content) {
  const source = String(content == null ? '' : content);
  if (source.includes("pod 'ArtICloudSync'")) return source;
  const target = /^([ \t]*)target[ \t]+['\"]App['\"][ \t]+do[ \t]*$/m.exec(source);
  if (target) {
    const at = target.index + target[0].length;
    return `${source.slice(0, at)}\n${target[1]}  ${ICLOUD_POD}${source.slice(at)}`;
  }
  return `${source.replace(/\s*$/, '')}\n${ICLOUD_POD}\n`;
}

/**
 * iCloud のキー・バリュー保存の entitlements の中身。
 * 値の $(TeamIdentifierPrefix) は Xcode が署名時にチームIDへ置き換える。
 */
export function entitlementsContent(key = ICLOUD_ENTITLEMENT_KEY, value = ICLOUD_ENTITLEMENT_VALUE) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>${key}</key>
\t<string>${value}</string>
</dict>
</plist>
`;
}

/** entitlements が想定どおりか（空なら合格） */
export function verifyEntitlementsContent(content) {
  const text = String(content == null ? '' : content);
  const problems = [];
  if (!text.includes(`<key>${ICLOUD_ENTITLEMENT_KEY}</key>`)) {
    problems.push(`entitlements に ${ICLOUD_ENTITLEMENT_KEY} がありません`);
  }
  if (!text.includes(`<string>${ICLOUD_ENTITLEMENT_VALUE}</string>`)) {
    problems.push('iCloud のキー・バリュー保存の値が想定と違います');
  }
  if ((text.match(/<dict>/g) || []).length !== (text.match(/<\/dict>/g) || []).length) {
    problems.push('entitlements の <dict> が閉じていません');
  }
  return problems;
}

/**
 * Xcode プロジェクトに CODE_SIGN_ENTITLEMENTS を入れる（App ターゲットの Debug/Release）。
 * PRODUCT_BUNDLE_IDENTIFIER の行の直後に置くので、Capacitor が作り直した pbxproj にも効く。
 */
export function addEntitlementSetting(content, relPath = ENTITLEMENTS_REL_PATH) {
  const source = String(content == null ? '' : content);
  const line = `CODE_SIGN_ENTITLEMENTS = ${relPath};`;
  if (source.includes(line)) return source;
  const pattern = /^([ \t]*)PRODUCT_BUNDLE_IDENTIFIER[ \t]*=[ \t]*com\.shodai4\.artsupplymanager[ \t]*;[ \t]*$/gm;
  if (!pattern.test(source)) return source;
  return source.replace(pattern, (match, indent) => `${match}\n${indent}${line}`);
}

/**
 * ios/App/App/capacitor.config.json の packageClassList に、ネイティブの読取プラグインを加える。
 * cap sync は node_modules のプラグインだけを列挙するので、ローカル Pod の分はここで足す
 * （この名前が無いと、JS 側の Capacitor.Plugins.BarcodeScanner が生まれない）。
 */
export function configureCapConfigContent(input, className = SCANNER_PLUGIN_CLASS) {
  const source = String(input == null ? '' : input);
  let config;
  try {
    config = JSON.parse(source);
  } catch (e) {
    return { content: source, modified: false, error: 'capacitor.config.json を読み取れません' };
  }
  const list = Array.isArray(config.packageClassList) ? config.packageClassList : [];
  if (list.includes(className)) return { content: source, modified: false, list };
  const next = { ...config, packageClassList: [...list, className] };
  return { content: `${JSON.stringify(next, null, '\t')}\n`, modified: true, list: next.packageClassList };
}

export function verifyCapConfigContent(content, className = SCANNER_PLUGIN_CLASS) {
  try {
    const config = JSON.parse(String(content == null ? '' : content));
    const list = Array.isArray(config.packageClassList) ? config.packageClassList : [];
    return list.includes(className) ? [] : [`capacitor.config.json の packageClassList に ${className} がありません`];
  } catch (e) {
    return ['capacitor.config.json を読み取れません（JSONとして壊れています）'];
  }
}

/**
 * Podfile.lock を作り直すべきか。
 * cap sync が先に pod install して UMP 3.x をロックしていると、Podfile の 2.x 固定とぶつかって
 * pod install が失敗する（CocoaPods はロックを下限として扱う）。そのときはロックを消して解決し直す。
 */
export function lockNeedsRefresh(lockText) {
  const text = String(lockText == null ? '' : lockText);
  if (!text) return false;
  const found = /GoogleUserMessagingPlatform \(([0-9.]+)/.exec(text);
  if (!found) return false;
  const version = found[1];
  return compareVersions(version, '2.0') < 0 || compareVersions(version, '3.0') >= 0;
}

/** Xcode プロジェクトの IPHONEOS_DEPLOYMENT_TARGET を引き上げる */
export function configureProjectContent(input, minimum = MINIMUM_IOS_VERSION) {
  const source = String(input == null ? '' : input);
  let occurrences = 0;
  let raised = 0;
  const upgraded = source.replace(/(IPHONEOS_DEPLOYMENT_TARGET[ \t]*=[ \t]*)([0-9.]+)([ \t]*;)/g, (match, head, version, tail) => {
    occurrences += 1;
    if (compareVersions(version, minimum) < 0) {
      raised += 1;
      return `${head}${minimum}${tail}`;
    }
    return match;
  });
  const content = addEntitlementSetting(upgraded);
  return { content, modified: content !== source, occurrences, raised };
}

export function verifyProjectContent(content, minimum = MINIMUM_IOS_VERSION) {
  const text = String(content == null ? '' : content);
  const found = [...text.matchAll(/IPHONEOS_DEPLOYMENT_TARGET[ \t]*=[ \t]*([0-9.]+)[ \t]*;/g)].map((m) => m[1]);
  if (found.length === 0) return ['project.pbxproj に IPHONEOS_DEPLOYMENT_TARGET がありません'];
  const problems = found
    .filter((v) => compareVersions(v, minimum) < 0)
    .map((v) => `IPHONEOS_DEPLOYMENT_TARGET が ${v} です（iOS ${minimum} 以上にしてください）`);
  const bundles = (text.match(/PRODUCT_BUNDLE_IDENTIFIER[ \t]*=[ \t]*com\.shodai4\.artsupplymanager[ \t]*;/g) || []).length;
  const entitlements = (text.match(/CODE_SIGN_ENTITLEMENTS[ \t]*=[ \t]*App\/App\.entitlements[ \t]*;/g) || []).length;
  if (bundles > 0 && entitlements !== bundles) {
    problems.push(`CODE_SIGN_ENTITLEMENTS が ${entitlements} 件です（${bundles} 件の構成すべてに入れてください）`);
  }
  return problems;
}

/** 実ファイルに適用（存在しないファイルは黙って飛ばす） */
export function applyAll({
  plistPath = PLIST_PATH, podfilePath = PODFILE_PATH, projectPath = PROJECT_PATH, lockPath = PODFILE_LOCK_PATH,
  capConfigPath = CAP_CONFIG_PATH, entitlementsPath = ENTITLEMENTS_PATH,
} = {}) {
  const results = [];
  if (fs.existsSync(plistPath)) {
    const before = fs.readFileSync(plistPath, 'utf8');
    const { content, modified } = configureContent(before);
    if (modified) fs.writeFileSync(plistPath, content, 'utf8');
    results.push({ file: 'Info.plist', action: modified ? 'updated' : 'verified', problems: verifyContent(content) });
  } else {
    results.push({ file: 'Info.plist', action: 'missing' });
  }
  let podfileChanged = false;
  if (fs.existsSync(podfilePath)) {
    const before = fs.readFileSync(podfilePath, 'utf8');
    const { content, modified } = configurePodfileContent(before);
    if (modified) fs.writeFileSync(podfilePath, content, 'utf8');
    podfileChanged = modified;
    results.push({ file: 'Podfile', action: modified ? 'updated' : 'verified', problems: verifyPodfileContent(content) });
  }
  // AdMob の UMP を 2.x に固定したので、3.x をロックしている Podfile.lock は捨てて解決し直す
  if (fs.existsSync(lockPath)) {
    const lock = fs.readFileSync(lockPath, 'utf8');
    if (podfileChanged || lockNeedsRefresh(lock)) {
      fs.rmSync(lockPath, { force: true });
      results.push({ file: 'Podfile.lock', action: 'removed', problems: [] });
    } else {
      results.push({ file: 'Podfile.lock', action: 'kept', problems: [] });
    }
  }
  if (fs.existsSync(capConfigPath)) {
    const before = fs.readFileSync(capConfigPath, 'utf8');
    let content = before;
    let modified = false;
    let error = '';
    for (const className of [SCANNER_PLUGIN_CLASS, ICLOUD_PLUGIN_CLASS]) {
      const out = configureCapConfigContent(content, className);
      if (out.error) { error = out.error; break; }
      if (out.modified) { content = out.content; modified = true; }
    }
    if (modified) fs.writeFileSync(capConfigPath, content, 'utf8');
    const problems = error
      ? [error]
      : [SCANNER_PLUGIN_CLASS, ICLOUD_PLUGIN_CLASS].flatMap((c) => verifyCapConfigContent(content, c));
    results.push({ file: 'capacitor.config.json', action: modified ? 'updated' : 'verified', problems });
  }
  // iCloud のキー・バリュー保存の entitlements（無ければ作り、違えば直す）。
  // iOS プロジェクトが無いときは作らない（テストが空の ios/ を作ってしまい、
  // CI の `if [ ! -d ios ]` が cap add を飛ばして sync が落ちるのを防ぐ）。
  const hasProject = fs.existsSync(plistPath) || fs.existsSync(projectPath);
  if (!hasProject) return results;
  const wanted = entitlementsContent();
  let entitlementsAction = 'verified';
  if (!fs.existsSync(entitlementsPath)) {
    fs.mkdirSync(path.dirname(entitlementsPath), { recursive: true });
    fs.writeFileSync(entitlementsPath, wanted, 'utf8');
    entitlementsAction = 'created';
  } else {
    const before = fs.readFileSync(entitlementsPath, 'utf8');
    if (before !== wanted) {
      fs.writeFileSync(entitlementsPath, wanted, 'utf8');
      entitlementsAction = 'updated';
    }
  }
  results.push({
    file: 'App.entitlements',
    action: entitlementsAction,
    problems: verifyEntitlementsContent(fs.readFileSync(entitlementsPath, 'utf8')),
  });
  if (fs.existsSync(projectPath)) {
    const before = fs.readFileSync(projectPath, 'utf8');
    const { content, modified } = configureProjectContent(before);
    if (modified) fs.writeFileSync(projectPath, content, 'utf8');
    results.push({ file: 'project.pbxproj', action: modified ? 'updated' : 'verified', problems: verifyProjectContent(content) });
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(PLIST_PATH)) {
    console.log('[ios] ios/ がまだありません。先に npx cap add ios を実行してください。');
    process.exit(0);
  }
  let failed = false;
  for (const r of applyAll()) {
    console.log(`[ios] ${r.file}: ${r.action}`);
    for (const p of r.problems || []) {
      failed = true;
      console.error(`[ios]   ${p}`);
    }
  }
  if (failed) process.exitCode = 1;
}
