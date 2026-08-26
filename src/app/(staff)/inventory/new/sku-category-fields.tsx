"use client";

import { useState } from "react";

type Category = { name: string; prefix: string };

const NEW = "__new__";

/** Category first: picking one auto-fills the next SKU in the existing PREFIX-### sequence.
    The SKU stays editable — manual edits stop the auto-fill. "+ Add new category" reveals
    name + prefix inputs; the SKU follows the typed prefix as PREFIX-001. */
export function SkuCategoryFields({ categories, nextSku }: { categories: Category[]; nextSku: Record<string, string> }) {
  const first = categories[0];
  const [category, setCategory] = useState(first?.name ?? "");
  const [sku, setSku] = useState(first ? nextSku[first.prefix] ?? "" : "");
  const [touched, setTouched] = useState(false);
  const [newPrefix, setNewPrefix] = useState("");
  const isNew = category === NEW;

  const prefixOf = (name: string) => categories.find((c) => c.name === name)?.prefix ?? "";

  return (
    <>
      <div>
        <label className="label">Category</label>
        <select
          name="category"
          className="input"
          value={category}
          onChange={(e) => {
            const v = e.target.value;
            setCategory(v);
            if (!touched) setSku(v === NEW ? (newPrefix ? `${newPrefix}-001` : "") : nextSku[prefixOf(v)] ?? "");
          }}
        >
          {categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          <option value={NEW}>+ Add new category…</option>
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
      {isNew && (
        <>
          <div>
            <label className="label">New Category Name</label>
            <input name="newCategoryName" required className="input" placeholder="e.g. Rodenticide" />
          </div>
          <div>
            <label className="label">New Category SKU Prefix (2–4 letters)</label>
            <input
              name="newCategoryPrefix"
              required
              className="input uppercase"
              placeholder="e.g. ROD"
              maxLength={4}
              pattern="[A-Za-z]{2,4}"
              title="2 to 4 letters — becomes the SKU prefix, e.g. ROD-001"
              value={newPrefix}
              onChange={(e) => {
                const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, "");
                setNewPrefix(v);
                if (!touched) setSku(v ? `${v}-001` : "");
              }}
            />
          </div>
        </>
      )}
    </>
  );
}
