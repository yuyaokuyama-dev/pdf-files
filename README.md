# PDF Files
ブラウザ(Windows / iPhone)で動く PDF エディタ(PWA)。ビルド不要。アカウント(Builds共通)のみ Vercel のサーバー関数(`api/`)を使用。

主な機能: ペン(なめらか)/ 線・円・四角・矢印・雲・テキスト・多角形(移動・削除・頂点編集)/ 印影・署名 /
開いているファイルのタブ(作業画面の外へドラッグで別ウィンドウに分けて並べて表示)/ PDFを作業画面にドロップで新しいタブ・ページ一覧にドロップでページ追加 /
ページ削除・並べ替え / カメラ挿入 / 寸法線 / 縮尺設定と2点計測 / 容量最適化して書き出し /
Google Drive 保存・履歴 / Gmail 送信 / オフライン / メールアドレスID・パスワード管理(Buildsと共通の共有アカウント)。

- セットアップ: [SETUP.md](SETUP.md)
- テスト: `node --test tests/geometry.test.mjs tests/auth.test.mjs tests/google.test.mjs`、E2E は `node tests/e2e-*.mjs`(Playwright 必要)
- 制限: ID/パスワードは端末内のみ(同期なし)/ パスワード付きPDF非対応 / 「最小」最適化はテキスト選択不可 /
  ロゴのフォント(TimeBurner)はEULAのためアウトライン化のみ同梱
- ライセンス: 本体は非公開ライセンス([LICENSE](LICENSE))。同梱OSSの一覧と全文は `licenses.html`(設定 → オープンソースライセンス)
