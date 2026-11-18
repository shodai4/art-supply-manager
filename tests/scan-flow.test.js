import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankState, createItem, calcCheckDigit } from '../core.js';
import { FREE_ITEM_LIMIT, UNLIMITED } from '../pro.js';
import {
  SCAN_COOLDOWN_MS, createScanSession, resetScanSession, checkCooldown, markScanned,
  classifyJAN, applyScan, draftName, scanFolderId, scanLogCount, describeScanLog,
} from '../scan-flow.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

/** 12桁から正しいJAN（チェックディジット付き）を作る */
const jan = (first12) => `${first12}${calcCheckDigit(first12)}`;

const DICT_JAN = jan('490123456789');   // 辞書にある・未登録
const DRAFT_JAN = jan('490765432109');  // 未収録（プレフィックスでメーカーが分かる）
const NOBODY_JAN = jan('499999999999'); // 未収録（メーカー不明）
const BAD_JAN = '4901234567890';        // チェックディジットが合わない

const PREFIXES = [{ prefix: '4907654', maker: 'テスト画材', brand: 'TEST' }];
const DICT = [{
  jan: DICT_JAN,
  name: 'テスト油絵具 ウルトラマリン',
  maker: 'テストメーカー',
  brand: 'TEST',
  category: 'oil',
  colorName: 'ウルトラマリン',
  code: 'A-12',
  size: '20ml',
}];

/* ---------------- クールダウン ---------------- */

test('同じJANは2.8秒あくまで数えない（別のJANはすぐ通る）', () => {
  const session = createScanSession();
  assert.equal(SCAN_COOLDOWN_MS, 2800);
  assert.equal(checkCooldown(session, DICT_JAN, 1000).accepted, true);
  markScanned(session, DICT_JAN, 1000);

  // 0.5秒後に同じJANがまた来ても数えない
  const blocked = checkCooldown(session, DICT_JAN, 1500);
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.same, true);
  assert.ok(blocked.waitMs > 2000 && blocked.waitMs <= SCAN_COOLDOWN_MS, `waitMs=${blocked.waitMs}`);

  // 別のJANは同時刻でも通る（何本も続けて読むときは止まらない）
  assert.equal(checkCooldown(session, DRAFT_JAN, 1500).accepted, true);

  // 2.8秒たつ前はだめ、たてば通る
  assert.equal(checkCooldown(session, DICT_JAN, 1000 + SCAN_COOLDOWN_MS - 1).accepted, false);
  assert.equal(checkCooldown(session, DICT_JAN, 1000 + SCAN_COOLDOWN_MS).accepted, true);

  // 画面を開き直したら戻る
  resetScanSession(session);
  assert.equal(checkCooldown(session, DICT_JAN, 1100).accepted, true);
});

test('クールダウンは同じJANでも、時刻が戻っていても数え続ける（時計のずれで固まらない）', () => {
  const session = createScanSession();
  markScanned(session, DICT_JAN, 5000);
  assert.equal(checkCooldown(session, DICT_JAN, 4000).accepted, false);
  assert.equal(checkCooldown(session, DICT_JAN, 8000).accepted, true);
});

/* ---------------- JANの見分け ---------------- */

test('JANの見分け（登録済み・辞書・未収録・不正）', () => {
  const registered = createItem({ name: '登録済み', jan: DICT_JAN });
  const items = [registered];
  assert.equal(classifyJAN(DICT_JAN, { items }).kind, 'registered');
  assert.equal(classifyJAN(DICT_JAN, { items: [], dict: DICT }).kind, 'dictionary');
  const unknown = classifyJAN(NOBODY_JAN, { items, dict: DICT, prefixes: PREFIXES });
  assert.equal(unknown.kind, 'unknown');
  assert.equal(unknown.maker, '');
  const known = classifyJAN(DRAFT_JAN, { items: [], dict: [], prefixes: PREFIXES });
  assert.equal(known.kind, 'unknown');
  assert.equal(known.maker, 'テスト画材');
  assert.equal(classifyJAN('123', {}).kind, 'invalid');
  assert.equal(classifyJAN(BAD_JAN, {}).kind, 'invalid');
});

/* ---------------- 読み取りの反映（3パターン） ---------------- */

test('登録済み品は在庫＋1（買い足しログにも積まれる・カメラは閉じない前提）', () => {
  const existing = createItem({ name: 'ウルトラマリン', jan: DICT_JAN, qty: 1, price: 1200 });
  const state = { ...blankState(), items: [existing] };
  const { state: next, result } = applyScan(state, DICT_JAN, { dict: DICT, folderId: 'home' });
  assert.equal(result.kind, 'incremented');
  assert.equal(result.label, '＋1');
  assert.equal(result.changed, true);
  assert.equal(next.items.length, 1, '新しい画材を増やさない');
  assert.equal(next.items[0].qty, 2);
  assert.equal(next.items[0].id, existing.id);
  // 1本目（既存在庫1）＋買い足し1本＝2本ぶんが記録に残る
  const total = next.items[0].purchaseLog.reduce((sum, e) => sum + e.amount, 0);
  assert.equal(total, 1200 * 2);
  // 元の状態は変えない（純粋関数）
  assert.equal(state.items[0].qty, 1);
});

test('辞書ヒットの未登録品は辞書の内容で在庫1のまま自動登録する', () => {
  const state = { ...blankState() };
  const { state: next, result } = applyScan(state, DICT_JAN, { dict: DICT, folderId: 'atelier' });
  assert.equal(result.kind, 'added');
  assert.equal(result.label, '登録');
  assert.equal(next.items.length, 1);
  const item = next.items[0];
  assert.equal(item.jan, DICT_JAN);
  assert.equal(item.name, 'テスト油絵具 ウルトラマリン');
  assert.equal(item.maker, 'テストメーカー');
  assert.equal(item.brand, 'TEST');
  assert.equal(item.category, 'oil');
  assert.equal(item.colorName, 'ウルトラマリン');
  assert.equal(item.colorCode, 'A-12');
  assert.equal(item.size, '20ml');
  assert.equal(item.qty, 1);
  assert.equal(item.folderId, 'atelier', 'いま見ているフォルダに入れる');
  assert.match(result.message, /登録/);
});

test('未収録JANは止めずに仮登録（メーカー名＋JAN・数量1）', () => {
  const state = { ...blankState() };
  const { state: next, result } = applyScan(state, DRAFT_JAN, { dict: [], prefixes: PREFIXES, folderId: 'all' });
  assert.equal(result.kind, 'drafted');
  assert.equal(result.label, '仮登録');
  assert.equal(next.items.length, 1);
  const item = next.items[0];
  assert.equal(item.jan, DRAFT_JAN);
  assert.equal(item.name, `テスト画材 ${DRAFT_JAN}`);
  assert.equal(item.maker, 'テスト画材');
  assert.equal(item.qty, 1);
  assert.equal(item.category, 'other');
  assert.equal(item.folderId, state.folders[0].id, '全体表示なら先頭のフォルダ');
  assert.match(item.memo, /仮登録/);

  // メーカーが分からないJANはJANだけを名前にする
  const second = applyScan(state, NOBODY_JAN, { dict: [], prefixes: PREFIXES });
  assert.equal(second.result.kind, 'drafted');
  assert.equal(second.result.name, NOBODY_JAN);
  assert.equal(draftName(NOBODY_JAN, ''), NOBODY_JAN);
});

test('読めないJANは何も変えない（ログにも数えない）', () => {
  const state = { ...blankState() };
  for (const bad of ['', '123', BAD_JAN]) {
    const { state: next, result } = applyScan(state, bad, { dict: DICT });
    assert.equal(result.kind, 'invalid');
    assert.equal(result.changed, false);
    assert.equal(next, state);
    assert.equal(next.items.length, 0);
  }
});

/* ---------------- 無料上限 ---------------- */

function fullFreeState(count = FREE_ITEM_LIMIT) {
  const items = Array.from({ length: count }, (_, i) => createItem({ name: `画材${i}`, qty: 1 }));
  return { ...blankState(), items };
}

test('無料上限に達したら新規登録だけ止める（登録済みの＋1は通す）', () => {
  const state = fullFreeState();
  const blocked = applyScan(state, DICT_JAN, { dict: DICT });
  assert.equal(blocked.result.kind, 'limit');
  assert.equal(blocked.result.changed, false);
  assert.equal(blocked.state.items.length, FREE_ITEM_LIMIT);
  assert.match(blocked.result.message, /100点/);

  // 未収録の仮登録も止める
  const draft = applyScan(state, DRAFT_JAN, { dict: [], prefixes: PREFIXES });
  assert.equal(draft.result.kind, 'limit');
  assert.equal(draft.state.items.length, FREE_ITEM_LIMIT);

  // 登録済み品は上限に関係なく＋1できる
  const withRegistered = {
    ...state,
    items: [...state.items.slice(1), createItem({ name: '登録済み', jan: DICT_JAN, qty: 1 })],
  };
  const inc = applyScan(withRegistered, DICT_JAN, { dict: DICT });
  assert.equal(inc.result.kind, 'incremented');
  assert.equal(inc.state.items.find((i) => i.jan === DICT_JAN).qty, 2);
  assert.equal(inc.state.items.length, FREE_ITEM_LIMIT);
});

test('Pro（プレビュー含む）は上限なしで登録できる', () => {
  const state = fullFreeState();
  state.settings = { ...state.settings, pro: true };
  const { state: next, result } = applyScan(state, DICT_JAN, { dict: DICT });
  assert.equal(result.kind, 'added');
  assert.equal(next.items.length, FREE_ITEM_LIMIT + 1);
  assert.equal(UNLIMITED, Number.POSITIVE_INFINITY);

  const preview = fullFreeState();
  preview.settings = { ...preview.settings, proPreview: true };
  assert.equal(applyScan(preview, DRAFT_JAN, { dict: [], prefixes: PREFIXES }).result.kind, 'drafted');
});

/* ---------------- 連続スキャンの流れ（結合） ---------------- */

test('同じJANがカメラの前に残っても、連続モードで1回だけ数える', () => {
  // app.js の continuousScan と同じ順番（クールダウン→反映→ログ）で流す
  const session = createScanSession();
  let state = { ...blankState(), items: [createItem({ name: 'ウルトラマリン', jan: DICT_JAN, qty: 1, price: 800 })] };
  const log = [];

  const readOnce = (value, at) => {
    if (!checkCooldown(session, value, at).accepted) return false;
    const out = applyScan(state, value, { dict: DICT });
    if (!out.result.changed) return false;
    markScanned(session, value, at);
    state = out.state;
    log.push(out.result);
    return true;
  };

  // 1秒間に10回、同じバーコードを読み続ける（fps 10）
  for (let i = 0; i < 10; i += 1) readOnce(DICT_JAN, 1000 + i * 100);
  assert.equal(state.items[0].qty, 2, '10回読まれても＋1は1回だけ');
  assert.equal(log.length, 1);
  assert.equal(scanLogCount(log), 1);

  // 3秒後にまた読み取れば＋1される
  assert.equal(readOnce(DICT_JAN, 1000 + 3000), true);
  assert.equal(state.items[0].qty, 3);

  // すぐ次の別の画材は止まらない（辞書ヒット→自動登録、未収録→仮登録）
  assert.equal(readOnce(DRAFT_JAN, 1000 + 3100), true);
  assert.equal(readOnce(NOBODY_JAN, 1000 + 3200), true);
  assert.equal(state.items.length, 3);
  assert.equal(log.length, 4, '＋1が2回・仮登録が2回');
  assert.equal(describeScanLog(log), '仮登録2点・＋1 2本');
});

test('読み取りログの件数と内訳（画面見出し・完了の通知）', () => {
  assert.equal(scanLogCount([]), 0);
  assert.equal(describeScanLog([]), 'まだ読み取りはありません');
  const log = [
    { kind: 'added', label: '登録' },
    { kind: 'incremented', label: '＋1' },
    { kind: 'drafted', label: '仮登録' },
    { kind: 'incremented', label: '＋1' },
  ];
  assert.equal(scanLogCount(log), 4);
  assert.equal(describeScanLog(log), '登録1点・仮登録1点・＋1 2本');
  // 上限・不正は「読み取れた本数」に入れない
  assert.equal(scanLogCount([...log, { kind: 'limit' }, { kind: 'invalid' }]), 4);
});

test('新規登録の置き場所は今見ているフォルダ（全体・不明なら先頭）', () => {
  const state = blankState();
  assert.equal(scanFolderId(state, 'atelier'), 'atelier');
  assert.equal(scanFolderId(state, 'all'), state.folders[0].id);
  assert.equal(scanFolderId(state, ''), state.folders[0].id);
  assert.equal(scanFolderId(state, 'no-such-folder'), state.folders[0].id);
});

/* ---------------- 画面とファイルの配線 ---------------- */

test('スキャン画面に「連続スキャン」トグルとログ・完了ボタンがある', () => {
  const html = read('index.html');
  const app = read('app.js');
  for (const id of [
    'btnContinuous', 'scanModeNote', 'scanLog', 'scanLogCount', 'scanLogList', 'scanLimitNote',
    'btnScanDone', 'scanStatus', 'scanBox', 'manualJan', 'btnManualLookup', 'btnRescan',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `#${id} がありません`);
  }
  // 短い文言（絵描きが読める言葉）
  assert.match(html, />連続スキャン OFF</);
  assert.match(html, />完了</);
  assert.match(html, /1本読むと閉じます/);
  // トグルは aria-pressed で状態を持ち、ON/OFFは画面の文字でも出す
  assert.match(html, /id="btnContinuous"[^>]*aria-pressed="false"/);
  assert.match(html, /id="btnContinuous"[^>]*>連続スキャン OFF</);
  assert.match(app, /`連続スキャン \$\{scanContinuous \? 'ON' : 'OFF'\}`/);

  // 画面側は scan-flow.js の判定を通す
  assert.match(app, /from '\.\/scan-flow\.js'/);
  assert.match(app, /checkCooldown\(/);
  assert.match(app, /applyScan\(/);
  assert.match(app, /describeScanLog\(/);
  assert.match(app, /scanContinuous/);
  // 通常モード（OFF）は今までどおり1本で閉じる
  assert.match(app, /stopScanner\(\);\s*\n\s*closeSheet\('sheetScan'\);\s*\n\s*applyJAN\(jan\);/);
});

test('scan-flow.js は配信・iOSビルド・Service Worker に入っている', async () => {
  const sw = read('sw.js');
  assert.match(sw, /'\.\/scan-flow\.js'/);
  assert.match(sw, /art-supply-manager-v49/);
  const { WEB_ASSETS } = await import('../scripts/build.mjs');
  assert.ok(WEB_ASSETS.includes('scan-flow.js'), 'scan-flow.js が WEB_ASSETS にありません');
  assert.ok(fs.existsSync(path.join(ROOT, 'scan-flow.js')));
});

test('連続スキャンの画面は絵文字を使わない', () => {
  for (const file of ['scan-flow.js', 'app.js', 'index.html', 'styles.css', 'tests/scan-flow.test.js']) {
    assert.equal(EMOJI.test(read(file)), false, `${file} に絵文字があります`);
  }
});

test('連続スキャンの表示はダークモードでも既存のCSS変数で馴染む', () => {
  const css = read('styles.css');
  for (const sel of ['.scan-mode', '.scan-status', '.scan-log', '.scan-log-list']) {
    assert.ok(css.includes(sel), `${sel} のスタイルがありません`);
  }
  // コメントを外してから、連続スキャンのルールだけを取り出す
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [...plain.matchAll(/[^{}]*\.scan-(status|log|mode)[^{}]*\{[^}]*\}/g)].map((m) => m[0]);
  assert.ok(blocks.length >= 6, `連続スキャンのルール数: ${blocks.length}`);
  for (const block of blocks) {
    // 決め打ちの白・黒でなく、テーマの変数を使う（色を決めるルールだけ見る）
    assert.equal(/#(fff|ffffff|000|000000)\b/i.test(block), false, block);
    if (/(color|background|border)\s*:/.test(block)) assert.match(block, /var\(--/, block);
  }
});
