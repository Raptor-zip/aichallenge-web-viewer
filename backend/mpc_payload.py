"""Decode KSK MPC Float32MultiArray payloads without ROS.

The browser and this bridge share ../mpc_schema.json. See
../docs/MPC-PROTOCOL.md and ../scripts/make-demo.ts for a publisher example.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Optional

_SCHEMA_PATH = Path(__file__).resolve().parent.parent / "mpc_schema.json"
with _SCHEMA_PATH.open(encoding="utf-8") as _f:
    SPEC: dict = json.load(_f)

SCHEMA: int = SPEC["schema"]
PLAN_WHY: tuple[str, ...] = tuple(SPEC["enums"]["plan_why"])
STATIC_HDR: int = SPEC["static"]["header_len"]
DEBUG_HDR: int = SPEC["debug"]["header_len"]

# 「計画が立たなかった理由」を人が読める形にする。番号のままだと
# ダッシュボードを見ながらソースを引く羽目になる。
PLAN_WHY_JA = {
    "off": "計画OFF",
    "no_opp": "相手なし",
    "far": "遠い",
    "fast": "相手が速い",
    "slow": "自車が遅い",
    "nocatch": "追いつけない",
    "long": "区間が長すぎ",
    "noblk": "塞がれていない",
    # 「計画が立っていて、同じ相手に仕掛け継続中」の意味。
    # 「別の相手を処理中」と訳していたのは誤りで、
    # コントローラ側は _plan_pass_line の成功パスでこれを立てる。
    "busy": "仕掛け継続中",
    "ok": "並べる",
    "tight": "幅が足りない",
    "keep": "前回の計画を保持",
}

MODE_NAMES = {
    0: "RL方策",
    1: "リカバリ(REVERSE)",
    2: "PurePursuit復帰",
    3: "復帰直後の切り返し",
    4: "復帰直後の向き揃え",
    5: "PurePursuit(純古典)",
    6: "MPC",
    7: "レース開始前(待機)",
    # 8/9 は自己位置破綻(`_loc_bad`)の分岐。10 は P1 の制御モード門。
    8: "自己位置破綻(前後に揺する)",
    9: "自己位置破綻(惰行)",
    10: "非AUTONOMOUS(人間が握っている)",
    # 11/12 は P2 の打ち切り。どちらも accel=0 / steer=0 / DRIVE。
    11: "復帰の空振りで停止(P2)",
    12: "自己位置破綻(揺すり打ち切り)",
    # 13 は P4。後方に相手が居るあいだ後退しない(accel=0 / steer=0 / DRIVE)。
    13: "後方確認で後退待ち(P4)",
}


# ---------------------------------------------------------------- 汎用デコード

def _conv(raw: float, spec: dict, origin: tuple[float, float]):
    t = spec["type"]
    r = spec.get("round")
    v = float(raw)
    if t == "i":
        return int(round(v))
    if t == "b":
        return v > 0.5
    if t == "fpos":
        # 負は「掛かっていない」の意味。0 で埋めると別物になる。
        return None if v < 0 else round(v, r if r is not None else 3)
    if t == "wx":
        return round(v - origin[0], r if r is not None else 3)
    if t == "wy":
        return round(v - origin[1], r if r is not None else 3)
    if t.startswith("enum:"):
        names = SPEC["enums"][t.split(":", 1)[1]]
        i = int(round(v))
        return names[i] if 0 <= i < len(names) else "?"
    return round(v, r) if r is not None else v


def _set_path(out: dict, dotted: str, value) -> None:
    parts = dotted.split(".")
    node = out
    for p in parts[:-1]:
        node = node.setdefault(p, {})
    node[parts[-1]] = value


def _read_header(data, hdr_spec: list, origin) -> dict:
    out: dict = {}
    for i, spec in enumerate(hdr_spec):
        _set_path(out, spec["name"], _conv(data[i], spec, origin))
    return out


class _Cursor:
    """先頭から順に読み進めるだけの薄いカーソル。"""

    def __init__(self, data, pos: int, origin: tuple[float, float]) -> None:
        self.d = data
        self.p = pos
        self.origin = origin

    def xy(self, n: int) -> list:
        """x を n 個 → y を n 個、の並び(インターリーブではない)。"""
        xs = self.d[self.p:self.p + n]; self.p += n
        ys = self.d[self.p:self.p + n]; self.p += n
        ox, oy = self.origin
        return [[round(float(a) - ox, 3), round(float(b) - oy, 3)]
                for a, b in zip(xs, ys)]

    def scalars(self, n: int, r: Optional[int]) -> list:
        vs = self.d[self.p:self.p + n]; self.p += n
        return [round(float(v), r) if r is not None else float(v) for v in vs]

    def fields(self, specs: list) -> dict:
        out: dict = {}
        for spec in specs:
            _set_path(out, spec["name"], _conv(self.d[self.p], spec, self.origin))
            self.p += 1
        return out


def _section_len(sec: dict, counts: dict) -> int:
    n = counts[sec["count"]]
    kind = sec["kind"]
    if kind == "xy":
        return 2 * n
    if kind == "scalar":
        return n
    per = len(sec["fields"])
    tr = sec.get("trailing")
    if tr:
        per += 2 * counts[tr["count"]]
    return per * n


def _read_sections(cur: _Cursor, specs: list, counts: dict, out: dict) -> None:
    for sec in specs:
        n = counts[sec["count"]]
        kind = sec["kind"]
        if kind == "xy":
            out[sec["name"]] = cur.xy(n)
        elif kind == "scalar":
            out[sec["name"]] = cur.scalars(n, sec.get("round"))
        else:
            recs = []
            tr = sec.get("trailing")
            for _ in range(n):
                rec = cur.fields(sec["fields"])
                if tr:
                    rec[tr["name"]] = cur.xy(counts[tr["count"]])
                recs.append(rec)
            out[sec["name"]] = recs


def _version_ok(data, out: dict) -> Optional[dict]:
    if out["_version"] != SCHEMA:
        return {"schema_mismatch": out["_version"]}
    del out["_version"]
    return None


# ---------------------------------------------------------------- 公開API

def decode_static(data, origin: tuple[float, float]) -> Optional[dict]:
    """latched な /rl_raceline/mpc_static を辞書にする。

    origin はダッシュボードが全体で使っている座標原点(raceline.csv の先頭点)。
    ここで引いておかないと、フロントの他のレイヤ(壁・レースライン)と重ならない。
    """
    spec = SPEC["static"]
    if len(data) < STATIC_HDR:
        return None
    out = _read_header(data, spec["header"], origin)
    bad = _version_ok(data, out)
    if bad:
        return bad
    counts = {"n": out["n"]}
    need = STATIC_HDR + sum(_section_len(b, counts) for b in spec["blocks"])
    if out["n"] <= 0 or len(data) < need:
        return None
    _read_sections(_Cursor(data, STATIC_HDR, origin), spec["blocks"], counts, out)
    return out


def decode_debug(data, origin: tuple[float, float]) -> Optional[dict]:
    """毎stepの /rl_raceline/mpc_debug を辞書にする。"""
    spec = SPEC["debug"]
    if len(data) < DEBUG_HDR:
        return None
    out = _read_header(data, spec["header"], origin)
    bad = _version_ok(data, out)
    if bad:
        return bad
    counts = {"horizon": out["horizon"], "n_cand": out["n_cand"],
              "n_opp_pred": out["n_opp_pred"], "n_opp_raw": out["n_opp_raw"]}
    need = DEBUG_HDR + sum(_section_len(s, counts) for s in spec["sections"])
    if out["horizon"] <= 0 or len(data) < need:
        return None
    _read_sections(_Cursor(data, DEBUG_HDR, origin), spec["sections"], counts, out)

    # ---- ここから先は「素の値から出せる、見て意味のある量」だけ ----
    out["best"]["steer_deg"] = round(math.degrees(out["best"]["steer"]), 2)
    costs = sorted(c["cost"] for c in out["cands"])
    # 隣り合う舵候補のコストはもともと近いので、2位との差だけでは何も言えない。
    # 見たいのは **候補集合全体で差が消えていないか**(壁のコストが全候補で
    # 飽和すると、MPC は意味のある選択ができなくなる。公式eval t=126.8 で
    # 舵候補21本すべての予測が壁に埋まっていた場面がこれ)。
    out["best"]["margin"] = round(costs[1] - costs[0], 3) if len(costs) >= 2 else None
    out["best"]["spread"] = round(costs[-1] - costs[0], 3) if len(costs) >= 2 else None
    out["plan_why_ja"] = PLAN_WHY_JA.get(out["plan_why"], out["plan_why"])
    out["mode"] = MODE_NAMES.get(out["mode_code"], f'unknown({out["mode_code"]})')
    # 相手の枠は可変長なので、UI 側が長さを聞き直さずに済むよう名前でも持つ。
    del out["n_opp_pred"], out["n_opp_raw"]
    return out


def raw_rows(d: dict) -> dict[str, Any]:
    """トピック生値パネル用の1行表示(MPCの要約)。"""
    b = d["best"]
    return {
        "mode": d["mode"],
        "best.steer_deg": b["steer_deg"],
        "best.accel": b["accel"],
        "best.off_m": b["off"],
        "best.cost": b["cost"],
        "候補コストの幅": b["spread"],
        "off_cmd_m": d["off_cmd"],
        "off_delta_m": d["off_delta"],
        "plan_tgt_m": d["plan_tgt"],
        "v_cap_mps": "—" if d["v_cap"] is None else d["v_cap"],
        "acc_cap_mps": "—" if d["acc_cap"] is None else d["acc_cap"],
        "threat": "あり" if d["threat"] else "なし",
        "passing": "はい" if d["passing"] else "いいえ",
        "plan": d["plan_why_ja"] + ("(計画中)" if d["plan_active"] else ""),
        "plan_ok": "並べる" if d["plan_ok"] else "幅なし",
        "plan_hold(縦で待つ)": "はい" if d["plan_hold"] else "いいえ",
        "side(抜く側)": {1.0: "左", -1.0: "右"}.get(d["side"], "未定"),
        "side_left": d["side_left"],
        "follow_hold": d["follow_hold"],
        "launched": "はい" if d["launched"] else "いいえ(発進中)",
        "pen_hold": d["pen_hold"],
        "clearance_m": d["clearance"],
        "lat_m(参照からの横ズレ)": d["lat"],
        "lat_slope": d["lat_slope"],
        "idx": d["idx"],
        "s_ego_m": d["s_ego"],
        "cbf_used(安全側へ差替)": "はい" if d["cbf_used"] else "いいえ",
        "safe_cands": f'{d["n_safe"]}/{d["n_cand"]}',
        "step_ms": d["step_ms"],
        "rollout_ext": "C拡張" if d["rollout_ext"] else "Python版",
    }
