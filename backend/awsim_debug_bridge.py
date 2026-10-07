#!/usr/bin/env python3
"""AWSIM実車/MPCコントローラのデバッグダッシュボード用ブリッジ。

rclpyで以下を購読し、テレメトリをWebSocket(JSON)でブラウザへ配信する。

  車両・セッション(RL時代からの基本セット)
  - /localization/kinematic_state (Odometry): 自己位置推定(x,y,yaw,速度)
  - /vehicle/status/steering_status (SteeringReport): 実舵角
  - /control/command/control_cmd (AckermannControlCommand): 指令舵角/加速度
  - /control/command/gear_cmd (GearCommand): 指令ギア
  - /sensing/imu/imu_data (Imu): 実加速度
  - /awsim/status (Float32MultiArray): セッション残時間/周回/ブースト等
  - /admin/awsim/state (String): 大会進行状態(TRANSIENT_LOCAL)
  - /rl_raceline/debug (Float32MultiArray): コントローラの復帰状態など

  MPC(いま実際に走っているサンプリングMPCの中身)
  - /rl_raceline/mpc_static (Float32MultiArray, TRANSIENT_LOCAL):
      参照経路・通れる回廊・速度プロファイル・重みとゲートの設定値
  - /rl_raceline/mpc_debug (Float32MultiArray): 毎stepの
      選ばれた予測軌跡 / 舵候補ごとの予測とコスト / ホライズン上の参照点 /
      横にずらした参照線 / 相手の予測位置(分岐込み) / ゲートと計画の状態
  - /v2x/vehicle_positions (V2XVehiclePositionArray): 相手の実位置

フロントエンド(React)はここへWebSocket接続してリアルタイム表示する。
このスクリプト自体はROS2 + rclpyがsourceされたコンテナ内(amd64 Autoware環境)で実行する。

使い方:
    ROS_DOMAIN_ID=1 python3 awsim_debug_bridge.py --port 8765 \
        --data-dir ../../../../workspace/src/aichallenge_submit/rl_raceline_controller/data
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import threading
import time
from pathlib import Path
from typing import Optional

import numpy as np
import rclpy
import rclpy.executors
from rclpy.node import Node
from rclpy.qos import DurabilityPolicy, HistoryPolicy, QoSProfile, ReliabilityPolicy

from autoware_auto_control_msgs.msg import AckermannControlCommand
from autoware_auto_vehicle_msgs.msg import GearCommand, SteeringReport
from nav_msgs.msg import Odometry
from sensor_msgs.msg import Imu
from std_msgs.msg import Float32MultiArray, String

import websockets
from websockets.server import WebSocketServerProtocol

import mpc_payload
import telemetry_payload
from telemetry_payload import TopicHealth
from track_assets import (
    load_lanelet2_boundaries,
    load_raceline,
    load_vehicle_hull,
    load_vehicle_model,
    load_wall_boundary,
)

# V2X(相手のground-truth位置)。単独走行の環境では入っていないこともあるので
# 無ければ購読ごと諦める(MPCの内部状態表示は相手が居なくても成立する)。
try:
    from v2x_msgs.msg import V2XVehiclePositionArray
except ImportError:
    V2XVehiclePositionArray = None

# /awsim/status (Float32MultiArray) のフィールド順。node/awsim_env_node.py の定義と一致させる。
AWSIM_STATUS_FIELDS = (
    "session_time",
    "lap_count",
    "lap_time",
    "section",
    "time_scale",
    "boost_remaining",
    "is_boosting",
)

MAX_STEER_RAD = 0.5236  # 実車ステア角上限(30deg)。rl_raceline_controller_node.py と一致。


def quat_to_yaw(z: float, w: float) -> float:
    """z,w以外は水平面走行なので0とみなせる平面ヨー角(rad)。"""
    return math.atan2(2.0 * w * z, 1.0 - 2.0 * z * z)


class WallContactDetector:
    """実車Colliderの凸包の各頂点から、lanelet2境界線(rvizの/map/vector_map_markerと同じ
    ソース)までの最短距離で接触を検出する。壁距離場(点群)由来のグリッドより線分ベースの
    lanelet境界のほうが実際の当たり判定に近いことが実走行で確認されたため、こちらを採用する。
    連続接触はスロットルして1回のマーカーにまとめる。
    """

    def __init__(
        self,
        boundary_segments: list[list[float]],
        hull_long_lat: list[list[float]],
        contact_threshold_m: float,
    ) -> None:
        # (M,2) x2: 各線分の始点・終点(world絶対座標)。ベクトル化した点-線分距離計算に使う。
        self._p1 = np.array([s[0] for s in boundary_segments], dtype=np.float64)
        self._p2 = np.array([s[1] for s in boundary_segments], dtype=np.float64)
        self._seg = self._p2 - self._p1
        self._seg_len2 = np.maximum((self._seg**2).sum(axis=1), 1e-9)
        self._hull = hull_long_lat
        self._threshold = contact_threshold_m
        self._last_marker_t: Optional[float] = None
        self._last_marker_xy: Optional[tuple[float, float]] = None

    def _sample(self, x: float, y: float) -> float:
        if len(self._p1) == 0:
            return float("inf")
        t = ((x - self._p1[:, 0]) * self._seg[:, 0] + (y - self._p1[:, 1]) * self._seg[:, 1]) / self._seg_len2
        t = np.clip(t, 0.0, 1.0)
        proj_x = self._p1[:, 0] + t * self._seg[:, 0]
        proj_y = self._p1[:, 1] + t * self._seg[:, 1]
        return float(np.hypot(x - proj_x, y - proj_y).min())

    def check(self, x_abs: float, y_abs: float, yaw_rad: float, now: float) -> Optional[dict]:
        """world絶対座標(origin減算前)での接触判定。マーカーを立てるべきなら
        {"min_dist": float} を返す(呼び出し側で座標を相対化して記録する)。"""
        cos_y, sin_y = math.cos(yaw_rad), math.sin(yaw_rad)
        min_dist = float("inf")
        for lon, lat in self._hull:
            wx = x_abs + lon * cos_y - lat * sin_y
            wy = y_abs + lon * sin_y + lat * cos_y
            d = self._sample(wx, wy)
            if d < min_dist:
                min_dist = d
        if min_dist > self._threshold:
            return None
        # 同じ接触が続く間は1個のマーカーに間引く(1.5秒 or 3m以上離れたら新規扱い)。
        if self._last_marker_t is not None:
            dt = now - self._last_marker_t
            dx = x_abs - (self._last_marker_xy[0] if self._last_marker_xy else x_abs)
            dy = y_abs - (self._last_marker_xy[1] if self._last_marker_xy else y_abs)
            if dt < 1.5 and (dx * dx + dy * dy) < 3.0 * 3.0:
                return None
        self._last_marker_t = now
        self._last_marker_xy = (x_abs, y_abs)
        return {"min_dist": round(min_dist, 4)}


class DebugBridgeNode(Node):
    def __init__(
        self,
        origin_xy: Optional[tuple[float, float]],
        wall_contact_detector: Optional[WallContactDetector] = None,
        raceline: Optional[list[list[float]]] = None,
        context=None,
        domain_id: int = 1,
    ) -> None:
        # 複数ドメインを1プロセスで見るので、ノード名がぶつからないようにする。
        super().__init__(f"awsim_debug_bridge_d{domain_id}", context=context)
        self.domain_id = domain_id
        self._origin_x, self._origin_y = origin_xy or (0.0, 0.0)
        self._lock = threading.Lock()
        self._wall_contact_detector = wall_contact_detector
        self._wall_markers: list[dict] = []
        # rl_raceline_controllerが/rl_raceline/debugで送ってくる「レースラインindex」を
        # 実座標に変換するための参照(origin減算済み、track messageのracelineと同じ配列)。
        self._raceline = raceline or []
        self._raceline_idx_marker: Optional[dict] = None
        # RL観測に入っている6ルックアヘッド(3/6/10/15/22/30m)のワールド座標点。
        self._rl_lookahead_points: list[list[float]] = []

        self._health = {
            "kinematic_state": TopicHealth(),
            "steering_status": TopicHealth(),
            "control_cmd": TopicHealth(),
            "gear_cmd": TopicHealth(),
            "awsim_status": TopicHealth(),
            "admin_state": TopicHealth(),
            "rl_debug": TopicHealth(),
            "imu": TopicHealth(),
            "mpc_debug": TopicHealth(),
            "mpc_static": TopicHealth(),
            "v2x": TopicHealth(),
        }

        # MPC の中身。mpc_static は latched なので接続順に依存せず1回だけ来る。
        # ただし **ブラウザ側にはWebSocketで別途配る必要がある**。track と同じ
        # 静的データだが、届くのが接続の後になり得るので世代番号で追う。
        self._mpc_static: Optional[dict] = None
        self._mpc_static_seq = 0
        self._mpc: Optional[dict] = None
        # スキーマ版が食い違ったときはUIに出す(黙って古い並びで読むと
        # 「値は出ているが全部ずれている」というもっとも厄介な壊れ方になる)。
        self._mpc_schema_warn: Optional[str] = None
        # V2X の生の相手位置(コントローラの解釈を通さない素の値)。
        self._v2x: list[dict] = []

        self._pose = {"x": 0.0, "y": 0.0, "yaw_deg": 0.0}
        self._twist = {"vx": 0.0, "vy": 0.0, "yaw_rate": 0.0}
        self._steer_actual_deg = 0.0
        self._steer_cmd_deg = 0.0
        self._accel_cmd = 0.0
        self._accel_actual = 0.0  # /sensing/imu/imu_data の実測 linear_acceleration.x[m/s^2]
        self._speed_cmd = 0.0
        self._gear_name = "?"
        self._gear_names_by_value = self._build_gear_name_map()
        self._awsim_status = {k: 0.0 for k in AWSIM_STATUS_FIELDS}
        self._admin_state = ""
        # ラップタイム履歴。lap_count(周回数)が変わった瞬間に、直前まで見えていたlap_time
        # (=完走したラップの所要時間)を確定値として積む。
        self._lap_history: list[dict] = []
        self._prev_lap_count: Optional[int] = None
        self._prev_lap_time: float = 0.0

        # 各トピックの生値(未加工のメッセージフィールド)。UI側でHz/経過時間と並べて表示する。
        self._raw: dict[str, dict] = {
            "kinematic_state": {},
            "steering_status": {},
            "control_cmd": {},
            "gear_cmd": {},
            "awsim_status": {},
            "admin_state": {},
            "rl_debug": {},
            "imu": {},
            "mpc_debug": {},
            "mpc_static": {},
            "v2x": {},
        }

        bv = QoSProfile(reliability=ReliabilityPolicy.BEST_EFFORT, history=HistoryPolicy.KEEP_LAST, depth=1)
        rel = QoSProfile(reliability=ReliabilityPolicy.RELIABLE, history=HistoryPolicy.KEEP_LAST, depth=1)
        transient = QoSProfile(
            reliability=ReliabilityPolicy.RELIABLE,
            history=HistoryPolicy.KEEP_LAST,
            depth=1,
            durability=DurabilityPolicy.TRANSIENT_LOCAL,
        )

        self.create_subscription(Odometry, "/localization/kinematic_state", self._cb_kinematic, bv)
        self.create_subscription(SteeringReport, "/vehicle/status/steering_status", self._cb_steering, bv)
        self.create_subscription(AckermannControlCommand, "/control/command/control_cmd", self._cb_control_cmd, rel)
        self.create_subscription(GearCommand, "/control/command/gear_cmd", self._cb_gear_cmd, rel)
        self.create_subscription(Float32MultiArray, "/awsim/status", self._cb_awsim_status, bv)
        self.create_subscription(String, "/admin/awsim/state", self._cb_admin_state, transient)
        self.create_subscription(Float32MultiArray, "/rl_raceline/debug", self._cb_rl_debug, rel)
        self.create_subscription(Imu, "/sensing/imu/imu_data", self._cb_imu, bv)
        # MPC の内部状態。debug は毎step来るので BEST_EFFORT、
        # static は起動時に1回だけなので TRANSIENT_LOCAL(後から繋いでも届く)。
        self.create_subscription(
            Float32MultiArray, "/rl_raceline/mpc_debug", self._cb_mpc_debug, bv)
        self.create_subscription(
            Float32MultiArray, "/rl_raceline/mpc_static", self._cb_mpc_static, transient)
        if V2XVehiclePositionArray is not None:
            self.create_subscription(
                V2XVehiclePositionArray, "/v2x/vehicle_positions", self._cb_v2x, bv)
        else:
            self.get_logger().warn(
                "v2x_msgs が無いので /v2x/vehicle_positions は購読しない"
                "(相手の実位置は出ないが、MPCが見ている相手の予測は出る)")

        self.get_logger().info(
            "awsim_debug_bridge ready: localization/control/status + MPC internals")

    @staticmethod
    def _build_gear_name_map() -> dict[int, str]:
        return telemetry_payload.gear_name_map(GearCommand)

    def _cb_kinematic(self, msg: Odometry) -> None:
        p = msg.pose.pose
        t = msg.twist.twist
        yaw = quat_to_yaw(p.orientation.z, p.orientation.w)
        with self._lock:
            self._pose = {
                "x": p.position.x - self._origin_x,
                "y": p.position.y - self._origin_y,
                "yaw_deg": math.degrees(yaw),
            }
            self._twist = {
                "vx": t.linear.x,
                "vy": t.linear.y,
                "yaw_rate": t.angular.z,
            }
            self._raw["kinematic_state"] = {
                "position.x": p.position.x,
                "position.y": p.position.y,
                "position.z": p.position.z,
                "orientation.x": p.orientation.x,
                "orientation.y": p.orientation.y,
                "orientation.z": p.orientation.z,
                "orientation.w": p.orientation.w,
                "twist.linear.x": t.linear.x,
                "twist.linear.y": t.linear.y,
                "twist.linear.z": t.linear.z,
                "twist.angular.x": t.angular.x,
                "twist.angular.y": t.angular.y,
                "twist.angular.z": t.angular.z,
            }
            self._health["kinematic_state"].mark()

            if self._wall_contact_detector is not None:
                hit = self._wall_contact_detector.check(
                    p.position.x, p.position.y, yaw, time.monotonic()
                )
                if hit is not None:
                    marker = {
                        "t": time.monotonic(),
                        "x": p.position.x - self._origin_x,
                        "y": p.position.y - self._origin_y,
                        "min_dist": hit["min_dist"],
                    }
                    self._wall_markers.append(marker)
                    if len(self._wall_markers) > 500:
                        self._wall_markers.pop(0)
                    self.get_logger().warn(
                        f"wall contact suspected at ({marker['x']:.2f}, {marker['y']:.2f}), "
                        f"min_dist={hit['min_dist']:.3f}m"
                    )

    def _cb_steering(self, msg: SteeringReport) -> None:
        with self._lock:
            self._steer_actual_deg = math.degrees(float(msg.steering_tire_angle))
            self._raw["steering_status"] = {
                "steering_tire_angle": float(msg.steering_tire_angle),
            }
            self._health["steering_status"].mark()

    def _cb_control_cmd(self, msg: AckermannControlCommand) -> None:
        with self._lock:
            self._steer_cmd_deg = math.degrees(float(msg.lateral.steering_tire_angle))
            self._accel_cmd = float(msg.longitudinal.acceleration)
            self._speed_cmd = float(msg.longitudinal.speed)
            self._raw["control_cmd"] = {
                "lateral.steering_tire_angle": float(msg.lateral.steering_tire_angle),
                "lateral.steering_tire_rotation_rate": float(msg.lateral.steering_tire_rotation_rate),
                "longitudinal.speed": float(msg.longitudinal.speed),
                "longitudinal.acceleration": float(msg.longitudinal.acceleration),
                "longitudinal.jerk": float(msg.longitudinal.jerk),
            }
            self._health["control_cmd"].mark()

    def _cb_gear_cmd(self, msg: GearCommand) -> None:
        with self._lock:
            self._gear_name = self._gear_names_by_value.get(int(msg.command), f"UNKNOWN({msg.command})")
            self._raw["gear_cmd"] = {"command": int(msg.command)}
            self._health["gear_cmd"].mark()

    def _cb_awsim_status(self, msg: Float32MultiArray) -> None:
        d = list(msg.data)
        with self._lock:
            for idx, field in enumerate(AWSIM_STATUS_FIELDS):
                self._awsim_status[field] = float(d[idx]) if len(d) > idx else 0.0
            self._raw["awsim_status"] = dict(self._awsim_status)
            self._health["awsim_status"].mark()

            new_lap_count = int(self._awsim_status["lap_count"])
            if self._prev_lap_count is not None and new_lap_count != self._prev_lap_count:
                self._lap_history.append(
                    {"lap": self._prev_lap_count, "time": round(self._prev_lap_time, 3)}
                )
                if len(self._lap_history) > 200:
                    self._lap_history.pop(0)
            self._prev_lap_count = new_lap_count
            self._prev_lap_time = self._awsim_status["lap_time"]

    def _cb_admin_state(self, msg: String) -> None:
        with self._lock:
            self._admin_state = msg.data or ""
            self._raw["admin_state"] = {"state": self._admin_state}
            self._health["admin_state"].mark()

    def _cb_imu(self, msg: Imu) -> None:
        with self._lock:
            self._accel_actual = float(msg.linear_acceleration.x)
            self._raw["imu"] = {
                "linear_acceleration.x": msg.linear_acceleration.x,
                "linear_acceleration.y": msg.linear_acceleration.y,
                "linear_acceleration.z": msg.linear_acceleration.z,
                "angular_velocity.z": msg.angular_velocity.z,
            }
            self._health["imu"].mark()

    def _cb_rl_debug(self, msg: Float32MultiArray) -> None:
        """/rl_raceline/debug。並びの解釈は telemetry_payload.decode_rl_debug。

        ここは「受けて詰め替えるだけ」にする。同じ配列をゲーム側
        (racing_game/server/dashboard_feed.py)も読むので、解釈を持つと
        2箇所で別の意味になる。
        """
        with self._lock:
            out = telemetry_payload.decode_rl_debug(
                msg.data, self._pose, self._raceline)
            self._raw["rl_debug"] = out["raw"]
            self._rl_lookahead_points = out["lookahead_points"]
            self._raceline_idx_marker = out["raceline_idx_marker"]
            self._health["rl_debug"].mark()

    # ---- MPC(サンプリングMPCの中身) ----
    # 並びの定義は mpc_payload.py。ここは受けて詰め替えるだけにする。

    def _cb_mpc_static(self, msg: Float32MultiArray) -> None:
        d = mpc_payload.decode_static(msg.data, (self._origin_x, self._origin_y))
        with self._lock:
            self._health["mpc_static"].mark()
            if d is None:
                self._raw["mpc_static"] = {"error": "短すぎるか壊れている"}
                return
            if "schema_mismatch" in d:
                self._mpc_schema_warn = (
                    f"mpc_static のスキーマ版が {d['schema_mismatch']} "
                    f"(ダッシュボードは {mpc_payload.SCHEMA})。"
                    "コントローラとバックエンドの片方だけが新しい。")
                self._raw["mpc_static"] = {"error": self._mpc_schema_warn}
                return
            self._mpc_static = d
            self._mpc_static_seq += 1
            # 生値パネルには「設定値」だけを出す(配列は地図に描く)。
            self._raw["mpc_static"] = {
                k: v for k, v in d.items()
                if not isinstance(v, (list, dict))
            }

    def mpc_static_payload(self) -> tuple[int, Optional[dict]]:
        with self._lock:
            return self._mpc_static_seq, self._mpc_static

    def _cb_mpc_debug(self, msg: Float32MultiArray) -> None:
        d = mpc_payload.decode_debug(msg.data, (self._origin_x, self._origin_y))
        with self._lock:
            self._health["mpc_debug"].mark()
            if d is None:
                self._raw["mpc_debug"] = {"error": "短すぎるか壊れている"}
                return
            if "schema_mismatch" in d:
                self._mpc_schema_warn = (
                    f"mpc_debug のスキーマ版が {d['schema_mismatch']} "
                    f"(ダッシュボードは {mpc_payload.SCHEMA})。")
                self._raw["mpc_debug"] = {"error": self._mpc_schema_warn}
                return
            self._mpc = d
            self._raw["mpc_debug"] = mpc_payload.raw_rows(d)

    def _cb_v2x(self, msg) -> None:
        """相手の実位置。コントローラの推定(mpc_debug の opp)と並べて出す。

        両方を出すのが要点。コントローラが持っている s / 速度は V2X の位置差分
        から自前で推定した値なので、実位置と食い違っていれば「相手を見失って
        いる」ことがその場で分かる。
        """
        out = []
        for veh in msg.vehicles:
            out.append({
                "id": str(veh.vehicle_id),
                "x": round(float(veh.position.x) - self._origin_x, 3),
                "y": round(float(veh.position.y) - self._origin_y, 3),
            })
        with self._lock:
            self._v2x = out
            self._raw["v2x"] = {"vehicles": len(out)}
            for v in out:
                self._raw["v2x"][v["id"]] = f'({v["x"]:.1f}, {v["y"]:.1f})'
            self._health["v2x"].mark()

    def snapshot(self) -> dict:
        now = time.monotonic()
        with self._lock:
            return {
                "type": "telemetry",
                "t": now,
                "pose": dict(self._pose),
                "twist": dict(self._twist),
                "speed_mps": self._twist["vx"],
                "steer": {
                    "actual_deg": self._steer_actual_deg,
                    "cmd_deg": self._steer_cmd_deg,
                    "max_deg": math.degrees(MAX_STEER_RAD),
                },
                "accel": {
                    "cmd_mps2": self._accel_cmd,
                    "speed_cmd_mps": self._speed_cmd,
                    "actual_mps2": self._accel_actual,
                },
                "gear": self._gear_name,
                "session": dict(self._awsim_status),
                "admin_state": self._admin_state,
                "wall_markers": list(self._wall_markers),
                "raceline_idx_marker": self._raceline_idx_marker,
                "rl_lookahead_points": list(self._rl_lookahead_points),
                "lap_history": list(self._lap_history),
                # MPC の中身。まだ1本も届いていない間は null(UI側で「待機中」表示)
                "mpc": self._mpc,
                "v2x": list(self._v2x),
                "mpc_schema_warn": self._mpc_schema_warn,
                "topics": {
                    name: {**health.snapshot(now), "raw": self._raw.get(name, {})}
                    for name, health in self._health.items()
                },
            }


# コースの静的データ(レースライン・壁・車線境界・車体形状)の読み込みは
# track_assets.py へ移した。ROS に依存しないので、bag をブラウザだけで開く
# ための track.json 書き出しにも同じコードを使える。


class BridgeServer:
    """複数台ぶんのノードをまとめて1つのWebSocketで配る。

    3台走行は **1台につき1つの ROS_DOMAIN_ID**(run_3car_video.sh: d1=1 / d2=2 /
    d3=3)。ドメインが違えばトピック名は同じでも別物なので、購読する側は
    ドメインごとに context を分ける必要がある。ポートやプロセスを台数ぶん
    増やすより、1プロセスが全ドメインを持って1本のWebSocketで配るほうが、
    ブラウザ側で **同じ瞬間の3台を並べて見られる**(誰が誰を避けたのかは
    別々の画面では追えない)。
    """

    def __init__(
        self,
        nodes: dict[int, DebugBridgeNode],
        track_payload: dict,
        hz: float,
    ) -> None:
        self._nodes = nodes
        self._interval = 1.0 / hz
        self._clients: set[WebSocketServerProtocol] = set()
        # 壁・車体形状・レーン境界は静的データなので接続のたびに再エンコードせず、起動時に一度だけJSON化しておく。
        self._track_payload = json.dumps({**track_payload, "domains": sorted(nodes)})
        # MPC の静的データ(参照経路・回廊)。コントローラの起動待ちなので
        # 接続より後に来ることがある。ドメインごとに、届いた世代とJSONを持つ。
        self._mpc_static_seq: dict[int, int] = {d: 0 for d in nodes}
        self._mpc_static_payload: dict[int, str] = {}

    def _refresh_mpc_static(self) -> list[str]:
        """新しい mpc_static が来ているドメインぶんだけJSONを作り直す。"""
        fresh: list[str] = []
        for d, node in self._nodes.items():
            seq, data = node.mpc_static_payload()
            if data is None or seq == self._mpc_static_seq[d]:
                continue
            self._mpc_static_seq[d] = seq
            self._mpc_static_payload[d] = json.dumps(
                {"type": "mpc_static", "domain": d, **data})
            fresh.append(self._mpc_static_payload[d])
        return fresh

    async def _handler(self, ws: WebSocketServerProtocol) -> None:
        self._clients.add(ws)
        try:
            await ws.send(self._track_payload)
            self._refresh_mpc_static()
            for payload in self._mpc_static_payload.values():
                await ws.send(payload)
            async for _ in ws:
                pass  # クライアントからの入力は無し(受信専用ダッシュボード)
        except websockets.ConnectionClosed:
            pass
        finally:
            self._clients.discard(ws)

    def _telemetry_payload(self) -> str:
        vehicles = []
        for d, node in sorted(self._nodes.items()):
            snap = node.snapshot()
            snap["domain"] = d
            vehicles.append(snap)
        return json.dumps({
            "type": "telemetry",
            "t": vehicles[0]["t"] if vehicles else 0.0,
            "vehicles": vehicles,
        })

    async def _broadcast_loop(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            if not self._clients:
                continue
            payloads = self._refresh_mpc_static()
            payloads.append(self._telemetry_payload())
            stale = []
            for ws in self._clients:
                try:
                    for payload in payloads:
                        await ws.send(payload)
                except websockets.ConnectionClosed:
                    stale.append(ws)
            for ws in stale:
                self._clients.discard(ws)

    async def run(self, host: str, port: int) -> None:
        async with websockets.serve(self._handler, host, port):
            first = next(iter(self._nodes.values()))
            first.get_logger().info(
                f"debug dashboard websocket listening on ws://{host}:{port} "
                f"(domains: {sorted(self._nodes)})")
            await self._broadcast_loop()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--hz", type=float, default=20.0, help="ブラウザへの配信レート")
    parser.add_argument(
        "--data-dir",
        default=str(
            Path.cwd() / "aichallenge"
            / "workspace/src/aichallenge_submit/rl_raceline_controller/data"
        ),
        help="raceline.csv を含むディレクトリ",
    )
    parser.add_argument(
        "--wall-contact-threshold",
        type=float,
        default=0.05,
        help="車体Collider頂点から壁までの距離がこれ以下ならマーカーを立てる(m, 既定=グリッド解像度)",
    )
    parser.add_argument(
        "--lanelet2-map",
        default=str(
            Path.cwd() / "aichallenge"
            / "workspace/src/aichallenge_submit/aichallenge_submit_launch/map/lanelet2_map.osm"
        ),
        help="rvizの/map/vector_map_markerと同じ.osmファイル。左右車線境界を枠として表示する",
    )
    parser.add_argument(
        "--vehicle-info-yaml",
        default=str(
            Path.cwd() / "aichallenge"
            / "workspace/src/aichallenge_submit/racing_kart_description/config/vehicle_info.param.yaml"
        ),
        help="rvizのRobotModel表示が使うのと同じ車両諸元ファイル。車体外形+4輪を描画する",
    )
    parser.add_argument(
        "--domains",
        default=os.environ.get("DASHBOARD_DOMAINS", ""),
        help="購読する ROS_DOMAIN_ID をカンマ区切りで(例 1,2,3)。"
             "3台走行は1台=1ドメイン(run_3car_video.sh の d1/d2/d3 = 1/2/3)。"
             "未指定なら ROS_DOMAIN_ID(既定1)の1台だけ",
    )
    args = parser.parse_args()

    if args.domains.strip():
        domains = [int(x) for x in args.domains.split(",") if x.strip()]
    else:
        domains = [int(os.environ.get("ROS_DOMAIN_ID", "1"))]

    data_dir = Path(args.data_dir)
    raceline = load_raceline(data_dir)
    origin = tuple(raceline[0]) if raceline else None
    if origin:
        raceline = [[x - origin[0], y - origin[1]] for x, y in raceline]
    walls = load_wall_boundary(data_dir, origin or (0.0, 0.0))
    vehicle_hull = load_vehicle_hull(data_dir)
    lanelet_boundaries = load_lanelet2_boundaries(Path(args.lanelet2_map), origin or (0.0, 0.0))
    # 接触判定はkinematic_stateのworld絶対座標(origin減算前)で行うため、境界も絶対座標で別途持つ。
    lanelet_boundaries_abs = load_lanelet2_boundaries(Path(args.lanelet2_map), (0.0, 0.0))
    vehicle_model = load_vehicle_model(Path(args.vehicle_info_yaml))

    boundary_segments = [
        [line[i], line[i + 1]] for line in lanelet_boundaries_abs for i in range(len(line) - 1)
    ]
    detector = None
    if boundary_segments and vehicle_hull:
        detector = WallContactDetector(
            boundary_segments,
            vehicle_hull,
            args.wall_contact_threshold,
        )

    # ドメインごとに context を分ける。**プロセスの ROS_DOMAIN_ID を変えるのでは
    # 足りない**(1プロセスは1ドメインにしか入れない、という制約は context 単位で
    # 解ける)。壁接触の検出器は状態を持つので台数ぶん作る。
    nodes: dict[int, DebugBridgeNode] = {}
    contexts: list = []
    for d in domains:
        ctx = rclpy.Context()
        rclpy.init(context=ctx, domain_id=d)
        contexts.append(ctx)
        det = None
        if boundary_segments and vehicle_hull:
            det = WallContactDetector(
                boundary_segments, vehicle_hull, args.wall_contact_threshold)
        node = DebugBridgeNode(
            origin_xy=origin, wall_contact_detector=det, raceline=raceline,
            context=ctx, domain_id=d)
        nodes[d] = node
        ex = rclpy.executors.SingleThreadedExecutor(context=ctx)
        ex.add_node(node)
        threading.Thread(target=ex.spin, daemon=True).start()

    server = BridgeServer(
        nodes,
        {
            "type": "track",
            # 座標原点(world絶対座標)。rosbag をこの図に重ねるときに要る。
            "origin": list(origin) if origin else [0.0, 0.0],
            "raceline": raceline,
            "walls": walls,
            "vehicle_hull": vehicle_hull,
            "lanelet_boundaries": lanelet_boundaries,
            "vehicle_model": vehicle_model,
        },
        args.hz,
    )
    try:
        asyncio.run(server.run(args.host, args.port))
    except KeyboardInterrupt:
        pass
    finally:
        for node in nodes.values():
            node.destroy_node()
        for ctx in contexts:
            if ctx.ok():
                rclpy.shutdown(context=ctx)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
