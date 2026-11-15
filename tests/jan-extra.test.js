import test from 'node:test';
import assert from 'node:assert/strict';
import { JAN_DICTIONARY } from '../jan-database.js';
import {
  normalizeExtraEntry, parseExtraDictionary, mergeDictionaries, lookupIn,
  readCache, writeCache, clearCache, syncExtraDictionary,
  describeCounts, describeSyncState, proposalTitle, proposalBody,
  buildIssueUrl, buildProposalClipboardText, EXTRA_CACHE_KEY, ISSUE_NEW_URL,
} from '../jan-extra.js';

const valid = {
  jan: '4901234567894',
  name: 'ホルベイン 油絵具 シルバー 6号',
  maker: 'ホルベイン',
  category: 'oil',
  colorName: 'シルバー',
  size: '6号(20ml)',
  code: 'H191',
  source: 'https://www.matueda.com/?pid=1',
};

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

test('追加辞書の1件はJANの妥当性・必須項目・出典で検証される', () => {
  const ok = normalizeExtraEntry({ ...valid, origin: 'x' });
  assert.equal(ok.entry.jan, '4901234567894');
  assert.equal(ok.entry.origin, 'extra');
  assert.equal(ok.entry.source, valid.source);

  assert.match(normalizeExtraEntry({ ...valid, jan: '123' }).reason, /13桁/);
  assert.match(normalizeExtraEntry({ ...valid, jan: '4900669001912' }).reason, /チェックディジット/);
  assert.match(normalizeExtraEntry({ ...valid, name: '' }).reason, /商品名/);
  assert.match(normalizeExtraEntry({ ...valid, maker: '' }).reason, /メーカー/);
  assert.match(normalizeExtraEntry({ ...valid, category: 'nope' }).reason, /カテゴリ/);
  assert.match(normalizeExtraEntry({ ...valid, source: '' }).reason, /出典URL/);
  assert.match(normalizeExtraEntry({ ...valid, source: 'javascript:alert(1)' }).reason, /出典URL/);
  assert.match(normalizeExtraEntry(null).reason, /オブジェクト/);
});

test('配信JSONは壊れた項目だけを弾き、重複を除いて読む', () => {
  const payload = {
    version: 1,
    updatedAt: '2026-11-15T00:00:00.000Z',
    items: [
      valid,
      { ...valid, jan: '4900669001912' }, // チェックディジット不正
      { ...valid, name: 'ダブり' }, // 同じJAN
      { ...valid, jan: '4933317232481' }, // 内蔵辞書にもあるJAN
    ],
  };
  const parsed = parseExtraDictionary(payload);
  assert.equal(parsed.error, '');
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.invalid.length, 1);
  assert.deepEqual(parsed.duplicates, ['4901234567894']);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.updatedAt, payload.updatedAt);

  assert.match(parseExtraDictionary({ items: 'x' }).error, /items/);
  assert.match(parseExtraDictionary([]).error, /形式/);
});

test('内蔵辞書と追加辞書はJANで重複なく合成される（内蔵が優先）', () => {
  const extra = [
    normalizeExtraEntry(valid).entry,
    normalizeExtraEntry({ ...valid, jan: '4933317232481', name: '内蔵と同じJAN' }).entry,
  ];
  const merged = mergeDictionaries(JAN_DICTIONARY, extra);
  assert.equal(merged.builtin, JAN_DICTIONARY.length);
  assert.equal(merged.added, 1);
  assert.equal(merged.total, JAN_DICTIONARY.length + 1);
  assert.deepEqual(merged.conflicts, ['4933317232481']);
  assert.deepEqual(merged.extraJans, ['4901234567894']);
  // 衝突したJANは内蔵の名前が残る
  assert.notEqual(lookupIn(merged.items, '4933317232481').name, '内蔵と同じJAN');
  assert.equal(lookupIn(merged.items, '4901234567894').name, valid.name);
  assert.equal(lookupIn(merged.items, '9999999999999'), null);
});

test('件数表示は3桁区切りで「内蔵＋追加配信」を出す', () => {
  const merged = mergeDictionaries(JAN_DICTIONARY, [normalizeExtraEntry(valid).entry]);
  assert.equal(describeCounts(merged), `内蔵 ${JAN_DICTIONARY.length.toLocaleString('ja-JP')}件 ＋ 追加配信 1件（合計 ${(JAN_DICTIONARY.length + 1).toLocaleString('ja-JP')}件）`);
});

test('キャッシュは読み書きでき、壊れていればnull', () => {
  const storage = fakeStorage();
  assert.equal(readCache(storage), null);
  const payload = { version: 1, updatedAt: '2026-11-15T00:00:00.000Z', items: [valid] };
  assert.equal(writeCache(storage, payload, '2026-11-15T01:00:00.000Z'), true);
  const cached = readCache(storage);
  assert.equal(cached.items.length, 1);
  assert.equal(cached.cachedAt, '2026-11-15T01:00:00.000Z');

  storage.setItem(EXTRA_CACHE_KEY, '{壊れた');
  assert.equal(readCache(storage), null);
  assert.equal(clearCache(storage), true);
  assert.equal(readCache(storage), null);
  // 保存できない環境でも落ちない
  assert.equal(writeCache(null, payload), false);
});

test('同期：成功・失敗時キャッシュ・完全オフライン', async () => {
  const storage = fakeStorage();
  const payload = { version: 1, updatedAt: '2026-11-15T00:00:00.000Z', items: [valid] };

  const ok = await syncExtraDictionary({
    storage,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload }),
    now: () => '2026-11-15T02:00:00.000Z',
  });
  assert.equal(ok.status, 'updated');
  assert.equal(ok.items.length, 1);
  assert.equal(ok.cachedAt, '2026-11-15T02:00:00.000Z');

  const offline = await syncExtraDictionary({
    storage,
    fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
  });
  assert.equal(offline.status, 'cached');
  assert.equal(offline.items.length, 1);
  assert.match(offline.error, /Failed to fetch/);

  const http500 = await syncExtraDictionary({
    storage,
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
  });
  assert.equal(http500.status, 'cached');

  const none = await syncExtraDictionary({ storage: fakeStorage(), fetchImpl: null });
  assert.equal(none.status, 'none');
  assert.equal(none.items.length, 0);

  const brokenJson = await syncExtraDictionary({
    storage: fakeStorage(),
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ nope: true }) }),
  });
  assert.equal(brokenJson.status, 'none');
  assert.match(brokenJson.error, /items/);
});

test('同期状態の説明文は短く、絵文字を含まない', () => {
  const re = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  const samples = [
    describeSyncState(null),
    describeSyncState({ status: 'updated', syncedAt: '2026-11-15T02:03:00.000Z', items: [1, 2] }),
    describeSyncState({ status: 'cached', cachedAt: '2026-11-15T02:03:00.000Z', items: [1] }, { cachedCount: 1 }),
    describeSyncState({ status: 'none' }),
  ];
  for (const s of samples) {
    assert.ok(s.length > 0);
    assert.equal(re.test(s), false, s);
  }
  assert.match(samples[1], /最終同期 2026\/11\/15/);
  assert.match(samples[2], /オフライン/);
});

test('辞書への提案：タイトル・本文・Issue URL・コピー文面', () => {
  assert.equal(proposalTitle(valid), '[JAN辞書] ホルベイン シルバー 6号(20ml)');
  const body = proposalBody(valid);
  assert.match(body, /4901234567894/);
  assert.match(body, /チェックディジット確認済み/);
  assert.match(body, /油絵具/);
  assert.match(body, /https:\/\/www\.matueda\.com/);

  const url = buildIssueUrl(valid);
  assert.ok(url.startsWith(`${ISSUE_NEW_URL}?`));
  const params = new URLSearchParams(url.slice(ISSUE_NEW_URL.length + 1));
  assert.equal(params.get('title'), proposalTitle(valid));
  assert.equal(params.get('body'), proposalBody(valid));

  const text = buildProposalClipboardText(valid);
  assert.match(text, /JAN辞書への追加提案/);
  assert.match(text, /shodai121ueda\+artsupply@gmail\.com/);
  // 空の項目でも例外にならない
  assert.match(proposalBody({ jan: '4901234567894' }), /4901234567894/);
});
