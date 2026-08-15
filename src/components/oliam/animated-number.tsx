import { useEffect, useRef, useState } from "react";
import { fmt } from "@/lib/format";
import type { Kind } from "@/lib/types";

export function AnimatedNumber({ value, kind }: { value: number; kind: Kind }) {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current,
      to = value,
      start = performance.now(),
      dur = 480;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else prev.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{fmt(display, kind) ?? "–"}</>;
}
