# PDF Files セットアップ手順(すべて無料)

## 1. 公開(ホスティング)
ビルド不要の静的サイトです。https で配信できる無料ホスティングならどれでも動きます(サーバー側の処理は不要)。
**GitHub Pages(推奨・無料)**
1. GitHub で新しいリポジトリ(例: `pdf-files`)を作り、このフォルダの中身をそのまま push(`main`)。
2. リポジトリの Settings → Pages → Source を **GitHub Actions** にする。同梱の `.github/workflows/pages.yml` が自動公開します。
3. 公開URL(例: `https://<ユーザー名>.github.io/pdf-files/`)が発行されます。
**Vercel / Cloudflare Pages / Netlify**: リポジトリを連携、ビルドコマンドなし・出力ディレクトリはルート(`.`)。
ローカル確認: `node scripts/serve.mjs` → http://localhost:8080
PWA・オフライン・Google連携は **https(または localhost)** が必須です。
## 2. Google 連携(Drive / Gmail)
アプリ内の「設定」に自分の値を入力します(コードには秘密情報を含みません)。
1. https://console.cloud.google.com でプロジェクトを作成(無料)。
2. 「APIとサービス」→「ライブラリ」で **Google Drive API / Gmail API / Google Picker API** を有効化。
3. 「OAuth 同意画面」を設定(テスト中は自分のアカウントをテストユーザーに追加)。
4. 「認証情報」→ **OAuth クライアント ID(ウェブアプリケーション)** を作成。
   「承認済みの JavaScript 生成元」に公開URL(例: https://example.pages.dev)を追加。
5. 「認証情報」→ **API キー** を作成(Picker 用。HTTPリファラで公開URLに制限推奨)。
6. プロジェクト番号が **App ID**。
7. アプリの設定ダイアログに クライアントID / APIキー / App ID を入力。
スコープ: `drive.file`(アプリが作成・開いたファイルのみ)と `gmail.send`。

## 3. iPhone のホーム画面に追加
Safari で公開URLを開く → 共有ボタン → 「ホーム画面に追加」。アイコンは「PDF Files」の1行(先頭のPのみ赤)。

## 4. オフライン
一度オンラインで開けばアプリ本体がキャッシュされます。オフラインでも編集・描画・計測・書き出しが可能。
Drive保存とメール送信はオフライン時は「待ち」に入り、オンライン復帰時に実行を提案します。
