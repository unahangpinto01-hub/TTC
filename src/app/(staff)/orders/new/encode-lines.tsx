"use client";

import { useState } from "react";

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

export function EncodeLines({ products }: { products: P[] }) {
  const [rows, setRows] = useState<{ key: number; productId: string; unit: string }[]>([
    { key: 0, productId: "", unit: "PCS" },
    { key: 1, productId: "", unit: "PCS" },
    { key: 2, productId: "", unit: "PCS" },
  ]);
  const setRow = (key: number, patch: Partial<{ productId: string; unit: string }>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div>
      <label className="label">Order Lines</label>
      <div className="space-y-2">
        {rows.map((r) => {
          const p = products.find((x) => x.id === r.productId);
          const hasCarton = !!p && !!p.piecesPerCarton && p.piecesPerCarton > 0;
          const unit = hasCarton ? r.unit : "PCS";
          const price = p ? (unit === "CARTON" ? cartonPrice(p)! : p.dealerPrice) : null;
          return (
            <div key={r.key}>
              <div className="flex gap-2">
                <select
                  name="productId"
                  className="input flex-1"
                  value={r.productId}
                  onChange={(e) => setRow(r.key, { productId: e.target.value, unit: "PCS" })}
                >
                  <option value="">— select product —</option>
                  {products.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.sku} · {x.name}
                    </option>
                  ))}
                </select>
                <input name="qty" type="number" min={0} placeholder="Qty" className="input w-24" />
                {/* never disabled — a disabled select would drop its value from FormData and misalign the line arrays */}
                <select name="unit" className="input w-28" value={unit} onChange={(e) => setRow(r.key, { unit: e.target.value })}>
                  <option value="PCS">PCS</option>
                  {hasCarton && <option value="CARTON">CARTON</option>}
                </select>
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
        onClick={() => setRows((rs) => [...rs, { key: (rs[rs.length - 1]?.key ?? 0) + 1, productId: "", unit: "PCS" }])}
      >
        + Add line
      </button>
    </div>
  );
}
