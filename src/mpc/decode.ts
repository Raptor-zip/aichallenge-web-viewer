/**
 * /rl_raceline/mpc_static と /rl_raceline/mpc_debug のデコーダ(ブラウザ側)。
 *
 * ライブ配信のときはバックエンド(backend/mpc_payload.py)がデコード済みの JSON を
 * 送ってくるので、これは **rosbag をブラウザで直接開くとき** に使う。
 *
 * 並びの定義は `../mpc_schema.json` を Python と共有している(vite の
 * `@mpc-schema` エイリアス)。表を複製しないので、片方だけ直してズレる事故が起きない。
 */
import spec from "@mpc-schema";
import type { MpcDebug, MpcStatic } from "../types";

interface FieldSpec {
  name: string;
  type: string;
  round?: number;
}
interface SectionSpec {
  name: string;
  kind: "xy" | "scalar" | "records";
  count: string;
  round?: number;
  fields?: FieldSpec[];
  trailing?: { name: string; kind: string; count: string };
}
interface Spec {
  schema: number;
  enums: Record<string, string[]>;
  static: { header_len: number; header: FieldSpec[]; blocks: SectionSpec[] };
  debug: { header_len: number; header: FieldSpec[]; sections: SectionSpec[] };
}

const SPEC = spec as Spec;
export const SCHEMA = SPEC.schema;

export const PLAN_WHY_JA: Record<string, string> = {
  off: "計画OFF",
  no_opp: "相手なし",
  far: "遠い",
  fast: "相手が速い",
  slow: "自車が遅い",
  nocatch: "追いつけない",
  long: "区間が長すぎ",
  noblk: "塞がれていない",
  // 「計画が立っていて、同じ相手に仕掛け継続中」の意味(成功パス)。
  busy: "仕掛け継続中",
  ok: "並べる",
  tight: "幅が足りない",
  keep: "前回の計画を保持",
};

export const MODE_NAMES: Record<number, string> = {
  0: "RL方策",
  1: "リカバリ(REVERSE)",
  2: "PurePursuit復帰",
  3: "復帰直後の切り返し",
  4: "復帰直後の向き揃え",
  5: "PurePursuit(純古典)",
  6: "MPC",
  7: "レース開始前(待機)",
};

type Origin = [number, number];

function round(v: number, r?: number): number {
  if (r === undefined) return v;
  const m = 10 ** r;
  return Math.round(v * m) / m;
}

function conv(raw: number, f: FieldSpec, origin: Origin): unknown {
  const v = Number(raw);
  switch (f.type) {
    case "i":
      return Math.round(v);
    case "b":
      return v > 0.5;
    case "fpos":
      // 負は「掛かっていない」の意味。0 で埋めると別物になる。
      return v < 0 ? null : round(v, f.round ?? 3);
    case "wx":
      return round(v - origin[0], f.round ?? 3);
    case "wy":
      return round(v - origin[1], f.round ?? 3);
    default:
      if (f.type.startsWith("enum:")) {
        const names = SPEC.enums[f.type.slice(5)];
        const i = Math.round(v);
        return i >= 0 && i < names.length ? names[i] : "?";
      }
      return round(v, f.round);
  }
}

function setPath(out: Record<string, unknown>, dotted: string, value: unknown) {
  const parts = dotted.split(".");
  let node = out;
  for (const p of parts.slice(0, -1)) {
    if (typeof node[p] !== "object" || node[p] === null) node[p] = {};
    node = node[p] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}

class Cursor {
  constructor(private d: ArrayLike<number>, public p: number, private origin: Origin) {}

  /** x を n 個 → y を n 個、の並び(インターリーブではない)。 */
  xy(n: number): [number, number][] {
    const out: [number, number][] = [];
    const x0 = this.p;
    const y0 = this.p + n;
    for (let i = 0; i < n; i++) {
      out.push([
        round(this.d[x0 + i] - this.origin[0], 3),
        round(this.d[y0 + i] - this.origin[1], 3),
      ]);
    }
    this.p += 2 * n;
    return out;
  }

  scalars(n: number, r?: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(round(this.d[this.p + i], r));
    this.p += n;
    return out;
  }

  fields(specs: FieldSpec[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of specs) {
      setPath(out, f.name, conv(this.d[this.p], f, this.origin));
      this.p += 1;
    }
    return out;
  }
}

function sectionLen(sec: SectionSpec, counts: Record<string, number>): number {
  const n = counts[sec.count];
  if (sec.kind === "xy") return 2 * n;
  if (sec.kind === "scalar") return n;
  let per = sec.fields!.length;
  if (sec.trailing) per += 2 * counts[sec.trailing.count];
  return per * n;
}

function readSections(
  cur: Cursor,
  specs: SectionSpec[],
  counts: Record<string, number>,
  out: Record<string, unknown>,
) {
  for (const sec of specs) {
    const n = counts[sec.count];
    if (sec.kind === "xy") {
      out[sec.name] = cur.xy(n);
    } else if (sec.kind === "scalar") {
      out[sec.name] = cur.scalars(n, sec.round);
    } else {
      const recs: Record<string, unknown>[] = [];
      for (let i = 0; i < n; i++) {
        const rec = cur.fields(sec.fields!);
        if (sec.trailing) rec[sec.trailing.name] = cur.xy(counts[sec.trailing.count]);
        recs.push(rec);
      }
      out[sec.name] = recs;
    }
  }
}

function readHeader(
  data: ArrayLike<number>,
  header: FieldSpec[],
  origin: Origin,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  header.forEach((f, i) => setPath(out, f.name, conv(data[i], f, origin)));
  return out;
}

export function decodeStatic(data: ArrayLike<number>, origin: Origin): MpcStatic | null {
  const s = SPEC.static;
  if (data.length < s.header_len) return null;
  const out = readHeader(data, s.header, origin);
  if (out._version !== SCHEMA) return null;
  delete out._version;
  const n = out.n as number;
  const counts = { n };
  const need = s.header_len + s.blocks.reduce((a, b) => a + sectionLen(b, counts), 0);
  if (n <= 0 || data.length < need) return null;
  readSections(new Cursor(data, s.header_len, origin), s.blocks, counts, out);
  return { type: "mpc_static", ...(out as unknown as Omit<MpcStatic, "type">) };
}

export function decodeDebug(data: ArrayLike<number>, origin: Origin): MpcDebug | null {
  const s = SPEC.debug;
  if (data.length < s.header_len) return null;
  const out = readHeader(data, s.header, origin);
  if (out._version !== SCHEMA) return null;
  delete out._version;
  const counts = {
    horizon: out.horizon as number,
    n_cand: out.n_cand as number,
    n_opp_pred: out.n_opp_pred as number,
    n_opp_raw: out.n_opp_raw as number,
  };
  const need = s.header_len + s.sections.reduce((a, x) => a + sectionLen(x, counts), 0);
  if (counts.horizon <= 0 || data.length < need) return null;
  readSections(new Cursor(data, s.header_len, origin), s.sections, counts, out);

  // ---- 素の値から出せる、見て意味のある量(mpc_payload.py と同じ) ----
  const best = out.best as Record<string, number | null>;
  best.steer_deg = round(((best.steer as number) * 180) / Math.PI, 2);
  const costs = (out.cands as { cost: number }[]).map((c) => c.cost).sort((a, b) => a - b);
  best.margin = costs.length >= 2 ? round(costs[1] - costs[0], 3) : null;
  best.spread = costs.length >= 2 ? round(costs[costs.length - 1] - costs[0], 3) : null;
  out.plan_why_ja = PLAN_WHY_JA[out.plan_why as string] ?? out.plan_why;
  out.mode = MODE_NAMES[out.mode_code as number] ?? `unknown(${out.mode_code})`;
  delete out.n_opp_pred;
  delete out.n_opp_raw;
  return out as unknown as MpcDebug;
}
