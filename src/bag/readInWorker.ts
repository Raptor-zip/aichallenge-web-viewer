import type { BagIndex, ResultDetails, TrackAssets } from "../types";

export function readInWorker(files: File | File[], onProgress: (frac: number, phase: string) => void,
  track?: TrackAssets, results?: ResultDetails | null): Promise<BagIndex> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const data = event.data;
      if (data.type === "progress") onProgress(data.frac, data.phase);
      else if (data.type === "result") { worker.terminate(); resolve(data.bag); }
      else if (data.type === "error") { worker.terminate(); reject(new Error(data.message)); }
    };
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message || "MCAP読み込み処理を開始できません")); };
    worker.postMessage({ files: Array.isArray(files) ? files : [files], track, results });
  });
}
