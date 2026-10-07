---
date: 2026-10-08 07:51:24
phase: "公開検証"
iteration: 1
status: failed
---

## やろうとしたこと
既存ビューアーを自作コードだけの独立リポジトリへ切り出し、合成MCAP、ブラウザ内Worker解析、地図JSON、入口、欠測表示、レスポンシブCSS、README、接続プロトコル、CI/Pages設定を実装した。

## 実際に起きたこと
`npm test`の10項目と`npm run build`、Python構文検査、Nodeのブラウザ検証スクリプト構文検査は成功した。`npm ci --dry-run --offline`は成功したがoptional peerの警告を返した。今回のクリーンインストールは実行していない。

ブラウザとGitHubの境界は以下のエラーで失敗した。


```text
Error: listen EPERM: operation not permitted 127.0.0.1
    at Server.setupListenHandle [as _listen2] (node:net:1918:21)
    at listenInCluster (node:net:1997:12)
    at node:net:2206:7
    at process.processTicksAndRejections (node:internal/process/task_queues:89:21) {
  code: 'EPERM',
  errno: -1,
  syscall: 'listen',
  address: '127.0.0.1'
}
```

```text
error connecting to api.github.com
check your internet connection or https://githubstatus.com
```


## 原因
実行環境のrestricted networkではループバックの待ち受けも拒否される。Chromeの初期起動でもsetsockoptがOperation not permittedとなった。GitHub CLIはAPI接続に失敗している。公開URLと修正後の画面検証は未完了。

## 試して却下した方法
ChromeをローカルCDP pipeで起動する確認でも初期化に失敗した。環境制限を回避して外部へ送信する方法は使用しない。

## 最終的な対応
コードとビルド成果物を保存し、ブラウザ再検証と公開の再開手順をdocs/PUBLISHING.mdへ残す。修正後の画面は未確認とし、未処理例外・横はみ出し・地図描画の検査に合格した場合にのみPagesへ配置する構成にした。ローカルの意味ある単位でコミットする。

## 次にやる人が知っておくべきこと
目標の公開先はRaptor-zip/aichallenge-web-viewer。まだ作成していない。先にネットワークとChromeが使える環境でnpm ci、npm test、npm run build、npm run test:browserを実行し、画像を1枚ずつ確認すること。前回画像と検証表はdocs/VALIDATION.md。元の開発・提出リポジトリや実走行データは変更していない。
