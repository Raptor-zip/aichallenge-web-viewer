import type { TrackMsg } from "./types";

export const DEMO_ORIGIN: [number, number] = [100, -40];
export function samplePoint(theta: number, radius = 0): [number, number] {
  return [(30 + radius) * Math.cos(theta), (18 + radius) * Math.sin(theta)];
}

/** All geometry is mathematical synthetic data, unrelated to an actual course. */
export function demoTrack(): TrackMsg {
  const line = (r: number) => Array.from({ length: 160 }, (_, i) => samplePoint(i * Math.PI * 2 / 160, r));
  return { type: "track", origin: DEMO_ORIGIN, raceline: line(0), walls: [...line(-3), ...line(3)],
    lanelet_boundaries: [line(-3), line(3)], vehicle_hull: [[1, 0.6], [1, -0.6], [-1, -0.6], [-1, 0.6]], vehicle_model: null };
}
