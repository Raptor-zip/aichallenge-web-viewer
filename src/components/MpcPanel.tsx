import type { MpcDebug, MpcStatic } from "../types";

interface Props {
  mpc: MpcDebug | null;
  mpcStatic: MpcStatic | null;
  schemaWarn: string | null;
}

function n(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(digits);
}

function Row({
  label,
  value,
  warn,
  good,
  hint,
}: {
  label: string;
  value: string;
  warn?: boolean;
  good?: boolean;
  hint?: string;
}) {
  return (
    <div className={`mpc-row ${warn ? "mpc-row-warn" : ""} ${good ? "mpc-row-good" : ""}`}>
      <span className="mpc-row-label" title={hint}>
        {label}
      </span>
      <span className="mpc-row-value">{value}</span>
    </div>
  );
}

export function MpcPanel({ mpc, mpcStatic, schemaWarn }: Props) {
  if (schemaWarn) {
    return (
      <div className="panel mpc-panel">
        <div className="panel-title">MPC</div>
        <div className="mpc-warn-box">{schemaWarn}</div>
      </div>
    );
  }
  if (!mpc) {
    return (
      <div className="panel mpc-panel">
        <div className="panel-title">MPC</div>
        <div className="waiting">
          /rl_raceline/mpc_debug がまだ来ていません。
          <br />
          RL_CONTROLLER=mpc で走っているか、RL_MPC_DEBUG=0 で切っていないかを確認してください。
        </div>
      </div>
    );
  }

  const capActive = mpc.v_cap !== null;
  // 候補集合全体でコスト差が消えている＝壁のコストで飽和して
  // 「どれを選んでも同じ」状態。実測でこれが起きたstepの直後に壁へ刺さっている
  // (公式eval t=126.8 で舵候補21本すべての予測が壁に埋まっていた)。
  const saturated = mpc.best.spread !== null && Math.abs(mpc.best.spread) < 1.0;
  const noSafe = mpc.n_safe === 0 && mpc.n_cand > 0;

  return (
    <div className="panel mpc-panel">
      <div className="panel-title">
        MPC
        <span className={mpc.rollout_ext ? "mpc-badge" : "mpc-badge mpc-badge-warn"}>
          {mpc.rollout_ext ? "C拡張" : "Python版(10倍遅い)"}
        </span>
        <span className={mpc.step_ms > 60 ? "mpc-badge mpc-badge-warn" : "mpc-badge"}>
          {n(mpc.step_ms, 1)} ms/step
        </span>
      </div>

      <div className="stat-section">いま出している一手</div>
      <div className="mpc-rows">
        <Row label="モード" value={mpc.mode} warn={mpc.mode_code !== 6} />
        <Row label="舵" value={`${n(mpc.best.steer_deg, 1)}° (${n(mpc.best.steer, 3)} rad)`} />
        <Row label="実舵" value={`${n((mpc.steer_actual * 180) / Math.PI, 1)}°`} />
        <Row label="加速度" value={`${n(mpc.best.accel)} m/s²`} warn={mpc.best.accel < 0} />
        <Row label="速度" value={`${n(mpc.speed)} m/s`} />
        <Row
          label="縦の上限"
          value={capActive ? `${n(mpc.v_cap)} m/s` : "なし(全開)"}
          warn={capActive}
          hint="follow ゲート / ACC / 計画から決まる硬い上限。コストの外側で効く"
        />
        <Row
          label="うちACC分"
          value={mpc.acc_cap === null ? "—" : `${n(mpc.acc_cap)} m/s`}
          hint="発進フェーズの追突防止(幾何だけで決まる包絡線)"
        />
      </div>

      <div className="stat-section">探索の結果</div>
      <div className="mpc-rows">
        <Row label="最良コスト" value={n(mpc.best.cost, 1)} />
        <Row
          label="候補コストの幅"
          value={mpc.best.spread === null ? "—" : n(mpc.best.spread, 2)}
          warn={saturated}
          hint="最良〜最悪の差。小さいほど候補間の差が消えている(壁のコストで飽和)。この状態は壁へ刺さる直前に観測される"
        />
        <Row
          label="2位との差"
          value={mpc.best.margin === null ? "—" : n(mpc.best.margin, 3)}
          hint="隣り合う舵候補との差。普段から小さいので単独では判断材料にならない"
        />
        <Row
          label="安全な候補"
          value={`${mpc.n_safe} / ${mpc.n_cand}`}
          warn={noSafe}
          hint="接触箱にもCBFにも引っかからない候補の数。0なら「どれを選んでも当たる」"
        />
        <Row
          label="CBFで差し替え"
          value={mpc.cbf_used ? "はい" : "いいえ"}
          warn={mpc.cbf_used}
          hint="最小コストの候補が危険だったので、印の無い候補へ切り替えた"
        />
        <Row label="壁までの余裕" value={`${n(mpc.clearance)} m`} warn={mpc.clearance < 1.6} />
        <Row label="参照からの横ズレ" value={`${n(mpc.lat)} m`} warn={Math.abs(mpc.lat) > 1.0} />
        <Row label="idx / 弧長" value={`${mpc.idx} / ${n(mpc.s_ego, 1)} m`} />
      </div>

      <div className="stat-section">追い越し</div>
      <div className="mpc-rows">
        <Row label="脅威" value={mpc.threat ? "あり" : "なし"} warn={mpc.threat} />
        <Row label="抜き中" value={mpc.passing ? "はい" : "いいえ"} good={mpc.passing} />
        <Row
          label="横オフセット指令"
          value={`${n(mpc.off_cmd)} m`}
          hint="参照線を横へどれだけずらしているか(絶対値)"
        />
        <Row
          label="計画からのずれ"
          value={`${n(mpc.off_delta)} m`}
          hint="計画モードのとき、探索が選んだ計画からの微修正量"
        />
        <Row label="計画の狙い" value={`${n(mpc.plan_tgt)} m`} />
        <Row
          label="計画"
          value={mpc.plan_why_ja + (mpc.plan_active ? "(計画中)" : "")}
          good={mpc.plan_active && mpc.plan_ok}
          warn={mpc.plan_active && !mpc.plan_ok}
        />
        <Row
          label="縦で待つ"
          value={mpc.plan_hold ? "はい" : "いいえ"}
          warn={mpc.plan_hold}
          hint="「ここでは並べない」と計画が言っている間だけ縦の上限を効かせる"
        />
        <Row
          label="抜く側"
          value={mpc.side > 0 ? `左 (残${mpc.side_left})` : mpc.side < 0 ? `右 (残${mpc.side_left})` : "未定"}
        />
        <Row label="follow ラッチ" value={`${mpc.follow_hold}`} warn={mpc.follow_hold > 0} />
        <Row
          label="発進フェーズ"
          value={mpc.launched ? "抜けた" : `発進中${mpc.pen_hold > 0 ? `(ペナ明け ${mpc.pen_hold})` : ""}`}
          warn={!mpc.launched}
        />
      </div>

      <div className="stat-section">相手 ({mpc.opp.length}台)</div>
      {mpc.opp.length === 0 && <div className="mpc-empty">V2Xで見えている相手はいません</div>}
      {mpc.opp.length > 0 && (
        <table className="mpc-table">
          <thead>
            <tr>
              <th>#</th>
              <th>経路差</th>
              <th>横間隔</th>
              <th>速度</th>
              <th>推定</th>
            </tr>
          </thead>
          <tbody>
            {mpc.opp.map((o, i) => {
              const sep = Math.abs(mpc.lat - o.lat);
              const ahead = o.gap > 0 && o.gap < 25;
              const tight = ahead && sep < (mpcStatic?.clear_w ?? 1.7);
              return (
                <tr key={i} className={tight ? "mpc-tr-warn" : ""}>
                  <td>d{i + 2}</td>
                  <td>
                    {o.gap >= 0 ? "+" : ""}
                    {n(o.gap, 1)} m
                  </td>
                  <td>
                    {n(sep)} m{ahead ? (tight ? " 不足" : " 可") : ""}
                  </td>
                  <td>{n(o.v)} m/s</td>
                  <td className={o.nobs < 5 ? "mpc-td-warn" : ""}>{o.nobs}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {mpcStatic && (
        <>
          <div className="stat-section">設定(起動時に確定)</div>
          <div className="mpc-rows">
            <Row
              label="参照経路"
              value={mpcStatic.smoothed ? "回廊内で平滑化" : "raceline.csv そのまま"}
            />
            <Row
              label="ホライズン"
              value={`${mpcStatic.horizon} step × ${n(mpcStatic.dt, 2)}s = ${n(
                mpcStatic.horizon * mpcStatic.dt,
                1,
              )}s`}
            />
            <Row
              label="候補数"
              value={`舵 ${mpcStatic.n_steer}${
                mpcStatic.n_steer2 > 1 ? `×${mpcStatic.n_steer2}` : ""
              } / 横 ${mpcStatic.n_off} / 縦 ${mpcStatic.n_accel}(相手時 ${mpcStatic.n_accel_v2x})`}
            />
            <Row
              label="壁マージン"
              value={`${n(mpcStatic.safe)} m(追い越し中 ${n(mpcStatic.safe_pass)} m)`}
            />
            <Row
              label="壁の重み"
              value={`${n(mpcStatic.w_wall, 0)}(追い越し中 ${n(mpcStatic.w_wall_pass, 0)})`}
            />
            <Row
              label="CBF"
              value={
                mpcStatic.cbf_alpha > 0
                  ? `α=${n(mpcStatic.cbf_alpha)} r_min=${n(mpcStatic.cbf_rmin)} m`
                  : "無効"
              }
            />
            <Row
              label="CRASH判定域"
              value={`後ろ ${n(mpcStatic.box_lon)} m × 横 ±${n(mpcStatic.box_lat)} m`}
            />
            <Row label="並ぶのに要る横間隔" value={`${n(mpcStatic.clear_w)} m`} />
            <Row label="重み (lat/head/prog/dsteer)"
              value={`${n(mpcStatic.w_lat, 1)} / ${n(mpcStatic.w_head, 1)} / ${n(
                mpcStatic.w_prog,
                1,
              )} / ${n(mpcStatic.w_dsteer, 1)}`}
            />
          </div>
        </>
      )}
    </div>
  );
}
