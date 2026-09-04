"use client";

import { useEffect, useRef } from "react";

const MM_TO_PX = 96 / 25.4;

/**
 * Scales everything inside down to ONE printed sheet.
 *
 * Just before the browser builds the print preview the content is measured in its print
 * layout and shrunk exactly enough to fit — fonts, spacing and column widths together, so
 * a table never splits across pages. Content that already fits prints at full size.
 *
 * `zoom` rather than `transform`: pagination ignores a transform, so the browser would
 * still split the content at its unscaled height.
 */
function useFitToPage(pageWmm: number, pageHmm: number, marginMm: number) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pageW = (pageWmm - marginMm * 2) * MM_TO_PX;
    const pageH = (pageHmm - marginMm * 2) * MM_TO_PX;

    const before = () => {
      // recreate the print layout to measure: hide screen-only controls, unclip tables, and
      // pin the width to the printable width — otherwise a narrow window wraps the content
      // taller than it will print and the document is shrunk more than it needs to be
      el.style.setProperty("--fit-page-w", `${pageW}px`);
      document.documentElement.classList.add("print-sim");
      void el.offsetHeight; // force reflow before reading sizes
      const w = el.scrollWidth;
      const h = el.scrollHeight;
      document.documentElement.classList.remove("print-sim");
      // the width is pinned to the printable width, so that ratio is 1 unless something
      // genuinely overflows; the 2% safety margin belongs on the height, where print
      // rendering measures type slightly differently than screen
      const scale = Math.min(1, pageW / w, (pageH / h) * 0.98);
      el.style.setProperty("--fit-scale", scale.toFixed(4));
    };
    const after = () => {
      el.style.removeProperty("--fit-scale");
      el.style.removeProperty("--fit-page-w");
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, [pageWmm, pageHmm, marginMm]);

  return ref;
}

/** Sales forecast: one A3 landscape sheet, 8mm margins. Wide table, so it is measured at
    its natural width (`fit-one-page` also sets `width: max-content`). */
export function FitOnePageA3({ children }: { children: React.ReactNode }) {
  const ref = useFitToPage(420, 297, 8);
  return (
    <div ref={ref} className="fit-one-page">
      {children}
    </div>
  );
}

/** US Letter portrait, 8.5in x 11in with 12mm margins — the delivery receipt. A portrait
    document already lays out to a fixed width, so this variant only scales the height. */
export function FitOnePageLetter({ children }: { children: React.ReactNode }) {
  const ref = useFitToPage(215.9, 279.4, 12);
  return (
    <div ref={ref} className="fit-page">
      {children}
    </div>
  );
}
