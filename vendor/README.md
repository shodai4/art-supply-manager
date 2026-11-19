# vendor/ について

## html5-qrcode.min.js

- 出典: https://github.com/mebjas/html5-qrcode
- バージョン: 2.3.8（https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js をそのまま保存）
- ライセンス: Apache License 2.0（同梱のライブラリ本体のヘッダに準拠）

### なぜリポジトリに入れているか

iOS の WKWebView（Capacitor のアプリ内ブラウザ）には `BarcodeDetector` がありません。
そこで、これまで `unpkg.com` から実行時に読み込んでいた軽量スキャナを、リポジトリに同梱して
自分のサイト（`shodai4.com` とアプリのバンドル内）から配るようにしました。

- 遠隔のコードを実行時に読み込まない（App Store 審査 2.5.2 の観点で安全）
- オフラインでも読取が動く（PWA のキャッシュにも乗る）
- CDN の停止や仕様変更に影響されない

読み込みは `scanner.js` の `loadVendorScanner()` が初回の読取時だけ行います（375KB）。
更新するときは同じバージョンの `html5-qrcode.min.js` を差し替え、
このファイルのバージョン表記も合わせて更新してください。

## gsap.min.js

- 出典: npm パッケージ `gsap@3.15.1` の `dist/gsap.min.js` をそのまま保存（変更なし）
- サイズ: 73,357 バイト（gzip 28,435 バイト）
- ライセンス: GSAP Standard "No Charge" License（https://gsap.com/standard-license）。
  商用利用も無償。禁止は「ビジュアルにアニメーションを作るツール（Webflow と競合する製品）」への
  組み込みだけで、在庫管理アプリのUIの動きは許可範囲内。全文と要旨は `gsap.LICENSE.txt`。
- ヘッダの著作権表示（`@license Copyright 2026, GreenSock...`）は消さずに残す。

### なぜリポジトリに入れているか

`html5-qrcode` と同じ理由です。CDN から読むと、通信できない場所（オフライン）や
アプリ内（`capacitor://localhost`）で動かず、遠隔コードの実行にもなります。
`index.html` が `app.js` より先に `<script src="vendor/gsap.min.js">` として読み、
アプリ側は `motion.js` からだけ触ります（GSAP が読めない・視差効果を減らす設定のときは、
動かさずにその場で終わりの状態にする）。

`sw.js` のキャッシュ対象と `scripts/build.mjs` の `www/` コピー対象にも入れてあります。
更新するときは同じバージョンの `gsap.min.js` を差し替え、このファイルと
`gsap.LICENSE.txt` のバージョン・サイズ・sha256 も合わせて更新してください。
