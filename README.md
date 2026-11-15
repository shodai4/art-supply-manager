# 画材管理アプリ（Art Supply Manager）

**公開URL: https://shodai4.com/art-supply-manager/** （GitHub Pages / HTTPS・インストール不要・サーバー代0円）

翔大さん（絵描き・個人開発者）向けの、**サーバー代0円でそのまま実用できる画材在庫管理Webアプリ**です。
`index.html` を開くだけで動き、データは端末のブラウザ内（localStorage）だけに保存されます。PWA対応（ホーム画面に追加してオフライン起動）。

- 保管場所フォルダ（家 / アトリエ / 持ち出し用 / ストック・予備）を**フォルダグリッド**で表示。タップで中へ、「すべて」で全件。UIは絵文字なしの単色SVGのみ
- **文字をできるだけ減らしたUI**: ヘッダーは「画材管理」と合計種数だけ。上部は `フォルダ` `読取` `検索` `絞込` `並替` の短い丸ボタン1段（＋グリッド/リスト切替）
- **画材は4列（広い画面は5〜6列）のビジュアルグリッド**: 絵具は色名から推測した色のチューブ型アイコンを棚板に並べ、右上に在庫数バッジ。残量少なめ＝橙の枠、要補充＝赤の枠と赤字で直感的に表示（「十分」「少なめ」等の文字は出さない）
- タップで編集シート（数量ステッパー付き）。リスト表示に切り替えると1件＝2行の高密度リストで `−` `＋` の即時増減ができる
- 並び替え（メーカー順／新しい順／名前順／残量少ない順）＋絞込（メーカー・カテゴリ・残量）。メーカー順ではメーカー見出しでグループ分け
- 残量「残りわずか・使い切り」を自動で集める買い物リスト
- **在庫切れはグレー表示**: 在庫0（または残量「使い切り」）のカードは落ち着いたグレーにして一目で分かるようにする。ただし ＋− の増減・タップ編集・通販リンクはそのまま操作できる（`pointer-events` は変えない）
- **通販で探す（アフィリエイト土台）**: 編集シートと買い物リストの「Amazon」「楽天市場」「Yahoo!」から外部サイトを開く。検索語は**JAN優先**（無ければメーカー＋商品名＋色名）。アフィリエイトIDは `shops.js` の `SHOP_AFFILIATE_CONFIG` 1か所に集約（未設定なら通常の検索URL）
- **JAN辞書の追加配信（DBゼロ）**: 同梱2,327件に加えて、`jan-extra.json` を起動時に取得して `localStorage` にキャッシュし、メモリ上の辞書へ重複なく合成。通信できないときは同梱＋キャッシュでそのまま動く。設定画面に「内蔵 2,327件 ＋ 追加配信 N件」と最終同期を表示し、「辞書を更新」で再取得
- **辞書に提案**: 辞書に無いJANを入れたときだけ「辞書に提案」が出る。GitHubアカウントがあればIssue作成画面（JAN・メーカー・商品名・出典をプリフィル）、無ければ文面をコピーしてメールで送れる
- スマホのカメラでJANバーコード読取 → 内蔵辞書から商品情報を自動補完（**同梱のhtml5-qrcode** を使うため、iOSのWKWebViewでも動き、オフラインでも読める。CDNからコードを読まない）
- **商品画像（実物写真）**: 編集シートで手元の写真を選ぶと、長辺320px・JPEG品質0.75に自動圧縮して端末内（IndexedDB `art-supply-images`）へ保存。グリッドの棚には写真を白背景・`object-fit: contain` で見切れなく表示し、リスト左のサムネイルにも出る。写真が無い画材は従来の絵具チューブSVGのまま
- **楽天APIでJANから画像取得（中継サーバー方式）**: `workers/rakuten-image-proxy/` の Cloudflare Workers を1つ公開し、`images.js` の `DEFAULT_IMAGE_PROXY_URL` にURLを入れておくと、**利用者は何も登録せずに**JANから商品画像URL（`_ex=300x300`）を取得できる（楽天の認証情報は Worker の秘密に置き、フロントには出さない）。中継サーバーが未設定・停止時のみ、設定の「楽天アプリID＋アクセスキー」で楽天APIを直接叩く上級者向けの逃げ道を使う。設置手順は `docs/rakuten-proxy-setup.md`。画像URLを手で貼ることも可能。表示優先順は ①手元写真（IndexedDB）→ ②画像URL → ③チューブSVG／カテゴリ別アイコン（読み込み失敗時は自動でアイコンへ）
- JSONバックアップ / 復元（機種変更・データ消失対策）。手元写真は端末内のみで、JSONには含まれません

## 使い方（ローカル）

```bash
cd art-supply-manager
python3 -m http.server 8080      # または任意の静的サーバー
# → http://localhost:8080/ をスマホ/PCのブラウザで開く
```

カメラ読取は **https または localhost** でのみ動きます（ブラウザのセキュリティ仕様）。
`file://` で直接開いた場合も、在庫管理・フォルダ・JSON入出力・JAN手入力照合はすべて動作します（ES Modulesのため、Chrome系で `--allow-file-access-from-files` が必要な場合あり）。ローカルHTTPを推奨。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | 画面（モバイルファースト・375px基準） |
| `styles.css` | スタイル（横はみ出しゼロ設計） |
| `app.js` | UI・localStorage保存・バーコード読取（ネイティブ→BarcodeDetector→同梱html5-qrcode→手入力の順に選択） |
| `core.js` | DOM非依存のロジック（JAN検証・在庫増減・絞り込み・フォルダ操作・JSON入出力・在庫切れ判定） |
| `jan-extra.js` | 追加辞書（jan-extra.json）の取得・キャッシュ・合成、提案文面の生成 |
| `jan-extra.json` | 追加辞書の配信ファイル（DBゼロ） |
| `shops.js` | 通販検索URLとアフィリエイト設定（`SHOP_AFFILIATE_CONFIG`） |
| `scanner.js` | バーコード読取方式の選び分けと、同梱スキャナの遅延読み込み |
| `vendor/html5-qrcode.min.js` | 同梱スキャナ（Apache-2.0・`vendor/README.md` 参照） |
| `privacy.html` / `support.html` | プライバシーポリシー（カメラ用途・アフィリエイト明記）とサポート |
| `capacitor.config.json` | iPhoneアプリ（Capacitor）の設定。`appId: com.shodai4.artsupplymanager` |
| `scripts/build.mjs` | Capacitor 用 `www/` の生成 |
| `scripts/configure-ios.mjs` | Info.plist（表示名・カメラ・写真・輸出コンプライアンス）と最低OS（15.0）の自動設定 |
| `scripts/add-jan-extra.mjs` | 追加辞書に1件追記（13桁・チェックディジット・重複チェック） |
| `docs/ios-release-plan.md` | iPhoneアプリ化の設計書（DBゼロ共有・ビルド手順・App Store Connect 項目・読取方式の比較） |
| `docs/rakuten-proxy-setup.md` | 楽天画像プロキシの設置手順（楽天アプリ登録・Workersデプロイ・Secret設定・動作確認） |
| `workers/rakuten-image-proxy/` | JANから商品画像を返す中継サーバー（Cloudflare Workers。`wrangler.toml` と `src/index.js`） |
| `images.js` | 手元写真の圧縮（canvas）・IndexedDB保存と、楽天APIからの商品画像取得 |
| `jan-database.js` | 実在確認済みJAN辞書＋メーカープレフィックス表 |
| `sw.js` / `manifest.webmanifest` | PWA（オフラインキャッシュ・ホーム画面追加） |
| `icon.svg` / `icon-192.png` / `icon-512.png` | アプリアイコン（manifest の192/512px用PNGを含む） |
| `tests/core.test.js` | ロジックの単体テスト |
| `tests/jan.test.js` | 辞書データの妥当性テスト |
| `tests/jan-extra.test.js` | 追加辞書の検証・合成・キャッシュ・同期・提案文面のテスト |
| `tests/shops.test.js` | 通販検索URL（JAN優先・商品名フォールバック・アフィリエイトの有無）のテスト |
| `tests/ui.test.js` | 在庫切れのグレー表示・HTMLの導線・絵文字なし・www/のファイル一覧・読取方式の選択 |
| `tests/ios.test.js` | Info.plist / Podfile / プロジェクトの最低OS設定と capacitor.config.json のテスト |
| `tests/images.test.js` | 写真の縮小計算・画像URLの検証・楽天APIの応答/エラー処理のテスト |
| `tests/image-proxy.test.js` | 中継サーバー連携（URL組み立て・応答の読み取り・分岐・直接取得へのフォールバック）のテスト |
| `tests/worker.test.js` | 中継サーバーのJAN検証・キャッシュキー・CORS・エラー読み替えのテスト |
| `preview-375.html` | 375px幅での表示確認用（iframe）。`preview-375.html?src=<URL>` で任意URLを375×812で表示 |
| `preview-393.html` | 393px幅での表示確認用（iframe）。`preview-393.html?src=<URL>` で任意URLを393×852で表示 |

## テスト

```bash
cd art-supply-manager
node --test tests/
```

- JANチェックディジット（モジュラス10/ウェイト3）、13桁判定、全角・ハイフン正規化
- 楽天画像の中継サーバー（13桁検証・キャッシュキー・CORS・秘密を応答に出さないこと・7日キャッシュ）
- 辞書データ（13桁・チェックディジット・重複なし・出典URL・プレフィックス判別との整合）
- 在庫増減（0未満にしない／0で「使い切り」→補充で「残りわずか」）
- 買い物リスト抽出、キーワード/カテゴリ/残量/メーカー/フォルダ/部分JAN検索
- 並び替え（メーカー順・新しい順・名前順・残量少ない順）とメーカー見出し用グルーピング
- フォルダ間移動、フォルダ追加・改名・色/アイコン・並び替え・削除（中身移動）・最後の1個は削除不可
- JSONエクスポート→インポート往復、壊れたJSON・想定外構造の拒否、存在しないフォルダ参照の補正
- 写真の縮小サイズ（長辺320px・縦横比維持・拡大しない）、画像URLの http(s) 検証、楽天APIのURL組み立て・応答からの画像抽出（`_ex=300x300`）・エラー案内

## 商品画像（実物写真）の扱い

- **手元写真**: 編集シートの「写真を追加／変更」で選んだ画像を、`<canvas>` で長辺320px・JPEG品質0.75（1枚15〜30KB前後）に圧縮し、IndexedDB（DB名 `art-supply-images` / ストア `photos` / キーは画材ID）へBlobで保存します。localStorage（5MB）を圧迫しません。写真は端末内だけに保存され、外部へ送信されません
- **表示優先順**: ①手元写真（IndexedDB）→ ②`imageUrl`（楽天API取得または手入力）→ ③従来の絵具チューブSVG／カテゴリ別アイコン。画像の読み込みに失敗した場合は自動でアイコン表示に戻ります
- **楽天APIの設定**: 設定タブの「楽天アプリID」に、[楽天ウェブサービス](https://webservice.rakuten.co.jp/) で無料発行したアプリIDを保存してください。アプリの「許可ドメイン」に `shodai4.com`（と `shodai4.github.io`）を入れると、ブラウザから直接APIを叩けます。JANを入れて「このJANで画像を取得（楽天）」を押すと商品画像URLがセットされます（未設定・画像なし・回数制限は短いトーストで案内）
- **バックアップ**: JSONには `imageUrl` は入りますが、手元写真は含まれません（設定画面にもその旨を表示）。バックアップを読み込んだとき、そこに無い画材の手元写真（孤児レコード）は端末内から自動で削除します

## JAN辞書について（重要）

`jan-database.js` の収録JANは、**メーカー公式サイトまたは実際の販売店の商品ページに「JANコード」として明記されていた値のみ**を転記し、
チェックディジットを全件Python/Nodeで検証したものです。**推測・規則からの補完・架空のコードは一切入れていません。**

- 収録件数: **2327件**（2026-11-15時点・重複なし）。内訳は油絵具864 / その他569 / アクリル221 / 水彩199 / 筆193 / メディウム140 / 紙107 / キャンバス33
- 主な出典: 額のまつえだ（`matueda.com` の商品ページに明記されたJAN）、ステッドラー日本 公式（`staedtler.jp` の品番/JAN/品名表）
- 各エントリは `source`（商品ページURL）と `verifiedAt`（確認日 2026-11-15）を持ちます
- メーカープレフィックス（`JAN_PREFIXES`）は収録JANから実際に確認できた28件のみ。同一プレフィックスを複数メーカーが使う場合（`4901881` = サクラクレパス／ターレンス、`4943668` = ナムラ／名村大成堂、`4251402` = フィネテック／ホルベイン）は `makers` に複数形で列挙しています
- 辞書は `RAW` のタプル配列 `[JAN, 商品名, メーカー, カテゴリ, 色名, 号数/容量, 品番, 出典]` で持ち、読込時にオブジェクトへ展開します（転送量削減。gzip約64KB）
- 辞書に無いJANを読んだ場合は「このJANで新規登録」にそのまま進めます（メーカーはプレフィックスから判別、不明なら空欄）

辞書は `RAW` の配列に追記し、`JAN_PREFIXES` に事業者コードを足すだけで拡張できます。
生成元の調査スクリプトは作業ディレクトリ `tmp-jan-research/` にあります。

## 追加辞書（DBゼロ）に1件足す

```bash
node scripts/add-jan-extra.mjs --jan 4900669001911 \
  --name "ホルベイン 油絵具 シルバー 6号" --maker ホルベイン --category oil \
  --color シルバー --size "6号(20ml)" --code H191 \
  --source https://www.matueda.com/?pid=000000000
```

- `--dry-run` 検証のみ / `--list` 一覧 / `--update` 同じJANの内容違いを置換
- 13桁・チェックディジット・カテゴリ・出典URLを検証し、内蔵辞書や既存項目と重複すれば書き込まない

## iPhoneアプリ化（Capacitor）

```bash
npm install
npm run build                 # www/ を作る
npx cap add ios               # 初回のみ
node scripts/configure-ios.mjs
python3 scripts/generate-ios-assets.py && node scripts/setup-ios-assets.mjs
npx cap open ios
```

手元にMacが無くても、`.github/workflows/ios-build.yml`（`docs/ios-build.yml.template` と同内容）でビルドできます。設計の全体は `docs/ios-release-plan.md` を参照してください。

## データの持ち方・拡張

`localStorage` のキーは `art-supply-manager/v1`。エクスポートJSONは
`{ app, version, exportedAt, folders[], items[], settings }` で、そのまま Supabase 等へ同期する拡張も可能な形にしています。
各アイテムは `imageUrl`（商品画像URL）を持ち、手元写真のBlobは IndexedDB `art-supply-images` にアイテムIDで保存します（JSONには含みません）。`settings.rakutenAppId` に楽天アプリIDを保持します。

## 公開（サーバー代0円）

1. GitHub で新規リポジトリ `art-supply-manager` を作成（Public）
2. `art-supply-manager/` の中身を push
3. Settings → Pages → Source: `Deploy from a branch` / Branch: `main` / `/ (root)`
4. `https://shodai4.github.io/art-supply-manager/` で公開（HTTPS なのでカメラ読取もそのまま動作）
5. スマホで開いて「ホーム画面に追加」→ PWAとして起動（オフライン可）

---

Created with for お絵描き楽しも委員会（しょうだい）
