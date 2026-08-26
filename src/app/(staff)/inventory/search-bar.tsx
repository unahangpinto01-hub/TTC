"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Live inventory filter bar: search-as-you-type (debounced ~250ms), instant category/stock
    selects, and a clear button. Updates the URL via soft navigation so the server-rendered
    table, grouping, and pagination keep working unchanged. */
export function InventorySearchBar({ categories }: { categories: string[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const first = useRef(true);

  const push = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    params.delete("page"); // any filter change starts back at page 1
    router.replace(`/inventory${params.size ? `?${params.toString()}` : ""}`, { scroll: false });
  };

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => push({ q: q.trim() || undefined }), 250);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-xs">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, SKU, pack…"
          className="input w-full pr-8"
          aria-label="Search products"
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
      <select
        value={sp.get("category") ?? ""}
        onChange={(e) => push({ category: e.target.value || undefined })}
        className="input max-w-[180px]"
        aria-label="Category filter"
      >
        <option value="">All categories</option>
        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select
        value={sp.get("stock") ?? ""}
        onChange={(e) => push({ stock: e.target.value || undefined })}
        className="input max-w-[140px]"
        aria-label="Stock filter"
      >
        <option value="">All stock</option>
        <option value="low">Low stock</option>
        <option value="out">Out of stock</option>
      </select>
    </div>
  );
}
