/**
 * 追加・編集シートの形（v1.24.0）。
 *
 *   1) 「保存」はシートの下端に固定する（中身だけがスクロールする）
 *   2) 購入店・メモ・写真・JAN・画像URL などは「もっと詳しく」に畳む（初期は閉じ）
 *   3) 畳んでいても、保存で値が消えない（入力欄はフォームの中にそのまま置く）
 *   4) 辞書から探すはシートから外し、カタログタブとバーコード読取にまとめた
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

const html = read('index.html');
const app = read('app.js');
const css = read('styles.css');

/** 開始タグの位置から、対応する閉じタグまでを切り出す（同じタグの入れ子を数える） */
function elementText(text, tag, startAt) {
  const re = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
  re.lastIndex = startAt;
  let depth = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0].startsWith('</')) {
      depth -= 1;
      if (depth <= 0) return text.slice(startAt, m.index + m[0].length);
    } else {
      depth += 1;
    }
  }
  return text.slice(startAt);
}

/** #sheetItem の中身（シート全体） */
const SHEET_AT = html.indexOf('id="sheetItem"');
const SHEET = elementText(html, 'div', html.lastIndexOf('<div', SHEET_AT));
const BODY_AT = SHEET.indexOf('id="sheetItemBody"');
const BODY = elementText(SHEET, 'div', SHEET.lastIndexOf('<div', BODY_AT));
const MORE_AT = SHEET.indexOf('id="itemMore"');
const MORE = elementText(SHEET, 'details', SHEET.lastIndexOf('<details', MORE_AT));
const FOOT_AT = SHEET.indexOf('id="itemFoot"');
const FOOT = elementText(SHEET, 'div', SHEET.lastIndexOf('<div', FOOT_AT));

test('編集シート: 保存ボタンは下端に固定し、中身だけがスクロールする', () => {
  // 画面の骨組み（ヘッダー / スクロールする本体 / 固定の足）がそろっている
  assert.ok(SHEET_AT > 0, '#sheetItem がありません');
  assert.match(SHEET, /class="sheet sheet-item"/);
  assert.ok(BODY, '#sheetItemBody がありません');
  assert.ok(FOOT, '#itemFoot がありません');
  // 足は本体の外（フォームの中）にある ＝ 本体がどれだけ長くても常に見える
  assert.ok(BODY_AT < FOOT_AT, '足は本体より後ろに置く');
  assert.equal(BODY.includes('id="itemFoot"'), false, '足がスクロールする本体の中に入っている');

  // 保存はフォームを送信するボタン、キャンセル・削除も足に並ぶ
  assert.match(FOOT, /<button type="submit"[^>]*id="btnSaveItem"/);
  assert.match(FOOT, /id="btnDeleteItem"/);
  assert.match(FOOT, /data-close="sheetItem"/);
  assert.equal((FOOT.match(/<button/g) || []).length, 3, '足のボタンは 削除・キャンセル・保存 の3つ');

  // CSS: シートは縦並びでスクロールさせない / 本体だけスクロール / 足は縮まない
  assert.match(css, /#sheetItem\.open\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*overflow:\s*hidden/);
  assert.match(css, /#itemForm\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/);
  assert.match(css, /\.sheet-body\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.foot\s*\{[^}]*flex:\s*0 0 auto[^}]*border-top:\s*1px solid var\(--line\)/);

  // セーフエリアと広告バナーに重ならせない（バナーが出ている間だけ持ち上げる）
  assert.match(css, /\.foot\s*\{[^}]*padding-bottom:\s*calc\([^)]*env\(safe-area-inset-bottom\)\)/);
  // iOS のバナーはセーフエリアの「上」に出るので、セーフエリア＋バナーの両方を足す
  // （片方だけだと、足りない 34px ぶんボタンが広告に隠れる）
  assert.match(
    css,
    /body\[data-ad-banner="true"\]\s*\.foot\s*\{[^}]*padding-bottom:\s*calc\([\s\S]{0,90}env\(safe-area-inset-bottom\)[\s\S]{0,40}var\(--ad-h\)/,
  );
});

test('編集シート: 開いたときは先頭から・保存の文言は追加/編集で変わる', () => {
  assert.match(app, /\$\('sheetItemBody'\)\.scrollTop = 0;/);
  assert.match(app, /\$\('btnSaveItem'\)\.textContent = it \? '保存' : '追加する';/);
});

test('「もっと詳しく（メモ・写真）」は閉じた状態から始まる', () => {
  assert.ok(MORE_AT > 0, '折りたたみ（#itemMore）がありません');
  assert.match(MORE, /<details class="more" id="itemMore">/);
  assert.equal(/<details[^>]*\sopen[\s>]/.test(MORE), false, '初期状態は閉じておく');
  const summary = MORE.slice(MORE.indexOf('<summary>'), MORE.indexOf('</summary>'));
  assert.match(summary, /▸/);
  // 1行に収まる長さ（右のバッジと並んでも「な／ど」で割れない）
  assert.match(summary, /もっと詳しく（メモ・写真）/);
  assert.match(css, /\.more-label\s*\{[^}]*white-space:\s*nowrap/);
  // 開いたときだけ、入っている項目をバッジで知らせる
  assert.match(summary, /id="moreBadge"[^>]*hidden/);
  assert.match(app, /function refreshMoreBadge\(\)/);
  assert.match(app, /refreshMoreBadge\(\);\n\s*updateJanHint/);
  // シートを開くたびに畳み直す
  assert.match(app, /\$\('itemMore'\)\.open = false;/);
});

test('畳んだ中身（JAN・購入店・単価・メモ・写真・画像URL）はフォームの中に残す', () => {
  // 折りたたみはフォームの中（＝閉じていてもフォーム送信に含まれる）
  const formAt = SHEET.indexOf('<form id="itemForm">');
  const form = elementText(SHEET, 'form', formAt);
  assert.ok(form.includes('id="itemMore"'), '折りたたみがフォームの外に出ている');
  assert.ok(form.includes('id="itemFoot"'), '足がフォームの外に出ている');

  for (const id of ['fJan', 'btnFetchImage', 'janHint', 'fShop', 'fPrice', 'fMemo', 'photoPrev', 'btnPhotoPick', 'fPhoto', 'fImageUrl', 'imageUrlHint']) {
    assert.ok(MORE.includes(`id="${id}"`), `#${id} が折りたたみの中にない`);
    // 畳んだ状態でも値を失わないよう、無効化しない
    assert.equal(new RegExp(`id="${id}"[^>]*\\sdisabled`).test(MORE), false, `#${id} が無効化されている`);
  }
  // ふだん使う項目は、折りたたみの外（いつでも見える位置）に置く
  for (const id of ['fName', 'fMaker', 'fCategoryInput', 'fSeries', 'fColorName', 'fColorCode', 'fSize', 'fQty', 'fStatusInput', 'fFolderInput', 'fFav']) {
    assert.ok(BODY.includes(`id="${id}"`), `#${id} が本体にない`);
    assert.equal(MORE.includes(`id="${id}"`), false, `#${id} が折りたたみの中に入っている`);
  }

  // 保存は畳んだ項目もそのまま読む（空にして閉じる処理をしない）
  assert.ok(form.includes('id="fMemo"'));
  for (const read of [
    'jan,', "shop: $('fShop').value,", "price: $('fPrice').value,", "memo: $('fMemo').value,", 'imageUrl,',
  ]) {
    assert.ok(app.includes(read), `保存が ${read} を読んでいない`);
  }
  // 折りたたみの開閉で値を触らない
  assert.equal(/\$\('itemMore'\)[\s\S]{0,160}\.value\s*=/.test(app), false, '折りたたみの開閉で値を消している');
});

test('辞書から探すは編集シートから外し、カタログタブとバーコード読取にまとめた', () => {
  for (const id of ['btnDictFind', 'sheetDictFind', 'dictFindQ', 'dictFindList']) {
    assert.equal(html.includes(`id="${id}"`), false, `#${id} が残っている`);
    assert.equal(app.includes(`'${id}'`), false, `app.js に #${id} の処理が残っている`);
  }
  assert.equal(/辞書から探す/.test(html), false, 'index.html に「辞書から探す」が残っている');
  assert.equal(/辞書から探す/.test(app), false, 'app.js に「辞書から探す」が残っている');
  assert.equal(/renderDictFind|applyDictEntry|data-dict-jan|DICT_FIND_LIMIT/.test(app), false, '辞書から探すの処理が残っている');
  assert.equal(/\.dfind|\.dict-list/.test(css), false, '辞書から探すのスタイルが残っている');
  // チュートリアルも、いまの導線（カタログ・読取）に合わせる
  assert.equal(/編集シートの「辞書から探す」/.test(html), false);

  // カタログタブからの登録は今までどおり（フォームへ入れる／そのまま在庫へ）
  assert.match(app, /openItemSheet\(null, dictPreset\(d\)\)/);
  assert.match(app, /function dictPreset\(d\) \{/);
  assert.match(app, /searchDictionary\(mergedDict/);
  assert.match(app, /dictionaryHaystack\(mergedDict\)/);
});
