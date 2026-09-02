"use client";

import { useEffect, useRef } from "react";

/** Usable A3 landscape area with 8mm margins, in CSS pixels (96 dpi). */
const MM_TO_PX = 96 / 25.4;
const PAGE_W = (420 - 16) * MM_TO_PX;
const PAGE_H = (297 - 16) * MM_TO_PX;

/** Fits everything inside on ONE A3 landscape page. Just before the browser builds the
    print preview, the content is measured in its print layout and scaled down exactly
    enough to fit — fonts, spacing and column widths all shrink together, so the table
    never splits across pages. Content that already fits prints at full size. */
export function FitOnePageA3({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const before = () => {
      // simulate the print layout (hide screen-only controls, unclip the table) to measure
      document.documentElement.classList.add("print-sim");
      void el.offsetHeight; // force reflow before reading sizes
      const w = el.scrollWidth;
      const h = el.scrollHeight;
      document.documentElement.classList.remove("print-sim");
      // 2% safety margin: print rendering measures type slightly differently than screen
      const scale = Math.min(1, (PAGE_W / w) * 0.98, (PAGE_H / h) * 0.98);
      el.style.setProperty("--fit-scale", scale.toFixed(4));
    };
    const after = () => el.style.removeProperty("--fit-scale");
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  return (
    <div ref={ref} className="fit-one-page">
      {children}
    </div>
  );
}
