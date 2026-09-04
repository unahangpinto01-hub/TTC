"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Search-as-you-type box for list pages: updates the URL's ?q= (debounced ~250ms)
    via soft navigation, so the server-rendered table refilters without pressing
    Enter or losing the other filters. The × button clears back to the full list. */
export function LiveSearch({ placeholder, className }: { placeholder?: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams(sp.toString());
      if (q.trim()) params.set("q", q.trim());
      else params.delete("q");
      params.delete("page"); // a new search starts back at page 1
      router.replace(`${pathname}${params.size ? `?${params.toString()}` : ""}`, { scroll: false });
    }, 250);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className={`relative ${className ?? "w-full max-w-xs"}`}>
      {/* keeps the current search when a surrounding filter form is submitted */}
      <input type="hidden" name="q" value={q} />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder ?? "Search…"}
        className="input w-full pr-8"
        aria-label="Search"
      />
      {q && (
        <button
          type="button"
          onClick={() => setQ("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          aria-label="Clear search"
        >
          ✕
        </button>
      )}
    </div>
  );
}
