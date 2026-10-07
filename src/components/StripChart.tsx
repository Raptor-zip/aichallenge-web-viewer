import { useEffect, useRef } from "react";
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Legend,
  Tooltip,
  type ChartDataset,
} from "chart.js";
import type { HistorySample } from "../types";

Chart.register(LineController, LineElement, PointElement, LinearScale, Legend, Tooltip);

const HISTORY_WINDOW_SEC = 20;

interface SeriesSpec {
  label: string;
  color: string;
  /**
   * null を返した step は線を切る(打点しない)。MPC の量は「掛かっていない」
   * と「0」がまったく違う意味なので、0 で埋めてはいけない
   * (縦の上限が外れた瞬間を 0m/s の急減速に見せてしまう)。
   */
  values: (h: HistorySample) => number | null;
  /** 指定したサンプル数の移動平均で平滑化する(IMU実測のような高周波振動ノイズ用)。未指定なら生値のまま。 */
  smoothWindow?: number;
}

// 単純移動平均。窓の前半が欠けるstart側は詰めて平均するので、系列の長さ・時刻軸は変えない。
function movingAverage(values: number[], window: number): number[] {
  if (window <= 1) return values;
  const out = new Array(values.length);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    const n = Math.min(i + 1, window);
    out[i] = sum / n;
  }
  return out;
}

interface RowProps {
  title: string;
  unit: string;
  /** 未指定なら Chart.js の自動スケール(コストのように範囲が読めない量に使う) */
  yMin?: number;
  yMax?: number;
  series: SeriesSpec[];
  history: HistorySample[];
}

function ChartRow({ title, unit, yMin, yMax, series, history }: RowProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const now = history.length ? history[history.length - 1].t : 0;
    const times = history.map((h) => h.t - now);
    const datasets: ChartDataset<"line", { x: number; y: number | null }[]>[] = series.map((s) => {
      const raw = history.map((h) => { const v = s.values(h); return v !== null && Number.isFinite(v) ? v : null; });
      // 平滑化は「欠けの無い系列」にだけ意味がある。null を含む系列はそのまま。
      const smoothed =
        s.smoothWindow && raw.every((v) => v !== null)
          ? movingAverage(raw as number[], s.smoothWindow)
          : raw;
      return {
        label: s.label,
        borderColor: s.color,
        backgroundColor: s.color,
        pointRadius: 0,
        borderWidth: 2,
        tension: 0,
        spanGaps: false,
        data: times.map((t, i) => ({ x: t, y: smoothed[i] })),
      };
    });

    if (!chartRef.current) {
      chartRef.current = new Chart(canvas, {
        type: "line",
        data: { datasets },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          parsing: false,
          normalized: true,
          interaction: { mode: "nearest", axis: "x", intersect: false },
          scales: {
            x: {
              type: "linear",
              min: -HISTORY_WINDOW_SEC,
              max: 0,
              ticks: {
                color: "#7ec8e3",
                stepSize: 5,
                callback: (v) => `${v}s`,
              },
              grid: { color: "#1a2430" },
              title: { display: true, text: "経過時間(秒前)", color: "#7ec8e3", font: { size: 10 } },
            },
            y: {
              min: yMin,
              max: yMax,
              ticks: { color: "#7ec8e3" },
              grid: { color: "#1a2430" },
              title: { display: true, text: unit, color: "#7ec8e3", font: { size: 10 } },
            },
          },
          plugins: {
            legend: {
              display: true,
              position: "top",
              align: "end",
              labels: { color: "#e6edf3", boxWidth: 10, font: { size: 10 } },
            },
            tooltip: {
              enabled: true,
              callbacks: {
                title: (items) => `${(items[0]?.parsed.x ?? 0).toFixed(1)}s`,
                label: (item) => `${item.dataset.label}: ${(item.parsed.y ?? 0).toFixed(2)}${unit}`,
              },
            },
          },
        },
      });
    } else {
      chartRef.current.data.datasets = datasets;
      chartRef.current.update("none");
    }
  }, [history, series, unit, yMin, yMax]);

  useEffect(() => {
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  const latest = series.map((s) => (history.length ? s.values(history[history.length - 1]) : null));

  return (
    <div className="chart-row">
      <div className="chart-row-header">
        <span className="chart-title">{title}</span>
        <span className="chart-legend">
          {series.map((s, i) => (
            <span key={s.label} className="legend-item">
              <span className="legend-swatch" style={{ background: s.color }} />
              {s.label}: {latest[i] === null ? "—" : `${latest[i]!.toFixed(2)}${unit}`}
            </span>
          ))}
        </span>
      </div>
      <div className="chart-canvas-wrap">
        <canvas ref={canvasRef} className="chart-canvas" />
      </div>
    </div>
  );
}

interface Props {
  history: HistorySample[];
  maxSteerDeg: number;
  /** MPCの系列(コスト・横オフセット・計算時間)を出すか */
  hasMpc: boolean;
}

// 実車の物理限界(aichallenge/simulator/AWSIM/AWSIM_Data/StreamingAssets/Vehicle/vehicle.yaml、
// [[awsim-vehicle-spec]]で確認済みの真値)にコントローラの実際のクリップ値を合わせて軸を決める。
// パディングなし=実際に出せる値の範囲そのもの。
//   maxSteerAngle: 30deg(vehicle.yaml)。actual/cmdともこれを超えることは物理的にない。
//   ACCEL_MAX=1.37 m/s²(vehicle.yamlのmaxAcceleration実測値そのもの、rl_raceline_controller_node.py)
//   BRAKE_MAX=2.5 m/s²(同node。実車物理上限のmaxDeceleration=8.0より保守的だが、
//     コントローラが実際に出す指令はこのクリップを超えないので表示範囲としてはこちらが正しい)
const ACCEL_CMD_MAX_MPS2 = 1.37;
const BRAKE_CMD_MAX_MPS2 = 2.5;
// 速度には物理的なハード上限が無い(vehicle.yamlにmaxSpeed相当の定数は存在せず、
// 加速度・抗力から創発する)。実機A/B計測での最高速10.1m/s(ACCEL_MAX=1.37時、2026-07-24
// 実測、rl_raceline_controller_node.py冒頭コメント)に安全マージンを載せた12m/sを使う。
const SPEED_AXIS_MAX_MPS = 12;
// REVERSE復帰中は後ろ向きに走るのでvxが負になる。_steps_for_distance()の
// 「後退速度上限(-2.5m/s)」= v = max(-2.5, v - rec_accel*0.1) がコントローラの
// 実際のクリップ値なので、それを下限として使う(以前は0固定でグラフが潰れていた)。
const SPEED_AXIS_MIN_MPS = -2.5;

export function StripChart({ history, maxSteerDeg, hasMpc }: Props) {
  return (
    <div className="panel chart-panel">
      <div className="panel-title">History (last {HISTORY_WINDOW_SEC}s)</div>
      <ChartRow
        title="Steering"
        unit="deg"
        yMin={-maxSteerDeg}
        yMax={maxSteerDeg}
        history={history}
        series={[
          { label: "actual", color: "#40c8ff", values: (h) => h.steerActual },
          { label: "cmd", color: "#ff6b6b", values: (h) => h.steerCmd },
        ]}
      />
      <ChartRow
        title="Accel (actual vs cmd)"
        unit=" m/s²"
        yMin={-BRAKE_CMD_MAX_MPS2}
        yMax={ACCEL_CMD_MAX_MPS2}
        history={history}
        series={[
          // IMU実測(linear_acceleration.x)は路面振動由来の高周波ノイズが乗るため、
          // 15サンプル(配信20Hz換算で約0.75秒)の移動平均で平滑化して傾向が見えるようにする。
          { label: "actual", color: "#40c8ff", values: (h) => h.accelActual, smoothWindow: 15 },
          { label: "cmd", color: "#ff6b6b", values: (h) => h.accelCmd },
        ]}
      />
      <ChartRow
        title="Speed"
        unit=" m/s"
        yMin={SPEED_AXIS_MIN_MPS}
        yMax={SPEED_AXIS_MAX_MPS}
        history={history}
        series={[
          { label: "speed", color: "#7dff9e", values: (h) => h.speed },
          // 縦の上限。掛かっていない間は線が消えるので「いつ効いたか」が一目で分かる。
          { label: "v_cap", color: "#ffb454", values: (h) => h.vCap },
        ]}
      />
      {hasMpc && (
        <>
          <ChartRow
            title="MPC cost (最良候補)"
            unit=""
            history={history}
            series={[{ label: "cost", color: "#c084fc", values: (h) => h.cost }]}
          />
          <ChartRow
            title="横オフセット指令 / 壁までの余裕"
            unit=" m"
            yMin={-3}
            yMax={4}
            history={history}
            series={[
              { label: "off_cmd", color: "#fbbf24", values: (h) => h.offCmd },
              { label: "clearance", color: "#40c8ff", values: (h) => h.clearance },
            ]}
          />
          <ChartRow
            title="1stepの計算時間"
            unit=" ms"
            yMin={0}
            yMax={110}
            history={history}
            series={[{ label: "step", color: "#ff6b6b", values: (h) => h.stepMs }]}
          />
        </>
      )}
    </div>
  );
}
