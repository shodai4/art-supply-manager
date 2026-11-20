/**
 * 18カテゴリ化と、3.7万件の辞書（シリーズ／色名／色番号／号数）の整理。
 *
 *   1) カテゴリが8種類から18種類になり、既存8つのID・名前はそのまま（後方互換）
 *   2) 内蔵辞書が新しい10カテゴリへ再分類されている（誤分類しない順番で判定）
 *   3) 辞書の各件が series を持ち、name はメーカー名・号数の重複が無い整頓後の商品名
 *   4) メーカー・シリーズ・商品名・色名・色番号・JAN のどれでも検索できる（退行しない）
 *   5) 在庫と編集シートに「シリーズ」欄があり、辞書から登録すると series も入る
 *   6) 「画材名を最新にする」で series・新カテゴリ・色名・号数・整頓後の商品名も揃う
 *   7) 検索タブはシリーズ名を淡く出して「シリーズ名＋色名＋号数」で読める
 *   8) 版（package.json / index.html / sw.js）がそろっている
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATEGORIES, COLOR_CATEGORIES, createItem, categoryLabel, summarize,
  searchDictionary, dictionaryHaystack, dictionaryRowDetail, splitSeriesFromName,
  syncItemsWithDictionary, DICT_SYNC_FIELDS,
} from '../core.js';
import { JAN_DICTIONARY } from '../jan-database.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const byJan = new Map(JAN_DICTIONARY.map((d) => [d.jan, d]));
const entry = (jan) => {
  const d = byJan.get(jan);
  assert.ok(d, `辞書に ${jan} がありません`);
  return d;
};

/* ---------------- 1) 18カテゴリ ---------------- */

test('カテゴリは18種類で、既存8つのIDと名前はそのまま（後方互換）', () => {
  assert.equal(CATEGORIES.length, 18);
  const ids = CATEGORIES.map((c) => c.id);
  // 既存8つ（順番も変えない）
  assert.deepEqual(ids.slice(0, 7), ['oil', 'acrylic', 'watercolor', 'medium', 'brush', 'canvas', 'paper']);
  assert.equal(ids[17], 'other');
  const old = {
    oil: '油絵具', acrylic: 'アクリル', watercolor: '水彩', medium: 'メディウム/溶剤',
    brush: '筆/ナイフ', canvas: 'キャンバス/パネル', paper: 'スケッチブック/紙', other: 'その他',
  };
  for (const [id, label] of Object.entries(old)) assert.equal(categoryLabel(id), label);
  // 追加の10カテゴリ
  assert.deepEqual(
    CATEGORIES.filter((c) => !(c.id in old)).map((c) => c.id).sort(),
    ['charcoal', 'colored_pencil', 'copic', 'crayon', 'frame', 'marker', 'nihonga', 'pastel', 'pen', 'pencil'].sort(),
  );
  assert.equal(categoryLabel('pastel'), 'パステル');
  assert.equal(categoryLabel('frame'), '額縁');
  assert.equal(categoryLabel('nihonga'), '日本画/墨');
  // IDは重複しない
  assert.equal(new Set(ids).size, ids.length);
});

test('カテゴリ別の集計・色名を持つカテゴリの一覧が18カテゴリで動く', () => {
  const items = CATEGORIES.map((c, i) => createItem({ id: `i${i}`, name: c.label, category: c.id, qty: 1 }));
  const s = summarize(items);
  assert.equal(Object.keys(s.byCategory).length, 18);
  for (const c of CATEGORIES) assert.equal(s.byCategory[c.id], 1);
  // 色名を持つカテゴリはすべて実在するID
  const ids = new Set(CATEGORIES.map((c) => c.id));
  for (const id of COLOR_CATEGORIES) assert.ok(ids.has(id), `${id} がカテゴリにありません`);
  // 筆・紙・キャンバス・額縁・その他は色名を持たない側
  for (const id of ['brush', 'paper', 'canvas', 'frame', 'medium', 'other']) {
    assert.equal(COLOR_CATEGORIES.includes(id), false, `${id} は色名を持たない`);
  }
});

/* ---------------- 2) 再分類 ---------------- */

test('内蔵辞書はすべて18カテゴリのどれかに入っている（新しい10カテゴリにも実データがある）', () => {
  const ids = new Set(CATEGORIES.map((c) => c.id));
  for (const d of JAN_DICTIONARY) assert.ok(ids.has(d.category), `カテゴリ不正: ${d.jan} ${d.category}`);
  const counts = {};
  for (const d of JAN_DICTIONARY) counts[d.category] = (counts[d.category] || 0) + 1;
  for (const id of ['pastel', 'colored_pencil', 'pencil', 'crayon', 'charcoal', 'pen', 'copic', 'marker', 'frame', 'nihonga']) {
    assert.ok((counts[id] || 0) >= 50, `${id} が少なすぎます: ${counts[id] || 0}`);
  }
  // 「その他」は再分類で大きく減っている（8カテゴリ時代は19,708件）。
  // 2026-11-19 の Drive 15社（文具中心）の取り込みで「その他」が増えたので、半分未満に収まっていることを見る
  assert.ok(counts.other < JAN_DICTIONARY.length / 2, `その他が多すぎます: ${counts.other}`);
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), JAN_DICTIONARY.length);
});

test('商品名のキーワードで新しいカテゴリに振り分けられている', () => {
  assert.equal(entry('0000049454703').category, 'pastel'); // ぺんてる パステル(単色)
  assert.equal(entry('4511338002278').category, 'copic'); // コピックスケッチ
  assert.equal(entry('4005401100119').category, 'colored_pencil'); // ポリクロモス色鉛筆
  assert.equal(entry('0000049454802').category, 'crayon'); // ぺんてる くれよん
  assert.equal(entry('4901991013337').category, 'pencil'); // エコ鉛筆
  assert.equal(entry('4947493001014').category, 'charcoal'); // 画用木炭
  assert.equal(entry('4547618159158').category, 'frame'); // 額縁 アサール
  assert.equal(entry('4902630212012').category, 'nihonga'); // 墨運堂 絵墨
  assert.equal(entry('8804345600022').category, 'marker'); // デザインマーカー
  assert.equal(entry('4901881105111').category, 'pen'); // ピグマ
});

test('色名や材質に紛れた語では誤分類しない（パステルブルー・カーボンブラック・消しゴム）', () => {
  // 製本テープの「パステルレモン」は色名（テープはそのまま）
  assert.equal(entry('4987167012977').category, 'other');
  // アクリルの色名「カーボンブラック」は木炭ではない
  assert.equal(entry('0738797104020').category, 'acrylic');
  // クレパス消しゴムはクレヨンではない
  assert.equal(entry('4901881020766').category, 'other');
  // 木炭紙は紙のまま
  const charcoalPaper = JAN_DICTIONARY.find((d) => /木炭紙/.test(d.name));
  assert.ok(charcoalPaper);
  assert.equal(charcoalPaper.category, 'paper');
  // パステル用のスケッチブックは紙のまま
  const pastelBook = JAN_DICTIONARY.find((d) => /パステル/.test(d.name) && /スケッチブック|画帳/.test(d.name));
  if (pastelBook) assert.notEqual(pastelBook.category, 'pastel');
  assert.equal(categoryLabel(entry('4947493001014').category), '木炭/コンテ');
});

/* ---------------- 3) series と整頓後の name ---------------- */

test('辞書の各件が series を持ち、name は整頓後の商品名（メーカー名・号数の重複なし）', () => {
  let withSeries = 0;
  for (const d of JAN_DICTIONARY) {
    assert.equal(typeof d.series, 'string', `series がありません: ${d.jan}`);
    assert.equal(typeof d.keywords, 'string', `keywords がありません: ${d.jan}`);
    if (d.series) withSeries += 1;
    assert.ok(d.name && d.name.trim().length >= 1, `商品名なし: ${d.jan}`);
    // メーカー名の二重（「文房堂 文房堂 ...」）が残らない
    const maker = String(d.maker || '');
    if (maker && d.name.includes(maker)) {
      const rest = d.name.split(maker).join('').trim();
      assert.ok(rest.length > 0, `メーカー名だけの商品名: ${d.jan} ${d.name}`);
    }
    // 号数が末尾でもう一度繰り返されない（例:「6号(20ml) 6号」）。
    // 商品名の途中で同じ号数が出るのは実在の表記（「3号・3号U針」）なので、末尾の重複だけを見る
    if (d.size && /\d+(?:\.\d+)?号/.test(d.size)) {
      const gou = (d.size.match(/(\d+(?:\.\d+)?号)/) || [])[1];
      if (gou && d.name.endsWith(gou)) {
        assert.equal(d.name.slice(0, -gou.length).includes(gou), false, `号数が重複: ${d.jan} ${d.name} / ${d.size}`);
      }
    }
  }
  assert.ok(withSeries >= 36000, `シリーズが入っている件数が少ない: ${withSeries}`);
});

test('色名を持つカテゴリは色名が入り、持たないカテゴリは空のまま（無理に切らない）', () => {
  // 油絵具・水彩・アクリル・パステル・色鉛筆・コピックは色名が入る
  for (const id of ['oil', 'watercolor', 'acrylic', 'pastel', 'colored_pencil', 'copic']) {
    const rows = JAN_DICTIONARY.filter((d) => d.category === id);
    const withColor = rows.filter((d) => d.colorName).length;
    assert.ok(withColor / rows.length > 0.6, `${id} の色名が少ない: ${withColor}/${rows.length}`);
  }
  // 筆・紙・キャンバス・額縁は色名が空のものが大半（仕上げ色のある額縁は例外）
  for (const id of ['brush', 'paper', 'canvas']) {
    const rows = JAN_DICTIONARY.filter((d) => d.category === id);
    const empty = rows.filter((d) => !d.colorName).length;
    assert.ok(empty / rows.length > 0.7, `${id} の色名が入りすぎ: 空 ${empty}/${rows.length}`);
  }
  // 実際の整頓の例（クサカベ 水彩2号 007 パーマネントバイオレット）
  const kusakabe = JAN_DICTIONARY.find((d) => d.maker === 'クサカベ' && d.colorName === 'パーマネントバイオレット');
  if (kusakabe) {
    assert.match(kusakabe.name, /^水彩絵具 パーマネントバイオレット/);
    assert.equal(kusakabe.name.includes('クサカベ'), false, '商品名にメーカー名が残る');
  }
});

/* ---------------- 4) 検索 ---------------- */

test('メーカー・シリーズ・商品名・色名・色番号・JAN のどれでも検索できる', () => {
  const hay = dictionaryHaystack(JAN_DICTIONARY);
  // 件数が多いので、見つかるまで描く上限を広げて確認する
  const hit = (q, jan) => searchDictionary(JAN_DICTIONARY, q, { limit: 3000, hay }).items.some((d) => d.jan === jan);

  // ウルトラマリン（ホルベイン 油絵具）を、各項目から引く
  const target = JAN_DICTIONARY.find((d) => d.maker === 'ホルベイン' && d.category === 'oil' && /^ウルトラマリン/.test(d.colorName));
  assert.ok(target, 'ホルベインの油絵具ウルトラマリンが辞書にない');
  assert.equal(hit('ホルベイン', target.jan), true, 'メーカー名で引けない');
  assert.equal(hit(target.series, target.jan), true, 'シリーズ名で引けない');
  assert.equal(hit(target.colorName, target.jan), true, '色名で引けない');
  assert.equal(hit(target.jan, target.jan), true, 'JANで引けない');
  if (target.code) assert.equal(hit(target.code, target.jan), true, '色番号で引けない');
  assert.equal(hit('油絵具', target.jan), true, '商品名の語で引けない');

  // 索引にシリーズと検索用の残り語が入っている
  const at = JAN_DICTIONARY.indexOf(target);
  assert.ok(hay[at].includes(target.series.replace(/\s+/g, '')), '索引にシリーズが入っていない');
});

test('これまで検索できていた語でヒットしなくならない（品番・括弧の中身・かな表記）', () => {
  const hay = dictionaryHaystack(JAN_DICTIONARY);
  const total = (q) => searchDictionary(JAN_DICTIONARY, q, { limit: 0, hay }).total;
  // 商品名の括弧・品番・ブランドの詰めた表記
  for (const q of ['GHS-T14R', '110011', 'コピックインク', 'ピグマ', 'ポリクロモス', 'ジェットストリーム', 'キャンパスノート', 'カランダッシュ', 'ほるべいん']) {
    assert.ok(total(q) > 0, `${q} がヒットしない`);
  }
  // 日本語は空白を入れずに打ってもヒットする
  assert.ok(total('ホルベイン油絵具') > 0);
  assert.ok(total('NEWトーナルカラー') >= 0); // 収録が無ければ0でもよい（落ちないこと）
  // 空の検索は全件
  assert.equal(total(''), JAN_DICTIONARY.length);
});

test('色名・号数の区切り（シリーズ名＋色名＋号数）で商品名が読める', () => {
  const d = entry('4511338002278'); // コピックスケッチ クールグレイ No.0
  assert.equal(d.series, 'コピックスケッチ');
  assert.equal(d.name, 'コピックスケッチ クールグレイ No.0');
  assert.equal(splitSeriesFromName(d.name, d.series).head, 'コピックスケッチ');
  assert.equal(splitSeriesFromName(d.name, d.series).rest, 'クールグレイ No.0');
  // シリーズ名で始まらないときは null（呼び出し側は商品名をそのまま出す）
  assert.equal(splitSeriesFromName('平筆 12号', 'ホルベイン油彩筆'), null);
  assert.equal(splitSeriesFromName('', 'x'), null);
  // 行の補足は商品名に入っている語を繰り返さない（色番号だけは、名前に無ければ補足に出す）
  assert.equal(dictionaryRowDetail(d), d.code);
  assert.equal(dictionaryRowDetail({ name: '平筆 12号', colorName: '丸' }), '丸');
});

/* ---------------- 5) 編集シート・登録 ---------------- */

test('在庫アイテムと編集シートに「シリーズ」欄があり、辞書から入る', () => {
  const item = createItem({ name: 'コピックスケッチ クールグレイ No.0', series: 'コピックスケッチ', category: 'copic' });
  assert.equal(item.series, 'コピックスケッチ');
  assert.equal(createItem({}).series, '', '未指定なら空文字');
  assert.equal(createItem({ series: '  水彩絵具  ' }).series, '水彩絵具', '前後の空白は落とす');

  const html = read('index.html');
  const app = read('app.js');
  assert.ok(html.includes('id="fSeries"'), '#fSeries がありません');
  assert.match(html, /<label for="fSeries">シリーズ<\/label>/);
  // 保存・シートを開く（カタログから選ぶとここへ入る）・辞書の商品を在庫に追加、の3経路で series が入る
  assert.match(app, /series: \$\('fSeries'\)\.value/);
  assert.match(app, /\$\('fSeries'\)\.value = data\.series \|\| ''/);
  assert.match(app, /series: d\.series \|\| '',/);
  // 辞書から開く登録フォーム（JAN読み取り）にも series が渡る
  assert.match(app, /category: hit\.category, series: hit\.series,/);
  // カテゴリの選択肢は18カテゴリから作る
  assert.match(app, /CATEGORIES\.map\(\(c\) => `<option value="\$\{c\.id\}">\$\{c\.label\}<\/option>`\)/);
});

test('検索タブの行はシリーズ名を繰り返さず、メーカー名も二重表示しない', () => {
  const app = read('app.js');
  const css = read('styles.css');
  // 行の名前は「シリーズ見出しの下では、シリーズ名・メーカー名を省いた色名・号数・品名」
  // （全画面共通の seriesItemLabel。在庫・補充の行・タイルも同じ関数を使う）
  assert.match(app, /const nameOf = \(d, seriesName = ''\) => seriesItemLabel\(d, seriesName\) \|\| catalogItemLabel\(d\);/);
  assert.equal(/dres-series/.test(app), false, 'シリーズ名を淡く出す古い表記が残っている');
  assert.equal(/\.dres-series \{/.test(css), false, 'シリーズ名の淡い色のスタイルが残っている');
  // 色名・号数は補足の行に回す（名前に入っていないものだけ）
  assert.match(app, /const sub = dictionaryRowDetail\(\{ name, colorName: d\.colorName, size: d\.size, colorCode: d\.code \}\);/);
});

/* ---------------- 6) 同期 ---------------- */

test('「画材名を最新にする」で series・新カテゴリ・色名・号数・整頓後の商品名も揃う', () => {
  assert.deepEqual(DICT_SYNC_FIELDS.map((f) => f.item), ['name', 'maker', 'brand', 'category', 'series', 'colorName', 'colorCode', 'size']);
  const d = entry('4511338002278');
  const item = createItem({
    id: 'x', name: 'むかしのコピック', maker: 'コピック', category: 'other', series: '',
    jan: d.jan, qty: 3, memo: '残す', folderId: 'atelier', price: 500,
  });
  const { items, updatedCount } = syncItemsWithDictionary([item], JAN_DICTIONARY, { now: '2026-11-17T00:00:00.000Z' });
  assert.equal(updatedCount, 1);
  const got = items[0];
  assert.equal(got.name, d.name);
  assert.equal(got.category, 'copic');
  assert.equal(got.series, 'コピックスケッチ');
  assert.equal(got.colorName, 'クールグレイ');
  assert.equal(got.size, 'No.0');
  // 数量・メモ・フォルダ・価格は変えない
  assert.equal(got.qty, 3);
  assert.equal(got.memo, '残す');
  assert.equal(got.folderId, 'atelier');
  assert.equal(got.price, 500);
  // すでに最新なら何もしない
  const again = syncItemsWithDictionary([got], JAN_DICTIONARY, { now: '2026-11-17T00:00:00.000Z' });
  assert.equal(again.updatedCount, 0);
});

test('古い8カテゴリの在庫は、辞書同期で新しいカテゴリに移る', () => {
  const d = entry('0000049454703'); // ぺんてる パステル
  const item = createItem({ name: 'パステル', category: 'other', jan: d.jan });
  const { items } = syncItemsWithDictionary([item], JAN_DICTIONARY);
  assert.equal(items[0].category, 'pastel');
  assert.equal(items[0].series, d.series);
});

/* ---------------- 7) 版と配布物 ---------------- */

test('版（package.json・index.html・sw.js）がそろっている', () => {
  const pkg = JSON.parse(read('package.json'));
  const html = read('index.html');
  const sw = read('sw.js');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.ok(html.includes(`app.js?v=${pkg.version}`), 'index.html の app.js の版が古い');
  assert.ok(html.includes(`styles.css?v=${pkg.version}`), 'index.html の styles.css の版が古い');
  assert.match(sw, /art-supply-manager-v\d+/);
  // 辞書の大きさ（1ファイル12MB以下。データは data/ のパートに分かれている）
  const dbBytes = fs.statSync(path.join(ROOT, 'jan-database.js')).size;
  assert.ok(dbBytes < 1 * 1024 * 1024, `jan-database.js が大きすぎます: ${(dbBytes / 1048576).toFixed(1)}MB`);
  const parts = fs.readdirSync(path.join(ROOT, 'data')).filter((f) => /^jan-part-\d+\.js$/.test(f)).sort();
  assert.ok(parts.length >= 2, 'データのパートがありません');
  const db = read('jan-database.js');
  const swText = read('sw.js');
  for (const p of parts) {
    const bytes = fs.statSync(path.join(ROOT, 'data', p)).size;
    assert.ok(bytes < 12 * 1024 * 1024, `${p} が大きすぎます: ${(bytes / 1048576).toFixed(1)}MB`);
    // 読み込み（jan-database.js）と、オフライン用のキャッシュ（sw.js）から漏れない
    assert.ok(db.includes(`./data/${p}`), `${p} が jan-database.js から読み込まれていない`);
    assert.ok(swText.includes(`./data/${p}`), `${p} が Service Worker のキャッシュにない`);
  }
});

test('内蔵辞書の件数は減っていない（104,001件 = マルオカ工業公式JAN・笹部の未収録分 4,795件を取り込み後）', () => {
  assert.equal(JAN_DICTIONARY.length, 104001);
});
