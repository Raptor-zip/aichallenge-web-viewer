"""ダッシュボードのテレメトリを組み立てる、ROS に依存しない部品。

読む側が2つある:

  1. `awsim_debug_bridge.py`            … 実機/AWSIM のトピックを購読して配信する
  2. `racing_game/server/dashboard_feed.py` … ROS 無しのレースゲームから同じ形で配信する

表示側(フロントエンド)は1つなので、詰め替える側で並びや語彙がずれると、
同じ画面が場面によって別の意味を持つことになる。`mpc_payload.py` が MPC
トピックの並びを1箇所に寄せているのと同じ理由で、こちらは
「MPC 以外の、画面が要求する部分」を1箇所に寄せる。

ROS に依存しないので単体でテストできる。
"""
from __future__ import annotations

import math
import time
from collections import deque
from typing import Optional

import mpc_payload

# rl_raceline_controller_node.py の LOOKAHEAD_DISTANCES_M / NORM_* と一致させる
# (観測ベクトルの中身をここで解釈するため)。
OBS_LOOKAHEAD_M = (3.0, 6.0, 10.0, 15.0, 22.0, 30.0)
OBS_NORM_LOOKAHEAD_X = 30.0
OBS_NORM_LOOKAHEAD_Y = 12.0


class TopicHealth:
    """1つの発生源の最終受信時刻と実測Hzを保持する。

    実機ではトピックの受信、ゲームでは publisher シンクへの publish が
    「発生」に当たる。どちらも `mark()` を呼ぶ側が決める。
    """

    def __init__(self) -> None:
        self.last_wall = 0.0
        self._times: deque[float] = deque(maxlen=30)

    def mark(self, now: Optional[float] = None) -> None:
        t = time.monotonic() if now is None else float(now)
        self.last_wall = t
        self._times.append(t)

    def snapshot(self, now: float) -> dict:
        age_ms = None if self.last_wall == 0.0 else round((now - self.last_wall) * 1000.0, 1)
        hz = 0.0
        if len(self._times) >= 2:
            span = self._times[-1] - self._times[0]
            if span > 0:
                hz = (len(self._times) - 1) / span
        return {"age_ms": age_ms, "hz": round(hz, 1)}


def gear_name_map(gear_cls) -> dict[int, str]:
    """GearCommand の定数から {値: 名前} を作る。

    実機は autoware_auto_vehicle_msgs の本物、ゲームは mpc_offline の
    ROS スタブを渡す。どちらも大文字の int 定数という形は同じ。
    """
    return {
        value: name
        for name, value in vars(gear_cls).items()
        if name.isupper() and isinstance(value, int)
    }


def decode_rl_debug(data, pose: dict, raceline) -> dict:
    """/rl_raceline/debug (rl_raceline_controller_node.py) を画面用の形にする。

    [0]=復帰残りstep [1]=停止継続step [2]=復帰試行回数 [3]=復帰後退の操舵[rad]
    [4]=レースラインindex [5]=横ズレ[m] [6]=最近傍壁までの距離[m] [7]=PP残りstep
    [8]=制御モード [9]=実舵角[rad] [10]=実加速度[m/s^2] [11][12]=次stepの自己回帰入力
    [13]=ブースト残 [14]=ブースト中 [15:40]=方策への25次元観測ベクトル

    末尾拡張分が来ない旧バージョンのノードでもエラーにならないよう、各要素は
    len(d) を見てから読む。

    「idx」は上記[4]のこと。レースライン配列の何番目の点に最も近いかを表すだけの
    数字なので、その点の実座標(x,y)に変換して一緒に返す。

    pose は **origin 減算済み**の {"x","y","yaw_deg"}。raceline も同じ原点で
    相対化された配列であることが前提(食い違うと lookahead 点が丸ごとずれる)。
    """
    d = list(data or [])
    raceline = raceline or []

    raceline_idx = int(d[4]) if len(d) > 4 else -1
    idx_point: Optional[list[float]] = None
    if 0 <= raceline_idx < len(raceline):
        idx_point = list(raceline[raceline_idx])

    mode_code = int(d[8]) if len(d) > 8 else None
    raw: dict = {
        "recovery_remaining_steps": d[0] if len(d) > 0 else 0.0,
        "stall_steps": d[1] if len(d) > 1 else 0.0,
        "recovery_attempts": d[2] if len(d) > 2 else 0.0,
        "recovery_steer_rad": d[3] if len(d) > 3 else 0.0,
        "raceline_idx": raceline_idx,
        "raceline_idx_location": (
            f"x={idx_point[0]:.2f}, y={idx_point[1]:.2f}" if idx_point else "unresolved"
        ),
        "lateral_offset_m": d[5] if len(d) > 5 else 0.0,
        "wall_clearance_m": d[6] if len(d) > 6 else -1.0,
        "pure_pursuit_remaining_steps": d[7] if len(d) > 7 else 0.0,
    }

    lookahead_points_world: list[list[float]] = []
    if mode_code is not None:
        raw["control_mode"] = mpc_payload.MODE_NAMES.get(
            mode_code, f"unknown({mode_code})")
        raw["steer_out_rad"] = d[9] if len(d) > 9 else 0.0
        raw["accel_out_mps2"] = d[10] if len(d) > 10 else 0.0
        raw["prev_steer_action"] = d[11] if len(d) > 11 else 0.0
        raw["prev_accel_action"] = d[12] if len(d) > 12 else 0.0
        raw["boost_remaining"] = d[13] if len(d) > 13 else 0.0
        raw["is_boosting"] = d[14] if len(d) > 14 else 0.0

        obs = d[15:40]
        if len(obs) == 25:
            yaw_rad = math.radians(pose["yaw_deg"])
            cos_y, sin_y = math.cos(yaw_rad), math.sin(yaw_rad)
            for k, horizon_m in enumerate(OBS_LOOKAHEAD_M):
                x_local = obs[2 * k] * OBS_NORM_LOOKAHEAD_X
                y_local = obs[2 * k + 1] * OBS_NORM_LOOKAHEAD_Y
                label = f"lookahead_{horizon_m:g}m"
                raw[f"{label}_x_local"] = x_local
                raw[f"{label}_y_local"] = y_local
                wx = pose["x"] + x_local * cos_y - y_local * sin_y
                wy = pose["y"] + x_local * sin_y + y_local * cos_y
                lookahead_points_world.append([round(wx, 3), round(wy, 3)])
            raw["obs_lateral_offset"] = obs[12]
            raw["obs_heading_err_sin"] = obs[13]
            raw["obs_heading_err_cos"] = obs[14]
            raw["obs_speed_norm"] = obs[15]
            raw["obs_speed_err_norm"] = obs[16]
            raw["obs_steer_norm"] = obs[17]
            raw["obs_yaw_rate_norm"] = obs[18]
            raw["obs_prev_steer"] = obs[19]
            raw["obs_prev_accel"] = obs[20]
            raw["obs_left_margin_norm"] = obs[21]
            raw["obs_right_margin_norm"] = obs[22]
            raw["obs_boost_remaining_norm"] = obs[23]
            raw["obs_is_boosting"] = obs[24]

    return {
        "raw": raw,
        "lookahead_points": lookahead_points_world,
        "raceline_idx_marker": (
            {"idx": raceline_idx, "x": idx_point[0], "y": idx_point[1]}
            if idx_point else None
        ),
    }
