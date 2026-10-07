import type { TrackAssets, TrackMsg } from "./types";

function point(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((x) => typeof x === "number" && Number.isFinite(x));
}

export function parseTrack(value: unknown): TrackMsg {
  if (!value || typeof value !== "object") throw new Error("track.jsonはオブジェクトが必要です");
  const v = value as Record<string, unknown>;
  if (!point(v.origin)) throw new Error("track.jsonに座標原点 origin: [x, y] が必要です");
  const points = (key: string): [number, number][] => {
    const rows = v[key] ?? [];
    if (!Array.isArray(rows) || !rows.every(point)) throw new Error(`${key}は有限な[x,y]の配列が必要です`);
    return rows as [number, number][];
  };
  const bounds = v.lanelet_boundaries ?? [];
  if (!Array.isArray(bounds) || !bounds.every((line) => Array.isArray(line) && line.every(point))) {
    throw new Error("lanelet_boundariesの座標が不正です");
  }
  // The optional detailed vehicle mesh is deliberately omitted on import.
  // The supplied hull, or the viewer's rectangle fallback, represents the body.
  return { type: "track", origin: v.origin, raceline: points("raceline"), walls: points("walls"),
    vehicle_hull: points("vehicle_hull"), lanelet_boundaries: bounds, vehicle_model: null };
}

export function trackAssets(track: TrackMsg | null): TrackAssets | undefined {
  return track?.origin ? { origin: track.origin, raceline: track.raceline, walls: track.walls,
    vehicleHull: track.vehicle_hull, laneletBoundaries: track.lanelet_boundaries } : undefined;
}
