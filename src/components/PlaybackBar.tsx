import { useMemo, useState } from "react";
import type { BagIndex } from "../types";
import { EVENT_STYLE, type BagEvent, type BagEventKind } from "../bag/events";
import { SPEEDS } from "../hooks/useBagPlayer";

interface Props {
  bag: BagIndex;
  t: number;
  playing: boolean;
  speed: number;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onStep: (n: number) => void;
  onSpeed: (v: number) => void;
  onClose: () => void;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(2).padStart(5, "0")}`;
}

/**
 * 走行を一言でまとめる。まず知りたいのは「何回やらかしたか」なので、
 * その走行に実際に出た種別だけを、重い順に並べる。
 */
function summarize(events: BagEvent[]): { kind: BagEventKind; n: number }[] {
  const counts = new Map<BagEventKind, number>();
  for (const e of events) {
    if (e.kind === "lap") continue; // 周回は帯のほうで見えている
    counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  }
  return [...counts]
    .map(([kind, n]) => ({ kind, n }))
    .sort((a, b) => EVENT_STYLE[a.kind].priority - EVENT_STYLE[b.kind].priority);
}

export function PlaybackBar({
  bag,
  t,
  playing,
  speed,
  onToggle,
  onSeek,
  onStep,
  onSpeed,
  onClose,
}: Props) {
  const [showList, setShowList] = useState(false);
  // 種別ごとの表示on/off。既定では「損をしたもの」だけ出し、
  // ニアミス(壁すれすれ・ペナ無しの接触)やMPCのゲートは畳んでおく。
  const [hidden, setHidden] = useState<Set<BagEventKind>>(
    () =>
      new Set(
        (Object.keys(EVENT_STYLE) as BagEventKind[]).filter(
          (k) => !EVENT_STYLE[k].defaultOn,
        ),
      ),
  );
  const frac = bag.duration > 0 ? t / bag.duration : 0;
  const summary = useMemo(() => summarize(bag.events), [bag.events]);
  const shown = useMemo(
    () => bag.events.filter((e) => !hidden.has(e.kind)),
    [bag.events, hidden],
  );
  const toggleKind = (k: BagEventKind) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // いま何周目か(バーの下に帯で出す)
  const lapAt = (time: number) => {
    let lap = 1;
    for (let i = 1; i < bag.laps.length; i++) if (time >= bag.laps[i]) lap = i + 1;
    return lap;
  };

  return (
    <div className="playback-bar">
      <div className="playback-controls">
        <span
          className="playback-name"
          title={Object.entries(bag.topics)
            .map(([k, v]) => `${k}  ${v}`)
            .join("\n")}
        >
          {bag.name}
        </span>
        <button className="toggle-btn" onClick={() => onStep(-1)} title="1フレーム戻る">
          ◀|
        </button>
        <button
          className={playing ? "toggle-btn toggle-btn-active" : "toggle-btn"}
          onClick={onToggle}
        >
          {playing ? "⏸ 一時停止" : "▶ 再生"}
        </button>
        <button className="toggle-btn" onClick={() => onStep(1)} title="1フレーム進む">
          |▶
        </button>
        <span className="playback-time">
          {fmtTime(t)} / {fmtTime(bag.duration)}
        </span>
        <span className="playback-lap">
          Lap {lapAt(t)} / {bag.laps.length}
          {!bag.lapsFromStatus && bag.laps.length > 1 && (
            <span className="playback-est" title="/awsim/status が bag に無いので弧長から推定">
              (推定)
            </span>
          )}
        </span>
        <div className="playback-speeds">
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={speed === s ? "toggle-btn toggle-btn-active" : "toggle-btn"}
              onClick={() => onSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>
        {/* 何が何回起きたか。ここをクリックするとその種別だけ消せる。 */}
        <span className="playback-summary">
          {summary.map((r) => (
            <button
              key={r.kind}
              className={hidden.has(r.kind) ? "ev-chip ev-chip-off" : "ev-chip"}
              style={{ borderColor: EVENT_STYLE[r.kind].color }}
              onClick={() => toggleKind(r.kind)}
              title="クリックでタイムラインから消す/戻す"
            >
              <span className="ev-dot" style={{ background: EVENT_STYLE[r.kind].color }} />
              {EVENT_STYLE[r.kind].label} {r.n}
            </button>
          ))}
          {summary.length === 0 && <span className="playback-est">事件なし</span>}
        </span>
        <button
          className={showList ? "toggle-btn toggle-btn-active" : "toggle-btn"}
          onClick={() => setShowList((v) => !v)}
        >
          一覧 {shown.length}
        </button>
        {/* ペナルティが実測(AWSIMの記録)か推定かは、見ている数字の信頼度を
            変えるので常に出す。 */}
        <span className={bag.results ? "ev-src ev-src-ok" : "ev-src"}>
          {bag.results
            ? `ペナルティ実測 ${bag.results.penalty_count}回 ${bag.results.penalty_total_seconds.toFixed(0)}s`
            : "ペナルティ推定"}
        </span>
        {!bag.hasMpc && (
          <span className="playback-warn" title="RL_MPC_DEBUG=1 で録り直すと候補や予測も見られます">
            MPCの中身なし
          </span>
        )}
        <button className="toggle-btn playback-close" onClick={onClose}>
          再生を閉じる
        </button>
      </div>

      <div className="playback-track">
        <input
          className="playback-range"
          type="range"
          min={0}
          max={bag.duration}
          step={bag.dt}
          value={t}
          onChange={(e) => onSeek(Number(e.target.value))}
        />
        {/* 周回の帯。Lap2 がどこからかを一目で。 */}
        <div className="playback-laps">
          {bag.laps.map((start, i) => {
            const end = i + 1 < bag.laps.length ? bag.laps[i + 1] : bag.duration;
            const w = ((end - start) / bag.duration) * 100;
            return (
              <button
                key={i}
                className={`playback-lapband ${i % 2 ? "playback-lapband-alt" : ""}`}
                style={{ left: `${(start / bag.duration) * 100}%`, width: `${w}%` }}
                title={`Lap ${i + 1}  ${fmtTime(start)} 〜 ${fmtTime(end)} (${(end - start).toFixed(1)}s)`}
                onClick={() => onSeek(start)}
              >
                {w > 4 ? `Lap ${i + 1}` : ""}
              </button>
            );
          })}
        </div>
        {/* 事件のマーカー。クリックでその瞬間へ飛ぶ。 */}
        <div className="playback-markers">
          {shown.map((m, i) => (
            <button
              key={i}
              className="playback-marker"
              style={{
                left: `${(m.t / bag.duration) * 100}%`,
                background: EVENT_STYLE[m.kind].color,
                zIndex: 10 - EVENT_STYLE[m.kind].priority,
              }}
              title={m.label}
              onClick={() => onSeek(m.t)}
            />
          ))}
          <div className="playback-cursor" style={{ left: `${frac * 100}%` }} />
        </div>
      </div>

      {showList && (
        <div className="event-list">
          {shown.length === 0 && <div className="playback-est">表示する事件がありません</div>}
          {shown.map((e, i) => (
            <button
              key={i}
              className={`event-row ${Math.abs(e.t - t) < bag.dt ? "event-row-now" : ""}`}
              onClick={() => onSeek(e.t)}
            >
              <span className="ev-dot" style={{ background: EVENT_STYLE[e.kind].color }} />
              <span className="event-t">{fmtTime(e.t)}</span>
              <span className="event-lap">L{lapAt(e.t)}</span>
              <span className="event-label">{e.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
