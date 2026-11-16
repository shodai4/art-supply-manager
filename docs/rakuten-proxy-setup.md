# 商品画像プロキシの設置手順（Cloudflare Workers）— 楽天市場 + Yahoo!ショッピング

アトリコは、JANコードから商品画像を取ってきます。そのために楽天ウェブサービスや
Yahoo!デベロッパーネットワークの認証情報（アプリID・アクセスキー・Client ID）が必要ですが、
利用者それぞれに登録してもらうのは現実的ではありません。

本番URL（2026年11月16日 デプロイ済み・`images.js` の `DEFAULT_IMAGE_PROXY_URL` に設定済み）:
`https://rakuten-image-proxy.shodai121ueda.workers.dev`

`workers/rakuten-image-proxy/` の中継サーバー（Cloudflare Workers）を1つ公開しておけば、
アプリ側はそのURLを叩くだけで商品画像を取得できます。認証情報は Worker の秘密（Secrets）に置くので、
アプリの画面にも配信ファイルにも出てきません。

中継サーバーは **楽天市場 商品検索API** と **Yahoo!ショッピング 商品検索API（v3）** の両方に対応しています。
Secret が入っているほうを先に試し、失敗したらもう片方で補完します（片方だけの設定でも動きます）。

```
アプリ（shodai4.com / iOSアプリ）
   │  GET https://<worker>.workers.dev/?jan=4900669001911
   ▼
Cloudflare Workers（このフォルダ）── キャッシュ7日
   │  ① 楽天（Secretがあれば先）
   │     GET openapi.rakuten.co.jp/.../IchibaItem/Search/20260701
   │     （アプリIDはクエリ、アクセスキーはヘッダーで送る）
   │  ② ①が未設定・失敗なら Yahoo!
   │     GET shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch
   │     （Client ID・jan_code・image_size=300 をクエリで送る）
   ▼
楽天ウェブサービス / Yahoo!ショッピング
```

- 楽天のキーが未設定のときは **Yahoo!が先** に動きます（Yahoo!だけの設定でOK）
- 両方入れてあるときは **楽天→Yahoo!** の順で、楽天がメンテナンス・認証エラー・回数制限・画像なしのときに
  Yahoo!で補完します
- 応答には `source`（`rakuten` か `yahoo`）が入るので、どちらから取れたか分かります

2026年の楽天ウェブサービスの移行で、楽天APIは `openapi.rakuten.co.jp` に変わり、
`applicationId` と `accessKey` の両方が必要になりました。旧 `20220601` 版は2026年8月に廃止されています。
そのため、この中継サーバーも現行版（`20260701`）を叩きます。

楽天ウェブサービスの管理画面がメンテナンスで止まっていて新しいアプリIDを発行できない間でも、
Yahoo!の Client ID だけで画像取得を動かせるようにしてあります。

## 用意するもの

| もの | どこで取るか | 費用 | 必須 |
| --- | --- | --- | --- |
| Yahoo! Client ID（アプリケーションID） | Yahoo!デベロッパーネットワークでアプリ登録 | 無料・審査なし | 楽天のキーが無ければ必須 |
| 楽天アプリID（applicationId） | 楽天ウェブサービスでアプリ登録 | 無料 | 任意（Yahoo!があれば不要） |
| 楽天アクセスキー（accessKey） | 同じアプリの登録画面で発行 | 無料 | 任意（現行APIで必要） |
| Cloudflare アカウント | https://dash.cloudflare.com/sign-up | 無料（Workers Free） | 必須 |
| 楽天アフィリエイトID | 楽天アフィリエイト | 無料 | 任意 |
| Yahoo!のアフィリエイトID（バリューコマース） | バリューコマース | 無料 | 任意 |

Cloudflare Workers の無料枠は **1日10万リクエスト**（CPU時間は1回10ミリ秒まで、2026年11月時点）。
この中継サーバーは同じJANを7日間キャッシュするので、通常の使い方では枠に届きません。

## 1. Yahoo!デベロッパーネットワークで Client ID を発行する（無料・審査なし）

商品検索API（v3）は Client ID（アプリケーションID）だけで使えます。審査・申請はありません。

1. https://e.developer.yahoo.co.jp/register を開く（「アプリケーションの管理」画面。ログインが求められる）
2. Yahoo! JAPAN ID でログインする（無ければ無料で取得）
3. 「新しいアプリケーションを開発」を開き、次を入力する

   | 項目 | 入れる値（例） | 補足 |
   | --- | --- | --- |
   | ID連携利用有無 | **ID連携を利用しない** | 商品検索APIはYahoo! ID連携を使わない |
   | 連絡先メールアドレス | `shodai121ueda@gmail.com` | メンテナンス等の連絡先 |
   | アプリケーション名 | `art-supply-manager` | 管理画面でしか見えない |
   | サイトURL | `https://shodai4.com/art-supply-manager/` | ホスト名にドットが必要。`localhost` などは登録不可 |
   | アプリケーションの説明 | アトリコでJANコードから商品画像を表示するため | 管理画面でしか見えない |
   | プライバシーポリシーURL | `https://shodai4.com/art-supply-manager/privacy.html` | ID連携を利用しない場合は必須ではない（フォームの必須表示に従う） |
   | 利用規約URL | 任意 | 同上 |
   | ガイドライン | 同意する | |

4. 「確認」→「登録」を押すと **Client ID（アプリケーションID）** が発行される
   - **コールバックURLは不要**（ID連携を利用しないため、入力欄が出ても空のままでよい）
   - ID連携を利用しない場合、Secret（シークレット）は発行されない。商品検索APIもSecretは使わない
5. 発行された Client ID を控える（Yahoo! JAPAN IDに紐づく。1つのIDで10個まで登録できる）
6. この Client ID を Worker の Secret `YAHOO_CLIENT_ID` に入れる（下の「4. 秘密（Secrets）を設定する」）

補足:
- 「ID連携を利用する」を選ぶと、SMS認証・メールアドレス認証・コールバックURLなどが必要になります。
  画像取得だけなら選ぶ必要はありません。
- Client ID は第三者に開示しないものとされています。Worker の Secret に置き、配信ファイルや応答には出しません
  （Yahoo!のAPI仕様上、Yahoo!へ送るURLのクエリには載ります）。

## 2. 楽天ウェブサービスでアプリを登録する（発行できたら。任意）

楽天の管理画面が復旧してアプリIDを発行できたら、こちらも入れておくと取得先が2つになります。

1. https://webservice.rakuten.co.jp/ を開き、楽天会員でログインする
2. アプリ登録（新規登録）を開き、次を入れる
   - アプリケーション名: 例 `art-supply-manager-image-proxy`
   - アプリケーションURL: `https://shodai4.com/art-supply-manager/`
   - アプリケーションタイプ: **Webアプリケーション**
   - 許可されたウェブサイト: `shodai4.com`
   - 利用目的: アトリコでJANから商品画像を表示するため
   - 想定QPS: 1 程度（楽天の制限は「1アプリIDにつき1秒1回以下」）
3. 発行された **applicationId** と **accessKey** を控える（accessKey は再表示できないことがあるので必ず保存）

補足:
- 中継サーバーは楽天へ `Referer: https://shodai4.com/` を付けて送ります。アプリ登録の「許可されたウェブサイト」と
  合わせておくと、Referer を見るチェックで弾かれません（Referer 必須という挙動は公式ドキュメントに明記がなく、
  実装者の報告によるものです。弾かれた場合はエラーコード `not_configured` になり、Yahoo!へ切り替わります）。
- アプリケーションタイプを「バックエンドサービス」にすると接続元IPの登録が必要になります。
  Cloudflare Workers の送信元IPは固定できないため、こちらは選ばないでください。

## 3. Cloudflare Workers にデプロイする

### 管理画面（コマンド不要）でやる場合

1. https://dash.cloudflare.com/ にログインし、左のメニューから「Workers & Pages」→「Create」→「Worker」を選ぶ
2. 名前を `rakuten-image-proxy` にして作成する（Yahoo!にも対応していますが、名前は既存のままで動きます）
3. 「Edit code」でエディタを開き、`src/index.js` の中身を全部貼り付けて「Deploy」
4. 表示された `https://rakuten-image-proxy.<あなたのサブドメイン>.workers.dev` を控える

### CLI（wrangler）でやる場合

```bash
cd workers/rakuten-image-proxy
npx wrangler login                 # ブラウザが開くのでCloudflareにログイン
npx wrangler deploy                # src/index.js と wrangler.toml で公開される
```

デプロイ後に表示されるURLが中継サーバーのURLです。

## 4. 秘密（Secrets）を設定する

管理画面: Worker を開き「Settings」→「Variables and Secrets」→「Add」で次を入れる（Type は Secret）。

| 名前 | 必須 | 内容 |
| --- | --- | --- |
| `YAHOO_CLIENT_ID` | 楽天のキーが無ければ必須 | Yahoo!の Client ID（アプリケーションID）。別名 `YAHOO_APP_ID` も可 |
| `RAKUTEN_APPLICATION_ID` | 任意 | 楽天のアプリID。別名 `RAKUTEN_APP_ID` も可 |
| `RAKUTEN_ACCESS_KEY` | 任意 | 楽天のアクセスキー（現行APIで必要） |
| `YAHOO_AFFILIATE_ID` | 任意 | バリューコマースのアフィリエイトID。入れると `itemUrl` がアフィリエイトリンクになる |
| `YAHOO_AFFILIATE_TYPE` | 任意 | `vc`（既定） |
| `RAKUTEN_AFFILIATE_ID` | 任意 | 入れると `itemUrl` がアフィリエイトリンクになる |
| `RAKUTEN_REFERER` | 任意 | 楽天へ送る Referer。既定は `https://shodai4.com/` |
| `RAKUTEN_API_ENDPOINT` | 任意 | 楽天APIのURLを差し替える（旧アプリIDで動かす場合など） |
| `ALLOWED_ORIGINS` | 任意 | 追加で許可するオリジン（カンマ区切り） |

- **Yahoo!の Client ID と楽天のアプリIDのどちらか1つは必須**です。両方入れると補完し合います
- 入れた順番は関係ありません。楽天のアプリIDがあれば楽天が先、無ければYahoo!が先になります

CLI の場合:

```bash
# Yahoo!のClient ID（まずはこれだけで動く）
npx wrangler secret put YAHOO_CLIENT_ID
# 楽天のアプリIDが発行できたら追加
npx wrangler secret put RAKUTEN_APPLICATION_ID
npx wrangler secret put RAKUTEN_ACCESS_KEY
# 任意
npx wrangler secret put YAHOO_AFFILIATE_ID
npx wrangler secret put RAKUTEN_AFFILIATE_ID
```

設定後、Worker は自動で反映されます（再デプロイ不要）。値はコードにも応答にも出ません。

## 5. 動作を確かめる

```bash
curl "https://rakuten-image-proxy.<サブドメイン>.workers.dev/?jan=4900669001911"
```

期待する応答（例。Yahoo!から取れた場合）:

```json
{"jan":"4900669001911","imageUrl":"https://item-shopping.c.yimg.jp/i/l/...","itemName":"...","itemPrice":2345,"itemUrl":"https://store.shopping.yahoo.co.jp/...","shopName":"...","source":"yahoo"}
```

- `source` が `rakuten` か `yahoo` で、どちらのAPIから取れたか分かります
- 応答ヘッダーの `X-Proxy-Source` にも同じ値が入ります
- 2回目以降は `X-Proxy-Cache: HIT` が付き、APIを叩きません
- ブラウザから叩く場合、`curl` は Origin を送らないため CORS の確認にはなりません。
  アプリから試すのが確実です

## 6. アプリに反映する

中継サーバーのURLは `images.js` の1か所で決まります。

```js
// images.js
export const DEFAULT_IMAGE_PROXY_URL = 'https://rakuten-image-proxy.<サブドメイン>.workers.dev';
```

ここに入れて `main` に反映すると、**利用者は何も設定せずに**「画像を取得」が使えます。

自分の端末だけで先に試すなら、アプリの「設定」→「商品画像」→「設定する」を開き、
「中継サーバーURL」にURLを貼って「保存」でも同じように動きます（設定値が既定値より優先されます）。

画像を取得すると、編集シートの「画像URL」の下に **当たった商品名と取得元（楽天／Yahoo!）** が出ます。
別の商品の画像が付いていないかをその場で確かめられます。

## 仕組みと守っていること

- 受け付けるのは `GET /?jan=<13桁>` だけ。13桁でない・チェックディジットが合わないものは 400
- CORS は次のオリジンだけ許可（`ALLOWED_ORIGINS` で追加可）
  - `https://shodai4.com` / `https://shodai4.github.io` / `capacitor://localhost` / `http://localhost` / `http://127.0.0.1`
  - Origin を送ってこないネイティブ・サーバー間のアクセスは許可（CORSヘッダーは付けない）
- 同じJANは Cloudflare のエッジキャッシュに7日（`Cache-Control: public, max-age=604800`）。
  キャッシュにはデータだけを入れ、CORSヘッダーは毎回付け直す（別オリジンでも取り違えない）
- 返すのは `imageUrl`（https・300x300）と商品名・価格・商品URL・ショップ名・取得元だけ。
  楽天のアプリIDとYahoo!のClient IDは各APIの仕様でクエリ必須（応答には出さない）、
  楽天のアクセスキーはヘッダーで送りURLにも出さない
- 取得の順番: 楽天のアプリIDがあれば 楽天 → Yahoo!、無ければ Yahoo! だけ。
  楽天がメンテナンス（5xx）・認証エラー・回数制限・画像なしのときに Yahoo! で補完する
- Yahoo!の画像は `exImage.url`（`image_size=300` で指定した300x300）→ `image.medium`（146x146）
  → `image.small`（76x76）の順で使う

### 回数制限

| API | 制限 | 超えたとき |
| --- | --- | --- |
| 楽天ウェブサービス | アプリIDごとに1秒1回 | 429 `rate_limited`（Yahoo!があればそちらで取得） |
| Yahoo!ショッピング 商品検索（v3） | Client IDごとに1分30回（2022年6月21日以降） | 429 `rate_limited`（楽天があればそちらで取得） |

7日キャッシュがあるので、同じ画材を何度開いてもAPIは叩きません。どちらのAPIも、短い時間に同じURLへ
大量アクセスすると一時的に利用できなくなることがあります（Yahoo!は1クエリ/秒の目安）。

### クレジット表示（Yahoo!のAPIを使う場合の決まり）

Yahoo!デベロッパーネットワークのAPIを使うアプリには、規定のクレジット表示が必要です
（[クレジット表示](https://developer.yahoo.co.jp/attribution/)）。
アプリの最下部（設定タブの一番下）に、規定のHTMLをそのまま置いてあります。

```html
<!-- Begin Yahoo! JAPAN Web Services Attribution Snippet -->
<span style="margin:15px 15px 15px 15px"><a href="https://developer.yahoo.co.jp/sitemap/">Webサービス by Yahoo! JAPAN</a></span>
<!-- End Yahoo! JAPAN Web Services Attribution Snippet -->
```

HTMLを書き換えたり、CSSで色・サイズを変えたりしないでください（規定違反になります）。

## エラーコード（応答の `error`）

| HTTP | error | 意味 |
| --- | --- | --- |
| 400 | `missing_jan` / `invalid_jan` | JANが無い・13桁でない・チェックディジット違い |
| 403 | `origin_not_allowed` | 許可していないオリジンから来た |
| 404 | `image_not_found` | 設定した取得先のどれにも画像付きの商品が無い |
| 405 | `method_not_allowed` | GET・OPTIONS 以外 |
| 429 | `rate_limited` | 回数制限（楽天=1秒1回 / Yahoo!=1分30回）に当たった |
| 500 | `not_configured` | Secret未設定・APIの認証で弾かれた（両方失敗なら「楽天・Yahoo!」の案内） |
| 502 | `upstream_error` など | API側の応答異常・通信失敗 |

両方の取得先が失敗したときは、次の順で1つを選んで返します。

1. どちらも「商品なし」→ 404 `image_not_found`
2. 回数制限がある → 429 `rate_limited`（待てば取れる）
3. 設定不備・上流の異常がある → そのエラー（「無い」と言い切れないため）
4. それ以外 → 404

## つまずいたとき

- `not_configured` が返る
  - `YAHOO_CLIENT_ID` か `RAKUTEN_APPLICATION_ID` のどちらかが入っているか
  - 楽天の場合: `RAKUTEN_ACCESS_KEY` も入っているか、アプリの登録が2026年以降の新しい形式（accessKey あり）か
  - 楽天の場合: 「許可されたウェブサイト」に `shodai4.com` が入っているか、`RAKUTEN_REFERER` と一致しているか
  - Yahoo!の場合: Client ID が削除されていないか、コピー漏れ（前後の空白）がないか
- `origin_not_allowed` が返る
  - 使っているサイトのオリジンを `ALLOWED_ORIGINS` に足す（例 `https://example.com`）
- `image_not_found` が返る
  - そのJANの商品がどちらのモールにも無い、または画像が無い商品。手元写真か画像URLの手入力で対応
- アプリ側で「中継サーバーに接続できませんでした」と出る
  - Worker のURLを開いて 400 `missing_jan` が返るか確認（返れば Worker は生きている）
  - 一時的な失敗なら、自分のアプリID・アクセスキーを設定してあれば自動でそちらに切り替わる
- Yahoo!に切り替わらず楽天のエラーだけが返る（逆も）
  - 応答の `source` と `X-Proxy-Source` を見る。Secretが片方しか入っていないと、その1つだけを試す

## テスト

中継サーバーのテストはアプリ本体のテストに含まれています（`tests/worker.test.js`）。
楽天だけ・Yahoo!だけ・両方（楽天が落ちている／商品なし）の組み合わせと、
どの失敗を返すかを固定しています。

```bash
npm test                                          # ルートで全部
node --test tests/worker.test.js                  # 中継サーバーだけ
cd workers/rakuten-image-proxy && npm test        # 中継サーバーのフォルダから
```

## 未確認のこと（2026年11月15日時点）

- Cloudflare へのデプロイと、実際のAPIキーでの疎通は、この作業では行っていません
  （楽天のアプリIDとアクセスキー、Yahoo!のClient ID、Cloudflareアカウントが手元にないため）
- Yahoo!の商品検索API（v3）は、`appid` をダミーにして叩き、**パラメータの形とエラーの返り方**を確認しました
  （2026年11月15日）。
  - `appid` なし → 401 `{"Error":{"Message":"Bad Request: Authentication parameters in your request incompleted."}}`
  - ダミーの `appid` → 403 `{"Error":{"Message":"Your Request was Forbidden"}}`
  - 正しい Client ID での成功応答（`hits` の中身）はまだ見ていません。応答の読み取りは公式ドキュメントの
    フィールド定義（`hits/name` `hits/price` `hits/url` `hits/image/medium` `hits/exImage/url` `hits/seller/name`）に
    基づいて実装し、テストではその形のJSONを与えて確認しています
- 楽天APIが Referer を必須にしているかは公式ドキュメントに明記がなく、実装者の報告に基づいています。
  初回の疎通確認で `not_configured` が出たら、まずアプリ登録の「許可されたウェブサイト」を確認してください
- 確認できたこと: 中継サーバーと同じ形（URLのクエリに applicationId、ヘッダーに accessKey と Referer）で
  楽天APIを直接叩くと、ダミーの認証情報では `403 Invalid Access Key` が返りました。つまりパラメータの形式と
  Referer の付け方は受け付けられており、弾かれたのはキーの値だけです（2026年11月15日に確認）。
  本物のアプリID・アクセスキーでの成功はまだ見ていません
