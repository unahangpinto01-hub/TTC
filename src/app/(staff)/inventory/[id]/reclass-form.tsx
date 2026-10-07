"use client";

import { useRef, useState } from "react";
import { reclassStock } from "../actions";

const LABELS: Record<string, string> = { GOOD: "Good stock", OBSOLETE: "Obsolete", RELABEL: "For relabelling", AT_SUPPLIER: "At supplier for reformulation" };

/** Move pieces between conditions at cost: declare obsolete, send for relabelling or to the
    supplier for reformulation, or bring stock back as good. Confirmation before applying. */
export function ReclassStockForm({ productId, available }: { productId: string; available: Record<string, number> }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [from, setFrom] = useState("GOOD");
  const [to, setTo] = useState("OBSOLETE");
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form
      ref={formRef}
      action={reclassStock}
      onSubmit={(e) => {
        const f = formRef.current!;
        const qty = (f.elements.namedItem("qty") as HTMLInputElement).value;
        const date = (f.elements.namedItem("date") as HTMLInputElement).value;
        if (!window.confirm(`Move ${qty} PCS from ${LABELS[from]} to ${LABELS[to]} effective ${date}?`)) e.preventDefault();
      }}
      className="card mb-4 flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="productId" value={productId} />
      <div>
        <label className="label">Reclassify from</label>
        <select name="from" value={from} onChange={(e) => setFrom(e.target.value)} className="input w-56">
          {Object.entries(LABELS).map(([k, v]) => <option key={k} value={k}>{v} ({(available[k] ?? 0).toLocaleString()} PCS)</option>)}
        </select>
      </div>
      <div>
        <label className="label">To</label>
        <select name="to" value={to} onChange={(e) => setTo(e.target.value)} className="input w-56">
          {Object.entries(LABELS).filter(([k]) => k !== from).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Quantity (PCS)</label>
        <input name="qty" type="number" min={1} step={1} max={available[from] ?? undefined} required className="input w-28" />
      </div>
      <div>
        <label className="label">Effective Date</label>
        <input name="date" type="date" defaultValue={today} max={today} className="input" />
      </div>
      <div className="min-w-[240px] flex-1">
        <label className="label">Reason (required)</label>
        <input name="reason" required className="input" placeholder="e.g. expired lot, label change, reformulation at Radisson" />
      </div>
      <button className="btn-secondary" type="submit">Reclassify</button>
      <p className="w-full text-xs text-gray-500">
        Pieces move at cost: from good stock at the product&rsquo;s unit cost, from a bucket at that bucket&rsquo;s cost basis. The ledger
        books the move between the stock accounts (131000–135000 good stock, 131100 obsolete, 137000 others).
      </p>
    </form>
  );
}
