# 画材管理 iPhoneアプリ化 設計書（DBゼロ辞書共有＋Capacitor iOS）

作成日: 2026年11月15日 / 対象: `shodai4/art-supply-manager` / 公開URL: https://shodai4.com/art-supply-manager/

このドキュメントは、Web版（PWA）として完成している画材管理アプリを、iPhoneアプリとして配布するまでの設計と手順をまとめたものです。サーバーを1台も持たない構成（DBゼロ）を保ったまま、JAN辞書をみんなで育てる仕組みと、App Store までの道筋を扱います。

---

## 1. 現在の構成（できていること）

| 項目 | 状態 |
|---|---|
| Web版（PWA・オフライン対応） | 公開中。`shodai4.com/art-supply-manager/` |
| 内蔵JAN辞書 2,327件 | `jan-database.js`（出典・チェックディジット検証済み） |
| 追加辞書の配信 | `jan-extra.json` を起動時と「辞書を更新」で取得、localStorageへキャッシュ |
| 辞書への提案導線 | GitHub Issue（プリフィル）／文面コピー（メール） |
| 運用スクリプト | `scripts/add-jan-extra.mjs`（検証・重複チェックつき追記） |
| 通販検索リンク | `shops.js` の `SHOP_AFFILIATE_CONFIG` 1か所でアフィリエイト付与を切替 |
| Capacitor iOS の土台 | `capacitor.config.json`、`www/` ビルド、Info.plist 自動設定、CI テンプレート |
| 法務ページ | `privacy.html`（カメラ用途・アフィリエイト明記）、`support.html` |

---

## 2. DBゼロ辞書共有の仕組み

### 2.1 配信ファイル `jan-extra.json`

```json
{
  "version": 1,
  "updatedAt": "2026-11-15T09:00:00.000Z",
  "items": [
    {
      "jan": "4900669001911",
      "name": "ホルベイン 油絵具 シルバー 6号",
      "maker": "ホルベイン",
      "brand": "HOLBEIN",
      "category": "oil",
      "colorName": "シルバー",
      "size": "6号(20ml)",
      "code": "H191",
      "source": "https://www.matueda.com/?pid=000000000",
      "verifiedAt": "2026-11-15"
    }
  ]
}
```

- `version` はスキーマ版（現在 1）。項目の形は `jan-database.js` の辞書レコードと同じで、`source`（実在を確認したページ）を必須にしています。推測のJANを混ぜないための最低条件です。
- 配信は GitHub Pages がそのまま行います（サーバー不要・DB不要・無料）。追記してプッシュすれば、次の起動から全端末に届きます。

### 2.2 アプリ側の同期（`jan-extra.js`）

1. 起動時に `jan-extra.json` を `cache: 'no-store'` で取得（タイムアウト6秒）。
2. 取得できたら localStorage（キー `art-supply-manager/jan-extra/v1`）へ保存し、メモリ上の辞書に合成。
3. 合成は `mergeDictionaries(JAN_DICTIONARY, extra)`。JANで重複排除し、**同じJANは内蔵（出典確認済み）を優先**して衝突として数えます。
4. 通信失敗時はキャッシュで動作。キャッシュも無ければ同梱の2,327件だけで動作（＝オフラインでも機能が落ちない）。
5. 設定画面に「内蔵 2,327件 ＋ 追加配信 N件（合計 M件）」と最終同期時刻を表示。辞書シートでは追加分に「追加」バッジ。

壊れた項目が1件あっても配信全体を捨てず、正常な項目だけを採用します（`parseExtraDictionary`）。

### 2.3 投稿（提案）の導線

辞書に無いJANを入力・読取したときだけ、編集シートに「辞書に提案」が出ます。

- **GitHubアカウントがある人**: `https://github.com/shodai4/art-supply-manager/issues/new` にタイトル（`[JAN辞書] メーカー 色名 号数`）と本文（JAN・メーカー・商品名・色名・品番・号数・カテゴリ・出典）をプリフィルして開く。
- **アカウントが無い人**: 同じ文面をクリップボードへコピーし、`shodai121ueda+artsupply@gmail.com` 宛メールで送れる。

### 2.4 運用手順（辞書に1件足す）

```bash
node scripts/add-jan-extra.mjs \
  --jan 4900669001911 \
  --name "ホルベイン 油絵具 シルバー 6号" \
  --maker ホルベイン --category oil --color シルバー --size "6号(20ml)" --code H191 \
  --source https://www.matueda.com/?pid=000000000
```

- 13桁とチェックディジット、カテゴリ、出典URLを検証。
- 内蔵辞書にあるJANは追記しない（終了コード2）。
- 追加辞書に同じ内容があれば何もせず終了（冪等）。内容違いは `--update` で置き換え。
- `--dry-run` で検証のみ、`--list` で収録一覧。

---

## 3. 通販で探す（アフィリエイト土台）

`shops.js` の1か所だけを書き換えれば、アプリ内のすべての通販リンクにIDが付きます。

```js
export const SHOP_AFFILIATE_CONFIG = {
  amazonTag: 'shodai4-22', // AmazonアソシエイトのトラッキングID
  rakutenAffiliateId: '598e3f74.c89b09de.598e3f75.325c6ad1',
  yahooSid: '',             // バリューコマース
  yahooPid: '',
};
```

- Amazonアソシエイトの表示義務として、設定画面の最下部と `privacy.html` に「Amazonのアソシエイトとして、適格販売により収入を得ています。」を明記している。

- 検索語は **JAN優先**（最も正確）。無ければ「メーカー＋商品名＋色名」。
- Amazon: `https://www.amazon.co.jp/s?k=<語>&tag=<タグ>`
- 楽天: `https://hb.afl.rakuten.co.jp/hgc/<ID>/?pc=<検索URL>&link_type=hybrid_url`
- Yahoo!: `https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=<sid>&pid=<pid>&vc_url=<検索URL>`
- 未設定なら通常の検索URL（壊れない）。値の検証は `tests/shops.test.js`。
- 注記は設定画面最下部の極小1行と `privacy.html` に記載（App Store / ASP規約向け）。

---

## 4. Capacitor iOS の土台

### 4.1 設定

```json
{
  "appId": "com.shodai4.artsupplymanager",
  "appName": "画材管理",
  "webDir": "www",
  "server": { "iosScheme": "capacitor" },
  "ios": { "contentInset": "never", "backgroundColor": "#f4f6f9", "preferredContentMode": "mobile" }
}
```

- `contentInset: "never"` で WebView を全画面に敷き、ノッチ・ホームバーは CSS の `env(safe-area-inset-*)` で避ける（`styles.css` のヘッダー上パディングとタブバー下パディング）。
- `www/` は `npm run build`（`scripts/build.mjs`）がリポジトリ直下の公開ファイルから生成。`www/` と `ios/` は `.gitignore` 済み。

### 4.2 Info.plist（`scripts/configure-ios.mjs` が自動設定）

| キー | 値 |
|---|---|
| `CFBundleDisplayName` / `CFBundleName` | 画材管理 |
| `NSCameraUsageDescription` | バーコード（JANコード）を読み取るためにカメラを使用します。映像は端末内だけで処理し、外部へ送信しません。 |
| `NSPhotoLibraryUsageDescription` | 画材の実物写真を登録するために、写真を選択します。 |
| `ITSAppUsesNonExemptEncryption` | false（TestFlight の輸出コンプライアンス保留を防ぐ） |
| `UISupportedInterfaceOrientations` | 縦のみ（存在確認） |

Podfile と `project.pbxproj` の `IPHONEOS_DEPLOYMENT_TARGET` を **iOS 15.0** に揃えます（2027年4月からのApple要件に先回り。iPhone 6s 以降が対象）。

### 4.3 外部リンク（通販・GitHub）

WKWebView では `target="_blank"` が効かないため、`app.js` の `openExternal()` が Capacitor の `Browser` プラグイン → `window.open` → URLコピーの順に試します。**Safariで確実に開くには `@capacitor/browser` の追加が次の1歩**です（`npm i @capacitor/browser`、`npx cap sync ios`）。未導入でもコピーに退避するので機能は止まりません。

---

## 5. バーコード読取方式（iOS実機・WKWebViewで動くか）

| 方式 | 動く環境 | iOS WKWebView | 長所 | 短所 |
|---|---|---|---|---|
| `BarcodeDetector`（Web標準） | Chrome/Android | **動かない**（Safari/WKWebViewは未実装） | 追加ライブラリ不要・高速 | iOSで使えない |
| 同梱 `html5-qrcode`（`vendor/`） | 全ブラウザ（https/localhost） | **動く**（`getUserMedia` は iOS 14.3 以降） | 追加プラグイン不要・オフライン可・遠隔コード無し | JSデコードのためやや遅い（EAN-13は実用範囲） |
| Capacitor ML Kit バーコード | iOS/Android | **動く**（ネイティブ） | 最速・暗所に強い・審査上も自然 | プラグイン追加でバイナリ増・ビルド設定が必要 |
| 手入力（13桁） | すべて | 動く | 確実 | 手間 |

現在の実装（`scanner.js` の `chooseScanStrategy`）は、**ネイティブプラグイン → BarcodeDetector → 同梱 html5-qrcode → 手入力** の順に自動で選びます。iOSアプリでは同梱 html5-qrcode が使われ、CDNからコードを読まないため App Store 審査（2.5.2 遠隔コード）の懸念もありません。

実機で確認すべき観点（TestFlight で最初に見る項目）:

1. カメラ許可ダイアログが出て、許可後にプレビューが映るか。
2. EAN-13 が 1〜2 秒で読めるか（明所・暗所）。
3. 読み取り後に編集シートが辞書補完つきで開くか。
4. カメラを閉じたあと背面カメラが解放されるか（バッテリー）。
5. 通販リンクがSafariで開くか。

将来的にネイティブ化する場合:

```bash
npm i @capacitor-mlkit/barcode-scanning
npx cap sync ios
```

`scanner.js` の `nativeScannerPlugin()` が `Capacitor.Plugins.BarcodeScanner` を検出すると、自動でネイティブ経路に切り替わります（コード変更不要）。

---

## 6. iOS ビルド手順（Mac不要・GitHub Actions）

1. **Apple Developer Program**（年99ドル）に登録。
2. App Store Connect で **App Store Connect API キー**を発行（Issuer ID / Key ID / `.p8`）。
3. App Store Connect に **アプリの器**を作成（Bundle ID `com.shodai4.artsupplymanager`、SKU `art-supply-manager-ios`、プライマリ言語 日本語）。
4. GitHub リポジトリの Secrets に4つ登録: `APP_STORE_CONNECT_ISSUER_ID` / `APP_STORE_CONNECT_KEY_ID` / `APP_STORE_CONNECT_API_KEY_P8` / `APPLE_TEAM_ID`。
5. `.github/workflows/ios-build.yml` を配置（テンプレート: `docs/ios-build.yml.template`）。
6. `workflow_dispatch` で実行 → 署名して TestFlight へアップロード。

手元のMacで行う場合:

```bash
npm install
npm run ios:assets          # 1024px アイコンとスプラッシュを生成
npm run build               # www/ を作る
npx cap add ios             # 初回のみ
node scripts/configure-ios.mjs
node scripts/setup-ios-assets.mjs
npx cap open ios            # Xcode で Archive
```

### 6.1 ワークフローの構成

- `actions/checkout` → `setup-node 20` → `npm install`
- `npm test`（テストが落ちたら止める）→ `npm run build`
- `npx cap add ios`（初回）/ `npx cap sync ios`
- `node scripts/configure-ios.mjs`（Info.plist・最低OS）
- `python3 scripts/generate-ios-assets.py` → `node scripts/setup-ios-assets.mjs`
- `xcodebuild ... CODE_SIGNING_ALLOWED=NO clean build`（署名なしのクリーンビルド検証）
- Secrets が4つ揃っているときだけ、証明書を作って `archive` → `exportArchive` → `altool --upload-app`（TestFlight）

### 6.2 注意（ワークフローYAMLの権限）

GitHub App の権限によっては `.github/workflows/*.yml` のプッシュが 403 で拒否されます。その場合は `docs/ios-build.yml.template` をオーナーが手動で `.github/workflows/ios-build.yml` にコピーしてください（本リポジトリはテンプレートを常に同梱しています）。

---

## 7. App Store Connect の登録項目（下書き）

| 項目 | 内容 |
|---|---|
| アプリ名（30字以内） | 画材管理 - JAN辞書と在庫 |
| サブタイトル（30字以内） | バーコードで読む、画材の棚 |
| カテゴリ | 仕事効率化（セカンダリ: ユーティリティ） |
| 価格 | 無料 |
| プライバシーポリシーURL | https://shodai4.com/art-supply-manager/privacy.html |
| サポートURL | https://shodai4.com/art-supply-manager/support.html |
| プライバシー（App Privacy） | データを収集しません（端末内保存のみ） |
| 年齢区分 | 4+ |
| スクリーンショット | 6.7インチ / 6.1インチ（375〜393px幅で撮影） |
| 審査メモ | カメラはバーコード読取のみ、データは端末内保存、アカウント登録なし |

---

## 8. Pro課金（StoreKit）とiCloudバックアップの接続点

第2弾で、無料上限（100点・フォルダ3つ）と Pro 特典（上限解除・色見本アルバム・画材費とCSV・iCloudバックアップ）の土台を入れた。課金そのものはまだ繋いでおらず、設定の「Proプレビュー」で同じ状態を再現している。以下は iPhone 版で繋ぐときの設計。

### 8.1 課金（非消耗型の買い切り）

| 項目 | 内容 |
|---|---|
| 商品ID（案） | `com.shodai4.artsupplymanager.pro` |
| 種類 | 非消耗型（Non-Consumable）の買い切り。価格は App Store Connect で設定（300〜500円を想定） |
| プラグイン | テリトリーウォークと同じ `cordova-plugin-purchase`（Capacitor 6 で動作実績あり） |
| 判定の入口 | `pro.js` の `isPro(settings)` 1か所。画面側は `itemLimit` / `folderLimit` / `canAddItem` / `canAddFolder` / `canUseFeature` を通しているので、購入状態を `settings.pro` に入れるだけで全部に効く |
| 購入・復元の反映 | `applyProEntitlement(settings, owned)` を呼び、返り値を `state.settings` に入れて `save()` |

```js
// 例: 購入・復元が成功したとき
import { applyProEntitlement } from './pro.js';
state = { ...state, settings: applyProEntitlement(state.settings, true) };
save(); render();
```

App Store 審査で必要なこと:

- アプリ内に「購入を復元」を必ず置く（機種変更・再インストール用）。`applyProEntitlement(settings, false)` も同じ入口で扱える
- 価格・期間・自動更新の有無を購入画面に明記する（非消耗型なので「一度の購入でずっと使えます」）
- デジタル機能の解除を外部決済へ誘導しない（App 外リンク・「Webで買う」文言を出さない）
- プレビュー（`settings.proPreview`）は審査提出ビルドでは初期値 false のまま。デバッグ用に残す場合は開発ビルドだけに限定する

### 8.2 iCloud バックアップ／複数端末同期

いまの保存先は `localStorage`（`art-supply-manager/v1` のJSON）と IndexedDB（`art-supply-images` の写真Blob）。サーバーは持たない方針なので、同期は Apple の iCloud 側に預ける。

| 方式 | 保存できる量 | 向き | 実装 |
|---|---|---|---|
| iCloud Key-Value Store | 合計 1MB 程度 | 設定・小さなJSONのみ | `NSUbiquitousKeyValueStore` を Capacitor プラグイン経由。画材100点のJSONは数百KBになるため主用途には不足 |
| iCloud Drive（書類フォルダ） | 容量は iCloud の空き次第 | バックアップファイルの置き場 | `@capacitor/filesystem` ＋ `UIDocumentPicker`（ユーザーが「iCloud Drive」を選ぶ）または `UIFileSharingEnabled`。既存のJSON書き出し・復元をそのまま自動化できる |
| CloudKit（プライベートDB） | 実質無制限（ユーザーのiCloud容量） | 複数端末の自動同期 | CloudKit 対応の Capacitor プラグイン。レコード単位の差分同期・競合解決が必要 |

おすすめの順番:

1. **まず iCloud Drive へ JSON を自動保存**（毎回の保存時に同じファイル名で上書き、復元はアプリ起動時に新しいほうを読む）。既存の `exportState` / `importState` / `mergeStates` をそのまま使えるので、追加するのはファイル入出力だけ。写真（IndexedDB）はJSONに含まれないため、次段で扱う
2. **次に CloudKit で複数端末同期**。`mergeStates` の「更新日時の新しいほうを残す」規則をそのまま競合解決に使える（画材IDは端末をまたいで一意）
3. 写真は CloudKit の `CKAsset` か iCloud Drive 上のファイルへ。1枚30〜60KBなので100点でも数MB程度

注意点:

- iCloud がオフ・容量不足のときは「端末内だけで動く」に戻す（同期は失敗しても在庫管理を止めない）
- 写真のBlobはJSONに入れない（今の設計を維持。入れると localStorage 5MB を超える）
- 復元は「置き換える」より「まとめる（`mergeStates`）」を既定にする。取り違えでデータが減らない

## 9. 残タスク（次のステップ）

1. `@capacitor/browser` を追加して外部リンクのSafari起動を確実にする。
2. App Store Connect にアプリの器を作り、4つのSecretsを登録する。
3. ワークフローYAMLを `.github/workflows/` に配置（403ならオーナーが手動配置）。
4. TestFlight の実機でバーコード読取・カメラ解放・通販リンク・色見本アルバムを確認する。
5. `cordova-plugin-purchase` を入れて Pro（非消耗型）を繋ぎ、`applyProEntitlement` まで通す（§8.1）。
6. iCloud Drive へのJSON自動保存を入れる（§8.2）。
7. 必要なら `@capacitor-mlkit/barcode-scanning` へ切り替えて読取速度を上げる。
8. 追加辞書が数十件を超えたら、`jan-extra.json` を月1回まとめて追記する運用にする。
