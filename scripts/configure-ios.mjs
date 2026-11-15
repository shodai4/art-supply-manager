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
export const PROJECT_PATH = process.env.IOS_PROJECT_PATH
  ? path.resolve(process.env.IOS_PROJECT_PATH)
  : path.join(ROOT, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');

export const APP_DISPLAY_NAME = '画材管理';
export const MINIMUM_IOS_VERSION = '15.0';

const CAMERA_USAGE = 'バーコード（JANコード）を読み取るためにカメラを使用します。映像は端末内だけで処理し、外部へ送信しません。';
const PHOTO_USAGE = '画材の実物写真を登録するために、写真を選択します。選んだ写真は端末内にのみ保存します。';

/** mode: 'value' は値まで一致させる / 'presence' はキーの存在だけ確認する */
export const CONFIG_ENTRIES = [
  { key: 'CFBundleDisplayName', value: `<string>${APP_DISPLAY_NAME}</string>`, mode: 'value' },
  { key: 'CFBundleName', value: `<string>${APP_DISPLAY_NAME}</string>`, mode: 'value' },
  { key: 'NSCameraUsageDescription', value: `<string>${CAMERA_USAGE}</string>`, mode: 'value' },
  { key: 'NSPhotoLibraryUsageDescription', value: `<string>${PHOTO_USAGE}</string>`, mode: 'value' },
  { key: 'ITSAppUsesNonExemptEncryption', value: '<false/>', mode: 'value' },
  // iPhone は縦固定（画面は縦前提で作っている）。iPad 用の ~ipad キーは Capacitor の既定（全向き）のまま
  { key: 'UISupportedInterfaceOrientations', value: '<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t</array>', mode: 'value' },
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

/** Podfile の platform :ios を最低バージョンに揃える */
export function configurePodfileContent(input, minimum = MINIMUM_IOS_VERSION) {
  const source = String(input == null ? '' : input);
  const line = `platform :ios, '${minimum}'`;
  const pattern = /^([ \t]*platform[ \t]+:ios[ \t]*,[ \t]*['"])[0-9.]+(['"])/m;
  if (!pattern.test(source)) {
    const anchor = /^([ \t]*use_frameworks!)/m;
    const content = anchor.test(source)
      ? source.replace(anchor, (_m, keep) => `${line}\n${keep}`)
      : `${line}\n${source}`;
    return { content, modified: content !== source, added: true };
  }
  const content = source.replace(pattern, (_m, head, tail) => `${head}${minimum}${tail}`);
  return { content, modified: content !== source, added: false };
}

export function verifyPodfileContent(content, minimum = MINIMUM_IOS_VERSION) {
  const found = /^[ \t]*platform[ \t]+:ios[ \t]*,[ \t]*['"]([0-9.]+)['"]/m.exec(String(content == null ? '' : content));
  if (!found) return ['Podfile に platform :ios の指定がありません'];
  if (compareVersions(found[1], minimum) < 0) {
    return [`Podfile の platform は iOS ${found[1]} です（iOS ${minimum} 以上にしてください）`];
  }
  return [];
}

/** Xcode プロジェクトの IPHONEOS_DEPLOYMENT_TARGET を引き上げる */
export function configureProjectContent(input, minimum = MINIMUM_IOS_VERSION) {
  const source = String(input == null ? '' : input);
  let occurrences = 0;
  let raised = 0;
  const content = source.replace(/(IPHONEOS_DEPLOYMENT_TARGET[ \t]*=[ \t]*)([0-9.]+)([ \t]*;)/g, (match, head, version, tail) => {
    occurrences += 1;
    if (compareVersions(version, minimum) < 0) {
      raised += 1;
      return `${head}${minimum}${tail}`;
    }
    return match;
  });
  return { content, modified: content !== source, occurrences, raised };
}

export function verifyProjectContent(content, minimum = MINIMUM_IOS_VERSION) {
  const found = [...String(content == null ? '' : content).matchAll(/IPHONEOS_DEPLOYMENT_TARGET[ \t]*=[ \t]*([0-9.]+)[ \t]*;/g)].map((m) => m[1]);
  if (found.length === 0) return ['project.pbxproj に IPHONEOS_DEPLOYMENT_TARGET がありません'];
  return found
    .filter((v) => compareVersions(v, minimum) < 0)
    .map((v) => `IPHONEOS_DEPLOYMENT_TARGET が ${v} です（iOS ${minimum} 以上にしてください）`);
}

/** 実ファイルに適用（存在しないファイルは黙って飛ばす） */
export function applyAll({ plistPath = PLIST_PATH, podfilePath = PODFILE_PATH, projectPath = PROJECT_PATH } = {}) {
  const results = [];
  if (fs.existsSync(plistPath)) {
    const before = fs.readFileSync(plistPath, 'utf8');
    const { content, modified } = configureContent(before);
    if (modified) fs.writeFileSync(plistPath, content, 'utf8');
    results.push({ file: 'Info.plist', action: modified ? 'updated' : 'verified', problems: verifyContent(content) });
  } else {
    results.push({ file: 'Info.plist', action: 'missing' });
  }
  if (fs.existsSync(podfilePath)) {
    const before = fs.readFileSync(podfilePath, 'utf8');
    const { content, modified } = configurePodfileContent(before);
    if (modified) fs.writeFileSync(podfilePath, content, 'utf8');
    results.push({ file: 'Podfile', action: modified ? 'updated' : 'verified', problems: verifyPodfileContent(content) });
  }
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
