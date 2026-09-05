"use client";

import { useState } from "react";
import { SearchSelect, type SearchHit } from "@/components/search-select";

const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type LineInit = {
  productId: string | null;
  productLabel: string | null;
  productSub: string | null;
  description: string | null;
  qty: number;
  unitPrice: number;
  returnToStock: boolean;
};

type Row = {
  key: number;
  product: SearchHit | null;
  description: string;
  qty: string;
  price: string;
  returnToStock: boolean;
};

/** Item lines for a credit/refund: a product (searched) OR a free-text description per
    line, quantity, unit price, and — for product lines — a "return to stock" tick that
    puts GOOD items back into inventory when the document is posted. Leave the lines
    empty for an amount-only document and type the amount instead. */
export function LinesEditor({ companyId, initial }: { companyId: string; initial?: LineInit[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    initial?.length
      ? initial.map((l, i) => ({
          key: i,
          product: l.productId ? { id: l.productId, label: l.productLabel ?? "", sub: l.productSub ?? undefined } : null,
          description: l.description ?? "",
          qty: String(l.qty),
          price: l.unitPrice.toFixed(2),
          returnToStock: l.returnToStock,
        }))
      : [{ key: 0, product: null, description: "", qty: "", price: "", returnToStock: false }]
  );
  const [amountOnly, setAmountOnly] = useState("");

  const setRow = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const lineTotal = (r: Row) => (Number(r.qty) || 0) * (Number(r.price) || 0);
  const total = rows.reduce((s, r) => s + lineTotal(r), 0);
  const hasLines = rows.some((r) => lineTotal(r) > 0);

  return (
    <div className="space-y-2">
      <label className="label">Items (product or description · leave empty for an amount-only document)</label>
      {rows.map((r, i) => (
        <div key={r.key} className="flex flex-wrap items-start gap-2">
          {/* hidden fields stay aligned by rendering exactly one of each per row */}
          <input type="hidden" name="lineProductId" value={r.product?.id ?? ""} />
          <div className="min-w-[240px] flex-1">
            <SearchSelect
              entity="products"
              params={{ company: companyId }}
              placeholder="Product (or use description) …"
              defaultValue={r.product}
              onSelect={(h) => setRow(r.key, { product: h, price: h?.data?.srp != null && !r.price ? Number(h.data.srp).toFixed(2) : r.price })}
            />
          </div>
          <input
            name="lineDescription"
            value={r.description}
            onChange={(e) => setRow(r.key, { description: e.target.value })}
            placeholder="or description (e.g. billing adjustment)"
            className="input w-56"
          />
          <input
            name="lineQty"
            type="number"
            min={0}
            value={r.qty}
            onChange={(e) => setRow(r.key, { qty: e.target.value })}
            placeholder="Qty"
            className="input w-20"
          />
          <input
            name="linePrice"
            type="number"
            min={0}
            step="0.01"
            value={r.price}
            onChange={(e) => setRow(r.key, { price: e.target.value })}
            placeholder="Unit price"
            className="input w-28"
          />
          <label className="flex items-center gap-1.5 pt-2 text-xs" title="Tick for GOOD items physically returned — they re-enter inventory when this document is posted. Leave unticked for damaged goods.">
            <input
              type="checkbox"
              name="lineReturn"
              value={String(i)}
              checked={r.returnToStock}
              disabled={!r.product}
              onChange={(e) => setRow(r.key, { returnToStock: e.target.checked })}
            />
            return to stock
          </label>
          <span className="w-28 pt-2 text-right text-sm font-semibold">{lineTotal(r) > 0 ? peso(lineTotal(r)) : ""}</span>
          <button
            type="button"
            className="pt-2 text-red-400 hover:text-red-600"
            title="Remove line"
            onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn-secondary"
        onClick={() => setRows((rs) => [...rs, { key: (rs[rs.length - 1]?.key ?? 0) + 1, product: null, description: "", qty: "", price: "", returnToStock: false }])}
      >
        + Add line
      </button>

      <div className="flex flex-wrap items-end gap-4 pt-2">
        {hasLines ? (
          <p className="text-sm">
            Document total from items: <span className="text-lg font-bold text-emerald-800">{peso(total)}</span>
          </p>
        ) : (
          <div>
            <label className="label">Amount (₱ — amount-only document)</label>
            <input
              name="amount"
              type="number"
              min={0}
              step="0.01"
              value={amountOnly}
              onChange={(e) => setAmountOnly(e.target.value)}
              className="input w-40 font-semibold"
            />
          </div>
        )}
      </div>
    </div>
  );
}
