import type { BagEvent } from "./bag/events";

export interface TopicHealth {
  age_ms: number | null;
  hz: number;
  raw: Record<string, number | string>;
}

/**
 * 1回の配信。3台走行では **1台=1つの ROS_DOMAIN_ID** なので、
 * バックエンドが全ドメインぶんをまとめて1本で送ってくる。
 * 同じ瞬間の全車を並べないと「誰が誰を避けたのか」は追えない。
 */
export interface TelemetryMsg {
  type: "telemetry";
  t: number;
  vehicles: Telemetry[];
}

export interface Telemetry {
  /** ROS_DOMAIN_ID。単独走行なら1つだけ */
  domain: number;
  /**
   * 車の表示名。実機は 1台=1ドメインなので `d1` で足りるが、
   * racing_game(人間 vs MPC)は「YOU / MPC-1」の方が分かるので送ってくる。
   * 無ければドメイン番号で呼ぶ。
   */
  name?: string;
  type?: "telemetry";
  t: number;
  pose: { x: number; y: number; yaw_deg: number };
  twist: { vx: number; vy: number; yaw_rate: number };
  speed_mps: number;
  steer: { actual_deg: number; cmd_deg: number; max_deg: number };
  accel: { cmd_mps2: number; speed_cmd_mps: number; actual_mps2: number };
  gear: string;
  session: {
    session_time: number;
    lap_count: number;
    lap_time: number;
    section: number;
    time_scale: number;
    boost_remaining: number;
    is_boosting: number;
  };
  admin_state: string;
  topics: Record<string, TopicHealth>;
  wall_markers: WallMarker[];
  /** /rl_raceline/debug の「レースラインindex」が指す実座標。無効な間はnull */
  raceline_idx_marker: RacelineIdxMarker | null;
  /** 完走したラップの所要時間履歴(古い順) */
  lap_history: LapRecord[];
  /** RL観測(state_observation.py)に入っている6ルックアヘッド点(3/6/10/15/22/30m)のワールド座標 */
  rl_lookahead_points: [number, number][];
  /** サンプリングMPCの毎stepの中身。MPC以外で走っている間はnull */
  mpc: MpcDebug | null;
  /** V2Xが配信している相手の実位置(コントローラの推定を通さない素の値) */
  v2x: V2XVehicle[];
  /** コントローラとダッシュボードでスキーマ版が食い違ったときの警告文 */
  mpc_schema_warn: string | null;
}

export interface V2XVehicle {
  id: string;
  x: number;
  y: number;
  /**
   * 進行方向[rad]。V2Xは位置しか配信しないので、bag再生では位置の差分から出す。
   * 無いときは受け手がコース接線で近似する(ヘアピンでは隣の区間を拾うことがあり
   * 当てにならないので、差分が取れるならそちらが正しい)。
   */
  yaw?: number;
}

/** 舵候補1本ぶんの予測。cost が小さいほど良い候補。 */
export interface MpcCandidate {
  steer: number;
  cost: number;
  /** 予測が相手の接触箱に入った、またはCBFを破った(=採らない印) */
  hit: boolean;
  pts: [number, number][];
}

export interface MpcOppPrediction {
  /** 分岐MPCの重み。1が本命、それ未満は「こう動くかもしれない」の枝 */
  w: number;
  pts: [number, number][];
}

export interface MpcOpponent {
  x: number;
  y: number;
  v: number;
  s: number;
  lat: number;
  vlat: number;
  /** 経路長での車間[m]。正なら相手が前 */
  gap: number;
  /** 速度推定が何回分の差分でできているか(小さいうちは当てにならない) */
  nobs: number;
}

export interface MpcDebug {
  horizon: number;
  dt: number;
  best: {
    steer: number;
    steer_deg: number;
    accel: number;
    off: number;
    cost: number;
    /** 2番目に安い候補との差(隣の舵候補なので普段から小さい) */
    margin: number | null;
    /** 候補集合の最良〜最悪の幅。小さいほど「どれを選んでも同じ」＝壁で飽和 */
    spread: number | null;
  };
  off_cmd: number;
  off_delta: number;
  plan_tgt: number;
  v_cap: number | null;
  acc_cap: number | null;
  threat: boolean;
  passing: boolean;
  plan_active: boolean;
  plan_ok: boolean;
  plan_hold: boolean;
  plan_why: string;
  plan_why_ja: string;
  side: number;
  side_left: number;
  follow_hold: number;
  launched: boolean;
  pen_hold: number;
  clearance: number;
  lat: number;
  idx: number;
  s_ego: number;
  speed: number;
  steer_actual: number;
  steer_prev: number;
  cbf_used: boolean;
  step_ms: number;
  mode_code: number;
  mode: string;
  n_safe: number;
  n_cand: number;
  lat_slope: number;
  plan_keep: number;
  pose: { x: number; y: number; yaw: number };
  boost_remaining: number;
  is_boosting: boolean;
  race_live: boolean;
  lap_time: number;
  session_time: number;
  /** C拡張(rollout_ext)で探索しているか。falseならPython版で10倍遅い */
  rollout_ext: boolean;
  best_traj: [number, number][];
  ref_points: [number, number][];
  ref_shifted: [number, number][];
  corridor_lo: number[];
  corridor_hi: number[];
  s_ref: number[];
  cands: MpcCandidate[];
  opp_pred: MpcOppPrediction[];
  opp: MpcOpponent[];
}

/** 起動時に1回だけ届くMPCの静的データ(参照経路・回廊・設定値) */
export interface MpcStatic {
  type: "mpc_static";
  /** どの車(ROS_DOMAIN_ID)のものか */
  domain?: number;
  n: number;
  total_len: number;
  horizon: number;
  dt: number;
  n_steer: number;
  n_steer2: number;
  n_off: number;
  n_accel: number;
  n_accel_v2x: number;
  max_steer: number;
  wheel_base: number;
  safe: number;
  safe_pass: number;
  w_wall: number;
  w_wall_pass: number;
  cbf_alpha: number;
  cbf_rmin: number;
  box_lon: number;
  box_lat: number;
  clear_w: number;
  off_max_m: number;
  lon_min: number;
  v_max: number;
  plan_on: boolean;
  v2x_enable: boolean;
  hard_box: boolean;
  /** 回廊内で曲率を均した経路を追っているか(raceline.csv そのものではない) */
  smoothed: boolean;
  w_lat: number;
  w_head: number;
  w_prog: number;
  w_dsteer: number;
  ref_path: [number, number][];
  off_lo: number[];
  off_hi: number[];
  v_prof: number[];
  s: number[];
}

export interface LapRecord {
  lap: number;
  time: number;
}

export interface WallMarker {
  t: number;
  x: number;
  y: number;
  min_dist: number;
}

export interface RacelineIdxMarker {
  idx: number;
  x: number;
  y: number;
}

export interface TrackMsg {
  type: "track";
  /** バックエンドが購読しているドメイン一覧(=台数) */
  domains?: number[];
  /**
   * このコース図の座標原点(world絶対座標)。raceline.csv の先頭点。
   * **rosbag を重ねるときに要る**。bag 側が別の原点(最初の自己位置など)で
   * 相対化すると、コース全体が丸ごとずれて壁にめり込んで見える
   * (実測: この bag では 3.45m ずれていた。コース幅は4〜6m)。
   */
  origin?: [number, number];
  raceline: [number, number][];
  walls: [number, number][];
  /** 実車物理Colliderの凸包(車体ローカル座標 [前後(+前), 左右(+左)]、前+1.13m/後-0.86m非対称) */
  vehicle_hull: [number, number][];
  /** lanelet2マップの車線境界(rvizの/map/vector_map_markerと同じソース)。ポリラインのリスト */
  lanelet_boundaries: [number, number][][];
  /** rvizのRobotModel(URDF)が使うvehicle_info.param.yaml由来の車体外形+4輪 */
  vehicle_model: VehicleModel | null;
}

export interface VehicleWheel {
  cx: number;
  cy: number;
  length: number;
  width: number;
  steerable: boolean;
}

export interface VehicleModel {
  body: [number, number][];
  wheels: VehicleWheel[];
}

export interface TrailPoint {
  x: number;
  y: number;
  speed: number;
  accel: number;
}

export type ServerMsg = TelemetryMsg | TrackMsg | MpcStatic;

/** rosbag から作った1フレーム(ライブの Telemetry の部分集合) */
export interface BagFrame {
  t: number;
  pose: { x: number; y: number; yaw_deg: number };
  twist: { vx: number; vy: number; yaw_rate: number };
  speed_mps: number;
  steer: { actual_deg: number; cmd_deg: number; max_deg: number };
  accel: { cmd_mps2: number; speed_cmd_mps: number; actual_mps2: number };
  gear: string;
  session: Telemetry["session"];
  mpc: MpcDebug | null;
  v2x: V2XVehicle[];
  /**
   * 車両コンディション(`/aichallenge/pitstop/condition`)。
   * 急に増えたらペナルティを食っている。bag に無ければ null。
   */
  condition: number | null;
}

/**
 * bag を「コース図と同じ座標」に載せるために要る静的データ。
 * 原点が食い違うとコースと軌跡が丸ごとずれるので、必ずまとめて渡す。
 */
export interface TrackAssets {
  origin: [number, number];
  raceline: [number, number][];
  laneletBoundaries: [number, number][][];
  /** 壁距離場から抜いた境界点群。lanelet2 より実際の壁に近い */
  walls: [number, number][];
  vehicleHull: [number, number][];
}

/**
 * `<run>/d1-result-details.json`。**AWSIM の判定そのもの**。
 * これがあればペナルティは推定しなくてよい。
 */
export interface ResultDetails {
  vehicle_name?: string;
  vehicle_number?: number;
  finished?: boolean;
  lap_count?: number;
  laps?: number[];
  session_timeout?: number;
  penalty_count: number;
  penalty_total_seconds: number;
  penalty_events: {
    /** crash=追突 / wall=壁 / over=コースアウト */
    kind: string;
    lap: number;
    /** レース開始からの秒数 */
    race_time: number;
    /** 5km/h 制限が続く秒数(追突10s / 壁5s が基本) */
    duration: number;
  }[];
  penalty_by_kind?: Record<string, { count: number; total_seconds: number }>;
}

/** 読み込んだ rosbag 全体 */
export interface BagIndex {
  name: string;
  /** 全長[s] */
  duration: number;
  /** フレーム間隔[s] */
  dt: number;
  frames: BagFrame[];
  mpcStatic: MpcStatic | null;
  /** トピックごとのメッセージ数(何が入っている bag なのかの確認用) */
  topics: Record<string, number>;
  hasMpc: boolean;
  /** タイムラインに立てる事件(周回・壁接触・追突・追い越し) */
  events: BagEvent[];
  /** 周回の切り替わり時刻[s]。先頭は常に0(Lap1の開始) */
  laps: number[];
  /** 周回が /awsim/status 由来か(false なら弧長からの推定) */
  lapsFromStatus: boolean;
  /** AWSIM の判定(result-details.json)。一緒に読み込めたときだけ */
  results: ResultDetails | null;
  /**
   * bag の時刻(先頭からの秒)を race_time に直すオフセット。
   * `race_time = t - raceT0`。/awsim/status から求める。求まらなければ null。
   */
  raceT0: number | null;
}

export interface HistorySample {
  t: number;
  steerActual: number;
  steerCmd: number;
  accelCmd: number;
  accelActual: number;
  speed: number;
  /** MPCの最良コスト。届いていないstepは null */
  cost: number | null;
  /** 横オフセット指令[m](追い越しでラインからどれだけ外したか) */
  offCmd: number | null;
  /** 壁までの余裕[m] */
  clearance: number | null;
  /** 縦の上限[m/s]。掛かっていないstepは null */
  vCap: number | null;
  /** 1stepの計算時間[ms]。100msを超えると制御周期を割る */
  stepMs: number | null;
}
