import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTelemetry } from "./hooks/useTelemetry";
import { useResizableColumns } from "./hooks/useResizableColumns";
import { useLayers } from "./hooks/useLayers";
import { useBagPlayer } from "./hooks/useBagPlayer";
import { StatusGrid } from "./components/StatusGrid";
import { MpcPanel } from "./components/MpcPanel";
import { TrackView } from "./components/TrackView";
import { StripChart } from "./components/StripChart";
import { PlaybackBar } from "./components/PlaybackBar";
import { EVENT_STYLE } from "./bag/events";
import type { Telemetry, TrackAssets, TrackMsg, ResultDetails } from "./types";
import { demoTrack } from "./demo";
import { parseTrack, trackAssets as assetsForTrack } from "./track";
import "./App.css";

type LeftTab = "mpc" | "status";

export default function App() {
  const query = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState<"files" | "demo" | "live">(query.has("ws") ? "live" : "files");
  const [endpoint, setEndpoint] = useState(query.get("ws") ?? "ws://127.0.0.1:8765");
  const [showConnect, setShowConnect] = useState(query.has("ws"));
  const [importError, setImportError] = useState<string | null>(null);
  const [trackName, setTrackName] = useState<string | null>(null);
  const customTrackRef = useRef<TrackMsg | null>(null);
  const previousFilesRef = useRef<{ bags: File[]; results: ResultDetails | null } | null>(null);
  const live = useTelemetry(mode === "live", endpoint);
  const { widths, startDrag } = useResizableColumns();
  const { layers, toggle, reset } = useLayers();
  const player = useBagPlayer();
  // 左カラムはMPCの状態を既定にする。RL時代の Status(観測とトピック生値)は
  // タブの向こうへ回す — 既定のコントローラは MPC なので、まず見たいのはそちら。
  const [leftTab, setLeftTab] = useState<LeftTab>("mpc");
  const [dragOver, setDragOver] = useState(false);
  // ドロップの受け口はマウント時に1回だけ登録するので、最新のコースデータは
  // ref で読む(登録し直すとドラッグ中に外れることがある)。
  const trackAssetsRef = useRef<TrackAssets | undefined>(undefined);

  // bag をコース図と同じ座標に載せるための静的データ。原点が食い違うと
  // コースと軌跡が丸ごとずれるので、必ずまとめて渡す。
  const trackAssets = useMemo(
    () =>
      live.trackOrigin
        ? {
            origin: live.trackOrigin,
            raceline: live.raceline,
            laneletBoundaries: live.laneletBoundaries,
            walls: live.walls,
            vehicleHull: live.vehicleHull,
          }
        : undefined,
    [
      live.trackOrigin,
      live.raceline,
      live.laneletBoundaries,
      live.walls,
      live.vehicleHull,
    ],
  );
  trackAssetsRef.current = trackAssets;

  // ---- ドラッグ&ドロップで rosbag を開く ----
  // ページ全体で受ける。キャンバスの上だけにすると「どこへ落とせばいいのか」を
  // 毎回探すことになるし、外したときにブラウザが .mcap をダウンロード扱いする。
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragOver(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      setDragOver(false);
      void openFiles(files);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [player]);

  /**
   * 落とされたファイルを開く。`.mcap` と、同じ走行の
   * `d?-result-details.json` を **一緒に落とせる**。JSON があれば
   * ペナルティは推定せず AWSIM の判定をそのまま使う。
   */
  const openFiles = useCallback(async (files: File[]) => {
    if (player.loading) return;
    setImportError(null);
    const bags = files.filter((f) => f.name.toLowerCase().endsWith(".mcap"));
    let results: ResultDetails | null = null;
    try {
      for (const json of files.filter((f) => f.name.toLowerCase().endsWith(".json"))) {
        const parsed = JSON.parse(await json.text());
        if (parsed.type === "track" || parsed.origin) {
          customTrackRef.current = parseTrack(parsed);
          setTrackName(json.name);
        } else if (Array.isArray(parsed.penalty_events)) {
          if (!parsed.penalty_events.every((e: Record<string, unknown>) =>
            typeof e.kind === "string" && typeof e.race_time === "number" && Number.isFinite(e.race_time) &&
            typeof e.duration === "number" && Number.isFinite(e.duration) && e.duration >= 0)) {
            throw new Error("結果JSONのpenalty_eventsに不正な時刻・秒数があります");
          }
          results = parsed;
        } else throw new Error(`${json.name}: track.jsonまたはresult-details.jsonの形式ではありません`);
      }
      if (!bags.length) {
        if (!files.some((f) => f.name.toLowerCase().endsWith(".json"))) throw new Error(".mcapファイルを選んでください");
        if (!previousFilesRef.current) { live.applyTrack(customTrackRef.current); return; }
        const previous = previousFilesRef.current;
        setMode("files");
        live.applyTrack(customTrackRef.current);
        const merged = { bags: previous.bags, results: results ?? previous.results };
        previousFilesRef.current = merged;
        await player.load(merged.bags, assetsForTrack(customTrackRef.current), merged.results);
        return;
      }
      setMode("files");
      live.applyTrack(customTrackRef.current);
      previousFilesRef.current = { bags, results };
      await player.load(bags, assetsForTrack(customTrackRef.current), results);
    } catch (error) { setImportError(error instanceof Error ? error.message : String(error)); }
  }, [live.applyTrack, player]);

  const openDemo = async () => {
    if (player.loading) return;
    setImportError(null);
    setMode("demo");
    const track = demoTrack();
    live.applyTrack(track);
    await player.loadUrl("demo.mcap", assetsForTrack(track));
  };

  useEffect(() => {
    if (player.bag) setLeftTab(player.bag.hasMpc ? "mpc" : "status");
  }, [player.bag]);

  // 再生中のキーボード操作。動画プレイヤーと同じ割り当てにする。
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (!player.bag) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        player.toggle();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        player.stepFrame(e.shiftKey ? 20 : 1);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        player.stepFrame(e.shiftKey ? -20 : -1);
      }
    },
    [player],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  // `?bag=<url>` の自動読み込み。**コースの原点が決まるまで待つ**。
  // 原点なしで相対化すると、コースと軌跡が丸ごとずれて自車が壁へ
  // めり込んで見える(この bag では 3.45m ずれていた)。
  useEffect(() => {
    if (!live.trackLoaded || player.bootedRef.current) return;
    const q = new URLSearchParams(window.location.search);
    const u = q.get("bag");
    if (!u) return;
    player.bootedRef.current = true;
    // `?bag=a.mcap,b.mcap&results=d1-result-details.json`
    if (u === "demo.mcap") {
      const track = demoTrack();
      setMode("demo");
      live.applyTrack(track);
      void player.loadUrl(u, assetsForTrack(track));
    } else {
      void player.loadUrl(u.split(",").filter(Boolean), trackAssets, q.get("results"));
    }
  }, [live.trackLoaded, trackAssets, player]);

  const bagMode = player.bag !== null;
  const f = player.frame;
  // bag再生中は、ライブと同じ形の Telemetry に見せかけて下流をそのまま使う。
  // 画面のどのパネルも「ライブか再生か」を知らずに済む。
  const telemetry: Telemetry | null = bagMode
    ? f && {
        type: "telemetry",
        // bag は1台ぶんの記録。ドメインの区別は無いので0を入れておく。
        domain: 0,
        t: f.t,
        pose: f.pose,
        twist: f.twist,
        speed_mps: f.speed_mps,
        steer: f.steer,
        accel: f.accel,
        gear: f.gear,
        session: f.session,
        admin_state: "",
        topics: {},
        wall_markers: [],
        raceline_idx_marker: null,
        lap_history: [],
        rl_lookahead_points: [],
        mpc: f.mpc,
        v2x: f.v2x,
        mpc_schema_warn: null,
      }
    : live.telemetry;

  const mpc = telemetry?.mpc ?? null;
  const mpcStatic = bagMode ? player.bag!.mpcStatic ?? live.mpcStatic : live.mpcStatic;
  // bag は1台ぶんの記録なので、他車の姿勢はライブのときだけ出る。
  const others = bagMode ? [] : live.others.map((v) => ({
    domain: v.domain, pose: v.pose, speed_mps: v.speed_mps,
  }));
  // 事件の地点。**再生位置までのもの**だけ出す(先の事故が見えていると
  // 「このあと当てる」と分かった状態で走りを見ることになり検証にならない)。
  const eventMarks = useMemo(() => {
    if (!bagMode || !player.bag) return [];
    return player.bag.events
      // 地図に出すのは「損をした/当たった」場所だけ。ゲート類まで出すと
      // コースが×で埋まって読めなくなる。
      .filter(
        (e) =>
          e.at &&
          e.t <= player.t &&
          (e.kind === "penaltyWall" ||
            e.kind === "penaltyCrash" ||
            e.kind === "penalty" ||
            e.kind === "contact" ||
            e.kind === "nearWall"),
      )
      .map((e) => ({
        x: e.at![0],
        y: e.at![1],
        color: EVENT_STYLE[e.kind].color,
        label: EVENT_STYLE[e.kind].label,
      }));
  }, [bagMode, player.bag, player.t]);

  const history = bagMode ? player.history : live.history;
  const trail = bagMode ? player.trail : live.trail;
  const version = bagMode ? player.index : live.historyVersion;

  return (
    <div className={`app ${dragOver ? "app-dragover" : ""}`}>
      <header className="app-header">
        <h1>AI Challenge Web Viewer</h1>
        <button className="toggle-btn demo-button" onClick={() => void openDemo()} disabled={player.loading}>デモを試す</button>
        {mpc && <span className="header-mode">{mpc.mode}</span>}
        {bagMode ? (
          <span className="conn-badge conn-bag">bag再生</span>
        ) : (
          <span className={`conn-badge conn-${live.connState}`}>{mode === "live" ? live.connState : "ローカル再生"}</span>
        )}
        {/* 3台走行では 1台=1つの ROS_DOMAIN_ID。どの車の中身を見るかを選ぶ。
            選んでいない車もコース図には薄く出る(誰を避けたのかを見るため)。 */}
        {!bagMode && live.vehicles.length > 1 && (
          <span className="veh-picker">
            {live.vehicles.map((v) => (
              <button
                key={v.domain}
                className={
                  v.domain === live.selectedDomain
                    ? "toggle-btn toggle-btn-active"
                    : "toggle-btn"
                }
                onClick={() => live.selectDomain(v.domain)}
              >
                {v.name ?? `d${v.domain}`}
              </button>
            ))}
          </span>
        )}
        {/* ドラッグ&ドロップが使えない場面(リモートのブラウザ、権限、単に落としにくい)
            のための同等の入口。動作としてはドロップとまったく同じ。 */}
        <label className="toggle-btn file-pick" tabIndex={0} role="button" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.querySelector("input")?.click(); } }}>
          MCAP / JSONを開く
          <input
            type="file"
            accept=".mcap,.json"
            multiple
            disabled={player.loading}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              if (files.length) void openFiles(files);
              e.target.value = "";
            }}
          />
        </label>
        <button className="toggle-btn" onClick={() => setShowConnect((v) => !v)}>ライブ接続</button>
        <a className="source-link" href="https://github.com/Raptor-zip/aichallenge-web-viewer" target="_blank" rel="noreferrer">使い方 / ソース</a>
      </header>
      {showConnect && <form className="connect-form" onSubmit={(e) => { e.preventDefault(); player.close(); setMode("live"); }}>
        <label>ROSブリッジのURL <input aria-label="WebSocket URL" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="ws://127.0.0.1:8765" /></label>
        <button className="toggle-btn" type="submit">接続する</button>
        {mode === "live" && <button className="toggle-btn" type="button" onClick={() => setMode("files")}>切断</button>}
        <span>ROS側のブリッジを起動してから接続してください。</span>
      </form>}
      {(mode === "demo" || player.bag?.name === "demo.mcap") && <div className="demo-notice">デモは表示確認用の合成データです。実際の走行・MPCの性能評価ではありません。</div>}
      {trackName && mode !== "demo" && <div className="map-notice">コースデータ: {trackName} <button className="toggle-btn" onClick={() => { customTrackRef.current = null; setTrackName(null); live.applyTrack(null); previousFilesRef.current = null; player.close(); }}>コースを外す</button></div>}
      {importError && <div className="bag-error" role="alert">{importError}</div>}
      {mode === "live" && live.connectionError && <div className="bag-error" role="alert">接続できません: {live.connectionError}</div>}

      {player.loading && (
        <div className="bag-loading">
          {player.progress?.phase ?? "読み込み中"}{" "}
          {Math.round((player.progress?.frac ?? 0) * 100)}%
          <div className="bag-loading-bar">
            <div style={{ width: `${(player.progress?.frac ?? 0) * 100}%` }} />
          </div>
        </div>
      )}
      {player.error && <div className="bag-error" role="alert">rosbagを開けません: {player.error}</div>}

      {bagMode && (
        <PlaybackBar
          bag={player.bag!}
          t={player.t}
          playing={player.playing}
          speed={player.speed}
          onToggle={player.toggle}
          onSeek={player.seek}
          onStep={player.stepFrame}
          onSpeed={player.setSpeed}
          onClose={() => { player.close(); setMode("files"); live.applyTrack(customTrackRef.current); }}
        />
      )}

      {bagMode && <details className="recording-info"><summary>収録トピック・表示の条件</summary>
        <p>未収録の信号は「—」で表示します。MPC内部情報にはKSKのデバッグトピックと対応スキーマが必要です。事故やペナルティの推定は公式判定と区別してください。</p>
        <ul>{Object.entries(player.bag!.topics).map(([topic, count]) => <li key={topic}><code>{topic}</code>: {count}件</li>)}</ul>
      </details>}
      {(bagMode || mode === "live") ? <main
        className="app-grid"
        style={{ gridTemplateColumns: `${widths.left}px 6px 1fr 6px ${widths.right}px` }}
      >
        <div className="left-col">
          <div className="tab-bar">
            <button
              className={leftTab === "mpc" ? "tab-btn tab-btn-active" : "tab-btn"}
              onClick={() => setLeftTab("mpc")}
            >
              MPC
            </button>
            <button
              className={leftTab === "status" ? "tab-btn tab-btn-active" : "tab-btn"}
              onClick={() => setLeftTab("status")}
            >
              Status / トピック
            </button>
          </div>
          {leftTab === "mpc" ? (
            <MpcPanel
              mpc={mpc}
              mpcStatic={mpcStatic}
              schemaWarn={telemetry?.mpc_schema_warn ?? null}
            />
          ) : (
            <StatusGrid telemetry={telemetry} />
          )}
        </div>
        <div className="col-resizer" onMouseDown={startDrag("left")} />
        <TrackView
          raceline={live.raceline}
          walls={live.walls}
          vehicleHull={live.vehicleHull}
          laneletBoundaries={live.laneletBoundaries}
          vehicleModel={live.vehicleModel}
          wallMarkers={telemetry?.wall_markers ?? []}
          eventMarks={eventMarks}
          racelineIdxMarker={telemetry?.raceline_idx_marker ?? null}
          rlLookaheadPoints={telemetry?.rl_lookahead_points ?? []}
          mpcStatic={mpcStatic}
          mpc={mpc}
          v2x={telemetry?.v2x ?? []}
          others={others}
          layers={layers}
          onToggleLayer={toggle}
          onResetLayers={reset}
          trail={trail}
          pose={telemetry ? telemetry.pose : null}
          steerCmdDeg={telemetry && Number.isFinite(telemetry.steer.cmd_deg) ? telemetry.steer.cmd_deg : 0}
          version={version}
        />
        <div className="col-resizer" onMouseDown={startDrag("right")} />
        <StripChart
          history={history}
          maxSteerDeg={telemetry ? telemetry.steer.max_deg : 30}
          hasMpc={mpc !== null}
        />
      </main> : <main className="welcome">
        <div className="welcome-copy"><p className="eyebrow">ROS 2 MCAP / AWSIM / MPC</p>
          <h2>走りを巻き戻し、<br />制御の判断を見にいく。</h2>
          <p>走行軌跡と速度・操舵を同じ時刻で表示。デバッグ情報があれば、MPCが選んだ予測と候補も重ねて確認できます。</p>
          <button className="primary-button" onClick={() => void openDemo()} disabled={player.loading}>60秒のデモを開く</button>
          <p className="welcome-caption">合成MCAP。ROS・インストール・ログインは不要です。</p>
        </div>
        <section className="welcome-card"><h3>自分の走行記録を調べる</h3>
          <ol><li>「MCAP / JSONを開く」か、この画面にファイルをドロップ。</li><li>分割されたMCAPはまとめて選択できます。</li><li>必要ならtrack.jsonとresult-details.jsonも一緒に選択。</li></ol>
          <p>選んだローカルファイルはブラウザ内で処理します。サーバーにアップロードしません。</p>
          <p>コースデータがなくても軌跡と時系列を表示できます。MPCのトピックがなくても自己位置・制御指令を確認できます。</p>
          <a href="demo.mcap" download>合成MCAPをダウンロード</a><span> / </span><a href="demo-track.json" download>サンプルtrack.json</a>
        </section>
      </main>}

      {dragOver && <div className="drop-overlay">rosbag(.mcap)を落として読み込む</div>}
    </div>
  );
}
