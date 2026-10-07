import { useCallback, useState } from "react";

/**
 * コース図に重ねるレイヤのon/off。
 *
 * 全部出すと壁・回廊・候補21本・相手の予測が重なって何も読めなくなるので、
 * 「いま何を疑っているか」で切り替えられるようにする。選択はlocalStorageに
 * 残す(リロードのたびに畳み直すのは実際に苦痛だった)。
 */
export const LAYER_DEFS = [
  { key: "walls", label: "壁の距離場", group: "コース" },
  { key: "lanelet", label: "車線境界", group: "コース" },
  { key: "raceline", label: "レースライン(csv)", group: "コース" },
  { key: "refPath", label: "MPC参照経路", group: "コース" },
  { key: "corridor", label: "通れる回廊", group: "コース" },
  { key: "trail", label: "走行軌跡", group: "自車" },
  { key: "wallMarks", label: "壁接触の疑い", group: "自車" },
  { key: "vehicle", label: "車体", group: "自車" },
  { key: "mpcBest", label: "選ばれた予測軌跡", group: "MPC" },
  { key: "mpcCands", label: "舵候補の予測", group: "MPC" },
  { key: "mpcRefPts", label: "ホライズン参照点", group: "MPC" },
  { key: "mpcShifted", label: "ずらした参照線", group: "MPC" },
  { key: "mpcHorizonRoom", label: "ホライズン上の回廊", group: "MPC" },
  { key: "opp", label: "相手とCRASH判定域", group: "相手" },
  { key: "otherCars", label: "他の車の姿勢(3台走行)", group: "相手" },
  { key: "oppPred", label: "相手の予測位置", group: "相手" },
  { key: "rlLookahead", label: "RL観測のルックアヘッド", group: "RL(旧)" },
] as const;

export type LayerKey = (typeof LAYER_DEFS)[number]["key"];
export type Layers = Record<LayerKey, boolean>;

const DEFAULTS: Layers = {
  walls: true,
  lanelet: true,
  raceline: true,
  refPath: true,
  corridor: true,
  trail: true,
  wallMarks: true,
  vehicle: true,
  mpcBest: true,
  mpcCands: true,
  mpcRefPts: true,
  mpcShifted: true,
  mpcHorizonRoom: false,
  opp: true,
  otherCars: true,
  oppPred: true,
  rlLookahead: false,
};

// v2: lanelet2 を既定ONにした(ペナルティの判定線はこちらだと実測で分かったため)
const STORAGE_KEY = "ksk-web-viewer-layers-v1";

function load(): Layers {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    // 保存されている値にキーが増減していても壊れないよう、既定値へ上書きする。
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Layers>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function useLayers() {
  const [layers, setLayers] = useState<Layers>(load);

  const toggle = useCallback((key: LayerKey) => {
    setLayers((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* プライベートモード等で書けなくても表示は続ける */
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setLayers({ ...DEFAULTS });
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* 同上 */
    }
  }, []);

  return { layers, toggle, reset };
}
