# 公開用ビューアーの検証状況

2026-10-08時点。公開は未完了です。

| 項目 | 結果 |
| --- | --- |
| 合成zstd MCAPのCDRデコード・60秒/1201フレーム | PASS |
| コースとMPCのworld原点、候補9本、速度上限 | PASS |
| 未収録IMU・舵角・セッションを0にしない | PASS |
| インデックスなし・Odometryのみの記録 | PASS |
| 逆順で選んだ分割記録の結合 | PASS |
| 不正MCAP・空の記録・不正地図・MPC版違い | PASS |
| `npm test` | 10項目PASS |
| TypeScript / Vite本番ビルド | PASS |
| Pythonファイルの構文検査 | PASS。ROS接続の実行検証は含まない |
| lockfileの`npm ci --dry-run --offline` | PASS。今回のクリーンインストールは未実施 |
| 修正後のPC/390px画面、地図、再生、復帰 | 未実行。ローカルサーバーのlistenがEPERM |
| ROSライブ接続 | 未実行。ROS/実車環境が必要 |
| GitHubリポジトリ作成・push・Pagesデプロイ | 未完了。GitHub CLIのネットワーク接続が失敗 |

## 画面確認

前回の入口・再生・エラーを1440×1000 / 390×844で撮影し、6枚を目視確認しました。画像は生成物としてローカル`artifacts/`に残し、Gitに含めません。

下表の修正後欄は、実際の再撮影ができるまで合格扱いにしません。`npm run build && npm run test:browser`は同じ3状態と2サイズを再現し、修正後の画像を作ります。再生位置はShift+右矢印12回で12秒、デモは合成データ、テーマはダーク、表示倍率は1です。公開URLのサブパスを模したパスでテストします。

| Screen | Before | Finding | Change | After | Result |
| --- | --- | --- | --- | --- | --- |
| 入口 / PC | [画像](../artifacts/visual-feedback/before/01-entry-desktop.png) | 空の地図に入口の案内がない | 使い方と合成デモの入口を追加 | 未取得 | 未確認 |
| 入口 / 390px | [画像](../artifacts/visual-feedback/before/01-entry-mobile.png) | 固定カラムとヘッダーがはみ出す | 入口を単一カラムにし操作を折り返す | 未取得 | 未確認 |
| 再生 / PC | [画像](../artifacts/visual-feedback/before/02-replay-desktop.png) | 数値は読めるが地図が空白 | canvas領域を明示、ResizeObserver再描画、合成地図を適用 | 未取得 | 原因仮説の検証待ち |
| 再生 / 390px | [画像](../artifacts/visual-feedback/before/02-replay-mobile.png) | 地図と再生操作が見切れる | 地図を先頭にして縦に積む | 未取得 | 未確認 |
| エラー / PC | [画像](../artifacts/visual-feedback/before/03-error-desktop.png) | エラー下に意味のない空パネルが残る | 入口を保ち、MCAP形式のエラーを説明する | 未取得 | 未確認 |
| エラー / 390px | [画像](../artifacts/visual-feedback/before/03-error-mobile.png) | エラーと操作が窮屈 | エラー領域と入口を画面幅に収める | 未取得 | 未確認 |

ブラウザ検証では未処理例外・横方向のはみ出しを失敗条件にします。canvasの描画色が存在すること、再生を開始できること、不正ファイルの後にデモへ復帰できることも確認します。スクリーンショットは別途1枚ずつ目視する必要があります。ライブ・レイヤ設定・追加JSONの全状態の画面確認は別途必要です。

## 実行を止めているエラー

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

公開完了には、修正後のブラウザ確認、GitHubへのpush、Actionsの成功、実際の公開URLでデモの再生を確認する必要があります。[PUBLISHING.md](PUBLISHING.md)に再開手順があります。
