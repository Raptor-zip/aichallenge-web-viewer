import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "awsim-debug-dashboard.column-widths.v1";
const MIN_WIDTH = 220;
const MAX_WIDTH = 900;

interface Widths {
  left: number;
  right: number;
}

const DEFAULT_WIDTHS: Widths = { left: 320, right: 380 };

function loadWidths(): Widths {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WIDTHS;
    const parsed = JSON.parse(raw);
    return {
      left: clamp(parsed.left ?? DEFAULT_WIDTHS.left),
      right: clamp(parsed.right ?? DEFAULT_WIDTHS.right),
    };
  } catch {
    return DEFAULT_WIDTHS;
  }
}

function clamp(v: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, v));
}

/** STATUS(左)/HISTORY(右)パネルの幅をドラッグで調整できるようにする。localStorageに永続化。 */
export function useResizableColumns() {
  const [widths, setWidths] = useState<Widths>(loadWidths);
  const dragRef = useRef<{ side: "left" | "right"; startX: number; startWidth: number } | null>(
    null,
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  }, [widths]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const delta = drag.side === "left" ? dx : -dx;
      setWidths((w) => ({ ...w, [drag.side]: clamp(drag.startWidth + delta) }));
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startDrag = useCallback(
    (side: "left" | "right") => (e: React.MouseEvent) => {
      dragRef.current = { side, startX: e.clientX, startWidth: widths[side] };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [widths],
  );

  return { widths, startDrag };
}
