---
date: 2026-10-08 07:43:51
phase: "MCAP検証"
iteration: 1
status: partial
---

# インデックスなしMCAPの検出

## やろうとしたこと
合成ROS2メッセージでzstd、CDR、座標原点、分割ファイル、インデックスなしMCAPのテストを実行した。

## 実際に起きたこと
インデックスなしOdometryのみのファイルを読んだとき、次のエラーが発生した。

```text
Error: ダッシュボードが読めるトピックが1つも入っていません(/localization/kinematic_state などが必要です)
    at readBag (src/bag/readBag.ts:236:11)
```

## 原因
McapIndexedReader.Initializeはチャンクの索引がなくても成功する。readMessagesはその場合メッセージを返さず、例外を契機にする既存のストリーム読み込みに到達しない。

## 試して却下した方法
Initializeの例外だけで索引の有無を判定する方法。

## 最終的な対応
chunkIndexesが空ならストリーム読み込みへ切り替える。欠測信号と複数ファイルの順序を回帰テストする。

## 次にやる人が知っておくべきこと
MCAPのmagicは89 4d 43 41 50 30 0d 0a。浮動小数点のyawは許容誤差で比較する。
