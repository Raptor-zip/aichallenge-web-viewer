import type { Telemetry } from "../types";

function fmt(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "--";
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`stat ${warn ? "stat-warn" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function healthColor(ageMs: number | null): string {
  if (ageMs === null) return "#8855ff";
  if (ageMs < 300) return "#3ddc84";
  if (ageMs < 1000) return "#ffcf40";
  return "#ff4d4d";
}

function fmtRawValue(field: string, v: number | string): string {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "--";
    // インデックス系の整数値は小数表示すると読みにくいので整数のまま出す。
    if (field.endsWith("_idx") || field.endsWith("_steps") || field.endsWith("_attempts")) {
      return `${Math.round(v)}`;
    }
    return v.toFixed(4);
  }
  return v;
}

interface Props {
  telemetry: Telemetry | null;
}

const TOPIC_LABELS: Record<string, string> = {
  kinematic_state: "kinematic_state",
  steering_status: "steering_status",
  control_cmd: "control_cmd",
  gear_cmd: "gear_cmd",
  awsim_status: "awsim_status",
  admin_state: "admin_state",
  rl_debug: "rl_debug (制御モード/観測/復帰)",
  mpc_debug: "mpc_debug (MPCの毎stepの中身)",
  mpc_static: "mpc_static (参照経路/回廊/設定、latched)",
  v2x: "v2x (相手の実位置)",
};

export function StatusGrid({ telemetry }: Props) {
  if (!telemetry) {
    return (
      <div className="panel status-panel">
        <div className="panel-title">Status</div>
        <div className="waiting">WebSocketに接続中...(バックエンド起動確認)</div>
      </div>
    );
  }

  const { pose, twist, steer, accel, gear, session, admin_state, topics } = telemetry;
  const wall_markers = telemetry.wall_markers ?? [];
  const lastMarker = wall_markers.length ? wall_markers[wall_markers.length - 1] : null;
  const lapHistory = telemetry.lap_history ?? [];
  const bestLapTime = lapHistory.length ? Math.min(...lapHistory.map((l) => l.time)) : null;
  const controlMode = topics.rl_debug?.raw?.control_mode;

  return (
    <div className="panel status-panel">
      <div className="panel-title">Status</div>

      <div className="stat-section">位置・姿勢</div>
      <div className="stat-grid">
        <Stat label="x" value={fmt(pose.x)} />
        <Stat label="y" value={fmt(pose.y)} />
        <Stat label="yaw" value={`${fmt(pose.yaw_deg, 1)}°`} />
      </div>

      <div className="stat-section">速度</div>
      <div className="stat-grid">
        <Stat label="vx" value={`${fmt(twist.vx)} m/s`} />
        <Stat label="vy" value={`${fmt(twist.vy)} m/s`} />
        <Stat label="yaw rate" value={`${fmt(twist.yaw_rate)} rad/s`} />
      </div>

      <div className="stat-section">操舵 / 加速</div>
      <div className="stat-grid">
        <Stat label="steer actual" value={`${fmt(steer.actual_deg, 1)}°`} />
        <Stat label="steer cmd" value={`${fmt(steer.cmd_deg, 1)}°`} />
        <Stat label="accel cmd" value={`${fmt(accel.cmd_mps2)} m/s²`} warn={accel.cmd_mps2 < 0} />
        <Stat label="gear" value={gear} />
      </div>

      <div className="stat-section">制御モード</div>
      <div className="stat-grid">
        {/* 既定は MPC。「MPC 以外なら異常」ではなく「通常走行の分岐から
            外れていたら警告」にする(復帰・切り返し・開始前が該当)。 */}
        <Stat
          label="current mode"
          value={typeof controlMode === "string" ? controlMode : "--"}
          warn={
            typeof controlMode === "string" &&
            controlMode !== "MPC" &&
            controlMode !== "RL方策" &&
            controlMode !== "PurePursuit(純古典)"
          }
        />
      </div>

      <div className="stat-section">セッション / ブースト</div>
      <div className="stat-grid">
        <Stat label="残時間" value={`${fmt(session.session_time, 1)} s`} />
        <Stat label="lap" value={fmt(session.lap_count, 0)} />
        <Stat label="lap time" value={`${fmt(session.lap_time, 2)} s`} />
        <Stat label="section" value={fmt(session.section, 0)} />
        <Stat label="boost残" value={fmt(session.boost_remaining, 0)} />
        <Stat
          label="boosting"
          value={!Number.isFinite(session.is_boosting) ? "--" : session.is_boosting > 0.5 ? "YES" : "no"}
          warn={session.is_boosting > 0.5}
        />
        <Stat label="admin state" value={admin_state || "--"} />
      </div>

      <div className="stat-section">ラップタイム履歴</div>
      <div className="lap-history-list">
        {lapHistory.length === 0 && <div className="lap-history-empty">まだ完走したラップがありません</div>}
        {[...lapHistory].reverse().map((l) => (
          <div key={l.lap} className="lap-history-row">
            <span className="lap-history-lap">lap {l.lap}</span>
            <span
              className={
                l.time === bestLapTime ? "lap-history-time lap-history-best" : "lap-history-time"
              }
            >
              {l.time.toFixed(2)} s{l.time === bestLapTime ? " ★" : ""}
            </span>
          </div>
        ))}
      </div>

      <div className="stat-section">壁接触疑い</div>
      <div className="stat-grid">
        <Stat label="件数" value={`${wall_markers.length}`} warn={wall_markers.length > 0} />
        <Stat
          label="直近min_dist"
          value={lastMarker ? `${lastMarker.min_dist.toFixed(3)} m` : "--"}
          warn={!!lastMarker}
        />
      </div>

      <div className="stat-section">トピック健全性 / 生値</div>
      <div className="topic-health-list">
        {Object.entries(topics).map(([name, health]) => (
          <div key={name} className="topic-health-block">
            <div className="topic-health-row">
              <span
                className="health-dot"
                style={{ background: healthColor(health.age_ms) }}
              />
              <span className="topic-name">{TOPIC_LABELS[name] ?? name}</span>
              <span className="topic-meta">
                {health.age_ms === null ? "no data" : `${health.age_ms.toFixed(0)}ms ago`} · {health.hz}Hz
              </span>
            </div>
            <div className="topic-raw-list">
              {Object.entries(health.raw ?? {}).map(([field, value]) => (
                <div key={field} className="topic-raw-row">
                  <span className="topic-raw-field">{field}</span>
                  <span className="topic-raw-value">{fmtRawValue(field, value)}</span>
                </div>
              ))}
              {Object.keys(health.raw ?? {}).length === 0 && (
                <div className="topic-raw-row topic-raw-empty">no raw data yet</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
