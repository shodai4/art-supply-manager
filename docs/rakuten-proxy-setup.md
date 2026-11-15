# 楽天画像プロキシの設置手順（Cloudflare Workers）

画材管理アプリは、JANコードから楽天市場の商品画像を取ってきます。
そのために楽天ウェブサービスの認証情報（アプリID・アクセスキー）が必要ですが、
利用者それぞれに登録してもらうのは現実的ではありません。

`workers/rakuten-image-proxy/` の中継サーバー（Cloudflare Workers）を1つ公開しておけば、
アプリ側はそのURLを叩くだけで商品画像を取得できます。認証情報は Worker の秘密（Secrets）に置くので、
アプリの画面にも配信ファイルにも出てきません。

```
アプリ（shodai4.com / iOSアプリ）
   │  GET https://<worker>.workers.dev/?jan=4900669001911
   ▼
Cloudflare Workers（このフォルダ）── キャッシュ7日
   │  GET openapi.rakuten.co.jp/.../IchibaItem/Search/20260701
   │  （アプリIDはクエリ、アクセスキーはヘッダーで送る）
   ▼
楽天ウェブサービス
```

2026年の楽天ウェブサービスの移行で、APIは `openapi.rakuten.co.jp` に変わり、
`applicationId` と `accessKey` の両方が必要になりました。旧 `20220601` 版は2026年8月に廃止されています。
そのため、この中継サーバーも現行版（`20260701`）を叩きます。

## 用意するもの

| もの | どこで取るか | 費用 |
| --- | --- | --- |
| 楽天アプリID（applicationId） | 楽天ウェブサービスでアプリ登録 | 無料 |
| 楽天アクセスキー（accessKey） | 同じアプリの登録画面で発行 | 無料 |
| Cloudflare アカウント | https://dash.cloudflare.com/sign-up | 無料（Workers Free） |
| 楽天アフィリエイトID（任意） | 楽天アフィリエイト | 無料 |

Cloudflare Workers の無料枠は **1日10万リクエスト**（CPU時間は1回10ミリ秒まで、2026年11月時点）。
この中継サーバーは同じJANを7日間キャッシュするので、通常の使い方では枠に届きません。

## 1. 楽天ウェブサービスでアプリを登録する

1. https://webservice.rakuten.co.jp/ を開き、楽天会員でログインする
2. アプリ登録（新規登録）を開き、次を入れる
   - アプリケーション名: 例 `art-supply-manager-image-proxy`
   - アプリケーションURL: `https://shodai4.com/art-supply-manager/`
   - アプリケーションタイプ: **Webアプリケーション**
   - 許可されたウェブサイト: `shodai4.com`
   - 利用目的: 画材管理アプリでJANから商品画像を表示するため
   - 想定QPS: 1 程度（楽天の制限は「1アプリIDにつき1秒1回以下」）
3. 発行された **applicationId** と **accessKey** を控える（accessKey は再表示できないことがあるので必ず保存）

補足:
- 中継サーバーは楽天へ `Referer: https://shodai4.com/` を付けて送ります。アプリ登録の「許可されたウェブサイト」と
  合わせておくと、Referer を見るチェックで弾かれません（Referer 必須という挙動は公式ドキュメントに明記がなく、
  実装者の報告によるものです。弾かれた場合はエラーコード `not_configured` になります）。
- アプリケーションタイプを「バックエンドサービス」にすると接続元IPの登録が必要になります。
  Cloudflare Workers の送信元IPは固定できないため、こちらは選ばないでください。

## 2. Cloudflare Workers にデプロイする

### 管理画面（コマンド不要）でやる場合

1. https://dash.cloudflare.com/ にログインし、左のメニューから「Workers & Pages」→「Create」→「Worker」を選ぶ
2. 名前を `rakuten-image-proxy` にして作成する
3. 「Edit code」でエディタを開き、`src/index.js` の中身を全部貼り付けて「Deploy」
4. 表示された `https://rakuten-image-proxy.<あなたのサブドメイン>.workers.dev` を控える

### CLI（wrangler）でやる場合

```bash
cd workers/rakuten-image-proxy
npx wrangler login                 # ブラウザが開くのでCloudflareにログイン
npx wrangler deploy                # src/index.js と wrangler.toml で公開される
```

デプロイ後に表示されるURLが中継サーバーのURLです。

## 3. 秘密（Secrets）を設定する

管理画面: Worker を開き「Settings」→「Variables and Secrets」→「Add」で次を入れる（Type は Secret）。

| 名前 | 必須 | 内容 |
| --- | --- | --- |
| `RAKUTEN_APPLICATION_ID` | 必須 | 楽天のアプリID |
| `RAKUTEN_ACCESS_KEY` | 必須 | 楽天のアクセスキー（現行APIで必要） |
| `RAKUTEN_AFFILIATE_ID` | 任意 | 入れると `itemUrl` がアフィリエイトリンクになる |
| `RAKUTEN_REFERER` | 任意 | 楽天へ送る Referer。既定は `https://shodai4.com/` |
| `RAKUTEN_API_ENDPOINT` | 任意 | 楽天APIのURLを差し替える（旧アプリIDで動かす場合など） |
| `ALLOWED_ORIGINS` | 任意 | 追加で許可するオリジン（カンマ区切り） |

CLI の場合:

```bash
npx wrangler secret put RAKUTEN_APPLICATION_ID
npx wrangler secret put RAKUTEN_ACCESS_KEY
# 任意
npx wrangler secret put RAKUTEN_AFFILIATE_ID
```

設定後、Worker は自動で反映されます（再デプロイ不要）。値はコードにも応答にも出ません。

## 4. 動作を確かめる

```bash
curl "https://rakuten-image-proxy.<サブドメイン>.workers.dev/?jan=4900669001911"
```

期待する応答（例）:

```json
{"jan":"4900669001911","imageUrl":"https://thumbnail.image.rakuten.co.jp/...jpg?_ex=300x300","itemName":"...","itemPrice":1234,"itemUrl":"https://item.rakuten.co.jp/...","shopName":"..."}
```

- 2回目以降は `X-Proxy-Cache: HIT` が付き、楽天APIを叩きません
- ブラウザから叩く場合、`curl` は Origin を送らないため CORS の確認にはなりません。
  アプリから試すのが確実です

## 5. アプリに反映する

中継サーバーのURLは `images.js` の1か所で決まります。

```js
// images.js
export const DEFAULT_IMAGE_PROXY_URL = 'https://rakuten-image-proxy.<サブドメイン>.workers.dev';
```

ここに入れて `main` に反映すると、**利用者は何も設定せずに**「画像を取得」が使えます。

自分の端末だけで先に試すなら、アプリの「設定」→「商品画像」→「設定」を開き、
「中継サーバーURL」にURLを貼って「保存」でも同じように動きます（設定値が既定値より優先されます）。

## 仕組みと守っていること

- 受け付けるのは `GET /?jan=<13桁>` だけ。13桁でない・チェックディジットが合わないものは 400
- CORS は次のオリジンだけ許可（`ALLOWED_ORIGINS` で追加可）
  - `https://shodai4.com` / `https://shodai4.github.io` / `capacitor://localhost` / `http://localhost` / `http://127.0.0.1`
  - Origin を送ってこないネイティブ・サーバー間のアクセスは許可（CORSヘッダーは付けない）
- 同じJANは Cloudflare のエッジキャッシュに7日（`Cache-Control: public, max-age=604800`）。
  キャッシュにはデータだけを入れ、CORSヘッダーは毎回付け直す（別オリジンでも取り違えない）
- 返すのは `imageUrl`（https・`_ex=300x300`）と商品名・価格・商品URL・ショップ名だけ。
  アプリIDは楽天の仕様でクエリ必須（応答には出さない）、アクセスキーはヘッダーで送りURLにも出さない

エラーコード（応答の `error`）:

| HTTP | error | 意味 |
| --- | --- | --- |
| 400 | `missing_jan` / `invalid_jan` | JANが無い・13桁でない・チェックディジット違い |
| 403 | `origin_not_allowed` | 許可していないオリジンから来た |
| 404 | `image_not_found` | 楽天に画像付きの商品が無い |
| 405 | `method_not_allowed` | GET・OPTIONS 以外 |
| 429 | `rate_limited` | 楽天APIの回数制限（1秒1回）に当たった |
| 500 | `not_configured` | Secret未設定・楽天の認証/Refererで弾かれた |
| 502 | `upstream_error` など | 楽天側の応答異常・通信失敗 |

## つまずいたとき

- `not_configured` が返る
  - `RAKUTEN_APPLICATION_ID` / `RAKUTEN_ACCESS_KEY` が両方入っているか
  - アプリの登録が2026年以降の新しい形式（accessKey あり）か
  - 「許可されたウェブサイト」に `shodai4.com` が入っているか、`RAKUTEN_REFERER` と一致しているか
- `origin_not_allowed` が返る
  - 使っているサイトのオリジンを `ALLOWED_ORIGINS` に足す（例 `https://example.com`）
- `image_not_found` が返る
  - 楽天にそのJANの商品が無い、または画像が無い商品。手元写真か画像URLの手入力で対応
- アプリ側で「中継サーバーに接続できませんでした」と出る
  - Worker のURLを開いて 400 `missing_jan` が返るか確認（返れば Worker は生きている）
  - 一時的な失敗なら、自分のアプリID・アクセスキーを設定してあれば自動でそちらに切り替わる

## テスト

中継サーバーのテストはアプリ本体のテストに含まれています（`tests/worker.test.js`）。

```bash
npm test                                          # ルートで全部
node --test tests/worker.test.js                  # 中継サーバーだけ
cd workers/rakuten-image-proxy && npm test        # 中継サーバーのフォルダから
```

## 未確認のこと（2026年11月15日時点）

- Cloudflare へのデプロイと、実際の楽天アプリIDでの疎通は、この作業では行っていません
  （楽天のアプリIDとアクセスキー、Cloudflareアカウントが手元にないため）
- 楽天APIが Referer を必須にしているかは公式ドキュメントに明記がなく、実装者の報告に基づいています。
  初回の疎通確認で `not_configured` が出たら、まずアプリ登録の「許可されたウェブサイト」を確認してください
- 確認できたこと: 中継サーバーと同じ形（URLのクエリに applicationId、ヘッダーに accessKey と Referer）で
  楽天APIを直接叩くと、ダミーの認証情報では `403 Invalid Access Key` が返りました。つまりパラメータの形式と
  Referer の付け方は受け付けられており、弾かれたのはキーの値だけです（2026年11月15日に確認）。
  本物のアプリID・アクセスキーでの成功はまだ見ていません
