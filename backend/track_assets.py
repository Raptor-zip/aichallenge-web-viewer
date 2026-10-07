#!/usr/bin/env python3
"""Export optional course geometry for the browser viewer.

No ROS runtime is required. Supply your own raceline.csv, optional wall distance
field, lanelet2 map and vehicle parameters; output a JSON file to import through
MCAP / JSONを開く. Geometry is relative to the exported world-coordinate origin.
"""
from __future__ import annotations

import argparse
import csv
import json
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

import numpy as np
import yaml


def load_raceline(data_dir: Path) -> list[list[float]]:
    path = data_dir / "raceline.csv"
    if not path.exists():
        return []
    points: list[list[float]] = []
    with path.open("r", newline="") as f:
        for row in csv.DictReader(f):
            points.append([float(row["x"]), float(row["y"])])
    return points


def load_wall_boundary(
    data_dir: Path, origin: tuple[float, float], target_points: int = 10000
) -> list[list[float]]:
    """wall_distance_field.npz (distance_m: 各セルから最近傍壁までの距離, 0=壁) から
    走行可能領域(distance_m >= res)と壁の境界セルを、フル解像度(0.05m)のまま抽出する。
    ブロックpoolingで先に間引くと「ブロック内のどれか1セルでも壁に近ければブロック全体を
    非走行可能扱い」になり、実際より最大ブロック幅ぶん壁が内側に張り出して見える
    (見た目上「壁にめり込んでいる」のに実際は接触していない、の原因)。
    そのため境界抽出は必ずフル解像度で行い、点群だけを均等ストライドで間引く。
    """
    path = data_dir / "wall_distance_field.npz"
    if not path.exists():
        return []
    d = np.load(path)
    dm = d["distance_m"]
    res = float(d["res"])
    x0 = float(d["x0"])
    y0 = float(d["y0"])

    drivable = dm >= res
    boundary = np.zeros_like(drivable)
    boundary[1:, :] |= drivable[1:, :] & ~drivable[:-1, :]
    boundary[:-1, :] |= drivable[:-1, :] & ~drivable[1:, :]
    boundary[:, 1:] |= drivable[:, 1:] & ~drivable[:, :-1]
    boundary[:, :-1] |= drivable[:, :-1] & ~drivable[:, 1:]

    rows, cols = np.nonzero(boundary)
    xs = x0 + (cols.astype(np.float64) + 0.5) * res - origin[0]
    ys = y0 + (rows.astype(np.float64) + 0.5) * res - origin[1]

    n = len(xs)
    stride = max(1, n // max(1, target_points))
    xs, ys = xs[::stride], ys[::stride]
    return np.stack([xs, ys], axis=1).round(3).tolist()


def load_lanelet2_boundaries(
    map_path: Path, origin: tuple[float, float]
) -> list[list[list[float]]]:
    """lanelet2の.osmマップから車線境界(left/right way)をポリラインのリストとして返す。
    rvizの `/map/vector_map_marker`(MarkerArray)と同じ情報源(Autoware map_loaderが読む
    ものと同一ファイル)を直接パースする。node の local_x/local_y は既にraceline.csv等と
    同じmap座標系(AWSIM world座標)なので変換不要。
    """
    if not map_path.exists():
        return []
    tree = ET.parse(map_path)
    root = tree.getroot()

    node_xy: dict[str, tuple[float, float]] = {}
    for node in root.findall("node"):
        nid = node.get("id")
        lx = ly = None
        for tag in node.findall("tag"):
            if tag.get("k") == "local_x":
                lx = float(tag.get("v"))
            elif tag.get("k") == "local_y":
                ly = float(tag.get("v"))
        if nid is not None and lx is not None and ly is not None:
            node_xy[nid] = (lx, ly)

    way_nodes: dict[str, list[str]] = {}
    for way in root.findall("way"):
        wid = way.get("id")
        if wid is not None:
            way_nodes[wid] = [nd.get("ref") for nd in way.findall("nd")]

    boundary_way_ids: set[str] = set()
    for relation in root.findall("relation"):
        tags = {t.get("k"): t.get("v") for t in relation.findall("tag")}
        if tags.get("type") != "lanelet":
            continue
        for member in relation.findall("member"):
            if member.get("type") == "way" and member.get("role") in ("left", "right"):
                ref = member.get("ref")
                if ref is not None:
                    boundary_way_ids.add(ref)

    polylines: list[list[list[float]]] = []
    for wid in boundary_way_ids:
        refs = way_nodes.get(wid, [])
        pts = [node_xy[r] for r in refs if r in node_xy]
        if len(pts) < 2:
            continue
        polylines.append(
            [[round(x - origin[0], 3), round(y - origin[1], 3)] for x, y in pts]
        )
    return polylines


def load_wall_distance_grid(data_dir: Path) -> Optional[dict]:
    """wall_distance_field.npz を生のグリッドのまま返す(壁接触のリアルタイム判定用)。
    load_wall_boundary() は表示用に間引いた点群を返すが、判定にはフル解像度が要る。
    """
    path = data_dir / "wall_distance_field.npz"
    if not path.exists():
        return None
    d = np.load(path)
    return {
        "distance_m": d["distance_m"],
        "res": float(d["res"]),
        "x0": float(d["x0"]),
        "y0": float(d["y0"]),
    }


def load_vehicle_hull(data_dir: Path) -> list[list[float]]:
    """実車の物理Collider凸包(車体ローカル座標、[前後(+前), 左右(+左)])を返す。
    UnityバイナリからUnityPyで抽出済みの34頂点(前+1.13m/後-0.86m非対称)。
    フロントエンドはこれを pose(x,y,yaw) で回転・平行移動して描画する
    (矢印よりも実際の壁接触判定を正確に可視化できる)。
    """
    path = data_dir / "unity_collision_field.npz"
    if not path.exists():
        return []
    d = np.load(path)
    if "vehicle_hull_long_lat" not in d:
        return []
    hull = d["vehicle_hull_long_lat"]
    return hull.round(4).tolist()


def load_vehicle_model(yaml_path: Path) -> Optional[dict]:
    """rvizのRobotModel表示(/robot_description、URDFはracing_kart_description由来)が使うのと
    同じ vehicle_info.param.yaml から、車体外形(矩形)と4輪の位置・寸法を算出する。
    3.3MBのkart.dae(COLLADAメッシュ)は複数パーツ(座席・ステアリング等の装飾込み)が混在していて
    単純な凸包抽出だと実寸より大幅に大きくなってしまう(検証で長さ4.7m相当という明らかな誤り値に
    なった)ため、メッシュ解析ではなくURDFの寸法パラメータから幾何学的に正確な矩形を組み立てる。
    座標系はvehicle_hull(実コライダー)と同じpose原点基準([前後(+前), 左右(+左)])。
    ホイールの前後位置(前+0.603m/後-0.484m)は[[awsim-collider-hitbox]]で確認済みの値
    (ホイールベース1.087m = wheel_base と整合)。
    """
    if not yaml_path.exists():
        return None
    with yaml_path.open() as f:
        params = yaml.safe_load(f)["/**"]["ros__parameters"]

    wheel_base = float(params["wheel_base"])
    wheel_tread = float(params["wheel_tread"])
    front_overhang = float(params["front_overhang"])
    rear_overhang = float(params["rear_overhang"])
    left_overhang = float(params["left_overhang"])
    right_overhang = float(params["right_overhang"])
    wheel_radius = float(params["wheel_radius"])
    wheel_width = float(params["wheel_width"])

    # pose原点から前輪/後輪軸中心までの距離(実測コライダーと同じ原点定義、UnityPy抽出で確認済み)
    front_wheel_lon = 0.603
    rear_wheel_lon = front_wheel_lon - wheel_base

    front_edge = front_wheel_lon + front_overhang
    rear_edge = rear_wheel_lon - rear_overhang
    half_width = wheel_tread / 2.0 + (left_overhang + right_overhang) / 2.0

    body = [
        [front_edge, half_width],
        [front_edge, -half_width],
        [rear_edge, -half_width],
        [rear_edge, half_width],
    ]

    half_tread = wheel_tread / 2.0
    wheel_len = wheel_radius * 2.0
    wheels = [
        {"cx": front_wheel_lon, "cy": half_tread, "length": wheel_len, "width": wheel_width, "steerable": True},
        {"cx": front_wheel_lon, "cy": -half_tread, "length": wheel_len, "width": wheel_width, "steerable": True},
        {"cx": rear_wheel_lon, "cy": half_tread, "length": wheel_len, "width": wheel_width, "steerable": False},
        {"cx": rear_wheel_lon, "cy": -half_tread, "length": wheel_len, "width": wheel_width, "steerable": False},
    ]
    return {"body": body, "wheels": wheels}



def build_track_payload(data_dir: Path, lanelet2_map: Path,
                        vehicle_info_yaml: Path) -> dict:
    """WebSocket の `track` メッセージと同じ中身を作る。

    origin(座標原点)はレースラインの先頭点。ダッシュボードの全レイヤが
    この原点で揃っているので、ここを変えると重ならなくなる。
    """
    raceline = load_raceline(data_dir)
    origin = tuple(raceline[0]) if raceline else (0.0, 0.0)
    if raceline:
        raceline = [[round(x - origin[0], 3), round(y - origin[1], 3)]
                    for x, y in raceline]
    return {
        "type": "track",
        "raceline": raceline,
        "walls": load_wall_boundary(data_dir, origin),
        "vehicle_hull": load_vehicle_hull(data_dir),
        "lanelet_boundaries": load_lanelet2_boundaries(lanelet2_map, origin),
        "vehicle_model": load_vehicle_model(vehicle_info_yaml),
        "origin": [origin[0], origin[1]],
    }


def _default(*parts: str) -> Path:
    return (Path.cwd() / "aichallenge").joinpath(*parts)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data-dir", default=str(_default(
        "workspace/src/aichallenge_submit/rl_raceline_controller/data")))
    ap.add_argument("--lanelet2-map", default=str(_default(
        "workspace/src/aichallenge_submit/aichallenge_submit_launch/map/lanelet2_map.osm")))
    ap.add_argument("--vehicle-info-yaml", default=str(_default(
        "workspace/src/aichallenge_submit/racing_kart_description/config/vehicle_info.param.yaml")))
    ap.add_argument("--out", default=str(
        Path.cwd() / "track.json"))
    args = ap.parse_args()

    payload = build_track_payload(Path(args.data_dir), Path(args.lanelet2_map),
                                  Path(args.vehicle_info_yaml))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"{out}  ({out.stat().st_size / 1e3:.0f} kB)  "
          f"レースライン {len(payload['raceline'])} 点 / "
          f"壁 {len(payload['walls'])} 点 / "
          f"車線境界 {len(payload['lanelet_boundaries'])} 本")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
