import { readBag } from "./readBag";
import type { ResultDetails, TrackAssets } from "../types";

self.onmessage = async (event: MessageEvent<{ files: File[]; track?: TrackAssets; results?: ResultDetails | null }>) => {
  try {
    const { files, track, results } = event.data;
    const bag = await readBag(files, (frac, phase) => self.postMessage({ type: "progress", frac, phase }), track, results);
    self.postMessage({ type: "result", bag });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
