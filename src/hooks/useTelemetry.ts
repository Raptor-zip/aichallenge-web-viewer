import { useCallback, useEffect, useRef, useState } from "react";
import type {
  HistorySample,
  MpcStatic,
  ServerMsg,
  Telemetry,
  TrackMsg,
  TrailPoint,
  VehicleModel,
} from "../types";

const HISTORY_WINDOW_SEC = 20;
const TRAIL_MAX_POINTS = 4000;

export type ConnState = "idle" | "connecting" | "open" | "closed";

/** 履歴・軌跡は車ごとに持つ(車を切り替えても相手の履歴が混ざらないように)。 */
interface PerVehicle {
  history: HistorySample[];
  trail: TrailPoint[];
}

export function useTelemetry(enabled = false, endpoint = "ws://127.0.0.1:8765") {
  const [connState, setConnState] = useState<ConnState>("idle");
  /** 全車ぶんの最新値。単独走行なら1台だけ入る。 */
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<Telemetry[]>([]);
  /** 見ている車(ROS_DOMAIN_ID)。null なら最初の1台。 */
  const [selected, setSelected] = useState<number | null>(null);
  const [raceline, setRaceline] = useState<[number, number][]>([]);
  const [walls, setWalls] = useState<[number, number][]>([]);
  const [vehicleHull, setVehicleHull] = useState<[number, number][]>([]);
  const [laneletBoundaries, setLaneletBoundaries] = useState<[number, number][][]>([]);
  const [vehicleModel, setVehicleModel] = useState<VehicleModel | null>(null);
  // コース図の座標原点(world絶対座標)。rosbag を同じ図に重ねるのに要る。
  const [trackOrigin, setTrackOrigin] = useState<[number, number] | null>(null);
  // コースの取得が決着したか(成功・失敗どちらでも true)。
  // rosbag の自動読み込みは **原点が決まってから** 始めないと、
  // 原点なしで相対化してしまいコースと軌跡がずれる。
  const [trackLoaded, setTrackLoaded] = useState(true);
  /** 車ごとの mpc_static(参照経路・回廊)。設定を変えた車を並べても混ざらない。 */
  const [mpcStaticByDomain, setMpcStaticByDomain] = useState<Record<number, MpcStatic>>({});
  const perVehicleRef = useRef<Map<number, PerVehicle>>(new Map());
  const [historyVersion, setHistoryVersion] = useState(0);

  const applyTrack = useCallback((track: TrackMsg | null) => {
    setRaceline(track?.raceline ?? []);
    setWalls(track?.walls ?? []);
    setVehicleHull(track?.vehicle_hull ?? []);
    setLaneletBoundaries(track?.lanelet_boundaries ?? []);
    setVehicleModel(track?.vehicle_model ?? null);
    setTrackOrigin(track?.origin ?? null);
    setTrackLoaded(true);
  }, []);

  useEffect(() => {
    if (!enabled) { setConnState("idle"); return; }
    let ws: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let closedByUs = false;

    const connect = () => {
      setConnState("connecting");
      setConnectionError(null);
      try {
        const parsed = new URL(endpoint);
        if (!["ws:", "wss:"].includes(parsed.protocol)) throw new Error("ws:// または wss:// を指定してください");
        ws = new WebSocket(parsed);
      } catch (error) {
        setConnState("closed");
        setConnectionError(error instanceof Error ? error.message : String(error));
        return;
      }

      ws.onopen = () => setConnState("open");

      ws.onmessage = (ev) => {
        let msg: ServerMsg;
        try { msg = JSON.parse(ev.data) as ServerMsg; }
        catch { setConnectionError("JSON形式のテレメトリではありません"); return; }
        if (msg.type === "track") {

          setRaceline(msg.raceline);
          setWalls(msg.walls ?? []);
          setVehicleHull(msg.vehicle_hull ?? []);
          setLaneletBoundaries(msg.lanelet_boundaries ?? []);
          setVehicleModel(msg.vehicle_model ?? null);
          if (msg.origin) setTrackOrigin(msg.origin);
          setTrackLoaded(true);
          return;
        }
        if (msg.type === "mpc_static") {
          // コントローラの起動が後になることがあるので、track とは別便で届く。
          setMpcStaticByDomain((prev) => ({ ...prev, [msg.domain ?? 0]: msg }));
          return;
        }
        if (msg.type === "telemetry") {
          if (!Array.isArray(msg.vehicles)) { setConnectionError("vehicles配列がありません"); return; }
          setVehicles(msg.vehicles);
          for (const v of msg.vehicles) {
            let pv = perVehicleRef.current.get(v.domain);
            if (!pv) {
              pv = { history: [], trail: [] };
              perVehicleRef.current.set(v.domain, pv);
            }
            const mpc = v.mpc;
            pv.history.push({
              t: v.t,
              steerActual: v.steer.actual_deg,
              steerCmd: v.steer.cmd_deg,
              accelCmd: v.accel.cmd_mps2,
              accelActual: v.accel.actual_mps2,
              speed: v.speed_mps,
              cost: mpc ? mpc.best.cost : null,
              offCmd: mpc ? mpc.off_cmd : null,
              clearance: mpc ? mpc.clearance : null,
              vCap: mpc ? mpc.v_cap : null,
              stepMs: mpc ? mpc.step_ms : null,
            });
            const cutoff = v.t - HISTORY_WINDOW_SEC;
            while (pv.history.length && pv.history[0].t < cutoff) pv.history.shift();

            pv.trail.push({
              x: v.pose.x,
              y: v.pose.y,
              speed: v.speed_mps,
              accel: v.accel.cmd_mps2,
            });
            if (pv.trail.length > TRAIL_MAX_POINTS) pv.trail.shift();
          }
          setHistoryVersion((n) => n + 1);
        }
      };

      ws.onclose = () => {
        setConnState("closed");
        if (!closedByUs) {
          reconnectTimer = window.setTimeout(connect, 1000);
        }
      };

      ws.onerror = () => {
        setConnectionError("ブリッジに接続できません。URLとROS側の起動状態を確認してください");
        ws?.close();
      };
    };

    connect();

    return () => {
      closedByUs = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [enabled, endpoint]);

  const telemetry =
    vehicles.find((v) => v.domain === selected) ?? vehicles[0] ?? null;
  const domain = telemetry?.domain ?? null;
  const pv = domain !== null ? perVehicleRef.current.get(domain) : undefined;
  const mpcStatic =
    (domain !== null ? mpcStaticByDomain[domain] : undefined) ??
    mpcStaticByDomain[0] ??
    null;

  const selectDomain = useCallback((d: number) => setSelected(d), []);

  return {
    connState,
    connectionError,
    applyTrack,
    telemetry,
    vehicles,
    /** 見ている車以外(コース図に薄く重ねる) */
    others: vehicles.filter((v) => v.domain !== domain),
    selectedDomain: domain,
    selectDomain,
    raceline,
    walls,
    vehicleHull,
    laneletBoundaries,
    vehicleModel,
    trackOrigin,
    trackLoaded,
    mpcStatic,
    history: pv?.history ?? [],
    trail: pv?.trail ?? [],
    historyVersion,
  };
}
