/**
 * 下タブの4タブ化と、在庫タブの中の「場所ごと / メーカーごと」。
 *
 *   1) 下タブは4つ（在庫・補充・カタログ・設定）。独立した「メーカー」「検索」タブは無い
 *   2) 在庫タブの中に [ 場所ごと | メーカーごと ] の切り替えがあり、初期は「場所ごと」
 *   3) 「場所ごと」＝フォルダ＋在庫一覧（従来のまま）、「メーカーごと」＝メーカー別のまとめ（件数・五十音順）
 *   4) フォルダを開く・複数選択は「場所ごと」に戻して行う（メーカーのまとめは場所に依らない）
 *   5) 削除の確認は、補足を改行して2行で見せる（端末の幅で中途半端に折り返さない）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listMakers, sortItems, createItem, blankState, itemMaker, addFolder, unfiledItems, isAllFolder, ALL_FOLDER_ID, ALL_FOLDER, FAVORITE_FOLDER_ID } from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

/* ---------------- 1) 4タブ ---------------- */

test('下タブは4つ（在庫・補充・カタログ・設定）', () => {
  const html = read('index.html');
  const bar = html.slice(html.indexOf('<nav class="tabbar"'), html.indexOf('</nav>', html.indexOf('<nav class="tabbar"')));
  const tabs = [...bar.matchAll(/data-tab="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ['stock', 'shopping', 'catalog', 'settings']);

  // 独立した「メーカー」「検索」タブは無くなった
  assert.equal(/data-tab="maker"/.test(html), false, 'メーカータブが残っている');
  assert.equal(/data-tab="search"/.test(html), false, '検索タブが残っている');
  assert.equal(html.includes('id="view-maker"'), false, 'メーカーの画面（view-maker）が残っている');
  assert.equal(html.includes('id="view-search"'), false, '検索の画面（view-search）が残っている');

  // 画面の節はタブと1対1（render() が view-<tab> を出し分ける）
  for (const t of tabs) assert.ok(html.includes(`id="view-${t}"`), `#view-${t} がありません`);
});

/* ---------------- 2) 在庫タブ内の切り替え ---------------- */

test('在庫タブの中に「場所 / メーカー」の切り替えがあり、初期は場所ごと', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  const stock = html.slice(html.indexOf('id="view-stock"'), html.indexOf('id="view-shopping"'));

  // 切り替えは見出しの右横に置く小さなチップ（全幅のセグメントバーは廃止）
  assert.ok(stock.includes('id="stockSeg"'), '切り替えがありません');
  assert.match(stock, /data-stock-mode="place"[^>]*aria-selected="true"[^>]*>場所</);
  assert.match(stock, /data-stock-mode="maker"[^>]*aria-selected="false"[^>]*>メーカー</);
  assert.equal(stock.includes('segbar'), false, '大きいセグメントバーが残っている');
  // 置き場所は「フォルダ」「画材」「メーカー」の各見出しの右（JSが1つだけ移す）
  for (const id of ['segSlotFolder', 'segSlotItems', 'segSlotMaker']) {
    assert.ok(stock.includes(`id="${id}"`), `#${id} がありません`);
  }
  assert.match(app, /function placeStockSeg\(\) \{[\s\S]{0,400}ui\.stockMode === 'maker' \? \$\('segSlotMaker'\)/);
  assert.match(app, /\$\('folderGrid'\)\.hidden \? \$\('segSlotItems'\) : \$\('segSlotFolder'\)/);
  assert.match(app, /slot\.appendChild\(seg\)/);

  // 場所ごと＝フォルダ＋在庫一覧（従来の並びをそのまま包む）
  const place = stock.slice(stock.indexOf('id="stockPlaceView"'), stock.indexOf('id="stockMakerView"'));
  assert.ok(place.includes('id="folderSec"') && place.includes('id="folderGrid"'), 'フォルダがありません');
  assert.ok(place.includes('id="itemSec"') && place.includes('id="itemList"'), '在庫一覧がありません');
  // メーカーごと＝メーカー別のまとまり（初期は隠す）
  assert.match(stock, /id="stockMakerView" hidden[\s\S]{0,300}id="makerGroups"/);

  // 初期値と、押したときの切り替え
  assert.match(app, /stockMode: 'place'/);
  assert.match(app, /\$\('stockSeg'\)\.addEventListener\('click', \(e\) => \{[\s\S]{0,400}data-stock-mode/);
  assert.match(app, /ui\.stockMode = mode;/);
  assert.match(app, /\$\('stockPlaceView'\)\.hidden = ui\.tab !== 'stock' \|\| stockMode !== 'place';/);
  assert.match(app, /\$\('stockMakerView'\)\.hidden = ui\.tab !== 'stock' \|\| stockMode !== 'maker';/);

  // 見た目: 小さなチップ（見出しの右に寄せる）
  assert.match(css, /\.segchip\s*\{[^}]*border-radius:\s*999px/);
  assert.match(css, /\.segchip button\s*\{[^}]*font-size:\s*11\.5px/);
  assert.match(css, /\.segchip button\[aria-selected="true"\]/);
  assert.match(css, /\.segslot\s*\{[^}]*margin-left:\s*auto/);
  assert.equal(/\.segbar\s*\{/.test(css), false, '大きいセグメントバーのスタイルが残っている');

  // メーカーごとのときはフォルダ欄とパンくずを隠す（切り替えのチップだけは残す）
  assert.match(app, /if \(ui\.stockMode === 'maker'\) return;/);
  assert.match(app, /\$\('crumb'\)\.hidden = !open \|\| ui\.tab !== 'stock' \|\| ui\.stockMode === 'maker';/);
});

test('「メーカーごと」は持っている画材をメーカー別にまとめ、件数を出す（五十音順）', () => {
  const app = read('app.js');
  // 見出しはメーカー名の五十音順で、無い画材は最後に「未設定」
  assert.match(app, /function renderMakerView\(\) \{[\s\S]{0,400}listMakers\(items\)/);
  assert.match(app, /items\.filter\(\(it\) => itemMaker\(it\) === m\)/);
  assert.match(app, /<b>\$\{g\.items\.length\}<\/b>/);
  assert.match(app, /label: '未設定'/);

  // 中身（長押し・スワイプ・数量±・お気に入り）は在庫と同じカードを使う
  assert.match(app, /itemsBodyHtml\(list, \{ showFolder: true \}\)/);
  assert.match(app, /function itemsBodyHtml[\s\S]{0,600}itemRow\(row\.item, opts\) : itemTile\(row\.item, opts\)/);

  // 五十音順（カタカナ・ひらなが混ざっても）に並ぶ
  const items = [
    createItem({ name: 'a', maker: 'ぺんてる' }),
    createItem({ name: 'b', maker: 'ニチバン' }),
    createItem({ name: 'c', maker: 'あかしや' }),
    createItem({ name: 'd', maker: '' }),
  ];
  assert.deepEqual(listMakers(items), ['あかしや', 'ニチバン', 'ぺんてる']);
  assert.deepEqual(sortItems(items, 'maker').map(itemMaker), ['あかしや', 'ニチバン', 'ぺんてる', '']);
});

test('フォルダを開く・複数選択は「場所ごと」に戻して行う', () => {
  const app = read('app.js');
  assert.match(app, /function openFolder\(id\) \{\n  ui\.folderId = id;\n  ui\.tab = 'stock';\n  ui\.stockMode = 'place';/);
  // タイル（スマートフォルダ・フォルダ）のどちらからでも同じ関数で開く
  assert.match(app, /\$\('smartGrid'\)\.addEventListener\('click', \(e\) => \{[\s\S]{0,160}openFolder\(b\.dataset\.folder\)/);
  assert.match(app, /\$\('folderGrid'\)\.addEventListener\('click', \(e\) => \{[\s\S]{0,220}openFolder\(b\.dataset\.folder\)/);
  assert.match(app, /ui\.tab = 'stock';\n  ui\.stockMode = 'place'; \/\/ まとめて選ぶのは場所ごとの並びから/);
  // メーカーのまとめを見ている間は、隠れている場所の一覧を作らない
  assert.match(app, /function renderItemSection\(\) \{\n  \/\/ 「メーカーごと」を見ている間は場所の一覧を作らない[\s\S]{0,120}if \(ui\.stockMode === 'maker'\) return;/);
  // 在庫タブの中の切り替えなので、タブを移っても在庫の FAB は在庫・補充のときだけ
  assert.match(app, /const fabVisible = \(ui\.tab === 'stock' \|\| ui\.tab === 'shopping'\) && !ui\.selectMode;/);
});

/* ---------------- 3) フォルダタイルの列 ---------------- */

test('フォルダのタイルは5列（保管場所4つ＋「＋ フォルダ」が1行）', () => {
  const css = read('styles.css');
  const app = read('app.js');
  // 375pxでも5列（5つがちょうど1行）
  const fgrid = /^\.fgrid \{([^}]*)\}/m.exec(css);
  assert.ok(fgrid, '.fgrid のスタイルがありません');
  assert.match(fgrid[1], /grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/);
  // アイコンは四角のまま・名前は折り返しても2行まで
  assert.match(css, /\.ftile \.fico \{[^}]*aspect-ratio:\s*1 \/ 1/);
  assert.match(css, /\.ftile \.fname \{[^}]*font-size:\s*10\.5px/);
  // お気に入りは上の段（スマートフォルダ）へ移ったので、ここには並べない
  assert.match(app, /const tiles = kids\.map\(\(f\) => \{/);
  assert.match(app, /tiles\.push\(`\n    <button class="ftile add"/);
});

/* ---------------- 3b) ルートのスマートフォルダと未分類 ---------------- */

test('未分類＝どのフォルダにも入っていない画材（消えたフォルダの画材も拾う）', () => {
  let s = blankState();
  s = addFolder(s, { name: 'アトリエ' });
  const atelier = s.folders.at(-1).id;
  const items = [
    createItem({ name: 'a', folderId: atelier }),
    { ...createItem({ name: 'b' }), folderId: '' },
    { ...createItem({ name: 'c' }), folderId: 'gone' },
  ];
  assert.deepEqual(unfiledItems(items, s.folders).map((it) => it.name), ['b', 'c']);
  assert.deepEqual(unfiledItems([], s.folders), []);
  // 「すべての画材」は仮想フォルダ（お気に入りと同じ扱い）
  assert.equal(isAllFolder(ALL_FOLDER_ID), true);
  assert.equal(isAllFolder(FAVORITE_FOLDER_ID), false);
  assert.equal(isAllFolder(''), false);
  assert.equal(ALL_FOLDER.name, 'すべての画材');
});

test('ルートは「お気に入り / すべての画材」を横に2つ、下にフォルダ、未分類はあるときだけ', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');

  // 上段は2列の横長タイル（アイコン＋名前＋点数）
  const smart = /^\.smartgrid \{([^}]*)\}/m.exec(css);
  assert.ok(smart, '.smartgrid のスタイルがありません');
  assert.match(smart[1], /grid-template-columns:\s*1fr 1fr/);
  assert.match(css, /\.stile \{[^}]*display:\s*flex/);
  assert.ok(html.includes('id="smartGrid"'), '#smartGrid がありません');
  assert.match(app, /function renderSmartGrid\(\) \{/);
  assert.match(app, /data-folder="\$\{esc\(FAVORITE_FOLDER_ID\)\}"/);
  assert.match(app, /data-folder="\$\{esc\(ALL_FOLDER_ID\)\}"/);
  // ルートで、検索も絞込もしていないときだけ出す
  assert.match(app, /const show = ui\.tab === 'stock' && ui\.stockMode !== 'maker' && !ui\.query && !hasFilters\(\) && root;/);

  // フォルダ欄を出さないとき（特別フォルダ・検索中）は見出しの行ごと畳む
  assert.match(app, /\$\('folderSecHead'\)\.hidden = !show;/);
  // display: flex の見出しでも hidden で畳めるようにしておく
  assert.match(css, /\.sechead\[hidden\]\s*\{[^}]*display:\s*none/);

  // ルートの一覧は未分類だけ。0件なら節ごと出さない
  assert.match(app, /if \(root && !ui\.query\) list = unfiledItems\(list, state\.folders\);/);
  assert.match(app, /\$\('itemSec'\)\.hidden = unfiledOnly && !hasFilters\(\) && list\.length === 0;/);
  assert.match(app, /root \? '未分類' : folderOf\(ui\.folderId\)\.name/);
});

test('「すべての画材」は仮想フォルダ（どのフォルダの画材もまとめて見る）', () => {
  const app = read('app.js');
  // 特別フォルダの判定と、フォルダをまたいで集める条件
  assert.match(app, /const anywhere = Boolean\(ui\.query\) \|\| all \|\| fav;/);
  assert.match(app, /all \? ALL_FOLDER\.name/);
  assert.match(app, /\$\('crumbTrail'\)\.innerHTML = \(fav/);
  assert.match(app, /\[{ id: ALL_FOLDER_ID, name: ALL_FOLDER\.name }\]/);
});

/* ---------------- 4) 確認ダイアログの改行 ---------------- */

test('削除などの確認は、補足を改行して2行で見せる', () => {
  const app = read('app.js');
  const core = read('core.js');

  // 画材の削除（編集シート・長押し・スワイプの共通処理）
  assert.ok(app.includes("confirm('この画材を削除しますか？\\n（元に戻せません）')"), '画材の削除が2行になっていない');
  // 全データの削除（2段階）と復元の置き換え
  assert.ok(app.includes("'この端末の画材データをすべて削除します。\\n元に戻せません。'"));
  assert.ok(app.includes("'本当に削除しますか？\\n（バックアップは書き出し済みですか？）'"));
  assert.ok(app.includes("'いまのデータを、読み込むファイルの内容で置き換えます。\\nよろしいですか？'"));
  // フォルダの削除は、伝えたい単位（何がどこへ移るか）で改行して組み立てる
  assert.match(app, /const message = \[\n\s*`「\$\{f\.name\}」を削除します。`,\n\s*`中の画材は「\$\{fallback\.name\}」へ移動します。`,/);
  assert.match(app, /\.join\('\\n'\);\n  if \(!confirm\(message\)\)/);
  // 辞書の表記を揃える確認も、補足（そのまま残るもの）を次の行に置く
  assert.ok(core.includes("に更新します\\n（数量・メモ・フォルダ・写真はそのまま残ります）'"));

  // どの confirm() にも「。」の直後や「（」の直前で折り返す長い1行を残さない
  for (const m of app.matchAll(/confirm\(([^\n]*)\)/g)) {
    const arg = m[1];
    if (arg.length < 40 && !arg.includes('（')) continue;
    assert.ok(arg.includes('\\n') || arg.includes('message'), `折り返しの指定が無い確認文: ${arg}`);
  }
});

/* ---------------- 5) 空の状態 ---------------- */

test('画材が無いときは「メーカーごと」でも案内を出す（壊れない）', () => {
  const app = read('app.js');
  assert.equal(blankState().items.length, 0);
  assert.match(app, /if \(!groups\.length\) \{[\s\S]{0,200}まだ画材がありません/);
});
