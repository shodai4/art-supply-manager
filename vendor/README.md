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
