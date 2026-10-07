# 公開手順

予定先は`Raptor-zip/aichallenge-web-viewer`です。公開先はこの文書作成時点では未作成・未確認です。

コード、MITライセンス、合成デモ、自動テスト、GitHub Pagesワークフローは用意済みです。現在の実行環境はネットワークとローカル待ち受けが制限されているため、GitHubへの公開と修正後のChrome確認は完了していません。

ネットワークとChromeが使える環境で、まず以下を実行します。

```sh
npm ci
npm test
npm run build
npm run test:browser
```

6枚の画像を1枚ずつ開き、入口、再生、エラーをPCとスマートフォン幅で確認します。特に地図が描かれ、操作や凡例がはみ出さないことを確認してください。

この独立リポジトリの`main`を公開します。

```sh
gh repo create Raptor-zip/aichallenge-web-viewer --public \
  --description 'Browser-local ROS 2 MCAP replay and MPC diagnostics for AI Challenge' \
  --source . --remote origin --push
gh api --method POST repos/Raptor-zip/aichallenge-web-viewer/pages -f build_type=workflow
```

既に同名リポジトリがある場合は、送信先と内容を確認してから既存originへの通常のpushで続けます。履歴の上書きはしません。

`Verify viewer`の成功後、`Publish viewer`が同じコミットをビルド・検証してGitHub Pagesに配置します。Actionsの成功と、表示された実URLでデモの読み込みを確認してから公開完了とします。

GitHub Pagesの権限・環境・成果物の構成は[GitHub公式ドキュメント](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)に従っています。
