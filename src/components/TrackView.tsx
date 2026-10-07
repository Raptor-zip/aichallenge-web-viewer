import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MpcDebug,
  MpcStatic,
  RacelineIdxMarker,
  TrailPoint,
  V2XVehicle,
  VehicleModel,
  WallMarker,
} from "../types";
import { LAYER_DEFS, type LayerKey, type Layers } from "../hooks/useLayers";

/** 同じレースを走っている別の車(それぞれ独立した ROS_DOMAIN_ID) */
export interface OtherVehicle {
  domain: number;
  pose: { x: number; y: number; yaw_deg: number };
  speed_mps: number;
}

interface Props {
  raceline: [number, number][];
  walls: [number, number][];
  /** 実車物理Colliderの凸包(車体ローカル座標 [前後(+前), 左右(+左)]) */
  vehicleHull: [number, number][];
  /** lanelet2マップの車線境界(rvizの/map/vector_map_markerと同じソース)。ポリラインのリスト */
  laneletBoundaries: [number, number][][];
  /** rvizのRobotModel(URDF)と同じ諸元から組み立てた車体外形+4輪 */
  vehicleModel: VehicleModel | null;
  /** 壁接触の疑いがある地点(バックエンドが実車Colliderと壁距離場から検出) */
  wallMarkers: WallMarker[];
  /**
   * bag再生のときの事件の地点(壁接触・接触)。**再生位置までのものだけ**渡すこと。
   * 先の事故まで見えていると「このあと当てる」と分かった状態で走りを見ることになり、
   * 判断の検証にならない。
   */
  eventMarks: { x: number; y: number; color: string; label: string }[];
  /** /rl_raceline/debug の「レースラインindex」が指す地点 */
  racelineIdxMarker: RacelineIdxMarker | null;
  /** RL観測に入っている6ルックアヘッド点(3/6/10/15/22/30m先)のワールド座標 */
  rlLookaheadPoints: [number, number][];
  /** MPCの静的データ(参照経路・回廊)。コントローラ起動前はnull */
  mpcStatic: MpcStatic | null;
  /** MPCの毎stepの中身。MPC以外で走っている間はnull */
  mpc: MpcDebug | null;
  /** V2Xが配信している相手の実位置 */
  v2x: V2XVehicle[];
  /** 3台走行のときの、いま見ていない車。実際の姿勢が分かるので車体で描く */
  others: OtherVehicle[];
  layers: Layers;
  onToggleLayer: (key: LayerKey) => void;
  onResetLayers: () => void;
  trail: TrailPoint[];
  pose: { x: number; y: number; yaw_deg: number } | null;
  steerCmdDeg: number;
  /** trail is a mutated-in-place ref array; bump this on every telemetry tick to force redraw. */
  version: number;
}

type ColorMode = "speed" | "accel";
interface View {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface HoverInfo {
  screenX: number;
  screenY: number;
  worldX: number;
  worldY: number;
  trailPoint: TrailPoint | null;
  trailDist: number;
  idx: number | null;
  idxDist: number;
  /** カーソル直下の参照経路点での回廊[m] */
  room: [number, number] | null;
}

const SPEED_MAX_MPS = 15;
const ACCEL_MAX_MPS2 = 3;
const MIN_SCALE_FACTOR = 0.05;
const MAX_SCALE_FACTOR = 40;
/** 追従モードのときに画面に収める半径[m]。render_mpc_debug.py の --span と同じ役目 */
const FOLLOW_SPAN_M = 22;
/** 本番Colliderの実測。pose原点に対し 前+1.13 / 後-0.86 / 半幅0.77 */
const BODY_REAR = -0.86;
const BODY: [number, number][] = [
  [1.13, 0.77],
  [1.13, -0.77],
  [-0.86, -0.77],
  [-0.86, 0.77],
];
const OPP_COLORS = ["#60a5fa", "#4ade80", "#f472b6", "#22d3ee"];

function fitTransform(
  points: [number, number][],
  width: number,
  height: number,
  padding: number,
): View {
  if (points.length === 0) {
    return { scale: 1, offsetX: width / 2, offsetY: height / 2 };
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanX = Math.max(1e-3, maxX - minX);
  const spanY = Math.max(1e-3, maxY - minY);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    scale,
    offsetX: width / 2 - cx * scale,
    // world Y is flipped so "up" on screen matches increasing Y.
    offsetY: height / 2 + cy * scale,
  };
}

// 速度: 遅い(青) -> 速い(赤) のヒートカラー。加速度: 減速(シアン) -> 0(白) -> 加速(オレンジ)。
function speedColor(v: number): string {
  const t = Math.max(0, Math.min(1, v / SPEED_MAX_MPS));
  const hue = 220 - t * 220; // 220=青 -> 0=赤
  return `hsl(${hue}, 90%, 55%)`;
}

function accelColor(a: number): string {
  const t = Math.max(-1, Math.min(1, a / ACCEL_MAX_MPS2));
  if (t >= 0) {
    // 0 -> 加速: 白からオレンジ
    const l = 92 - t * 40;
    return `hsl(30, 95%, ${l}%)`;
  }
  // 0 -> 減速: 白からシアン
  const l = 92 - -t * 40;
  return `hsl(190, 95%, ${l}%)`;
}

/**
 * 参照経路の各点の法線(左が正)。回廊の帯を描くのと、相手の向きを推定するのに使う。
 * 中央差分で出す(コントローラの _lateral_room / _lat_of と同じ取り方)。
 */
function pathNormals(path: [number, number][]): { nx: number[]; ny: number[]; yaw: number[] } {
  const n = path.length;
  const nx = new Array<number>(n);
  const ny = new Array<number>(n);
  const yaw = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = path[(i - 1 + n) % n];
    const b = path[(i + 1) % n];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const t = Math.hypot(tx, ty) || 1;
    nx[i] = -ty / t;
    ny[i] = tx / t;
    yaw[i] = Math.atan2(ty, tx);
  }
  return { nx, ny, yaw };
}

export function TrackView({
  raceline,
  walls,
  vehicleHull,
  laneletBoundaries,
  vehicleModel,
  wallMarkers,
  eventMarks,
  racelineIdxMarker,
  rlLookaheadPoints,
  mpcStatic,
  mpc,
  v2x,
  others,
  layers,
  onToggleLayer,
  onResetLayers,
  trail,
  pose,
  steerCmdDeg,
  version,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("speed");
  // 自車追従。MPCの予測は車の前方15m程度しか無いので、全景のままだと
  // 点にしか見えない。既定でON(このダッシュボードの主目的がMPCの観察なので)。
  const [follow, setFollow] = useState(true);
  const [showLayerPanel, setShowLayerPanel] = useState(false);

  // ユーザーがドラッグ/ホイールで動かした表示範囲。null の間は自動フィット。
  const viewRef = useRef<View | null>(null);
  const fitScaleRef = useRef(1);
  // 追従モードのズーム倍率。ホイールで変えられるようにする。
  const followZoomRef = useRef(1);
  const dragRef = useRef<{ startX: number; startY: number; origin: View } | null>(null);
  // 直近の描画関数を保持し、イベントハンドラ(props未変化)からも常に最新の状態で再描画できるようにする。
  const drawRef = useRef<() => void>(() => {});
  const [, forceRedraw] = useState(0);

  // マウスカーソル位置のオーバーレイ(速度/加速度/最寄りレースラインidx)。
  const [hover, setHover] = useState<HoverInfo | null>(null);
  // hover計算はイベントハンドラ(マウント時に1回だけ登録)から呼ぶので、propsの最新値をrefで持つ。
  const latestPropsRef = useRef({ trail, raceline, mpcStatic });
  latestPropsRef.current = { trail, raceline, mpcStatic };
  const followRef = useRef(follow);
  followRef.current = follow;
  const poseRef = useRef(pose);
  poseRef.current = pose;

  // 相手の向きを出すための線。V2X も mpc.opp も **位置しか持っていない** ので、
  // コース上の最寄り点の接線で向きを近似する(render_mpc_debug.py と同じ手)。
  // MPCの参照経路があればそれ、無ければ(bag再生など)レースラインを使う。
  const heading = useMemo(() => {
    const path = mpcStatic?.ref_path?.length ? mpcStatic.ref_path : raceline;
    if (path.length < 3) return null;
    return { path, yaw: pathNormals(path).yaw };
  }, [mpcStatic, raceline]);

  // 回廊の帯は参照経路が来たとき1回だけ作れば足りる(毎frame作ると重い)。
  const corridorBand = useMemo(() => {
    if (!mpcStatic || mpcStatic.ref_path.length < 3) return null;
    const path = mpcStatic.ref_path;
    const { nx, ny, yaw } = pathNormals(path);
    const outer: [number, number][] = path.map(([x, y], i) => [
      x + nx[i] * mpcStatic.off_hi[i],
      y + ny[i] * mpcStatic.off_hi[i],
    ]);
    const inner: [number, number][] = path.map(([x, y], i) => [
      x + nx[i] * mpcStatic.off_lo[i],
      y + ny[i] * mpcStatic.off_lo[i],
    ]);
    return { outer, inner, yaw };
  }, [mpcStatic]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    drawRef.current = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = "#0b0f14";
      ctx.fillRect(0, 0, width, height);

      const boundsSource = walls.length
        ? walls
        : raceline.length
        ? raceline
        : trail.map((p) => [p.x, p.y] as [number, number]);
      const fit = fitTransform(boundsSource, width, height, 32);
      fitScaleRef.current = fit.scale;

      let view: View;
      if (follow && pose) {
        // 自車中心。スケールは「半径 FOLLOW_SPAN_M が画面に収まる」を基準に、
        // ホイールのズーム倍率を掛ける。
        const base = Math.min(width, height) / 2 / FOLLOW_SPAN_M;
        const scale = base * followZoomRef.current;
        view = {
          scale,
          offsetX: width / 2 - pose.x * scale,
          offsetY: height / 2 + pose.y * scale,
        };
      } else {
        view = viewRef.current ?? fit;
      }
      const { scale, offsetX, offsetY } = view;
      const toScreen = (x: number, y: number): [number, number] => [
        offsetX + x * scale,
        offsetY - y * scale,
      ];
      const strokePath = (pts: [number, number][], close = false) => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => {
          const [sx, sy] = toScreen(x, y);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        if (close) ctx.closePath();
        ctx.stroke();
      };
      /** コース上の最寄り点の接線から、その地点を走る車の向きを推定する */
      const yawOnPath = (x: number, y: number): number => {
        if (!heading) return 0;
        let best = 0;
        let bd = Infinity;
        for (let i = 0; i < heading.path.length; i++) {
          const d =
            (heading.path[i][0] - x) ** 2 + (heading.path[i][1] - y) ** 2;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        return heading.yaw[best];
      };

      /** 車体ローカル(前+/左+)の多角形を world 上の (x,y,yaw) へ置いて描く */
      const polyAt = (
        shape: [number, number][],
        x: number,
        y: number,
        yaw: number,
      ) => {
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        ctx.beginPath();
        shape.forEach(([lon, lat], i) => {
          const [sx, sy] = toScreen(x + lon * c - lat * s, y + lon * s + lat * c);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.closePath();
      };

      // --- 通れる回廊(帯)。参照経路の法線方向に off_lo〜off_hi -------------
      if (layers.corridor && corridorBand) {
        ctx.fillStyle = "rgba(59, 130, 246, 0.13)";
        ctx.beginPath();
        corridorBand.outer.forEach(([x, y], i) => {
          const [sx, sy] = toScreen(x, y);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        for (let i = corridorBand.inner.length - 1; i >= 0; i--) {
          const [sx, sy] = toScreen(corridorBand.inner[i][0], corridorBand.inner[i][1]);
          ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.fill();
      }

      // walls (壁境界点群。壁距離場から抽出した非連続点なので個別に小さい四角で描く)
      if (layers.walls && walls.length) {
        ctx.fillStyle = "#ff8a3d";
        const dotSize = Math.max(0.6, Math.min(2.5, scale * 0.15));
        for (const [x, y] of walls) {
          const [sx, sy] = toScreen(x, y);
          ctx.fillRect(sx - dotSize / 2, sy - dotSize / 2, dotSize, dotSize);
        }
      }

      // lanelet2境界(rvizで見えているコースの枠と同じソース)。
      // **壁ペナルティの判定線はこちら**。実測(2026-07-29、race3-cap9/cap11の
      // 有効2件)では、罰が出た瞬間の車体〜境界が 0.11m / 0.25m なのに対し、
      // 壁の距離場までは 0.64m / 0.80m あった。距離場は判定より約0.6m 外側。
      if (layers.lanelet && laneletBoundaries.length) {
        ctx.strokeStyle = "#8a5cff";
        ctx.lineWidth = 1.5;
        for (const line of laneletBoundaries) {
          if (line.length >= 2) strokePath(line);
        }
      }

      // raceline (提出データそのもの)
      if (layers.raceline && raceline.length > 1) {
        ctx.strokeStyle = "#4a5a6a";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        strokePath(raceline, true);
        ctx.setLineDash([]);
      }

      // MPCの参照経路。RL_MPC_SMOOTH=1(既定)ではレースラインとは別の線になる。
      if (layers.refPath && mpcStatic && mpcStatic.ref_path.length > 1) {
        ctx.strokeStyle = "#4ade80";
        ctx.lineWidth = 1.8;
        strokePath(mpcStatic.ref_path, true);
      }

      // trail: 速度 or 加速度で色分け(セグメントごとに色を変える)
      if (layers.trail && trail.length > 1) {
        ctx.lineWidth = 3;
        for (let i = 1; i < trail.length; i++) {
          const p0 = trail[i - 1];
          const p1 = trail[i];
          ctx.strokeStyle = colorMode === "speed" ? speedColor(p1.speed) : accelColor(p1.accel);
          const [x0, y0] = toScreen(p0.x, p0.y);
          const [x1, y1] = toScreen(p1.x, p1.y);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      }

      // 事件の地点をバツ印で表示。ライブはバックエンドの壁接触検出、
      // bag再生は events.ts が拾った壁接触・接触。
      if (layers.wallMarks) {
        const cross = (x: number, y: number, color: string) => {
          const [sx, sy] = toScreen(x, y);
          const r = 7;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(sx - r, sy - r);
          ctx.lineTo(sx + r, sy + r);
          ctx.moveTo(sx + r, sy - r);
          ctx.lineTo(sx - r, sy + r);
          ctx.stroke();
        };
        for (const m of wallMarkers) cross(m.x, m.y, "#ff2d55");
        ctx.font = "10px sans-serif";
        for (const m of eventMarks) {
          cross(m.x, m.y, m.color);
          const [sx, sy] = toScreen(m.x, m.y);
          ctx.fillStyle = m.color;
          ctx.fillText(m.label, sx + 9, sy - 9);
        }
      }

      // ---------------- MPC ----------------
      if (mpc) {
        // ホライズン各点の回廊(いま許されている横の範囲)。参照点の法線方向に短い線分。
        if (layers.mpcHorizonRoom && mpc.ref_points.length > 1) {
          ctx.strokeStyle = "rgba(59,130,246,0.55)";
          ctx.lineWidth = 1;
          for (let k = 0; k < mpc.ref_points.length; k++) {
            const a = mpc.ref_points[Math.max(0, k - 1)];
            const b = mpc.ref_points[Math.min(mpc.ref_points.length - 1, k + 1)];
            const tx = b[0] - a[0];
            const ty = b[1] - a[1];
            const t = Math.hypot(tx, ty) || 1;
            const nxk = -ty / t;
            const nyk = tx / t;
            const [x, y] = mpc.ref_points[k];
            const [x0, y0] = toScreen(
              x + nxk * mpc.corridor_lo[k],
              y + nyk * mpc.corridor_lo[k],
            );
            const [x1, y1] = toScreen(
              x + nxk * mpc.corridor_hi[k],
              y + nyk * mpc.corridor_hi[k],
            );
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
          }
        }

        // 舵候補ごとの予測。コストの良い順に濃くする。「どれが競っていたか」が
        // 見えないと、なぜその候補が選ばれたのかは説明できない。
        // 接触印(hit)のついた候補は赤く出す(採用対象から外れている候補)。
        if (layers.mpcCands && mpc.cands.length) {
          const order = mpc.cands
            .map((c, i) => [c.cost, i] as [number, number])
            .sort((a, b) => a[0] - b[0]);
          order.forEach(([, ci], rank) => {
            const c = mpc.cands[ci];
            ctx.strokeStyle = c.hit ? "#ff5f5f" : "#ffd24a";
            ctx.globalAlpha = Math.max(0.08, 0.55 - 0.02 * rank);
            ctx.lineWidth = 1;
            strokePath(c.pts);
          });
          ctx.globalAlpha = 1;
        }

        // 横にずらした参照線(MPCが実際に追っている線)
        if (layers.mpcShifted && mpc.ref_shifted.length > 1) {
          ctx.strokeStyle = "#fbbf24";
          ctx.lineWidth = 1.8;
          ctx.setLineDash([5, 4]);
          strokePath(mpc.ref_shifted);
          ctx.setLineDash([]);
        }

        // ホライズン上の参照点(ずらす前)
        if (layers.mpcRefPts) {
          ctx.fillStyle = "#4ade80";
          for (const [x, y] of mpc.ref_points) {
            const [sx, sy] = toScreen(x, y);
            ctx.beginPath();
            ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // 相手の予測位置。重み<1 は分岐MPCの枝なので薄く出す。
        if (layers.oppPred && mpc.opp_pred.length) {
          for (const op of mpc.opp_pred) {
            ctx.strokeStyle = "#c084fc";
            ctx.globalAlpha = op.w >= 0.99 ? 0.95 : 0.4;
            ctx.lineWidth = 1.4;
            const r = 3.5;
            for (const [x, y] of op.pts) {
              const [sx, sy] = toScreen(x, y);
              ctx.beginPath();
              ctx.moveTo(sx - r, sy - r);
              ctx.lineTo(sx + r, sy + r);
              ctx.moveTo(sx + r, sy - r);
              ctx.lineTo(sx - r, sy + r);
              ctx.stroke();
            }
          }
          ctx.globalAlpha = 1;
        }

        // 選ばれた予測軌跡。いちばん上に描く。
        if (layers.mpcBest && mpc.best_traj.length > 1) {
          ctx.strokeStyle = "#ff5f5f";
          ctx.lineWidth = 2.8;
          strokePath(mpc.best_traj);
        }
      }

      // --- 相手 -----------------------------------------------------------
      // **○では描かない**。当たるかどうかは車体の形と向きで決まるので、
      // 自車と同じ実物理Collider凸包(unity_collision_field.npz から取った
      // 34頂点、前+1.13/後-0.86/半幅0.77の非対称)で描く。丸で描くと
      // 「ぶつかる寸前なのか、もう並べているのか」がまったく読めない。
      //
      // 位置の出どころは2つあり、意味が違う:
      //   mpc.opp … コントローラが「相手はここに居る」と思っている位置
      //   v2x     … V2Xが配信した生の位置
      // 普段は重なるが、ズレていればその step でコントローラが相手を
      // 見失っている(実測で s の推定が階段状に飛ぶ既知の症状がある)。
      // 両方描いて、離れているときだけ線で結ぶ。
      if (layers.opp && (v2x.length || (mpc && mpc.opp.length))) {
        const dangerBox = (): [number, number][] => {
          const lon = mpcStatic?.box_lon ?? 2.4;
          const lat = mpcStatic?.box_lat ?? 1.7;
          return [
            [BODY_REAR, lat],
            [BODY_REAR, -lat],
            [BODY_REAR - lon, -lat],
            [BODY_REAR - lon, lat],
          ];
        };
        const danger = dangerBox();
        const shape = vehicleHull.length > 2 ? vehicleHull : BODY;

        const drawOpp = (
          x: number,
          y: number,
          col: string,
          label: string,
          solid: boolean,
          /** 分かっている向き[rad]。無ければコース接線で近似する */
          knownYaw?: number,
        ) => {
          const yaw = knownYaw ?? yawOnPath(x, y);
          // CRASH判定域(相手の後ろ box_lon × 横 ±box_lat)。
          // ここに自車の前が入ると 5km/h × 10秒。
          ctx.fillStyle = "rgba(255,95,95,0.10)";
          ctx.strokeStyle = "rgba(255,95,95,0.7)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          polyAt(danger, x, y, yaw);
          ctx.fill();
          ctx.stroke();
          ctx.setLineDash([]);
          // 車体(実際の当たり判定に使われる凸包)
          ctx.fillStyle = col;
          ctx.globalAlpha = solid ? 0.85 : 0.25;
          polyAt(shape, x, y, yaw);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = solid ? "#e8e8e8" : col;
          ctx.lineWidth = solid ? 1.2 : 1;
          if (!solid) ctx.setLineDash([4, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
          if (label) {
            const [lx, ly] = toScreen(x, y);
            ctx.fillStyle = col;
            ctx.font = "11px sans-serif";
            ctx.fillText(label, lx + 10, ly - 10);
          }
        };

        const seen = mpc?.opp ?? [];
        seen.forEach((o, j) => {
          drawOpp(
            o.x,
            o.y,
            OPP_COLORS[j % OPP_COLORS.length],
            `${o.gap >= 0 ? "+" : ""}${o.gap.toFixed(1)}m ${o.v.toFixed(1)}m/s`,
            true,
          );
        });
        // V2Xの生位置。コントローラが認識している位置と 0.5m 以上離れている
        // ものだけ、破線の車体と結線で「ここに居るのに見えていない」を出す。
        v2x.forEach((veh) => {
          const near = seen.find(
            (o) => Math.hypot(o.x - veh.x, o.y - veh.y) < 0.5,
          );
          if (near) return;
          drawOpp(veh.x, veh.y, "#22d3ee", `V2X ${veh.id}`, seen.length === 0, veh.yaw);
          if (seen.length) {
            let best = seen[0];
            let bd = Infinity;
            for (const o of seen) {
              const d = Math.hypot(o.x - veh.x, o.y - veh.y);
              if (d < bd) {
                bd = d;
                best = o;
              }
            }
            ctx.strokeStyle = "#22d3ee";
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            const [ax, ay] = toScreen(veh.x, veh.y);
            const [bx, by] = toScreen(best.x, best.y);
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        });
      }

      // 3台走行の別の車。V2X の円と違って **実際の姿勢が分かる**(各車の
      // 自己位置推定をそのまま受け取っているので)。誰がどこで何をしていたかを
      // 1枚で見るためのレイヤなので、自車と紛れないよう塗りは薄くする。
      if (layers.otherCars && others.length) {
        ctx.font = "11px sans-serif";
        others.forEach((o, j) => {
          const col = OPP_COLORS[j % OPP_COLORS.length];
          const yaw = (o.pose.yaw_deg * Math.PI) / 180;
          ctx.fillStyle = col;
          ctx.globalAlpha = 0.35;
          polyAt(vehicleHull.length > 2 ? vehicleHull : BODY, o.pose.x, o.pose.y, yaw);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = col;
          ctx.lineWidth = 1.4;
          ctx.stroke();
          const [sx, sy] = toScreen(o.pose.x, o.pose.y);
          ctx.fillStyle = col;
          ctx.fillText(`d${o.domain} ${o.speed_mps.toFixed(1)}m/s`, sx + 10, sy + 12);
        });
      }

      // レースラインindex(RL時代のコントローラが追っていた目標点)
      if (layers.rlLookahead && racelineIdxMarker) {
        const [sx, sy] = toScreen(racelineIdxMarker.x, racelineIdxMarker.y);
        ctx.fillStyle = "#ff4de0";
        ctx.strokeStyle = "#e6edf3";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#e6edf3";
        ctx.font = "11px sans-serif";
        ctx.fillText(`idx ${racelineIdxMarker.idx}`, sx + 9, sy - 9);
      }

      // RL観測の6ルックアヘッド点(3/6/10/15/22/30m先)。
      if (layers.rlLookahead && rlLookaheadPoints.length) {
        ctx.fillStyle = "#40ffea";
        ctx.strokeStyle = "#0b0f14";
        ctx.lineWidth = 1;
        rlLookaheadPoints.forEach(([x, y], i) => {
          const [sx, sy] = toScreen(x, y);
          ctx.beginPath();
          ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          if (i === rlLookaheadPoints.length - 1) {
            ctx.fillStyle = "#40ffea";
            ctx.font = "10px sans-serif";
            ctx.fillText("RL lookahead", sx + 6, sy + 4);
          }
        });
      }

      // vehicle: 実物理Colliderの凸包を実スケールで描画(矢印より正確に壁接触が判断できる)
      if (layers.vehicle && pose) {
        const [vx, vy] = toScreen(pose.x, pose.y);
        const yawRad = (pose.yaw_deg * Math.PI) / 180; // world yaw (ROS/AWSIM座標系, CCW正)

        // 車体ローカル(前+/左+)のベクトルをworld yawで回転し、原点からの相対スクリーン座標(px)へ変換する。
        // toScreen() と同じ「Yはワールド上向き→スクリーンは下向きなので符号反転」規約をここでも1箇所に閉じ込める。
        const localToScreenOffset = (lon: number, lat: number): [number, number] => {
          const wx = lon * Math.cos(yawRad) - lat * Math.sin(yawRad);
          const wy = lon * Math.sin(yawRad) + lat * Math.cos(yawRad);
          return [wx * scale, -wy * scale];
        };

        ctx.save();
        ctx.translate(vx, vy);

        let frontLon = 1.13;

        // 車体モデル(rvizのRobotModelと同じ諸元): ボディ矩形 + 4輪。実寸で塗りつぶし描画する。
        if (vehicleModel) {
          const drawLocalRect = (cx: number, cy: number, lon: number, lat: number, rot: number) => {
            const hl = lon / 2;
            const hw = lat / 2;
            const corners: [number, number][] = [
              [hl, hw],
              [hl, -hw],
              [-hl, -hw],
              [-hl, hw],
            ];
            const cosR = Math.cos(rot);
            const sinR = Math.sin(rot);
            ctx.beginPath();
            corners.forEach(([lx, ly], i) => {
              const rlon = cx + lx * cosR - ly * sinR;
              const rlat = cy + lx * sinR + ly * cosR;
              const [sx, sy] = localToScreenOffset(rlon, rlat);
              if (i === 0) ctx.moveTo(sx, sy);
              else ctx.lineTo(sx, sy);
            });
            ctx.closePath();
          };

          ctx.fillStyle = "#e6edf3";
          ctx.strokeStyle = "#8fd4ff";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          vehicleModel.body.forEach(([lon, lat], i) => {
            const [sx, sy] = localToScreenOffset(lon, lat);
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          });
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          const steerRad = (steerCmdDeg * Math.PI) / 180;
          ctx.fillStyle = "#1a2430";
          for (const w of vehicleModel.wheels) {
            drawLocalRect(w.cx, w.cy, w.length, w.width, w.steerable ? steerRad : 0);
            ctx.fill();
          }
        }

        if (vehicleHull.length > 2) {
          frontLon = Math.max(...vehicleHull.map(([lon]) => lon));
          // 実際の壁当たり判定に使われる物理Collider凸包。車体モデルの上に輪郭だけ重ねる。
          ctx.fillStyle = vehicleModel ? "rgba(255, 207, 64, 0.12)" : "rgba(255, 207, 64, 0.28)";
          ctx.strokeStyle = "#ffcf40";
          ctx.lineWidth = vehicleModel ? 1.5 : 2;
          ctx.beginPath();
          vehicleHull.forEach(([lon, lat], i) => {
            const [sx, sy] = localToScreenOffset(lon, lat);
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          });
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (!vehicleModel) {
          // 車体形状が未取得のときのフォールバック(従来の矢印、実寸ではない)
          ctx.rotate(-yawRad);
          const len = 16;
          ctx.fillStyle = "#ffcf40";
          ctx.beginPath();
          ctx.moveTo(len, 0);
          ctx.lineTo(-len * 0.6, len * 0.55);
          ctx.lineTo(-len * 0.6, -len * 0.55);
          ctx.closePath();
          ctx.fill();
          ctx.rotate(yawRad);
        }

        // 指令舵角の向き(前端から伸びる固定長14pxの線)。steerCmdDegは車体ローカルの左+角度なので
        // world yawに加算してから、上と同じworld->screenのY反転規約で伸ばす。
        const [fx, fy] = localToScreenOffset(frontLon, 0);
        const steerWorldRad = yawRad + (steerCmdDeg * Math.PI) / 180;
        const tipX = fx + Math.cos(steerWorldRad) * 14;
        const tipY = fy - Math.sin(steerWorldRad) * 14;
        ctx.strokeStyle = "#ff6b6b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();

        ctx.restore();
      }

      // 縮尺バー。追従モードでは倍率が自由に動くので、無いと距離感が読めない。
      // バーが 60〜160px くらいに収まる刻みを選ぶ(短すぎると読めない)。
      const barM = scale > 60 ? 1 : scale > 25 ? 2 : scale > 8 ? 5 : scale > 3 ? 20 : scale > 1.2 ? 50 : 100;
      const barPx = barM * scale;
      ctx.strokeStyle = "#8b93a7";
      ctx.fillStyle = "#8b93a7";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(14, height - 16);
      ctx.lineTo(14 + barPx, height - 16);
      ctx.moveTo(14, height - 21);
      ctx.lineTo(14, height - 11);
      ctx.moveTo(14 + barPx, height - 21);
      ctx.lineTo(14 + barPx, height - 11);
      ctx.stroke();
      ctx.font = "10px sans-serif";
      ctx.fillText(`${barM} m`, 16 + barPx, height - 20);
    };

    drawRef.current();
  }, [
    raceline,
    walls,
    vehicleHull,
    laneletBoundaries,
    vehicleModel,
    wallMarkers,
    eventMarks,
    racelineIdxMarker,
    rlLookaheadPoints,
    mpcStatic,
    mpc,
    v2x,
    others,
    layers,
    corridorBand,
    heading,
    trail,
    pose,
    steerCmdDeg,
    version,
    colorMode,
    follow,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // ホイールでズーム(カーソル位置を中心に)・ドラッグでパン。ネイティブリスナーで登録し、
  // { passive: false } でページ側のスクロールを止める。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const currentView = (): View => {
      if (viewRef.current) return viewRef.current;
      const rect = canvas.getBoundingClientRect();
      // まだユーザー操作していなければ、直近の自動フィット値をコピーして初期化する。
      return { scale: fitScaleRef.current, offsetX: rect.width / 2, offsetY: rect.height / 2 };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.001);
      if (followRef.current && poseRef.current) {
        // 追従中は中心が自車に固定なので、倍率だけ変える。
        followZoomRef.current = Math.max(0.15, Math.min(20, followZoomRef.current * factor));
        drawRef.current();
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const view = currentView();
      const minScale = fitScaleRef.current * MIN_SCALE_FACTOR;
      const maxScale = fitScaleRef.current * MAX_SCALE_FACTOR;
      const newScale = Math.max(minScale, Math.min(maxScale, view.scale * factor));
      // カーソル下のワールド座標を固定したままスケールを変える。
      const worldX = (mouseX - view.offsetX) / view.scale;
      const worldY = (view.offsetY - mouseY) / view.scale;
      viewRef.current = {
        scale: newScale,
        offsetX: mouseX - worldX * newScale,
        offsetY: mouseY + worldY * newScale,
      };
      drawRef.current();
    };

    const onMouseDown = (e: MouseEvent) => {
      if (followRef.current) return; // 追従中はパンしない(すぐ引き戻されるだけ)
      dragRef.current = { startX: e.clientX, startY: e.clientY, origin: currentView() };
      canvas.style.cursor = "grabbing";
    };
    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      viewRef.current = {
        ...drag.origin,
        offsetX: drag.origin.offsetX + (e.clientX - drag.startX),
        offsetY: drag.origin.offsetY + (e.clientY - drag.startY),
      };
      drawRef.current();
    };
    const onMouseUp = () => {
      dragRef.current = null;
      canvas.style.cursor = "grab";
    };
    const onDoubleClick = () => {
      viewRef.current = null; // 自動フィットへ戻す
      followZoomRef.current = 1;
      forceRedraw((v) => v + 1);
      drawRef.current();
    };

    // カーソル直下のワールド座標から、最寄りのtrail点(速度/加速度)とレースライン点(idx)を探す。
    const onHoverMove = (e: MouseEvent) => {
      if (dragRef.current) return; // パン中はオーバーレイを出さない
      const rect = canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const view = currentView();
      const worldX = (screenX - view.offsetX) / view.scale;
      const worldY = (view.offsetY - screenY) / view.scale;

      const { trail: latestTrail, raceline: latestRaceline, mpcStatic: st } =
        latestPropsRef.current;

      let trailPoint: TrailPoint | null = null;
      let trailDist = Infinity;
      for (const p of latestTrail) {
        const d = (p.x - worldX) ** 2 + (p.y - worldY) ** 2;
        if (d < trailDist) {
          trailDist = d;
          trailPoint = p;
        }
      }

      let idx: number | null = null;
      let idxDist = Infinity;
      latestRaceline.forEach(([x, y], i) => {
        const d = (x - worldX) ** 2 + (y - worldY) ** 2;
        if (d < idxDist) {
          idxDist = d;
          idx = i;
        }
      });

      // 参照経路上でいちばん近い点の回廊。「その地点でどこまで横へ出られるか」は
      // 追い越しの可否を目で確かめるときに毎回聞かれる数字。
      let room: [number, number] | null = null;
      if (st && st.ref_path.length) {
        let bi = 0;
        let bd = Infinity;
        for (let i = 0; i < st.ref_path.length; i++) {
          const d = (st.ref_path[i][0] - worldX) ** 2 + (st.ref_path[i][1] - worldY) ** 2;
          if (d < bd) {
            bd = d;
            bi = i;
          }
        }
        room = [st.off_lo[bi], st.off_hi[bi]];
      }

      setHover({
        screenX,
        screenY,
        worldX,
        worldY,
        trailPoint,
        trailDist: Math.sqrt(trailDist),
        idx,
        idxDist: Math.sqrt(idxDist),
        room,
      });
    };
    const onHoverLeave = () => setHover(null);

    canvas.style.cursor = "grab";
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("mousemove", onHoverMove);
    canvas.addEventListener("mouseleave", onHoverLeave);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("dblclick", onDoubleClick);
      canvas.removeEventListener("mousemove", onHoverMove);
      canvas.removeEventListener("mouseleave", onHoverLeave);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const resetView = () => {
    viewRef.current = null;
    followZoomRef.current = 1;
    forceRedraw((v) => v + 1);
    drawRef.current();
  };

  const groups = Array.from(new Set(LAYER_DEFS.map((l) => l.group)));

  return (
    <div className="panel track-panel">
      <div className="track-panel-header">
        <div className="panel-title">Track / MPC</div>
        <div className="track-panel-controls">
          <span className="track-hint">
            {follow ? "ホイール:ズーム / 追従中" : "ホイール:ズーム / ドラッグ:移動 / ダブルクリック:リセット"}
          </span>
          <button
            className={follow ? "toggle-btn toggle-btn-active" : "toggle-btn"}
            onClick={() => setFollow((f) => !f)}
          >
            自車追従
          </button>
          <button className="toggle-btn" onClick={resetView}>
            リセット
          </button>
          <button
            className={showLayerPanel ? "toggle-btn toggle-btn-active" : "toggle-btn"}
            onClick={() => setShowLayerPanel((v) => !v)}
          >
            レイヤ
          </button>
          <div className="color-mode-toggle">
            <button
              className={colorMode === "speed" ? "toggle-btn toggle-btn-active" : "toggle-btn"}
              onClick={() => setColorMode("speed")}
            >
              速度
            </button>
            <button
              className={colorMode === "accel" ? "toggle-btn toggle-btn-active" : "toggle-btn"}
              onClick={() => setColorMode("accel")}
            >
              加速度
            </button>
          </div>
        </div>
      </div>
      <div className="track-canvas-wrap-outer">
        <canvas ref={canvasRef} className="track-canvas" />
        {showLayerPanel && (
          <div className="layer-panel">
            <div className="layer-panel-head">
              <span>表示レイヤ</span>
              <button className="toggle-btn" onClick={onResetLayers}>
                既定へ
              </button>
            </div>
            {groups.map((g) => (
              <div key={g} className="layer-group">
                <div className="layer-group-title">{g}</div>
                {LAYER_DEFS.filter((l) => l.group === g).map((l) => (
                  <label key={l.key} className="layer-row">
                    <input
                      type="checkbox"
                      checked={layers[l.key]}
                      onChange={() => onToggleLayer(l.key)}
                    />
                    <span>{l.label}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
        {hover && (
          <div
            className="track-hover-overlay"
            style={{
              left: Math.max(
                0,
                Math.min(hover.screenX + 14, (canvasRef.current?.clientWidth ?? 0) - 190),
              ),
              top: Math.max(
                0,
                Math.min(hover.screenY + 14, (canvasRef.current?.clientHeight ?? 0) - 110),
              ),
            }}
          >
            <div>
              <span className="hover-label">座標</span>
              {hover.worldX.toFixed(2)}, {hover.worldY.toFixed(2)}
            </div>
            <div>
              <span className="hover-label">速度</span>
              {hover.trailPoint && hover.trailDist < 3
                ? `${hover.trailPoint.speed.toFixed(2)} m/s`
                : "--"}
            </div>
            <div>
              <span className="hover-label">加速度</span>
              {hover.trailPoint && hover.trailDist < 3
                ? `${hover.trailPoint.accel.toFixed(2)} m/s²`
                : "--"}
            </div>
            <div>
              <span className="hover-label">idx</span>
              {hover.idx !== null && hover.idxDist < 3 ? `${hover.idx} (${hover.idxDist.toFixed(2)}m)` : "--"}
            </div>
            <div>
              <span className="hover-label">回廊</span>
              {hover.room
                ? `${hover.room[0].toFixed(2)} … ${hover.room[1].toFixed(2)} m`
                : "--"}
            </div>
          </div>
        )}
      </div>
      <div className="track-legend">
        <LegendItem color="#ff5f5f" label="選ばれた予測軌跡" />
        <LegendItem color="#ffd24a" label="舵候補(濃いほど低コスト・赤は接触印)" />
        <LegendItem color="#4ade80" label="MPC参照経路 / ホライズン参照点" />
        <LegendItem color="#fbbf24" label="横にずらした参照線" />
        <LegendItem color="#3b82f6" label="通れる回廊(車体+余裕込み)" />
        <LegendItem color="#c084fc" label="相手の予測位置(薄い=分岐)" />
        <LegendItem color="#8a5cff" label="車線境界" />
        <LegendItem color="#ff8a3d" label="壁の距離場" />
        <LegendItem color="#60a5fa" label="他の車(3台走行)" />
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="track-legend-item">
      <span className="track-legend-swatch" style={{ background: color }} />
      {label}
    </span>
  );
}
