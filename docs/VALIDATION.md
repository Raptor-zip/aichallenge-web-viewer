# 公開用ビューアーの検証状況

2026-10-08時点。公開と実URLでの確認が完了しました。

[公開ページ](https://raptor-zip.github.io/aichallenge-web-viewer/) / [ソース](https://github.com/Raptor-zip/aichallenge-web-viewer)

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
| クリーンインストール `npm ci` | PASS。91パッケージを新規インストール |
| 修正後のPC/390px画面、地図、再生、復帰 | PASS。PC/390pxの6状態・12枚を目視、自動検査 |
| 公開URLでのデモ・ファイル取り込み | PASS。ChromeでPC/390pxの12状態を再確認、未処理例外0 |
| ROSライブ接続 | 未実行。ROS/実車環境が必要 |
| GitHubリポジトリ作成・push・Pagesデプロイ | PASS。公開リポジトリへpush、GitHub Pages配置成功 |

## 画面確認

前回の入口・再生・エラーを1440×1000 / 390×844で撮影し、6枚を目視確認しました。画像は生成物としてローカル`artifacts/`に残し、Gitに含めません。

入口・再生・エラーを同じ条件で再撮影して確認しました。さらにMCAP+JSONの取り込み、レイヤ操作、不正接続URLの6枚を追加して確認しています。再生位置はShift+右矢印12回で12秒、データは合成、テーマはダーク、表示倍率は1です。公開URLのサブパスを模したパスでテストします。

| Screen | Before | Finding | Change | After | Result |
| --- | --- | --- | --- | --- | --- |
| 入口 / PC | [画像](../artifacts/visual-feedback/before/01-entry-desktop.png) | 空の地図に入口の案内がない | 使い方と合成デモの入口を追加 | [画像](../artifacts/visual-feedback/after/01-entry-desktop.png) | PASS |
| 入口 / 390px | [画像](../artifacts/visual-feedback/before/01-entry-mobile.png) | 固定カラムとヘッダーがはみ出す | 入口を単一カラムにし操作を折り返す | [画像](../artifacts/visual-feedback/after/01-entry-mobile.png) | PASS |
| 再生 / PC | [画像](../artifacts/visual-feedback/before/02-replay-desktop.png) | 数値は読めるが地図が空白 | canvas領域を明示、ResizeObserver再描画、合成地図を適用 | [画像](../artifacts/visual-feedback/after/02-replay-desktop.png) | PASS。地図描画を確認 |
| 再生 / 390px | [画像](../artifacts/visual-feedback/before/02-replay-mobile.png) | 地図と再生操作が見切れる | 地図を先頭にして縦に積む | [画像](../artifacts/visual-feedback/after/02-replay-mobile.png) | PASS |
| エラー / PC | [画像](../artifacts/visual-feedback/before/03-error-desktop.png) | エラー下に意味のない空パネルが残る | 入口を保ち、MCAP形式のエラーを説明する | [画像](../artifacts/visual-feedback/after/03-error-desktop.png) | PASS |
| エラー / 390px | [画像](../artifacts/visual-feedback/before/03-error-mobile.png) | エラーと操作が窮屈 | エラー領域と入口を画面幅に収める | [画像](../artifacts/visual-feedback/after/03-error-mobile.png) | PASS |

## 追加の状態

| Screen | Before | Finding | Change | After | Result |
| --- | --- | --- | --- | --- | --- |
| MCAP+JSON / PC | 新規の公開機能 | ローカルファイルの入口が必要 | 複数ファイルと地図の取り込み | [画像](../artifacts/visual-feedback/after/04-local-files-desktop.png) | PASS |
| MCAP+JSON / 390px | 新規の公開機能 | 同上 | 同上 | [画像](../artifacts/visual-feedback/after/04-local-files-mobile.png) | PASS |
| レイヤ / PC | 未撮影 | 予測が重なるので選択が必要 | チェックボックス操作を確認 | [画像](../artifacts/visual-feedback/after/05-layers-desktop.png) | PASS |
| レイヤ / 390px | 未撮影 | 小さい地図で設定が収まるか | スクロール可能な設定を確認 | [画像](../artifacts/visual-feedback/after/05-layers-mobile.png) | PASS |
| 不正接続URL / PC | 新規の公開機能 | 入力エラーからの復帰が必要 | スキームの説明と切断を確認 | [画像](../artifacts/visual-feedback/after/06-connection-error-desktop.png) | PASS |
| 不正接続URL / 390px | 新規の公開機能 | 同上 | 同上 | [画像](../artifacts/visual-feedback/after/06-connection-error-mobile.png) | PASS |

未処理例外・横方向のはみ出しは0件。canvas描画、再生開始、不正ファイルからデモへの復帰、ローカルMCAP+地図JSON、レイヤ切り替え、接続URLのエラー表示と切断を検証しました。未収録IMUの最新値ラベルは「—」です。

画像のリンクはローカル作業用です。GitHubではActionsの`viewer-screenshots`成果物を参照してください。公開READMEには[再生画面](images/replay.png)を含めています。

ライブの実車ROS接続と、全種類の実走行データでの検証は未実行です。合成デモは性能評価ではありません。

## 公開先での確認

[Verify viewer](https://github.com/Raptor-zip/aichallenge-web-viewer/actions/runs/37702692287)と[Publish viewer](https://github.com/Raptor-zip/aichallenge-web-viewer/actions/runs/37702774644)が成功しました。配置したアプリのコミットは`91e55b7`です。その後の検証記録の変更はアプリの配信内容を変えません。

実際のHTTPS公開ページをChromeで開き、同じ操作列を再実行しました。WorkerとMCAPの読み込み、再生、ローカルファイル取り込み、レイヤ、不正URLからの復帰が成功しています。以下の12枚も個別に目視しました。

| Screen | Before | Finding | Change | After | Result |
| --- | --- | --- | --- | --- | --- |
| 入口 / PC | [ローカル](../artifacts/visual-feedback/after/01-entry-desktop.png) | 公開先の配信・表示を確認 | 追加修正なし | [公開先](../artifacts/visual-feedback/public/01-entry-desktop.png) | PASS |
| 入口 / 390px | [ローカル](../artifacts/visual-feedback/after/01-entry-mobile.png) | 公開先の配信・表示を確認 | 追加修正なし | [公開先](../artifacts/visual-feedback/public/01-entry-mobile.png) | PASS |
| 再生 / PC | [ローカル](../artifacts/visual-feedback/after/02-replay-desktop.png) | 公開先の配信・表示を確認 | 追加修正なし | [公開先](../artifacts/visual-feedback/public/02-replay-desktop.png) | PASS |
| 再生 / 390px | [ローカル](../artifacts/visual-feedback/after/02-replay-mobile.png) | 公開先の配信・表示を確認 | 追加修正なし | [公開先](../artifacts/visual-feedback/public/02-replay-mobile.png) | PASS |
| エラー / PC | [ローカル](../artifacts/visual-feedback/after/03-error-desktop.png) | 公開先の配信・表示を確認 | 追加修正なし | [公開先](../artifacts/visual-feedback/public/03-error-desktop.png) | PASS |
| エラー / 390px | [ローカル](../artifacts/visual-feedback/after/03-error-mobile.png) | 公開先の配信・表示を確認 | 追加修正なし | [公開先](../artifacts/visual-feedback/public/03-error-mobile.png) | PASS |
| MCAP+JSON / PC | [ローカル](../artifacts/visual-feedback/after/04-local-files-desktop.png) | 公開先の配信・表示を確認 | 追加修正なし | [公開先](../artifacts/visual-feedback/public/04-local-files-desktop.png) | PASS |
| MCAP+JSON / 390px | [ローカル](../artifacts/visual-feedback/after/04-local-files-mobile.png) | 公開先の配信・表示を確認 | 追加修正なし | [公開先](../artifacts/visual-feedback/public/04-local-files-mobile.png) | PASS |
| レイヤ / PC | [ローカル](../artifacts/visual-feedback/after/05-layers-desktop.png) | 公開先の配信・表示を確認 | 追加修正なし | [公開先](../artifacts/visual-feedback/public/05-layers-desktop.png) | PASS |
| レイヤ / 390px | [ローカル](../artifacts/visual-feedback/after/05-layers-mobile.png) | 公開先の配信・表示を確認 | 追加修正なし | [公開先](../artifacts/visual-feedback/public/05-layers-mobile.png) | PASS |
| 不正接続URL / PC | [ローカル](../artifacts/visual-feedback/after/06-connection-error-desktop.png) | 公開先の配信・表示を確認 | 追加修正なし | [公開先](../artifacts/visual-feedback/public/06-connection-error-desktop.png) | PASS |
| 不正接続URL / 390px | [ローカル](../artifacts/visual-feedback/after/06-connection-error-mobile.png) | 公開先の配信・表示を確認 | 追加修正なし | [公開先](../artifacts/visual-feedback/public/06-connection-error-mobile.png) | PASS |
