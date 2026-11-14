# 画材管理アプリ（Art Supply Manager）

翔大さん（絵描き・個人開発者）向けの、**サーバー代0円でそのまま実用できる画材在庫管理Webアプリ**です。
`index.html` を開くだけで動き、データは端末のブラウザ内（localStorage）だけに保存されます。PWA対応（ホーム画面に追加してオフライン起動）。

- 保管場所フォルダ（🏠 家 / 🎨 アトリエ / 🎒 持ち出し用 / 📦 ストック・予備）で在庫を分ける
- 残量「残りわずか・使い切り」を自動で集める 🛒 買い物リスト
- スマホのカメラでJANバーコード読取 → 内蔵辞書から商品情報を自動補完
- JSONバックアップ / 復元（機種変更・データ消失対策）

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
| `app.js` | UI・localStorage保存・バーコード読取（BarcodeDetector＋html5-qrcodeフォールバック） |
| `core.js` | DOM非依存のロジック（JAN検証・在庫増減・絞り込み・フォルダ操作・JSON入出力） |
| `jan-database.js` | 実在確認済みJAN辞書＋メーカープレフィックス表 |
| `sw.js` / `manifest.webmanifest` / `icon.svg` | PWA（オフラインキャッシュ・ホーム画面追加） |
| `tests/core.test.js` | ロジックの単体テスト |
| `tests/jan.test.js` | 辞書データの妥当性テスト |
| `preview-375.html` | 375px幅での表示確認用（iframe） |

## テスト

```bash
cd art-supply-manager
node --test tests/
```

- JANチェックディジット（モジュラス10/ウェイト3）、13桁判定、全角・ハイフン正規化
- 辞書データ（13桁・チェックディジット・重複なし・出典URL・プレフィックス判別との整合）
- 在庫増減（0未満にしない／0で「使い切り」→補充で「残りわずか」）
- 買い物リスト抽出、キーワード/カテゴリ/残量/フォルダ/部分JAN検索
- フォルダ間移動、フォルダ追加・改名・色/アイコン・並び替え・削除（中身移動）・最後の1個は削除不可
- JSONエクスポート→インポート往復、壊れたJSON・想定外構造の拒否、存在しないフォルダ参照の補正

## JAN辞書について（重要）

`jan-database.js` の収録JANは、**実際の販売店の商品ページに「JANコード」として明記されていた値のみ**を転記し、
チェックディジットを検証したものです。**推測・規則からの補完・架空のコードは一切入れていません。**

- 主な出典: 額のまつえだ（`matueda.com`）、アークオアシス オンライン本店（`arc-oasis-online.com`）、アスクル（`askul.co.jp`）
- 各エントリは `source`（商品ページURL）と `verifiedAt`（確認日 2026-11-15）を持ちます
- メーカープレフィックス（`JAN_PREFIXES`）も、収録JANから実際に確認できたものだけを登録しています
  - `4900669` / `4938331` → ホルベイン
  - `4933317` → クサカベ
- 辞書に無いJANを読んだ場合は「このJANで新規登録」にそのまま進めます（メーカーはプレフィックスから判別、不明なら空欄）

辞書は `jan-database.js` の配列に追記するだけで拡張できます。

## データの持ち方・拡張

`localStorage` のキーは `art-supply-manager/v1`。エクスポートJSONは
`{ app, version, exportedAt, folders[], items[], settings }` で、そのまま Supabase 等へ同期する拡張も可能な形にしています。

## 公開（サーバー代0円）

1. GitHub で新規リポジトリ `art-supply-manager` を作成（Public）
2. `art-supply-manager/` の中身を push
3. Settings → Pages → Source: `Deploy from a branch` / Branch: `main` / `/ (root)`
4. `https://shodai4.github.io/art-supply-manager/` で公開（HTTPS なのでカメラ読取もそのまま動作）
5. スマホで開いて「ホーム画面に追加」→ PWAとして起動（オフライン可）

---

Created with for お絵描き楽しも委員会（しょうだい）
