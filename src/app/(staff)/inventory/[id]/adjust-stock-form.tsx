"use client";

import { useRef } from "react";
import { adjustStock } from "../actions";

/** Stock adjustment form: reason is mandatory and applying asks for confirmation first. */
export function AdjustStockForm({ productId, hasCarton }: { productId: string; hasCarton: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form
      ref={formRef}
      action={adjustStock}
      onSubmit={(e) => {
        const f = formRef.current!;
        const delta = (f.elements.namedItem("delta") as HTMLInputElement).value;
        const unit = (f.elements.namedItem("unit") as HTMLSelectElement).value;
        const date = (f.elements.namedItem("effectiveDate") as HTMLInputElement).value;
        const ok = window.confirm(
          `Are you sure you want to proceed?\n\nAdjustment: ${Number(delta) > 0 ? "+" : ""}${delta} ${unit === "CARTON" ? "CARTON" : "PCS"}\nEffective date: ${date}`
        );
        if (!ok) e.preventDefault();
      }}
      className="card mb-4 flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="productId" value={productId} />
      <div>
        <label className="label">Effective Date</label>
        <input
          name="effectiveDate"
          type="date"
          defaultValue={today}
          max={today}
          className="input"
          title="The date the movement applies to — backdate for beginning balances"
        />
      </div>
      <div>
        <label className="label">Adjust Stock (+/−)</label>
        <input name="delta" type="number" className="input w-32" placeholder="+10 or -5" required />
      </div>
      <div>
        <label className="label">Unit</label>
        <select name="unit" className="input w-28" defaultValue="PCS">
          <option value="PCS">PCS</option>
          {hasCarton && <option value="CARTON">CARTON</option>}
        </select>
      </div>
      <div className="flex-1">
        <label className="label">Reason (required)</label>
        <input name="reason" className="input" placeholder="Physical count correction / Beginning Balance" required />
      </div>
      <button className="btn-secondary" type="submit">Apply Adjustment</button>
    </form>
  );
}
