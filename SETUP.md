# PDF Files セットアップ手順(すべて無料)

## 1. 公開(Vercel・無料)
アカウント機能(メールアドレスID・パスワード再設定)は、サーバー側の処理(`api/`)を使うため **Vercel** で公開します。
1. https://vercel.com で **Add New → Project** → GitHub の `pdf-files` をインポート(設定は初期値のまま。ビルドコマンドは不要)。
2. **Settings → Environment Variables** に、Builds と**同じ値**で次の3つを設定(秘密情報なのでチャットなどに貼らない):
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
   - `GOOGLE_DRIVE_ROOT_FOLDER_ID`
3. 設定後に再デプロイ(Deployments → 最新の「Redeploy」)。
4. 以後は PR ごとに確認用URL(Preview)、`main` へのマージで本番が自動更新されます。

### アカウントについて
- Builds と同じ共有ドライブの `Builds/_auth/users.json` を使うので、**Builds と同じメールアドレス・パスワード**でログインできます(最初に登録した人が管理者)。
- パスワードはハッシュ(PBKDF2-SHA256)だけを保存します。
- 一度ログインした端末では、**オフラインでもログイン**できます。
- **パスワードの再設定**: メール送信の仕組みがないため、既定は「管理者が確認コードを発行して本人に伝える」方式です(ユーザーメニュー → 再設定コードの発行)。コードは30分有効・5回間違えると無効になります。
  - Builds と同じ「要求した画面にコードを表示する」方式にするには、環境変数 `AUTH_RESET_MODE=display` を設定します。ただし、**メールアドレスを知っている人なら誰でもパスワードを変更できてしまう**ため、おすすめしません。
- Vercel 以外(GitHub Pages など API が無い環境)で開くと、従来どおり**端末内だけのアカウント**で動きます。

### GitHub Pages(補助)
`.github/workflows/pages.yml` で GitHub Pages にも自動公開されます(アカウントは端末内のみ)。不要なら、このファイルを削除してください。
## 2. Google 連携(Drive / Gmail)
アプリ内の「設定」に自分の値を入力します(コードには秘密情報を含みません)。
1. https://console.cloud.google.com でプロジェクトを作成(無料)。
2. 「APIとサービス」→「ライブラリ」で **Google Drive API / Gmail API / Google Picker API** を有効化。
3. 「OAuth 同意画面」を設定(テスト中は自分のアカウントをテストユーザーに追加)。
4. 「認証情報」→ **OAuth クライアント ID(ウェブアプリケーション)** を作成。
   「承認済みの JavaScript 生成元」に公開URL(Vercel の `https://xxxx.vercel.app`。パスなし)を追加。
5. 「認証情報」→ **API キー** を作成(Picker 用。HTTPリファラで公開URLに制限推奨)。
6. プロジェクト番号が **App ID**。
7. アプリの設定ダイアログに クライアントID / APIキー / App ID を入力。
スコープ: `drive.file`(アプリが作成・開いたファイルのみ)と `gmail.send`。

## 3. iPhone のホーム画面に追加
Safari で公開URLを開く → 共有ボタン → 「ホーム画面に追加」。アイコンは「PDF Files」の1行(先頭のPのみ赤)。

## 4. オフライン
一度オンラインで開けばアプリ本体がキャッシュされます。オフラインでも編集・描画・計測・書き出しが可能。
Drive保存とメール送信はオフライン時は「待ち」に入り、オンライン復帰時に実行を提案します。
