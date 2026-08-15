"use client";

import { useState } from "react";

type P = { id: string; sku: string; name: string; unitCost: number; stockQty: number };

export function POLinePicker({ products }: { products: P[] }) {
  const [rows, setRows] = useState([0, 1, 2]);
  return (
    <div>
      <label className="label">Lines</label>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r} className="flex gap-2">
            <select name="productId" className="input flex-1" defaultValue="">
              <option value="">— select product —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} · {p.name} (stock: {p.stockQty})
                </option>
              ))}
            </select>
            <input name="qty" type="number" min={0} placeholder="Qty" className="input w-24" />
          </div>
        ))}
      </div>
      <button type="button" className="btn-secondary mt-2" onClick={() => setRows((r) => [...r, r.length])}>
        + Add line
      </button>
    </div>
  );
}
