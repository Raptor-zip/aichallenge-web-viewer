/**
 * ブラウザにドラッグ&ドロップされた rosbag(.mcap)を読んで、
 * ダッシュボードがライブで受け取っているのと同じ形のフレーム列に直す。
 *
 * バックエンド(ROS)を経由しないのが要点。走り終わったあとに
 * 「あの壁接触の3秒前、MPCは何を見ていたか」を **その場で** 巻き戻せる。
 *
 * デコードは2段:
 *   1. MCAP から (topic, 時刻, バイト列) を取り出す      … @mcap/core
 *   2. バイト列を ROS2 の CDR として読む                 … @foxglove/rosmsg2-serialization
 * スキーマ(.msg / .idl のテキスト)は MCAP の中に埋まっているので、
 * ROS の環境が無くても型が分かる。
 */
import { McapIndexedReader, McapStreamReader } from "@mcap/core";
import { decompress as zstdDecompress } from "fzstd";
import { parse as parseRos2msg } from "@foxglove/rosmsg";
import { parseRos2idl } from "@foxglove/ros2idl-parser";
import { MessageReader } from "@foxglove/rosmsg2-serialization";
import { decodeDebug, decodeStatic } from "../mpc/decode";
import type {
  BagFrame,
  BagIndex,
  MpcStatic,
  ResultDetails,
  TrackAssets,
  V2XVehicle,
} from "../types";
import { detectEvents } from "./events";

/** ダッシュボードが読む必要のあるトピック。それ以外は捨てる(/clock が大半を占める)。 */
const WANTED = new Set([
  "/localization/kinematic_state",
  "/vehicle/status/steering_status",
  "/control/command/control_cmd",
  "/control/command/gear_cmd",
  "/sensing/imu/imu_data",
  "/awsim/status",
  "/rl_raceline/debug",
  "/rl_raceline/mpc_debug",
  "/rl_raceline/mpc_static",
  "/v2x/vehicle_positions",
  // ペナルティ(5km/h制限)の正規の情報源。急に増えたら被弾。
  // `ros2 bag record -a` なら入るが、抜粋してある bag には無いことがある。
  "/aichallenge/pitstop/condition",
]);

interface RawMsg {
  topic: string;
  /** ログ時刻[s](全ファイルを通した先頭からの相対) */
  t: number;
  /** ログ時刻[s](絶対)。ファイルをまたいで並べ直すのに要る */
  wall: number;
  value: Record<string, unknown>;
}

function makeReader(schemaName: string, encoding: string, data: Uint8Array) {
  const text = new TextDecoder().decode(data);
  const defs =
    encoding === "ros2idl" ? parseRos2idl(text) : parseRos2msg(text, { ros2: true });
  // MessageReader は先頭の定義をルートとして読む。ros2idl は依存型を含めて
  // 平らに返してくるので、スキーマ名と一致するものを先頭へ持ってくる
  // (並び順に頼ると型の違うメッセージとして読んでしまう)。
  const i = defs.findIndex((d) => d.name === schemaName);
  const ordered = i > 0 ? [defs[i], ...defs.slice(0, i), ...defs.slice(i + 1)] : defs;
  return new MessageReader(ordered);
}

function yawFromQuat(z: number, w: number): number {
  return Math.atan2(2 * w * z, 1 - 2 * z * z);
}

/**
 * zstd の解凍。**本番の録画は zstd で圧縮されている**
 * (`record_all_rosbag.bash` の `--storage-preset-profile zstd_fast`)ので、
 * これが無いと `Unsupported compression zstd` で開けない。
 *
 * **純JSの fzstd を使う**。foxglove の `@mcap/support` /
 * `@foxglove/wasm-zstd` は emscripten の WASM で、vite が
 * 「ESM integration proposal for Wasm is not supported」で落ちる
 * (vite-plugin-wasm を足しても emscripten の glue とは噛み合わない)。
 * rosbag2 が使う圧縮は zstd だけなので、これで足りる。
 */
const DECOMPRESS = {
  zstd: (buffer: Uint8Array, decompressedSize: bigint) =>
    zstdDecompress(buffer, new Uint8Array(Number(decompressedSize))),
};
async function decompressHandlers() {
  return DECOMPRESS;
}

async function collect(
  file: File,
  onProgress?: (frac: number) => void,
): Promise<RawMsg[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const magic = [0x89, 0x4d, 0x43, 0x41, 0x50, 0x30, 0x0d, 0x0a];
  if (!magic.every((v, i) => buf[i] === v)) throw new Error(`${file.name}: MCAP形式ではありません`);
  const handlers = await decompressHandlers();
  const out: RawMsg[] = [];
  const readers = new Map<number, { topic: string; reader: MessageReader }>();
  let t0: number | null = null;

  const handle = (
    channelId: number,
    logTime: bigint,
    data: Uint8Array,
    chan: { topic: string; schemaId: number },
    schemas: Map<number, { name: string; encoding: string; data: Uint8Array }>,
  ) => {
    if (!WANTED.has(chan.topic)) return;
    let r = readers.get(channelId);
    if (!r) {
      const sch = schemas.get(chan.schemaId);
      if (!sch) return;
      try {
        r = { topic: chan.topic, reader: makeReader(sch.name, sch.encoding, sch.data) };
      } catch {
        return; // 読めない型は静かに飛ばす(表示に要らないものが混ざっていても止めない)
      }
      readers.set(channelId, r);
    }
    const secs = Number(logTime) / 1e9;
    if (t0 === null) t0 = secs;
    try {
      out.push({
        topic: r.topic,
        t: secs - t0,
        wall: secs,
        value: r.reader.readMessage(data) as Record<string, unknown>,
      });
    } catch {
      /* 1本壊れていても残りは読む */
    }
  };

  // インデックス付きなら summary から、無ければ頭から流し読みする。
  try {
    const reader = await McapIndexedReader.Initialize({
      readable: {
        size: async () => BigInt(buf.byteLength),
        read: async (offset: bigint, length: bigint) =>
          buf.subarray(Number(offset), Number(offset + length)),
      },
      decompressHandlers: handlers,
    });
    if (reader.chunkIndexes.length === 0) throw new Error("MCAP has no chunk index; use streaming reader");
    const schemas = new Map(
      [...reader.schemasById].map(([id, s]) => [id, { name: s.name, encoding: s.encoding, data: s.data }]),
    );
    const total = reader.statistics?.messageCount ?? 0n;
    let seen = 0;
    for await (const m of reader.readMessages()) {
      const chan = reader.channelsById.get(m.channelId);
      if (chan) handle(m.channelId, m.logTime, m.data, chan, schemas);
      if (onProgress && total > 0n && ++seen % 5000 === 0) {
        onProgress(seen / Number(total));
      }
    }
  } catch {
    // If indexed reading failed after yielding messages, do not retain that
    // partial prefix when falling back to the stream reader.
    out.length = 0;
    readers.clear();
    t0 = null;
    const stream = new McapStreamReader({ decompressHandlers: handlers });
    stream.append(buf);
    const schemas = new Map<number, { name: string; encoding: string; data: Uint8Array }>();
    const chans = new Map<number, { topic: string; schemaId: number }>();
    for (let rec = stream.nextRecord(); rec; rec = stream.nextRecord()) {
      if (rec.type === "Schema") {
        schemas.set(rec.id, { name: rec.name, encoding: rec.encoding, data: rec.data });
      } else if (rec.type === "Channel") {
        chans.set(rec.id, { topic: rec.topic, schemaId: rec.schemaId });
      } else if (rec.type === "Message") {
        const chan = chans.get(rec.channelId);
        if (chan) handle(rec.channelId, rec.logTime, rec.data, chan, schemas);
      }
    }
  }
  out.sort((a, b) => a.wall - b.wall);
  return out;
}

const AWSIM_FIELDS = [
  "session_time", "lap_count", "lap_time", "section",
  "time_scale", "boost_remaining", "is_boosting",
] as const;

/**
 * bag のメッセージ列を、一定周期のフレーム列へ落とす。
 *
 * ROS のトピックはそれぞれ勝手なレートで来るので、そのまま並べても
 * 「この瞬間の全体像」にならない。**直近値ホールド**(その時刻までに来た
 * 最後の値)で揃える — rviz や PlotJuggler と同じ読み方。
 */
export async function readBag(
  /**
   * .mcap。**複数渡せる**。本番の録画は `--max-bag-duration 60` で
   * `rosbag2_all_0.mcap`, `_1`, `_2` … と分割されるので、
   * 1つだけ開くと走行の一部しか見えない。
   */
  input: File | File[],
  onProgress?: (frac: number, phase: string) => void,
  /**
   * コース図の静的データ。**必ず渡すこと**。
   * - `origin` … bag の中身は world 絶対座標なので、コース図と違う原点で
   *   相対化すると全体が丸ごとずれる。実測: 原点を「bag の最初の自己位置」に
   *   していたときは raceline.csv の先頭点と 3.45m ずれ、コース幅4〜6mの
   *   このコースでは自車が常に壁へめり込んで見えていた。
   * - 車線境界・レースライン・車体凸包 … 壁接触や追い越しの検出に使う。
   */
  track?: TrackAssets,
  /**
   * 同じ走行の `d?-result-details.json`。**AWSIM の判定そのもの**なので、
   * 渡されたらペナルティは推定せずこちらを使う。
   */
  results?: ResultDetails | null,
): Promise<BagIndex> {
  onProgress?.(0, "読み込み中");
  const files = (Array.isArray(input) ? input : [input])
    .slice()
    // _0, _1, _2 … の順に読む(名前の数字で並べる)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const msgs: RawMsg[] = [];
  for (let i = 0; i < files.length; i++) {
    const part = await collect(files[i], (f) =>
      onProgress?.(((i + f) / files.length) * 0.8, `デコード中 (${i + 1}/${files.length})`),
    );
    msgs.push(...part);
  }
  // ファイルごとに先頭を 0 にしているので、通しの時刻に直してから並べ直す。
  msgs.sort((a, b) => a.wall - b.wall);
  const w0 = msgs.length ? msgs[0].wall : 0;
  for (const m of msgs) m.t = m.wall - w0;
  onProgress?.(0.85, "整列中");
  if (msgs.length === 0) {
    throw new Error(
      "ダッシュボードが読めるトピックが1つも入っていません" +
        "(/localization/kinematic_state などが必要です)",
    );
  }

  // 座標原点。**コース図(track.json / WebSocketのtrack)と同じものを使う**。
  // これが一致していないとコースと軌跡が丸ごとずれる。
  // 渡されなかったときだけ bag の中から決める(コースも描けない状況なので
  // 相対位置の意味は薄いが、軌跡の形だけは見られるようにしておく)。
  const staticMsg = msgs.find((m) => m.topic === "/rl_raceline/mpc_static");
  const firstOdom = msgs.find((m) => m.topic === "/localization/kinematic_state");
  if (!firstOdom) throw new Error("自己位置 /localization/kinematic_state がありません。対応トピックをREADMEで確認してください");
  let origin: [number, number] = [0, 0];
  if (track) {
    origin = track.origin;
  } else if (firstOdom) {
    const p = (firstOdom.value.pose as any).pose.position;
    origin = [p.x, p.y];
  }

  let mpcStatic: MpcStatic | null = null;
  if (staticMsg) {
    mpcStatic = decodeStatic(staticMsg.value.data as ArrayLike<number>, origin);
  }

  const duration = msgs[msgs.length - 1].t;
  const dt = 0.05; // 20Hz。ライブ配信の既定と同じ
  const nFrames = Math.max(1, Math.floor(duration / dt) + 1);

  // 直近値ホールド用のカーソル
  const state = {
    pose: { x: 0, y: 0, yaw_deg: 0 },
    twist: { vx: NaN, vy: NaN, yaw_rate: NaN },
    steerActual: NaN,
    steerCmd: NaN,
    accelCmd: NaN,
    accelActual: NaN,
    speedCmd: NaN,
    gear: "?",
    session: Object.fromEntries(AWSIM_FIELDS.map((k) => [k, NaN])) as Record<string, number>,
    mpc: null as ReturnType<typeof decodeDebug>,
    v2x: [] as V2XVehicle[],
    /** 車両コンディション。null は「そのトピックが bag に無い」 */
    condition: null as number | null,
  };
  // 相手の **向き**。V2Xは位置しか配信しないので、位置の差分から出す。
  // コース接線での近似はヘアピンで隣の区間を拾うことがあり、当たり判定の
  // 箱が明後日を向く。動いている限りは差分のほうが正しい。
  const v2xYaw = new Map<string, { x: number; y: number; yaw: number }>();

  const apply = (m: RawMsg) => {
    const v = m.value as any;
    switch (m.topic) {
      case "/localization/kinematic_state": {
        const p = v.pose.pose;
        const t = v.twist.twist;
        state.pose = {
          x: p.position.x - origin[0],
          y: p.position.y - origin[1],
          yaw_deg: (yawFromQuat(p.orientation.z, p.orientation.w) * 180) / Math.PI,
        };
        state.twist = { vx: t.linear.x, vy: t.linear.y, yaw_rate: t.angular.z };
        break;
      }
      case "/vehicle/status/steering_status":
        state.steerActual = (v.steering_tire_angle * 180) / Math.PI;
        break;
      case "/control/command/control_cmd":
        state.steerCmd = (v.lateral.steering_tire_angle * 180) / Math.PI;
        state.accelCmd = v.longitudinal.acceleration;
        state.speedCmd = v.longitudinal.speed;
        break;
      case "/control/command/gear_cmd":
        state.gear = v.command === 2 ? "DRIVE" : v.command === 20 ? "REVERSE" : `${v.command}`;
        break;
      case "/sensing/imu/imu_data":
        state.accelActual = v.linear_acceleration.x;
        break;
      case "/awsim/status":
        AWSIM_FIELDS.forEach((k, i) => {
          state.session[k] = v.data[i] ?? NaN;
        });
        break;
      case "/rl_raceline/mpc_debug":
        state.mpc = decodeDebug(v.data as ArrayLike<number>, origin);
        break;
      case "/aichallenge/pitstop/condition":
        state.condition = Number(v.data);
        break;
      case "/v2x/vehicle_positions":
        state.v2x = (v.vehicles ?? []).map((veh: any) => {
          const id = String(veh.vehicle_id);
          const x = veh.position.x - origin[0];
          const y = veh.position.y - origin[1];
          const prev = v2xYaw.get(id);
          let yaw = prev?.yaw;
          if (prev) {
            const dx = x - prev.x;
            const dy = y - prev.y;
            // 止まっているときの差分は雑音なので、動いた分だけ更新する。
            if (Math.hypot(dx, dy) > 0.05) yaw = Math.atan2(dy, dx);
          }
          v2xYaw.set(id, { x, y, yaw: yaw ?? 0 });
          return { id, x, y, yaw };
        });
        break;
      default:
        break;
    }
  };

  const frames: BagFrame[] = [];
  let mi = 0;
  for (let k = 0; k < nFrames; k++) {
    const t = k * dt;
    while (mi < msgs.length && msgs[mi].t <= t) apply(msgs[mi++]);
    frames.push({
      t,
      pose: { ...state.pose },
      twist: { ...state.twist },
      speed_mps: state.twist.vx,
      steer: { actual_deg: state.steerActual, cmd_deg: state.steerCmd, max_deg: 30 },
      accel: {
        cmd_mps2: state.accelCmd,
        speed_cmd_mps: state.speedCmd,
        actual_mps2: state.accelActual,
      },
      gear: state.gear,
      session: { ...state.session } as BagFrame["session"],
      mpc: state.mpc,
      v2x: state.v2x.slice(),
      condition: state.condition,
    });
  }

  const topics: Record<string, number> = {};
  for (const m of msgs) topics[m.topic] = (topics[m.topic] ?? 0) + 1;

  // race_time(レース開始からの秒)と bag の時刻の対応。
  // /awsim/status の session_time は残り時間なので、動き出した瞬間に
  // 「timeout - 残り」= 経過時間 が分かる。result-details.json の
  // race_time と突き合わせるのに要る。
  let raceT0: number | null = null;
  if (results?.session_timeout) {
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1].session.session_time;
      const b = frames[i].session.session_time;
      if (a !== b && b > 0) {
        raceT0 = frames[i].t - (results.session_timeout - b);
        break;
      }
    }
  }

  onProgress?.(0.95, "事件を拾い出し中");
  const events = track
    ? detectEvents(frames, track, { results: results ?? null, raceT0 })
    : [];
  const laps = [0, ...events.filter((e) => e.kind === "lap").map((e) => e.t)];

  onProgress?.(1, "完了");
  return {
    name: files.length > 1 ? `${files[0].name} ほか${files.length - 1}本` : files[0].name,
    duration,
    dt,
    frames,
    mpcStatic,
    topics,
    hasMpc: frames.some((f) => f.mpc !== null),
    events,
    laps,
    lapsFromStatus: frames.some((f) => f.session.lap_count > 0),
    results: results ?? null,
    raceT0,
  };
}
