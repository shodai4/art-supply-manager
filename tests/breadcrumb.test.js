/**
 * フォルダを開いたときのパンくず（家 › 親 › 子 › 孫）。
 *
 *   1) ルート（家）から現在地までの階層を並べる
 *   2) 途中の階層をタップしたら、その階層へ一気に移動できる
 *   3) 幅が足りないときは折り返して全階層を見せる（横スクロールで隠さない）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankState, addFolder, folderChain } from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

/** 家 > アトリエ > 赤ちゃん > 価格 の3階層を作る */
function deepState() {
  let s = blankState();
  s = addFolder(s, { name: 'アトリエ', parentId: 'home' });
  const atelier = s.folders.at(-1).id;
  s = addFolder(s, { name: '赤ちゃん', parentId: atelier });
  const baby = s.folders.at(-1).id;
  s = addFolder(s, { name: '価格', parentId: baby });
  const price = s.folders.at(-1).id;
  return { s, atelier, baby, price };
}

test('パンくずの階層は家から現在地まで順に並ぶ（家 › アトリエ › 赤ちゃん › 価格）', () => {
  const { s, price } = deepState();
  assert.deepEqual(folderChain(s.folders, price).map((f) => f.name), ['家', 'アトリエ', '赤ちゃん', '価格']);
  // 途中の階層のIDも取れる（タップでその階層へ移動するため）
  const chain = folderChain(s.folders, price);
  assert.equal(chain.at(-1).id, price);
  assert.ok(chain.slice(0, -1).every((f) => f.id));
});

test('画面: パンくず欄に階層を並べ、各階層をタップで移動できる', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');

  // 家ボタン（#btnHome）＋動的に作る階層（#crumbTrail）
  for (const id of ['crumb', 'btnHome', 'crumbTrail']) {
    assert.ok(html.includes(`id="${id}"`), `#${id} がありません`);
  }
  // 「↑ 上へ」のボタンは外した（親へ戻るのはパンくずの階層をタップすればよい）
  assert.equal(html.includes('id="btnUp"'), false, '上へ（#btnUp）が残っている');
  assert.equal(/btnUp|function goUp\(/.test(app), false, '上へ（goUp）の処理が残っている');
  // 現在地の階層は folderChain で組み立て、行ごとに data-crumb を持たせる
  // （特別フォルダ「お気に入り」だけは階層を持たないので現在地のみ）
  assert.match(app, /const chain = open && !fav && !all \? folderChain\(state\.folders, ui\.folderId\) : \[\];/);
  assert.match(app, /isFavoriteFolder\(ui\.folderId\)[\s\S]{0,400}FAVORITE_FOLDER\.name/);
  assert.match(app, /data-crumb="\$\{esc\(f\.id\)\}"/);
  assert.match(app, /aria-current="page"/);
  // 家アイコンの後ろにも区切り（›）が入り、区切りと名前は1つのまとまり（折り返しで離れない）
  assert.match(app, /'<span class="step"><span class="sep" aria-hidden="true">›<\/span>'/);
  assert.match(css, /^\.crumb \.step\s*\{[^}]*display:\s*flex[^}]*max-width:\s*100%/m);
  // タップでその階層へ（ui.folderId を切り替えて描き直す）
  assert.match(app, /\$\('crumbTrail'\)\.addEventListener\('click', \(e\) => \{[\s\S]{0,400}ui\.folderId = id;[\s\S]{0,200}render\(\);/);
  // 古い1行表示（#crumbName）は残っていない
  assert.equal(/id="crumbName"/.test(html), false, '古い現在地の表示（#crumbName）が残っている');
});

test('パンくずは横幅が足りなければ折り返す（横スクロールで隠さない）', () => {
  const css = read('styles.css');
  const crumb = /^\.crumb\s*\{([^}]*)\}/m.exec(css);
  assert.ok(crumb, '.crumb のスタイルがありません');
  assert.match(crumb[1], /flex-wrap:\s*wrap/, 'パンくず全体が折り返さない');
  const trail = /^\.crumb \.trail\s*\{([^}]*)\}/m.exec(css);
  assert.ok(trail, '.crumb .trail のスタイルがありません');
  assert.match(trail[1], /flex-wrap:\s*wrap/, '階層の並びが折り返さない');
  assert.equal(/overflow-x/.test(trail[1]), false, '横スクロールで隠している');
  // 各階層は1行に収まる範囲で省略し、折り返しで全部見せる
  const name = /^\.crumb \.cbtn\.name\s*\{([^}]*)\}/m.exec(css);
  assert.ok(name, '.crumb .cbtn.name のスタイルがありません');
  assert.match(name[1], /text-overflow:\s*ellipsis/);
  assert.match(name[1], /white-space:\s*nowrap/);
  // 枠の丸ボックスではなく、文字リンク風（枠線・背景を持たない）
  assert.equal(/border-radius/.test(name[1]), false, '名前が角丸ボックスになっている');
  const home = /^\.crumb \.cbtn\s*\{([^}]*)\}/m.exec(css);
  assert.ok(home, '.crumb .cbtn のスタイルがありません');
  assert.match(home[1], /border:\s*none/);
  assert.match(home[1], /background:\s*none/);
});
