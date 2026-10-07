# AI Challenge Web Viewer

ROS 2のMCAP走行記録をブラウザ内で再生し、走行軌跡・速度・操舵・加速度を同じ時刻で確認するビューアーです。KSKのデバッグトピックを収録している場合は、MPCの選択軌跡、舵候補、回廊、速度制限も重ねられます。

Team KSKで使用していたAWSIM Debug Dashboardから、自作のビューアーとブリッジを独立させました。コントローラ、実走行データ、公式コース素材は含めていません。公開に向けた切り出しと改修には生成AIを使用しています。

## 試す

Node.js 24以上が必要です。

```sh
npm ci
npm run dev
```

表示されたローカルURLを開き「60秒のデモを開く」を押してください。楕円コースとROS 2メッセージから生成した、実際のzstd圧縮MCAPを読み込みます。デモは表示確認のための合成データです。実際の走行やMPCの性能を示すものではありません。

```sh
npm test
npm run build
npm run preview
```

デモファイルは開発・テスト・ビルド前に再生成します。`public/`に自分で置いた素材は追跡できます。

## 自分の記録を再生する

1. 「MCAP / JSONを開く」または画面へのドロップで`.mcap`を選びます。
2. 分割記録は同じ車・同じ走行のファイルをまとめて選びます。ログ時刻で並べ替えます。
3. 再生、一時停止、速度変更、スライダー、1フレーム送りで確認します。
4. Spaceで再生切り替え、左右矢印で1フレーム、Shift+左右矢印で1秒移動できます。

ローカルファイルの解析はWeb Workerを含むブラウザ内で行い、ファイルをサーバーへアップロードしません。任意URLからの読み込みを指定した場合だけ、そのURLへアクセスします。

| トピック | 表示 | 条件 |
| --- | --- | --- |
| `/localization/kinematic_state` | 自己位置・速度・軌跡 | 必須。`nav_msgs/msg/Odometry` |
| `/vehicle/status/steering_status` | 実舵角 | `autoware_auto_vehicle_msgs/msg/SteeringReport` |
| `/control/command/control_cmd` | 舵角・加速度・速度指令 | `autoware_auto_control_msgs/msg/AckermannControlCommand` |
| `/control/command/gear_cmd` | ギア | `autoware_auto_vehicle_msgs/msg/GearCommand` |
| `/sensing/imu/imu_data` | 実加速度 | `sensor_msgs/msg/Imu` |
| `/awsim/status` | セッション・周回・ブースト | AWSIM用Float32配列 |
| `/rl_raceline/mpc_static`, `/rl_raceline/mpc_debug` | MPCの予測・候補・制約 | KSK独自スキーマ1。下記参照 |
| `/v2x/vehicle_positions` | 他車位置 | V2XVehiclePositionArray |
| `/aichallenge/pitstop/condition` | ペナルティ推定の補助 | dataに数値を持つ車両コンディション |

MCAP内の`ros2msg`または`ros2idl`スキーマを使ってCDRをデコードします。非圧縮とzstd圧縮、チャンク索引のないファイルに対応します。`.db3`、LZ4圧縮、点群、カメラ画像、任意のトピック名・型への自動対応はありません。未収録の信号は数値0にせず、欠測として表示・描画します。

MPC内部表示は任意のMPCで自動的に使える機能ではありません。配列の定義は[mpc_schema.json](mpc_schema.json)、送信側の接続方法は[MPC-PROTOCOL.md](docs/MPC-PROTOCOL.md)を参照してください。Odometryのみでも軌跡と速度を再生できます。

## コースを重ねる

MCAPと同時に`track.json`を選ぶか、MCAPを開いた後に追加します。地図のない場合は最初の自己位置を原点にして軌跡を表示します。

```json
{
  "type": "track",
  "origin": [100, -40],
  "raceline": [[30, 0], [0, 18], [-30, 0], [0, -18]],
  "walls": [],
  "lanelet_boundaries": [],
  "vehicle_hull": [[1, 0.6], [1, -0.6], [-1, -0.6], [-1, 0.6]]
}
```

`origin`はMCAPの自己位置と同じworld座標系で指定します。`raceline`、`walls`、`lanelet_boundaries`の点はoriginを引いた座標、`vehicle_hull`は車体ローカル座標です。単位はm、X前方・Y左方、yawは反時計回りです。原点や地図が違う走行を混ぜると、車体とコースがずれます。

自分のデータから書き出す補助スクリプトもあります。Python 3.10以上で、ROSは不要です。

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/python backend/track_assets.py \
  --data-dir /path/to/controller/data \
  --lanelet2-map /path/to/lanelet2_map.osm \
  --vehicle-info-yaml /path/to/vehicle_info.param.yaml \
  --out /tmp/track.json
```

dataディレクトリの`raceline.csv`は`x,y`列のworld座標です。追加の壁距離場や車体形状があれば読み込みます。詳細な車輪モデルはJSONインポートでは使用せず、車体凸包または既定の矩形を表示します。

同じ走行のAWSIM `result-details.json`を一緒に選ぶと、`penalty_events`の時刻と秒数を使います。結果JSONがないときの接触・ペナルティは推定です。公式判定の代わりには使わないでください。

## ライブ表示（任意）

ROS 2 / Autowareのメッセージと`rclpy`が利用できる環境で実行します。必要なPythonパッケージは`backend/requirements.txt`にあります。

```sh
ROS_DOMAIN_ID=1 python3 backend/awsim_debug_bridge.py \
  --host 127.0.0.1 --port 8765 \
  --data-dir /path/to/controller/data \
  --lanelet2-map /path/to/lanelet2_map.osm \
  --vehicle-info-yaml /path/to/vehicle_info.param.yaml
```

ブラウザで「ライブ接続」を開き、`ws://127.0.0.1:8765`を指定します。複数ドメインは`--domains 1,2,3`で選べます。ブリッジは受信・表示用で、操作指令を送信しません。ローカルHTTP版で使うのが簡単です。HTTPSでホストしたビューアーから接続する場合はブラウザの混在コンテンツ制限があるため、適切な`wss://`の接続先を用意してください。

## 検証と制限

- `npm test`: 合成MCAP/CDRに対する10項目。zstd、MPC候補、原点、欠測、索引なし、分割ファイル、不正入力を確認します。
- `npm run test:browser`: ビルド後にChromeで1440px/390pxの入口・再生・エラーを確認し、6枚のスクリーンショットを保存します。横方向のはみ出し、未処理例外、地図の描画、再生、エラーからの復帰を検査します。`CHROME_BIN`で実行ファイルを指定できます。
- [検証状況](docs/VALIDATION.md)に実行済みと未実行の項目を記録しています。

読み込みではファイル全体と解析結果をメモリに保持し、20Hzの再生フレームを作ります。大きな記録や長時間の走行はPCで短い区間から試してください。メッセージは各フレーム時刻までの直近値を保持し、通信遅延を補正した厳密な同期は行いません。

## 公開と貢献

[公開手順](docs/PUBLISHING.md)。GitHub Pages用の相対パスとワークフローを含めています。ビルド成果物だけでホストでき、MCAP再生のためのROSサーバーは不要です。

不具合の報告には、ブラウザ・記録したトピック・再現手順を添えてください。実走行ファイルを共有できない場合は、デモで再現する手順や匿名化した小さな記録でも構いません。

MIT License — Team KSK. 依存ライブラリのライセンスは各パッケージの定義に従います。ビルド時にインストール済みパッケージのライセンス本文を`THIRD_PARTY_NOTICES.txt`へまとめ、静的配信物に含めます。
