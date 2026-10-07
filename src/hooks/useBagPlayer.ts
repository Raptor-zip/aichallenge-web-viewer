import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readInWorker } from "../bag/readInWorker";
import type {
  BagIndex,
  HistorySample,
  ResultDetails,
  TrackAssets,
  TrailPoint,
} from "../types";

const HISTORY_WINDOW_SEC = 20;
const TRAIL_MAX_POINTS = 4000;

export const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4, 8] as const;

/**
 * ドラッグ&ドロップで開いた rosbag を再生する。
 *
 * ライブ配信とは排他。bag を開いている間は WebSocket の値ではなく
 * こちらのフレームを表示する(同じ画面で「今」と「あのとき」を切り替える)。
 */
export function useBagPlayer() {
  const [bag, setBag] = useState<BagIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ frac: number; phase: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [t, setT] = useState(0);

  const bootedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastWallRef = useRef<number>(0);
  // 再生ループは毎frame動くので、最新値を ref で読む(effect の貼り直しを避ける)。
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const bagRef = useRef(bag);
  bagRef.current = bag;

  const load = useCallback(
    async (files: File | File[], track?: TrackAssets, results?: ResultDetails | null) => {
    setLoading(true);
    setError(null);
    setProgress({ frac: 0, phase: "読み込み中" });
    setPlaying(false);
    try {
      const idx = await readInWorker(
        files,
        (frac, phase) => setProgress({ frac, phase }),
        track,
        results,
      );
      setBag(idx);
      setT(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBag(null);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  },
  [],
  );

  /**
   * URL から取ってきて開く。`?bag=<url>[,<url>...]&results=<url>` の形で
   * 走行を人に渡せるようにするため。本番の bag は60秒ごとに分割されるので
   * **複数指定できる**必要がある。
   */
  const loadUrl = useCallback(
    async (urls: string | string[], track?: TrackAssets, resultsUrl?: string | null) => {
      setPlaying(false);
      const list = Array.isArray(urls) ? urls : [urls];
      setLoading(true);
      setError(null);
      setProgress({ frac: 0, phase: "ダウンロード中" });
      try {
        const files: File[] = [];
        for (const url of list) {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
          files.push(new File([await res.blob()], url.split("/").pop() || "bag.mcap"));
        }
        let results = null;
        if (resultsUrl) {
          const r = await fetch(resultsUrl);
          if (r.ok) {
            const parsed = await r.json();
            if (Array.isArray(parsed?.penalty_events)) results = parsed;
          }
        }
        await load(files, track, results);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
        setProgress(null);
      }
    },
    [load],
  );

  const close = useCallback(() => {
    setBag(null);
    setPlaying(false);
    setT(0);
    setError(null);
  }, []);

  const seek = useCallback((v: number) => {
    const b = bagRef.current;
    if (!b) return;
    setT(Math.max(0, Math.min(b.duration, v)));
  }, []);

  const stepFrame = useCallback((n: number) => {
    const b = bagRef.current;
    if (!b) return;
    setPlaying(false);
    setT((prev) => {
      const k = Math.round(prev / b.dt) + n;
      return Math.max(0, Math.min(b.duration, k * b.dt));
    });
  }, []);

  // 再生ループ。**壁時計で進める**(フレーム数で数えると、描画が重い区間で
  // 実時間よりゆっくり流れて「この現象は何秒続いたか」が読めなくなる)。
  useEffect(() => {
    if (!playing || !bag) return;
    lastWallRef.current = performance.now();
    const tick = () => {
      const now = performance.now();
      const dtWall = (now - lastWallRef.current) / 1000;
      lastWallRef.current = now;
      setT((prev) => {
        const next = prev + dtWall * speedRef.current;
        const b = bagRef.current;
        if (!b) return prev;
        if (next >= b.duration) {
          setPlaying(false);
          return b.duration;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, bag]);

  const index = bag ? Math.max(0, Math.min(bag.frames.length - 1, Math.round(t / bag.dt))) : 0;
  const frame = bag ? bag.frames[index] : null;

  // 直近20秒ぶんのストリップチャート。フレームは等間隔なので添字で切り出す。
  const history: HistorySample[] = useMemo(() => {
    if (!bag) return [];
    const span = Math.round(HISTORY_WINDOW_SEC / bag.dt);
    const from = Math.max(0, index - span);
    return bag.frames.slice(from, index + 1).map((f) => ({
      t: f.t,
      steerActual: f.steer.actual_deg,
      steerCmd: f.steer.cmd_deg,
      accelCmd: f.accel.cmd_mps2,
      accelActual: f.accel.actual_mps2,
      speed: f.speed_mps,
      cost: f.mpc ? f.mpc.best.cost : null,
      offCmd: f.mpc ? f.mpc.off_cmd : null,
      clearance: f.mpc ? f.mpc.clearance : null,
      vCap: f.mpc ? f.mpc.v_cap : null,
      stepMs: f.mpc ? f.mpc.step_ms : null,
    }));
  }, [bag, index]);

  // 走行軌跡。**再生位置までしか描かない** — 先の軌跡が見えていると
  // 「MPCがこれから何をするか」を目で先読みしてしまい、判断の検証にならない。
  const trail: TrailPoint[] = useMemo(() => {
    if (!bag) return [];
    const from = Math.max(0, index - TRAIL_MAX_POINTS);
    return bag.frames.slice(from, index + 1).map((f) => ({
      x: f.pose.x,
      y: f.pose.y,
      speed: f.speed_mps,
      accel: f.accel.cmd_mps2,
    }));
  }, [bag, index]);

  return {
    bag,
    loading,
    progress,
    error,
    load,
    loadUrl,
    /** `?bag=<url>` の自動読み込みを二重に走らせないための印 */
    bootedRef,
    close,
    playing,
    setPlaying,
    toggle: () => setPlaying((p) => !p),
    speed,
    setSpeed,
    t,
    seek,
    stepFrame,
    index,
    frame,
    history,
    trail,
  };
}
