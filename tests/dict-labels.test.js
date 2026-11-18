// 内蔵辞書（38,140件）の表示名が、同じシリーズの中で見分けられるかを見るテスト。
// 2026-11-18 の不具合（「アーチストソフトパステル」252件が同じ名前で並ぶ／色番・セット名が
// シリーズ名に混ざって件数1のシリーズが乱立する）の再発防止。
import test from 'node:test';
import assert from 'node:assert/strict';
import { JAN_DICTIONARY } from '../jan-database.js';
import { seriesItemLabel, dictionaryRowDetail, groupItemsByMakerSeries } from '../core.js';

/** 画面に出る1行（名前 ＋ 補足の色番・号数） */
function rowText(entry, series) {
  const label = seriesItemLabel(entry, series);
  const sub = dictionaryRowDetail({
    name: label, colorName: entry.colorName, size: entry.size, colorCode: entry.code,
  });
  return sub && sub !== label ? `${label} ・ ${sub}` : label;
}

test('アーチストソフトパステル: 252色の単色が色番付きで並び、同じ名前が繰り返さない', () => {
  const rows = JAN_DICTIONARY.filter((d) => d.series === 'アーチストソフトパステル');
  const singles = rows.filter((d) => !/セット/.test(d.name || ''));
  assert.ok(singles.length >= 250, `単色が足りない: ${singles.length}`);
  // 色番（S005 など）が全件に入っている
  const noCode = singles.filter((d) => !d.code);
  assert.equal(noCode.length, 0, `色番が無い: ${noCode.slice(0, 3).map((d) => d.jan).join(',')}`);
  // 行の名前は全件ちがう（S005 / S057 …）
  const labels = singles.map((d) => rowText(d, d.series));
  assert.equal(new Set(labels).size, labels.length, '同じ表示名が残っている');
  assert.ok(labels.includes('S005'), 'S005 が出ていない');
  assert.ok(labels.includes('S057'), 'S057 が出ていない');
});

test('デリーター スクリーン: 色番（SE-0 など）で見分けられる', () => {
  const rows = JAN_DICTIONARY.filter((d) => d.maker === 'デリーター' && d.series === 'スクリーン');
  assert.ok(rows.length > 400, `件数が足りない: ${rows.length}`);
  assert.equal(rows.filter((d) => !d.code).length, 0, '色番の無い行がある');
  const labels = rows.map((d) => rowText(d, d.series));
  assert.ok(labels.includes('SE-0') && labels.includes('SE-4029'), 'SE の色番が出ていない');
});

test('シリーズ名に色番・セット名・色名が吸い込まれて件数1のシリーズに分かれていない', () => {
  const names = new Set(JAN_DICTIONARY.map((d) => d.series).filter(Boolean));
  // 色番がシリーズ名の末尾に付いたもの（アーチスト色鉛筆 #1 など）
  const splitByNumber = [...names].filter((s) => /[#＃]\d+\s*$/.test(s) && names.has(s.replace(/\s*[#＃]\d+\s*$/, '')));
  assert.deepEqual(splitByNumber, [], `色番でシリーズが分裂している: ${splitByNumber.slice(0, 5).join(' / ')}`);
  // アーチスト色鉛筆は1つのシリーズにまとまり、#1 は行の名前に残る
  const pencil = JAN_DICTIONARY.filter((d) => d.series === 'アーチスト色鉛筆');
  assert.ok(pencil.length >= 160, `アーチスト色鉛筆がまとまっていない: ${pencil.length}`);
  const labels = pencil.map((d) => rowText(d, d.series));
  assert.ok(labels.includes('#1 ウォームグレイ'), `#1 の色名が出ていない: ${labels.slice(0, 5).join(' / ')}`);
  // アートバッグ（各色1件）も1つのシリーズにまとまる
  const bags = JAN_DICTIONARY.filter((d) => d.series === 'アートバッグ');
  assert.ok(bags.length >= 3, `アートバッグがまとまっていない: ${bags.length}`);
  assert.ok(bags.some((d) => rowText(d, d.series).startsWith('オリーブグリーン')), 'アートバッグの色名が出ていない');
});

test('全辞書: 同じシリーズの中で、中身の違う行が同じ表示名にならない', () => {
  const groups = groupItemsByMakerSeries(JAN_DICTIONARY, { makerOf: (d) => String(d?.maker || 'メーカー不明') });
  const collisions = [];
  for (const group of groups) {
    for (const series of group.series) {
      const byText = new Map();
      for (const entry of series.items) {
        const text = rowText(entry, series.name);
        if (!byText.has(text)) byText.set(text, []);
        byText.get(text).push(entry);
      }
      for (const [text, list] of byText) {
        if (list.length < 2) continue;
        // 元データの重複JAN（商品名・色名・号数・色番が全部同じ）は、表示では区別できないので除く
        const forms = new Set(list.map((d) => [d.name, d.colorName, d.size, d.code].join('|')));
        if (forms.size < 2) continue;
        collisions.push(`${group.maker} / ${series.name} / ${text}`);
      }
    }
  }
  assert.deepEqual(collisions.slice(0, 5), [], `中身が違うのに同じ表示名: ${collisions.length}件`);
});

test('全辞書: シリーズの細分化が増えていない（件数1のシリーズが6,500件以下）', () => {
  const counts = new Map();
  for (const d of JAN_DICTIONARY) {
    if (!d.series) continue;
    const k = `${d.maker}\u0000${d.series}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  // 直す前は 13,048シリーズ・件数1が 10,833件だった
  assert.ok(counts.size <= 9000, `シリーズが多すぎる: ${counts.size}`);
  const singles = [...counts.values()].filter((n) => n === 1).length;
  assert.ok(singles <= 6500, `件数1のシリーズが多すぎる: ${singles}`);
});
