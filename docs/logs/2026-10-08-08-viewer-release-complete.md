---
date: 2026-10-08 08:34:27
phase: "公開"
iteration: 2
status: success
---

## やろうとしたこと
権限変更後にインストール・テスト・画面確認を完了し、独立した公開リポジトリとGitHub Pagesを作成した。

## 実際に起きたこと
npm ciで91パッケージのインストールに成功。10項目のMCAPテストとビルド、Python構文検査、ChromeのPC/390px・12状態が成功した。画像は1枚ずつ目視した。

GitHub ActionsのVerify viewer (37702692287) とPublish viewer (37702774644) が成功。公開URLは https://raptor-zip.github.io/aichallenge-web-viewer/ 。HTTP 200と配置されたJS/CSSの一致を確認し、実際のHTTPSページでも12状態の操作と描画が成功した。未処理例外と横はみ出しは0件。

## 原因
前回の制限は解除された。npmのロック不整合はVite 5と同世代のvite-nodeを選び直して解消。未収録値のラベルもNaNではなく欠測に直した。

## 試して却下した方法
前回のoffline dry-runだけによるインストール確認。今回は実際のnpm ciとGitHubのクリーン環境で確認した。

## 最終的な対応
Raptor-zip/aichallenge-web-viewerをMITで公開した。READMEに公開URL、合成デモ、利用条件と再生画像を掲載し、docs/VALIDATION.mdへ実行結果を保存した。ローカルの公開先キャプチャはartifacts/visual-feedback/publicに保存した。

## 次にやる人が知っておくべきこと
MPC表示はKSKスキーマ1の記録が必要。実車ROSライブ接続は未検証。デモは性能評価ではない。アプリ変更はCI成功後に同じコミットから自動配置し、docs/README/LICENSEだけの変更は再配置しない。公開したアプリは91e55b7。元の開発・提出リポジトリには変更を加えていない。
