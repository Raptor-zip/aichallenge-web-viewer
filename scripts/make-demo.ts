/** Generate a genuine MCAP/CDR file from exclusively synthetic messages. */
import { mkdir, writeFile } from "node:fs/promises";
import { zstdCompressSync } from "node:zlib";
import { McapWriter } from "@mcap/core";
import { parse } from "@foxglove/rosmsg";
import { MessageWriter } from "@foxglove/rosmsg2-serialization";
import spec from "@mpc-schema";
import { demoTrack, DEMO_ORIGIN, samplePoint } from "../src/demo";

const chunks: Uint8Array[] = [];
let length = 0;
const writer = new McapWriter({ useChunks: true, compressChunk: (data) => ({ compression: "zstd", compressedData: zstdCompressSync(data) }), writable: {
  write: async (b) => { chunks.push(b.slice()); length += b.length; }, position: () => BigInt(length),
}});
await writer.start({ profile: "ros2", library: "Team KSK synthetic demo" });
const floatArray = `std_msgs/MultiArrayLayout layout\nfloat32[] data
================================================================================
MSG: std_msgs/MultiArrayLayout
std_msgs/MultiArrayDimension[] dim
uint32 data_offset
================================================================================
MSG: std_msgs/MultiArrayDimension
string label
uint32 size
uint32 stride`;
const odom = `std_msgs/Header header
string child_frame_id
geometry_msgs/PoseWithCovariance pose
geometry_msgs/TwistWithCovariance twist
================================================================================
MSG: std_msgs/Header
builtin_interfaces/Time stamp
string frame_id
================================================================================
MSG: builtin_interfaces/Time
int32 sec
uint32 nanosec
================================================================================
MSG: geometry_msgs/PoseWithCovariance
geometry_msgs/Pose pose
float64[36] covariance
================================================================================
MSG: geometry_msgs/Pose
geometry_msgs/Point position
geometry_msgs/Quaternion orientation
================================================================================
MSG: geometry_msgs/Point
float64 x
float64 y
float64 z
================================================================================
MSG: geometry_msgs/Quaternion
float64 x
float64 y
float64 z
float64 w
================================================================================
MSG: geometry_msgs/TwistWithCovariance
geometry_msgs/Twist twist
float64[36] covariance
================================================================================
MSG: geometry_msgs/Twist
geometry_msgs/Vector3 linear
geometry_msgs/Vector3 angular
================================================================================
MSG: geometry_msgs/Vector3
float64 x
float64 y
float64 z`;
const ackermann = `builtin_interfaces/Time stamp
autoware_auto_control_msgs/AckermannLateralCommand lateral
autoware_auto_control_msgs/LongitudinalCommand longitudinal
================================================================================
MSG: builtin_interfaces/Time
int32 sec
uint32 nanosec
================================================================================
MSG: autoware_auto_control_msgs/AckermannLateralCommand
builtin_interfaces/Time stamp
float32 steering_tire_angle
float32 steering_tire_rotation_rate
================================================================================
MSG: autoware_auto_control_msgs/LongitudinalCommand
builtin_interfaces/Time stamp
float32 speed
float32 acceleration
float32 jerk`;

async function channel(topic: string, name: string, schema: string) {
  const schemaId = await writer.registerSchema({ name, encoding: "ros2msg", data: new TextEncoder().encode(schema) });
  const id = await writer.registerChannel({ topic, schemaId, messageEncoding: "cdr", metadata: new Map() });
  return { id, serializer: new MessageWriter(parse(schema, { ros2: true })) };
}
const channels = {
  odom: await channel("/localization/kinematic_state", "nav_msgs/msg/Odometry", odom),
  command: await channel("/control/command/control_cmd", "autoware_auto_control_msgs/msg/AckermannControlCommand", ackermann),
  steering: await channel("/vehicle/status/steering_status", "autoware_auto_vehicle_msgs/msg/SteeringReport", "builtin_interfaces/Time stamp\nfloat32 steering_tire_angle\n================================================================================\nMSG: builtin_interfaces/Time\nint32 sec\nuint32 nanosec"),
  session: await channel("/awsim/status", "std_msgs/msg/Float32MultiArray", floatArray),
  static: await channel("/rl_raceline/mpc_static", "std_msgs/msg/Float32MultiArray", floatArray),
  mpc: await channel("/rl_raceline/mpc_debug", "std_msgs/msg/Float32MultiArray", floatArray),
};
async function send(ch: typeof channels.odom, t: number, data: unknown) {
  const time = 1_700_000_000_000_000_000n + BigInt(Math.round(t * 1e9));
  await writer.addMessage({ channelId: ch.id, sequence: Math.round(t * 10), logTime: time, publishTime: time,
    data: ch.serializer.writeMessage(data) });
}
const array = (data: number[]) => ({ layout: { dim: [], data_offset: 0 }, data });
const xy = (pts: [number, number][]) => [...pts.map((p) => p[0] + DEMO_ORIGIN[0]), ...pts.map((p) => p[1] + DEMO_ORIGIN[1])];
const track = demoTrack();
const header = (fields: { name: string }[], values: Record<string, number>) => fields.map((f) => values[f.name] ?? 0);
const n = track.raceline.length;
const staticValues = { _version: 1, n, total_len: 153, horizon: 12, dt: 0.1, n_steer: 9, n_steer2: 1,
  n_off: 3, n_accel: 3, n_accel_v2x: 3, max_steer: 0.52, wheel_base: 1.1, safe: 0.8,
  safe_pass: 0.9, w_wall: 100, w_wall_pass: 130, cbf_alpha: 0.4, cbf_rmin: 1.7,
  box_lon: 2, box_lat: 1, clear_w: 1.7, off_max_m: 2, lon_min: 0.8, v_max: 7,
  plan_on: 1, v2x_enable: 1, hard_box: 1, smoothed: 1, w_lat: 2, w_head: 2, w_prog: 1, w_dsteer: 0.1 };
await send(channels.static, 0, array([...header(spec.static.header, staticValues), ...xy(track.raceline),
  ...Array(n).fill(-2), ...Array(n).fill(2), ...Array(n).fill(6), ...Array.from({ length: n }, (_, i) => i * 153 / n)]));

for (let i = 0; i <= 600; i++) {
  const t = i * 0.1, theta = t * Math.PI * 2 / 32;
  const [x, y] = samplePoint(theta), yaw = Math.atan2(18 * Math.cos(theta), -30 * Math.sin(theta));
  const speed = Math.hypot(30 * Math.sin(theta), 18 * Math.cos(theta)) * Math.PI * 2 / 32;
  const steer = 0.1 + 0.06 * Math.cos(theta * 2), accel = 0.6 * Math.sin(theta * 2);
  const stamp = { sec: 1700000000 + Math.floor(t), nanosec: Math.round(t % 1 * 1e9) };
  await send(channels.odom, t, { header: { stamp, frame_id: "map" }, child_frame_id: "base_link",
    pose: { pose: { position: { x: x + DEMO_ORIGIN[0], y: y + DEMO_ORIGIN[1], z: 0 },
      orientation: { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) } }, covariance: Array(36).fill(0) },
    twist: { twist: { linear: { x: speed, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0.2 } }, covariance: Array(36).fill(0) } });
  await send(channels.command, t, { stamp, lateral: { stamp, steering_tire_angle: steer, steering_tire_rotation_rate: 0 },
    longitudinal: { stamp, speed, acceleration: accel, jerk: 0 } });
  await send(channels.steering, t, { stamp, steering_tire_angle: steer * 0.92 });
  await send(channels.session, t, array([300 - t, Math.floor(t / 32) + 1, t % 32, 1, 1, 3, 0]));
  const h = 12;
  const refs = Array.from({ length: h }, (_, k) => samplePoint(theta + (k + 1) * 0.022));
  const constrained = t >= 26 && t < 28;
  const vals = { _version: 1, horizon: h, dt: 0.1, n_cand: 9, n_opp_pred: 0, n_opp_raw: 0,
    "best.steer": steer, "best.accel": accel, "best.cost": 25 + 15 * Math.sin(theta) ** 2,
    off_cmd: 0.3 * Math.sin(theta), off_delta: 0, plan_tgt: 0, v_cap: t >= 10 && t < 17 ? 4 : -1,
    acc_cap: -1, threat: 0, passing: 0, plan_why: 1, side: 1, launched: 1, clearance: 2.1,
    idx: Math.floor((theta % (Math.PI * 2)) * n / (Math.PI * 2)), s_ego: t * 4.8,
    speed, steer_actual: steer * 0.92, steer_prev: steer, cbf_used: constrained ? 1 : 0,
    step_ms: 2.2 + 0.6 * Math.sin(t), mode_code: 6, n_safe: constrained ? 0 : 7,
    "pose.x": x + DEMO_ORIGIN[0], "pose.y": y + DEMO_ORIGIN[1], "pose.yaw": yaw,
    boost_remaining: 3, race_live: 1, lap_time: t % 32, session_time: 300 - t, rollout_ext: 1 };
  const debug = [...header(spec.debug.header, vals), ...xy(refs), ...xy(refs), ...xy(refs),
    ...Array(h).fill(-2), ...Array(h).fill(2), ...Array.from({ length: h }, (_, k) => t * 4.8 + k)];
  for (let k = 0; k < 9; k++) {
    const off = (k - 4) * 0.19;
    const pts: [number, number][] = refs.map(([rx, ry], j) => [rx - Math.sin(yaw) * off * j / h, ry + Math.cos(yaw) * off * j / h]);
    debug.push(steer + (k - 4) * 0.025, vals["best.cost"] + (k - 4) ** 2 * 6, constrained || k === 0 || k === 8 ? 1 : 0, ...xy(pts));
  }
  await send(channels.mpc, t, array(debug));
}
await writer.end();
await mkdir("public", { recursive: true });
await writeFile("public/demo.mcap", Buffer.concat(chunks));
await writeFile("public/demo-track.json", JSON.stringify(track));
console.log(`Synthetic ROS 2 MCAP generated: ${(length / 1e6).toFixed(2)} MB, 60 seconds`);
