"use client";

import { useState } from "react";
import { SearchSelect, type SearchHit } from "@/components/search-select";

type P = {
  id: string;
  sku: string;
  name: string;
  dealerPrice: number;
  cartonDealerPrice: number | null;
  piecesPerCarton: number | null;
  stockQty: number;
};

const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function cartonPrice(p: P): number | null {
  if (!p.piecesPerCarton || p.piecesPerCarton <= 0) return null;
  return p.cartonDealerPrice ?? Math.round(p.dealerPrice * p.piecesPerCarton * 100) / 100;
}

function stockHint(p: P): string {
  if (!p.piecesPerCarton || p.piecesPerCarton <= 0) return `${p.stockQty.toLocaleString()} PCS`;
  const ctn = Math.floor(p.stockQty / p.piecesPerCarton);
  const loose = p.stockQty % p.piecesPerCarton;
  return `${p.stockQty.toLocaleString()} PCS = ${ctn.toLocaleString()} CTN${loose ? ` + ${loose} PCS` : ""}`;
}

/** A product picked from the search endpoint, rebuilt into the shape the line math uses. */
function fromHit(h: SearchHit): P {
  const d = h.data ?? {};
  return {
    id: h.id,
    sku: String(d.sku ?? ""),
    name: h.label,
    dealerPrice: Number(d.dealerPrice ?? 0),
    cartonDealerPrice: d.cartonDealerPrice == null ? null : Number(d.cartonDealerPrice),
    piecesPerCarton: d.piecesPerCarton == null ? null : Number(d.piecesPerCarton),
    stockQty: Number(d.stockQty ?? 0),
  };
}

/** An existing order line, for editing rather than encoding from scratch. */
export type InitialLine = P & { qty: number; unit: string };

export function EncodeLines({ companyId, initial }: { companyId: string; initial?: InitialLine[] }) {
  // encoding starts with three blank rows; editing starts with the order's own lines
  // and one spare, so adding an item takes no extra click
  const [rows, setRows] = useState<{ key: number; product: P | null; unit: string; qty: string }[]>(
    initial?.length
      ? [
          ...initial.map((l, i) => ({ key: i, product: l as P, unit: l.unit, qty: String(l.qty) })),
          { key: initial.length, product: null, unit: "PCS", qty: "" },
        ]
      : [
          { key: 0, product: null, unit: "PCS", qty: "" },
          { key: 1, product: null, unit: "PCS", qty: "" },
          { key: 2, product: null, unit: "PCS", qty: "" },
        ]
  );
  const setRow = (key: number, patch: Partial<{ product: P | null; unit: string; qty: string }>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div>
      <label className="label">Order Lines</label>
      <div className="space-y-2">
        {rows.map((r) => {
          const p = r.product;
          const hasCarton = !!p && !!p.piecesPerCarton && p.piecesPerCarton > 0;
          const unit = hasCarton ? r.unit : "PCS";
          const price = p ? (unit === "CARTON" ? cartonPrice(p)! : p.dealerPrice) : null;
          return (
            <div key={r.key}>
              <div className="flex gap-2">
                <SearchSelect
                  entity="products"
                  name="productId"
                  params={{ company: companyId, active: "1" }}
                  placeholder="Type product name or SKU…"
                  className="flex-1"
                  defaultValue={p ? { id: p.id, label: p.name } : null}
                  onSelect={(h) => setRow(r.key, { product: h ? fromHit(h) : null, unit: "PCS" })}
                />
                <input
                  name="qty"
                  type="number"
                  min={0}
                  placeholder="Qty"
                  className="input w-24"
                  value={r.qty}
                  onChange={(e) => setRow(r.key, { qty: e.target.value })}
                />
                {/* never disabled — a disabled select would drop its value from FormData and misalign the line arrays */}
                <select name="unit" className="input w-28" value={unit} onChange={(e) => setRow(r.key, { unit: e.target.value })}>
                  <option value="PCS">PCS</option>
                  {hasCarton && <option value="CARTON">CARTON</option>}
                </select>
                <button
                  type="button"
                  title="Remove this line"
                  aria-label="Remove this line"
                  className="rounded border border-gray-200 px-2 text-sm text-gray-400 hover:border-red-200 hover:text-red-600"
                  onClick={() =>
                    // drop the whole row: productId/qty/unit are parallel arrays on submit,
                    // so a row has to leave as one piece or the lines misalign
                    setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))
                  }
                >
                  ✕
                </button>
              </div>
              {p && (
                <p className="mt-0.5 pl-1 text-xs text-gray-500">
                  Stock: {stockHint(p)}
                  {price != null && <> · {peso(price)} / {unit === "CARTON" ? `CTN (${p.piecesPerCarton} pcs)` : "PC"}</>}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="btn-secondary mt-2"
        onClick={() => setRows((rs) => [...rs, { key: (rs[rs.length - 1]?.key ?? 0) + 1, product: null, unit: "PCS", qty: "" }])}
      >
        + Add line
      </button>
    </div>
  );
}
