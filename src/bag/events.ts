/**
 * 走行の「事件」をフレーム列から拾って、タイムラインに並べられる形にする。
 *
 * 300秒のバーを目で舐めて壁接触を探すのは無理なので、**見るべき瞬間だけ**を
 * 先に立てる。拾うのは、走行を後から説明するときに毎回聞かれるもの:
 *
 *   周回      … Lap2 はどこから
 *   壁接触    … どこで当てたか(ペナルティ5秒)
 *   追突      … どこで相手の後ろに入ったか(ペナルティ5km/h×10秒)
 *   追い越し  … どこで抜いた / 抜かれた
 *
 * **すべて幾何からの推定**。AWSIM の判定そのものではない。
 * `/awsim/status`(周回)や `/aichallenge/pitstop/condition`(接触で減る)が
 * bag に入っていればそちらが正なので、入っているときはそちらを優先する。
 * いまの `record_all_rosbag.bash` はどちらも録っていないので、既定では推定になる。
 */
import type { BagFrame, ResultDetails, TrackAssets } from "../types";

export type BagEventKind =
  /** 物理的にありえない減速。外力＝何かに当たった動かぬ証拠 */
  | "impact"
  /** 相手と真横で擦れ合ったまま這う膠着。罰は出ないのに時間だけ失う */
  | "deadlock"
  /** ペナルティ(5km/h制限)を食った。原因が壁 */
  | "penaltyWall"
  /** ペナルティを食った。原因が相手との接触 */
  | "penaltyCrash"
  /** ペナルティを食ったが、直前に壁も相手も見当たらない */
  | "penalty"
  | "lap"
  /** 壁すれすれ(ペナルティにはなっていない)。既定では出さない */
  | "nearWall"
  /** 車体が重なった(ペナルティにはなっていない軽い接触を含む) */
  | "contact"
  | "overtake"
  | "overtaken"
  | "nosafe"
  | "vcap"
  | "passing";

export interface BagEvent {
  t: number;
  kind: BagEventKind;
  /** 一覧とツールチップに出す一行 */
  label: string;
  /** 起きた場所(コース図に印を出すため)。周回など場所を持たないものは null */
  at: [number, number] | null;
}

export const EVENT_STYLE: Record<
  BagEventKind,
  { color: string; label: string; priority: number; defaultOn: boolean }
> = {
  impact: { color: "#ff2d55", label: "衝突(急停止)", priority: 0, defaultOn: true },
  deadlock: { color: "#ff9500", label: "膠着(真横で這う)", priority: 1, defaultOn: true },
  penaltyCrash: { color: "#ff2d55", label: "ペナルティ(追突)", priority: 2, defaultOn: true },
  penaltyWall: { color: "#ff8a3d", label: "ペナルティ(壁)", priority: 3, defaultOn: true },
  penalty: { color: "#ff6b6b", label: "ペナルティ(原因不明)", priority: 4, defaultOn: true },
  overtake: { color: "#3ddc84", label: "追い越した", priority: 5, defaultOn: true },
  overtaken: { color: "#ffcf40", label: "抜かれた", priority: 6, defaultOn: true },
  lap: { color: "#e6edf3", label: "周回", priority: 7, defaultOn: true },
  // 以下は「損はしていないが危なかった」もの。既定では畳んでおく。
  contact: { color: "#f472b6", label: "接触(ペナ無)", priority: 8, defaultOn: false },
  nearWall: { color: "#b06a2c", label: "壁すれすれ", priority: 9, defaultOn: false },
  nosafe: { color: "#ff5f5f", label: "安全な候補なし", priority: 10, defaultOn: false },
  vcap: { color: "#40c8ff", label: "縦の上限", priority: 11, defaultOn: false },
  passing: { color: "#c084fc", label: "追い越し中", priority: 12, defaultOn: false },
};

/** 5km/h = ペナルティ中の速度上限[m/s]。AWSIM がここへ直接クランプする。 */
const PENALTY_SPEED = 1.3889;

/** レースラインの弧長テーブル。相手との前後関係は経路長で見ないと意味がない。 */
class ArcLength {
  private cum: number[] = [];
  readonly total: number;

  constructor(private path: [number, number][]) {
    let s = 0;
    for (let i = 0; i < path.length; i++) {
      this.cum.push(s);
      const j = (i + 1) % path.length;
      s += Math.hypot(path[j][0] - path[i][0], path[j][1] - path[i][1]);
    }
    this.total = s;
  }

  /**
   * 点(x,y)の弧長。**線分へ射影して連続値で返す**。最近傍点の弧長をそのまま
   * 返すと、点間隔3mに対し1step 0.6mしか進まないので階段状になり、
   * 前後関係の符号が震える(コントローラの _s_of と同じ理由)。
   */
  at(x: number, y: number): number {
    const n = this.path.length;
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = (this.path[i][0] - x) ** 2 + (this.path[i][1] - y) ** 2;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    let bs = this.cum[bi];
    for (const j of [(bi - 1 + n) % n, bi]) {
      const k = (j + 1) % n;
      const ex = this.path[k][0] - this.path[j][0];
      const ey = this.path[k][1] - this.path[j][1];
      const seg2 = ex * ex + ey * ey;
      if (seg2 < 1e-9) continue;
      const t = ((x - this.path[j][0]) * ex + (y - this.path[j][1]) * ey) / seg2;
      if (t <= 0 || t >= 1) continue;
      const qx = this.path[j][0] + t * ex;
      const qy = this.path[j][1] + t * ey;
      const dd = (x - qx) ** 2 + (y - qy) ** 2;
      if (dd < bd) {
        bd = dd;
        bs = this.cum[j] + t * Math.sqrt(seg2);
      }
    }
    return bs;
  }

  /** a から見た b の前後差。正なら b が前。半周を境に符号を折り返す。 */
  gap(sa: number, sb: number): number {
    let g = (sb - sa) % this.total;
    if (g < 0) g += this.total;
    return g > this.total / 2 ? g - this.total : g;
  }
}

/** 線分を一様グリッドに入れて、近傍だけ調べられるようにする(壁判定の高速化)。 */
class SegmentGrid {
  private cell = 5;
  private buckets = new Map<string, number[]>();
  private p1: [number, number][] = [];
  private p2: [number, number][] = [];

  constructor(lines: [number, number][][]) {
    for (const line of lines) {
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i];
        const b = line[i + 1];
        const idx = this.p1.length;
        this.p1.push(a);
        this.p2.push(b);
        // 線分がまたぐセルすべてに登録する(端点だけだと長い線分が抜ける)
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / this.cell));
        for (let s = 0; s <= steps; s++) {
          const x = a[0] + ((b[0] - a[0]) * s) / steps;
          const y = a[1] + ((b[1] - a[1]) * s) / steps;
          const key = this.key(x, y);
          const arr = this.buckets.get(key);
          if (arr) {
            if (arr[arr.length - 1] !== idx) arr.push(idx);
          } else {
            this.buckets.set(key, [idx]);
          }
        }
      }
    }
  }

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
  }

  /** 点から最寄りの線分までの距離。近傍セルに何も無ければ Infinity。 */
  dist(x: number, y: number): number {
    let best = Infinity;
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const arr = this.buckets.get(`${cx + dx},${cy + dy}`);
        if (!arr) continue;
        for (const i of arr) {
          const ax = this.p1[i][0];
          const ay = this.p1[i][1];
          const ex = this.p2[i][0] - ax;
          const ey = this.p2[i][1] - ay;
          const seg2 = Math.max(ex * ex + ey * ey, 1e-9);
          let t = ((x - ax) * ex + (y - ay) * ey) / seg2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(x - (ax + t * ex), y - (ay + t * ey));
          if (d < best) best = d;
        }
      }
    }
    return best;
  }
}

/** 点群を一様グリッドに入れて近傍だけ調べる(壁距離場の境界点は1万点ある)。 */
class PointGrid {
  private cell = 5;
  private buckets = new Map<string, [number, number][]>();

  constructor(points: [number, number][]) {
    for (const p of points) {
      const key = `${Math.floor(p[0] / this.cell)},${Math.floor(p[1] / this.cell)}`;
      const arr = this.buckets.get(key);
      if (arr) arr.push(p);
      else this.buckets.set(key, [p]);
    }
  }

  dist(x: number, y: number): number {
    let best = Infinity;
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const arr = this.buckets.get(`${cx + dx},${cy + dy}`);
        if (!arr) continue;
        for (const [px, py] of arr) {
          const d = (px - x) ** 2 + (py - y) ** 2;
          if (d < best) best = d;
        }
      }
    }
    return Math.sqrt(best);
  }
}

/**
 * 車体同士が実際に重なっているか(分離軸判定)。
 *
 * **MPC の CRASH 判定域に入ったかでは見ない**。あれは「相手の後ろ2.4m×横1.7m」
 * というコスト用の近似で、渋滞で後ろに並んでいるだけでも入る。ここで欲しいのは
 * 「本当に当てた瞬間」なので、本番Collider(全長1.99m × 全幅1.54m、pose原点に対し
 * 前+1.13/後-0.86)の矩形同士が重なったかで見る。
 */
function bodiesOverlap(
  ax: number,
  ay: number,
  aYaw: number,
  bx: number,
  by: number,
  bYaw: number,
): boolean {
  const corners = (x: number, y: number, yaw: number): [number, number][] => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return ([[1.13, 0.77], [1.13, -0.77], [-0.86, -0.77], [-0.86, 0.77]] as const).map(
      ([lon, lat]) => [x + lon * c - lat * s, y + lon * s + lat * c] as [number, number],
    );
  };
  const A = corners(ax, ay, aYaw);
  const B = corners(bx, by, bYaw);
  // 矩形なので分離軸は各車の縦横2本ずつで足りる。
  for (const [yaw] of [[aYaw], [bYaw]] as const) {
    for (const [nx, ny] of [
      [Math.cos(yaw), Math.sin(yaw)],
      [-Math.sin(yaw), Math.cos(yaw)],
    ] as const) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [x, y] of A) {
        const d = x * nx + y * ny;
        if (d < a0) a0 = d;
        if (d > a1) a1 = d;
      }
      for (const [x, y] of B) {
        const d = x * nx + y * ny;
        if (d < b0) b0 = d;
        if (d > b1) b1 = d;
      }
      if (a1 < b0 || b1 < a0) return false; // この軸で分離できた
    }
  }
  return true;
}

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, "0")}`;
}

export interface DetectOptions {
  /**
   * 壁すれすれとみなす、車体から **lanelet2 車線境界** までの距離[m]。
   * 実測(2026-07-29)では、AWSIM の wall ペナルティが出た瞬間の距離が
   * 0.11m と 0.25m。0.05m では拾えないので 0.3m にしてある。
   */
  wallThreshold?: number;
  /**
   * 追い越しとみなす経路長の上限[m]。これより離れた地点での前後関係の反転は
   * 無視する。**入れないと周回遅れの相手が半周を跨ぐたびに誤検出する**
   * (前後差は半周で折り返すので、遠くの相手は符号がひとりでに反転する)。
   */
  overtakeRange?: number;
  /** AWSIM の判定(result-details.json)。あればペナルティは推定しない */
  results?: ResultDetails | null;
  /** bag の時刻 → race_time のオフセット。`race_time = t - raceT0` */
  raceT0?: number | null;
}

export function detectEvents(
  frames: BagFrame[],
  track: TrackAssets,
  opts: DetectOptions = {},
): BagEvent[] {
  const wallThreshold = opts.wallThreshold ?? 0.3;
  const overtakeRange = opts.overtakeRange ?? 30;
  const out: BagEvent[] = [];
  if (!frames.length) return out;

  const hull = track.vehicleHull.length > 2
    ? track.vehicleHull
    : ([[1.13, 0.77], [1.13, -0.77], [-0.86, -0.77], [-0.86, 0.77]] as [number, number][]);
  const grid = track.laneletBoundaries.length ? new SegmentGrid(track.laneletBoundaries) : null;
  // 壁距離場から抜いた点群。lanelet2 の車線境界は安全マージン込みで実壁より
  // 外側にあるので、**罰の原因を当てるにはこちらのほうが近い**
  // (実測: 壁に当たって止まった瞬間、lanelet では 0.5m 以内に入らないのに
  //  点群では 0.66m だった)。
  const wallPts = track.walls?.length ? new PointGrid(track.walls) : null;
  const arc = track.raceline.length > 2 ? new ArcLength(track.raceline) : null;

  // --- 周回 -------------------------------------------------------------
  // /awsim/status の lap_count があればそれが正。無ければ弧長の巻き戻りで数える。
  const hasLapCount = frames.some((f) => f.session.lap_count > 0);
  if (hasLapCount) {
    let prev = frames[0].session.lap_count;
    for (const f of frames) {
      if (f.session.lap_count !== prev) {
        out.push({
          t: f.t,
          kind: "lap",
          label: `Lap ${f.session.lap_count} 開始 (${fmt(f.t)})`,
          at: [f.pose.x, f.pose.y],
        });
        prev = f.session.lap_count;
      }
    }
  } else if (arc) {
    let travelled = 0;
    let lap = 1;
    let prevS: number | null = null;
    for (const f of frames) {
      const s = arc.at(f.pose.x, f.pose.y);
      if (prevS !== null) {
        let ds = s - prevS;
        if (ds < -arc.total / 2) ds += arc.total;
        else if (ds > arc.total / 2) ds -= arc.total;
        travelled += ds;
        if (travelled >= arc.total) {
          travelled -= arc.total;
          lap += 1;
          out.push({
            t: f.t,
            kind: "lap",
            label: `Lap ${lap} 開始 (${fmt(f.t)}、弧長から推定)`,
            at: [f.pose.x, f.pose.y],
          });
        }
      }
      prevS = s;
    }
  }

  // --- 壁すれすれ(参考) ---------------------------------------------------
  // **これはペナルティではない**。車体凸包の頂点から車線境界までの距離で
  // 「危なかった地点」を出すだけ。損をしたかどうかは下のペナルティで見る。
  // 連続して当たっている間は1件にまとめる(でないと1回の接触で数十件立つ)。
  const nearWall: { t: number; x: number; y: number; d: number }[] = [];
  // 罰の原因分類だけに使う、緩い「壁のそば」。罰が出た事実は確定しているので、
  // 接触閾値(0.05m)ほど厳しく見る必要はない。実測: 壁で罰を食った瞬間でも
  // 車体〜境界は 0.05m を割らないことがある(自己位置の誤差と、境界が
  // 実際の壁より内側にある分)。
  const wallClose: { t: number; d: number }[] = [];
  if (grid) {
    let lastT = -Infinity;
    let lastXY: [number, number] | null = null;
    for (const f of frames) {
      const c = Math.cos((f.pose.yaw_deg * Math.PI) / 180);
      const s2 = Math.sin((f.pose.yaw_deg * Math.PI) / 180);
      let min = Infinity;
      let minAny = Infinity;
      for (const [lon, lat] of hull) {
        const wx = f.pose.x + lon * c - lat * s2;
        const wy = f.pose.y + lon * s2 + lat * c;
        const d = grid.dist(wx, wy);
        if (d < min) min = d;
        const dp = wallPts ? Math.min(d, wallPts.dist(wx, wy)) : d;
        if (dp < minAny) minAny = dp;
      }
      if (minAny < 1.0) wallClose.push({ t: f.t, d: minAny });
      if (min > wallThreshold) continue;
      const moved = lastXY ? Math.hypot(f.pose.x - lastXY[0], f.pose.y - lastXY[1]) : Infinity;
      if (f.t - lastT < 1.5 && moved < 3) continue;
      lastT = f.t;
      lastXY = [f.pose.x, f.pose.y];
      nearWall.push({ t: f.t, x: f.pose.x, y: f.pose.y, d: min });
      out.push({
        t: f.t,
        kind: "nearWall",
        label: `壁すれすれ (${fmt(f.t)}、余裕 ${min.toFixed(2)}m、速度 ${f.speed_mps.toFixed(1)}m/s)`,
        at: [f.pose.x, f.pose.y],
      });
    }
  }
  /** その時刻の前後に壁のそばに居たか(ペナルティの原因分類に使う) */
  const wallNear = (t: number) => wallClose.find((w) => t - w.t >= -1.0 && t - w.t <= 4.0);

  // --- 接触と追い越し ---------------------------------------------------
  // どちらも相手ごとに前フレームとの関係を追う必要があるので、まとめて回す。
  // **接触はペナルティとは別物**。軽く触れても罰が出ないことがあるので、
  // ここでは幾何の事実だけを記録し、損をしたかはペナルティ側で見る。
  const contacts: { t: number; id: string; x: number; y: number }[] = [];
  if (arc) {
    // 相手の向き。V2X は位置しか無いので差分から出す(readBag と同じ)。
    const prevOpp = new Map<string, { x: number; y: number; yaw: number }>();
    // 相手ごとの「前回の前後関係」。符号が変われば抜いた/抜かれた。
    const prevGap = new Map<string, number>();
    const crashHold = new Map<string, number>();

    for (const f of frames) {
      const sEgo = arc.at(f.pose.x, f.pose.y);
      for (const veh of f.v2x) {
        const prev = prevOpp.get(veh.id);
        let yaw = veh.yaw ?? prev?.yaw ?? 0;
        if (prev && veh.yaw === undefined) {
          const dx = veh.x - prev.x;
          const dy = veh.y - prev.y;
          if (Math.hypot(dx, dy) > 0.05) yaw = Math.atan2(dy, dx);
        }
        prevOpp.set(veh.id, { x: veh.x, y: veh.y, yaw });

        // 追突。当たっている間は1件にまとめる(ペナルティは10秒続く)。
        const hold = crashHold.get(veh.id) ?? -Infinity;
        if (
          f.t - hold > 3 &&
          bodiesOverlap(
            f.pose.x,
            f.pose.y,
            (f.pose.yaw_deg * Math.PI) / 180,
            veh.x,
            veh.y,
            yaw,
          )
        ) {
          crashHold.set(veh.id, f.t);
          contacts.push({ t: f.t, id: veh.id, x: f.pose.x, y: f.pose.y });
          out.push({
            t: f.t,
            kind: "contact",
            label: `車体が重なった ${veh.id} (${fmt(f.t)}、速度 ${f.speed_mps.toFixed(1)}m/s)`,
            at: [f.pose.x, f.pose.y],
          });
        }

        // 前後関係。**経路長で見る**(直線距離だとU字の向こう側の車と入れ替わる)。
        const gap = arc.gap(sEgo, arc.at(veh.x, veh.y));
        const before = prevGap.get(veh.id);
        // 震え防止に2mのヒステリシス(真横を並走している間は確定させない)、
        // 上限 overtakeRange で「遠くの相手の符号飛び」を除く。
        if (
          before !== undefined &&
          Math.abs(gap) > 2 &&
          Math.abs(before) > 2 &&
          Math.abs(gap) < overtakeRange &&
          Math.abs(before) < overtakeRange
        ) {
          if (before > 0 && gap < 0) {
            out.push({
              t: f.t,
              kind: "overtake",
              label: `${veh.id} を抜いた (${fmt(f.t)})`,
              at: [f.pose.x, f.pose.y],
            });
          } else if (before < 0 && gap > 0) {
            out.push({
              t: f.t,
              kind: "overtaken",
              label: `${veh.id} に抜かれた (${fmt(f.t)})`,
              at: [f.pose.x, f.pose.y],
            });
          }
        }
        if (Math.abs(gap) > 2) prevGap.set(veh.id, gap);
      }
    }
  }

  // --- 衝突(急停止) -----------------------------------------------------
  // **これが「本当にぶつかった」の動かぬ証拠**。この車の減速上限は 8.0 m/s²
  // (vehicle.yaml の maxDeceleration)なので、それを大きく超える減速は
  // ブレーキでは出せない。外力＝何かに当たったということ。
  //
  // 位置ではなく速度で見るのが要点。**自己位置推定には実測で平均0.42m・
  // 最大1.74m の誤差がある**ので、「画面上で壁から離れているのに当たっている」
  // ことが普通に起きる。座標で当たり判定をやり直しても、その誤差は消せない。
  // 速度は推定に頼らないので、ここだけは信用できる。
  const impacts: { t: number; dv: number; x: number; y: number; wall: number }[] = [];
  {
    const dt = frames.length > 1 ? frames[1].t - frames[0].t : 0.05;
    // 8.0 m/s² はブレーキの上限。余裕を見て 12 m/s² を超えたら外力とみなす。
    const limit = 12 * dt;
    let lastT = -Infinity;
    for (let i = 1; i < frames.length; i++) {
      const dv = Math.abs(frames[i].speed_mps) - Math.abs(frames[i - 1].speed_mps);
      if (dv > -limit) continue;
      const f = frames[i];
      if (f.t - lastT < 1.5) continue;
      lastT = f.t;
      const w = wallClose.find((x) => Math.abs(x.t - f.t) < 0.3);
      impacts.push({
        t: f.t,
        dv: dv / dt,
        x: f.pose.x,
        y: f.pose.y,
        wall: w ? w.d : NaN,
      });
      const near = contacts.find((c) => Math.abs(c.t - f.t) < 1.0);
      out.push({
        t: f.t,
        kind: "impact",
        label:
          `衝突 (${fmt(f.t)}、${Math.abs(frames[i - 1].speed_mps).toFixed(1)}→` +
          `${Math.abs(f.speed_mps).toFixed(1)}m/s = ${(dv / dt).toFixed(0)}m/s²` +
          (near ? `、相手 ${near.id} と重なっていた` : "") +
          (Number.isFinite(w?.d ?? NaN)
            ? `、自己位置では壁まで ${w!.d.toFixed(2)}m`
            : "、自己位置では壁も相手も近くにない=推定がずれている可能性") +
          ")",
        at: [f.pose.x, f.pose.y],
      });
    }
  }

  // --- ペナルティ(5km/h制限) --------------------------------------------
  // **これが「損をした」の定義**。壁のすぐ横を通っただけ、軽く触れただけでは
  // 罰は出ない。幾何で当たり判定を数えるのではなく、実際に罰を食った瞬間を拾う。
  //
  // 情報源は2つ。上が正で、無いときだけ下に落ちる:
  //   1. /aichallenge/pitstop/condition が急に増えた(mpc_controller.py と同じ
  //      閾値 30。これが AWSIM 側の判定そのもの)
  //   2. 速度が 5km/h に張り付いた。ペナルティ中は AWSIM が車速をここへ直接
  //      クランプするので、「全開なのに超えられない」で分かる
  //      (rl_raceline_controller_node.py がペナ明けの検出に使っているのと同じ手)
  const hasCondition = frames.some((f) => f.condition !== null);
  const penalties: { t0: number; t1: number; kind?: string }[] = [];
  const fromResults = !!(opts.results?.penalty_events?.length && opts.raceT0 !== null &&
    opts.raceT0 !== undefined);

  if (fromResults) {
    // AWSIM が記録したペナルティ。推定と違い、種別(crash/wall/over)も
    // 秒数も向こうが持っている。突き合わせは race_time で行う。
    for (const e of opts.results!.penalty_events) {
      const t0 = e.race_time + opts.raceT0!;
      penalties.push({ t0, t1: t0 + e.duration, kind: e.kind });
    }
  } else if (hasCondition) {
    let prev: number | null = null;
    let lastT = -Infinity;
    for (const f of frames) {
      if (f.condition === null) continue;
      if (prev !== null && f.condition - prev > 30 && f.t - lastT > 3) {
        lastT = f.t;
        penalties.push({ t0: f.t, t1: f.t });
      }
      prev = f.condition;
    }
  } else {
    // 速度が 5km/h の上限に抑えられている区間。**加速指令は見ない**
    // (ros2idl のトピックが読めない bag でも動くように。速度だけで足りる)。
    //
    // AWSIM が記録したペナルティ(result-details.json の penalty_events)と
    // 突き合わせて検証した(2026-07-29、race3-cap6/cap7):
    //   AWSIM  crash race_time 27.30s 10.0s  ／ 推定 27.4s から 10.0s
    //   AWSIM  crash race_time 21.57s 10.0s  ／ 推定 21.7s から 10.0s
    // 開始が 0.1 秒(サンプリング周期ぶん)遅れるだけで継続時間は一致した。
    //
    // 「上限以下」だけだと停止中や発進待ちも入るので、区間の中に
    // **上限へ張り付いた時間**があることを要求する(実測: スタート待機は
    // 張り付き 0.2 秒、本物の罰は 2 秒以上)。
    const runs: { t0: number; t1: number; stuck: number }[] = [];
    let cur: { t0: number; t1: number; stuck: number } | null = null;
    const dt = frames.length > 1 ? frames[1].t - frames[0].t : 0.05;
    for (const f of frames) {
      const v = Math.abs(f.speed_mps);
      if (v <= PENALTY_SPEED + 0.06) {
        if (!cur) cur = { t0: f.t, t1: f.t, stuck: 0 };
        cur.t1 = f.t;
        if (Math.abs(v - PENALTY_SPEED) < 0.05) cur.stuck += dt;
      } else if (cur) {
        runs.push(cur);
        cur = null;
      }
    }
    if (cur) runs.push(cur);
    for (const r of runs) {
      if (r.t1 - r.t0 >= 2.0 && r.stuck >= 0.5) penalties.push({ t0: r.t0, t1: r.t1 });
    }
  }

  for (const p of penalties) {
    // 原因の分類。罰そのものは AWSIM が出しているが、何で食ったかは
    // 教えてくれないので、直前の数秒に何があったかで振り分ける。
    // 罰の直前(と、判定が少し遅れる分の直後1秒)に何があったか。
    const hitOpp = contacts.find((c) => p.t0 - c.t >= -1.0 && p.t0 - c.t <= 4.0);
    const hitWall = wallNear(p.t0);
    // 位置では説明できないが急停止していた＝当たってはいる(自己位置がずれている)
    const bump = impacts.find((b) => p.t0 - b.t >= -1.0 && p.t0 - b.t <= 4.0);
    const dur = p.t1 - p.t0;
    // 秒数は種別の手がかりになる。AWSIM の記録を167件集計すると
    // **追突はちょうど 10.0s**(118件中79件)、壁は 5.0s 基本だが 5〜8s に散る。
    // 10秒だけは固有値と言えるほど強いので断定に使い、あとは幾何で決める
    // (連続で食うと延長されるので、長い側は当てにならない)。
    // AWSIM の記録があれば種別はそちらが正。無いときだけ推定する。
    const looksCrash = Math.abs(dur - 10.0) <= 0.3;
    const kind: BagEventKind =
      p.kind === "crash" || (!p.kind && (looksCrash || hitOpp))
        ? "penaltyCrash"
        : p.kind === "wall" || (!p.kind && (hitWall || bump))
        ? "penaltyWall"
        : "penalty";
    const geo = hitOpp
      ? `相手 ${hitOpp.id} と重なった`
      : hitWall
      ? `壁まで ${hitWall.d.toFixed(2)}m`
      : bump
      ? `急停止 ${bump.dv.toFixed(0)}m/s²`
      : "直前に壁も相手も無し";
    const named: Record<string, string> = { crash: "追突", wall: "壁", over: "コースアウト" };
    const why =
      (p.kind
        ? named[p.kind] ?? p.kind
        : looksCrash || hitOpp
        ? "追突"
        : hitWall || bump
        ? "壁"
        : "不明") + `(${dur.toFixed(1)}s、${geo})`;
    const src = fromResults
      ? "AWSIMの記録"
      : hasCondition
      ? "condition"
      : "5km/h張り付きから推定";
    const frame = frames.find((f) => f.t >= p.t0) ?? frames[0];
    out.push({
      t: p.t0,
      kind,
      label: `ペナルティ ${why} ${fmt(p.t0)} (${src})`,
      at: [frame.pose.x, frame.pose.y],
    });
  }

  // --- 膠着(真横で擦れ合ったまま這う) -----------------------------------
  // **罰は一切出ないのに時間だけ失う**、いちばん高くつく失敗。
  // 公式評価 2026-07-29 では 56秒続いて約46秒を失った(132秒悪化の最大要因)。
  //
  //   真横に居る(縦差が小さい) → CRASH は自車前端が相手の中心より後ろで判定
  //                              されるので **無罰**
  //   横に出きれていない(車幅1.54m なので擦れている)
  //   ゆっくり動き続けている   → pin(v<0.20)も stall(完全停止2秒)も素通り
  //
  // 「ゆっくり動き続ける」ことがあらゆる検出を回避するので、ここで明示的に拾う。
  // 閾値はコントローラの RL_V2X_LOCK_* と同じ(側で対策を測るときに揃うように)。
  {
    const LON = 2.5, LAT = 1.9, V = 3.5;
    let cur: { t0: number; t1: number } | null = null;
    for (const f of frames) {
      const m = f.mpc;
      const bad =
        !!m &&
        f.speed_mps < V &&
        m.opp.some((o) => Math.abs(o.gap) < LON && Math.abs(m.lat - o.lat) < LAT);
      if (bad) {
        if (!cur) cur = { t0: f.t, t1: f.t };
        cur.t1 = f.t;
      } else if (cur) {
        if (cur.t1 - cur.t0 >= 1.0) {
          const mid = frames.find((g) => g.t >= (cur!.t0 + cur!.t1) / 2)!;
          const o = mid.mpc!.opp.reduce((a, b) =>
            Math.abs(a.gap) < Math.abs(b.gap) ? a : b);
          out.push({
            t: cur.t0,
            kind: "deadlock",
            label:
              `膠着 ${(cur.t1 - cur.t0).toFixed(1)}s (${fmt(cur.t0)}、` +
              `縦差 ${o.gap.toFixed(2)}m 横差 ${(mid.mpc!.lat - o.lat).toFixed(2)}m ` +
              `速度 ${mid.speed_mps.toFixed(1)}m/s、罰は出ない)`,
            at: [mid.pose.x, mid.pose.y],
          });
        }
        cur = null;
      }
    }
  }

  // --- MPC 由来(bag に mpc_debug が入っているときだけ) -------------------
  // 状態が変わった瞬間だけ立てる。毎フレーム立てるとバーが塗り潰される。
  let prevKind: BagEventKind | null = null;
  for (const f of frames) {
    const m = f.mpc;
    let kind: BagEventKind | null = null;
    if (m) {
      if (m.n_cand > 0 && m.n_safe === 0) kind = "nosafe";
      else if (m.v_cap !== null) kind = "vcap";
      else if (m.passing) kind = "passing";
    }
    if (kind && kind !== prevKind) {
      const detail =
        kind === "nosafe"
          ? `安全な候補なし (${fmt(f.t)}、0/${m!.n_cand})`
          : kind === "vcap"
          ? `縦の上限 ${m!.v_cap?.toFixed(1)}m/s (${fmt(f.t)})`
          : `追い越し中 (${fmt(f.t)})`;
      out.push({ t: f.t, kind, label: detail, at: [f.pose.x, f.pose.y] });
    }
    prevKind = kind;
  }

  out.sort((a, b) => a.t - b.t);
  return out;
}
