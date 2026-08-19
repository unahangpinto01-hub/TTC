"use client";

import { useState } from "react";

const CATEGORIES = ["Insecticide", "Herbicide", "Fungicide", "Molluscicide", "Foliar Fertilizer", "Others"];
const PREFIX: Record<string, string> = {
  Insecticide: "INS", Herbicide: "HER", Fungicide: "FNG",
  Molluscicide: "MOL", "Foliar Fertilizer": "FOL", Others: "OTH",
};

/** Category first: picking one auto-fills the next SKU in the existing PREFIX-### sequence.
    The SKU stays editable — manual edits stop the auto-fill. */
export function SkuCategoryFields({ nextSku }: { nextSku: Record<string, string> }) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [sku, setSku] = useState(nextSku[PREFIX[CATEGORIES[0]]] ?? "");
  const [touched, setTouched] = useState(false);

  return (
    <>
      <div>
        <label className="label">Category</label>
        <select
          name="category"
          className="input"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            if (!touched) setSku(nextSku[PREFIX[e.target.value]] ?? "");
          }}
        >
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label className="label">SKU (auto)</label>
        <input
          name="sku"
          required
          className="input"
          value={sku}
          onChange={(e) => {
            setSku(e.target.value);
            setTouched(true);
          }}
        />
      </div>
    </>
  );
}
