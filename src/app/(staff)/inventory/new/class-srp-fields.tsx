"use client";

import { useState } from "react";

/** Item classification + SRP: promo materials (non-inventory) keep stock and unit-cost
    tracking but carry no SRP, so the SRP box disappears when NON_INVENTORY is picked. */
export function ClassSrpFields({ defaultClass = "INVENTORY", defaultSrp }: { defaultClass?: string; defaultSrp?: number }) {
  const [cls, setCls] = useState(defaultClass);
  return (
    <>
      <div>
        <label className="label">Classification</label>
        <select name="itemClass" className="input" value={cls} onChange={(e) => setCls(e.target.value)}>
          <option value="INVENTORY">Inventory item (merchandise)</option>
          <option value="NON_INVENTORY">Non-Inventory (promo materials)</option>
        </select>
      </div>
      <div>
        <label className="label">SRP (₱)</label>
        {cls === "NON_INVENTORY" ? (
          <p className="input bg-gray-50 text-gray-400">— no SRP for promo items</p>
        ) : (
          <input name="srp" type="number" step="0.01" min={0} defaultValue={defaultSrp || undefined} className="input" />
        )}
      </div>
    </>
  );
}
