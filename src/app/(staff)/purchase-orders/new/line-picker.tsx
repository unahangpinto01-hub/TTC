"use client";

import { useState } from "react";
import { SearchSelect, type SearchHit } from "@/components/search-select";

type P = { id: string; sku: string; name: string; unitCost: number; piecesPerCarton: number | null; stockQty: number };

const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A product picked from the search endpoint, rebuilt into the shape the line math uses. */
function fromHit(h: SearchHit): P {
  const d = h.data ?? {};
  return {
    id: h.id,
    sku: String(d.sku ?? ""),
    name: h.label,
    unitCost: Number(d.unitCost ?? 0),
    piecesPerCarton: d.piecesPerCarton == null ? null : Number(d.piecesPerCarton),
    stockQty: Number(d.stockQty ?? 0),
  };
}

export function POLinePicker({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<{ key: number; product: P | null; unit: string }[]>([
    { key: 0, product: null, unit: "CARTON" },
    { key: 1, product: null, unit: "CARTON" },
    { key: 2, product: null, unit: "CARTON" },
  ]);
  const setRow = (key: number, patch: Partial<{ product: P | null; unit: string }>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div>
      <label className="label">Lines</label>
      <div className="space-y-2">
        {rows.map((r) => {
          const p = r.product;
          const hasCarton = !!p && !!p.piecesPerCarton && p.piecesPerCarton > 0;
          const unit = hasCarton ? r.unit : "PCS";
          return (
            <div key={r.key}>
              <div className="flex gap-2">
                <SearchSelect
                  entity="products"
                  name="productId"
                  params={{ company: companyId }}
                  placeholder="Type product name or SKU…"
                  className="flex-1"
                  onSelect={(h) => {
                    const next = h ? fromHit(h) : null;
                    const nextHasCarton = !!next && !!next.piecesPerCarton && next.piecesPerCarton > 0;
                    setRow(r.key, { product: next, unit: nextHasCarton ? "CARTON" : "PCS" });
                  }}
                />
                <input name="qty" type="number" min={0} placeholder="Qty" className="input w-24" />
                {/* never disabled — a disabled select would drop its value from FormData and misalign the line arrays */}
                <select name="unit" className="input w-28" value={unit} onChange={(e) => setRow(r.key, { unit: e.target.value })}>
                  <option value="PCS">PCS</option>
                  {hasCarton && <option value="CARTON">CARTON</option>}
                </select>
                <input
                  name="cost"
                  type="number"
                  min={0}
                  step="any"
                  placeholder={
                    p
                      ? `₱${(unit === "CARTON" && p.piecesPerCarton ? p.unitCost * p.piecesPerCarton : p.unitCost).toFixed(2)}`
                      : "Unit cost"
                  }
                  className="input w-32"
                  title={`Cost per ${unit === "CARTON" ? "carton" : "piece"} — leave blank to use the product's current cost`}
                />
              </div>
              {p && (
                <p className="mt-0.5 pl-1 text-xs text-gray-500">
                  Stock: {p.stockQty.toLocaleString()} PCS ·{" "}
                  {unit === "CARTON" && p.piecesPerCarton
                    ? `1 CTN = ${p.piecesPerCarton} PCS · current cost ${peso(p.unitCost * p.piecesPerCarton)} / CTN`
                    : `current cost ${peso(p.unitCost)} / PC`}
                  {" · blank cost box = use current; enter a new cost for supplier price changes"}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="btn-secondary mt-2"
        onClick={() => setRows((rs) => [...rs, { key: (rs[rs.length - 1]?.key ?? 0) + 1, product: null, unit: "CARTON" }])}
      >
        + Add line
      </button>
    </div>
  );
}
