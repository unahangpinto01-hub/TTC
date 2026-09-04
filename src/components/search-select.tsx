"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SearchHit = { id: string; label: string; sub?: string; data?: Record<string, unknown> };

/** The BMS-wide autocomplete box. Type to search — matches from the beginning of
 *  the name/code, any letter case — pick with ↑/↓ + Enter or the mouse. Results
 *  come from /api/search/<entity> a page at a time (debounced), so the browser
 *  never downloads a whole table. Clearing the box restores the full list.
 *
 *  Works both in server-action forms (set `name`: the chosen id is submitted in
 *  a hidden input) and in client grids (pass `onSelect`).
 */
export function SearchSelect({
  entity,
  options,
  pinned,
  name,
  placeholder,
  defaultValue,
  params,
  onSelect,
  submitOnSelect,
  required,
  className,
}: {
  /** API segment: customers, suppliers, products, employees, salespeople, sales-orders, invoices, purchase-orders */
  entity?: string;
  /** in-memory list instead of the API — same behavior, for short or page-scoped lists */
  options?: SearchHit[];
  /** sentinel choices (e.g. "— Unassigned —") kept above the search results */
  pinned?: SearchHit[];
  /** form field name for the selected id (hidden input) */
  name?: string;
  placeholder?: string;
  defaultValue?: SearchHit | null;
  /** extra query params, e.g. { company: companyId } */
  params?: Record<string, string>;
  onSelect?: (hit: SearchHit | null) => void;
  /** auto-submit the surrounding GET form when a value is picked or cleared (filter forms) */
  submitOnSelect?: boolean;
  required?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(defaultValue?.label ?? "");
  const [picked, setPicked] = useState<SearchHit | null>(defaultValue ?? null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const search = useCallback(
    (q: string) => {
      // match from the beginning of the label (or its code line), any case
      const lq = q.toLowerCase();
      const prefix = (o: SearchHit) =>
        !lq || o.label.toLowerCase().startsWith(lq) || (o.sub ?? "").toLowerCase().startsWith(lq);
      const pins = (pinned ?? []).filter(prefix);
      if (options) {
        setHits([...pins, ...options.filter(prefix)].slice(0, 50));
        setActive(0);
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        const mySeq = ++seq.current;
        setLoading(true);
        try {
          const usp = new URLSearchParams({ q, limit: "20", ...(params ?? {}) });
          const res = await fetch(`/api/search/${entity}?${usp.toString()}`);
          if (!res.ok) throw new Error();
          const data = (await res.json()) as { hits: SearchHit[] };
          if (mySeq === seq.current) {
            setHits([...pins, ...data.hits]);
            setActive(0);
          }
        } catch {
          if (mySeq === seq.current) setHits(pins);
        } finally {
          if (mySeq === seq.current) setLoading(false);
        }
      }, 200);
    },
    [entity, options, pinned, params ? JSON.stringify(params) : ""] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // close when clicking anywhere else
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const submitForm = () => {
    // let the hidden input update first, then send the surrounding filter form
    setTimeout(() => inputRef.current?.form?.requestSubmit(), 0);
  };

  const choose = (h: SearchHit | null) => {
    setPicked(h);
    setText(h?.label ?? "");
    setOpen(false);
    onSelect?.(h);
    if (submitOnSelect) submitForm();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setOpen(true);
        search(text.trim() && !picked ? text.trim() : "");
        if (e.key === "Enter") e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hits[active]) choose(hits[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={boxRef} className={`relative ${className ?? ""}`}>
      {name && <input type="hidden" name={name} value={picked?.id ?? ""} />}
      <div className="relative">
        <input
          ref={inputRef}
          value={text}
          required={required && !picked}
          placeholder={placeholder ?? "Type to search…"}
          className={`input w-full pr-7 ${picked ? "font-medium" : ""}`}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            if (picked) {
              setPicked(null);
              onSelect?.(null);
            }
            setOpen(true);
            search(v.trim());
          }}
          onFocus={() => {
            setOpen(true);
            search(picked ? "" : text.trim());
          }}
          onKeyDown={onKey}
          autoComplete="off"
        />
        {(text || picked) && (
          <button
            type="button"
            aria-label="Clear"
            className="absolute inset-y-0 right-1.5 text-gray-400 hover:text-gray-600"
            onClick={() => {
              choose(null);
              setText("");
              setOpen(true);
              search("");
              inputRef.current?.focus();
            }}
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <ul className="absolute z-50 mt-1 max-h-64 w-full min-w-[240px] overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg">
          {hits.map((h, i) => (
            <li key={h.id}>
              <button
                type="button"
                className={`block w-full px-3 py-1.5 text-left text-sm ${i === active ? "bg-emerald-50 text-emerald-900" : "hover:bg-gray-50"}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()} // keep focus in the input
                onClick={() => choose(h)}
              >
                <span className="font-medium">{h.label}</span>
                {h.sub && <span className="block text-xs text-gray-400">{h.sub}</span>}
              </button>
            </li>
          ))}
          {!hits.length && (
            <li className="px-3 py-2 text-sm text-gray-400">{loading ? "Searching…" : "No results found"}</li>
          )}
        </ul>
      )}
    </div>
  );
}
