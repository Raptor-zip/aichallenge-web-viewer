# 公開・更新手順

ソース: [Raptor-zip/aichallenge-web-viewer](https://github.com/Raptor-zip/aichallenge-web-viewer)

公開ページ: [AI Challenge Web Viewer](https://raptor-zip.github.io/aichallenge-web-viewer/)

GitHub Pagesのビルド方式はGitHub Actionsに設定済みです。アプリの変更をmainへpushすると、`Verify viewer`がインストール・テスト・ビルド・Chrome検証を行います。成功後に`Publish viewer`が同じコミットを再確認して配置します。PRや別リポジトリのコードからは公開しません。

README、docs、LICENSEだけの更新はアプリを再配置しません。手動配置はActionsの`Publish viewer` → Run workflowです。

## 配置前の確認

```sh
npm ci
npm test
npm run build
npm run test:browser
```

生成された12枚の画像を1枚ずつ開き、入口、再生、エラー、MCAP+JSONの取り込み、レイヤ、不正接続URLの表示をPCと390px幅で確認します。地図が描かれ、操作や凡例がはみ出さないこと、未収録値がNaNや0にならないことを確認してください。

## 公開後の確認

Actionsの成功だけでなく、上記の公開ページを開いて「60秒のデモを開く」を押します。WorkerとMCAPを公開URLから読み込めること、再生・停止・シークが動くこと、ブラウザの未処理例外がないことを確認してください。

確認結果は[VALIDATION.md](VALIDATION.md)に記録します。公式ROS/実車環境でのライブ接続確認は別項目です。

GitHub Pagesの権限・環境・成果物は[GitHub公式ドキュメント](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)に従っています。
