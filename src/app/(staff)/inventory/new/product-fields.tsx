"use client";

import { useState } from "react";
import { ParentItemField } from "../parent-item-field";

type Category = { name: string; prefix: string };
type Supplier = { id: string; name: string };

const NEW = "__new__";

/** The whole New Product field grid. Classification comes first: Non-Inventory (promo
    materials) shows only Category, SKU, Name, Unit Cost, Pack Size, Reorder Point,
    Opening Stock, Gross Weight, Batch Number, and Supplier — no selling prices,
    cartons, crop/ingredient data, dates, or parent grouping. */
export function ProductFields({
  categories,
  nextSku,
  suppliers,
  parentOptions,
}: {
  categories: Category[];
  nextSku: Record<string, string>;
  suppliers: Supplier[];
  parentOptions: string[];
}) {
  const first = categories[0];
  const [cls, setCls] = useState("INVENTORY");
  const [category, setCategory] = useState(first?.name ?? "");
  const [sku, setSku] = useState(first ? nextSku[first.prefix] ?? "" : "");
  const [touched, setTouched] = useState(false);
  const [newPrefix, setNewPrefix] = useState("");
  const isNew = category === NEW;
  const inv = cls === "INVENTORY";

  const prefixOf = (name: string) => categories.find((c) => c.name === name)?.prefix ?? "";

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
      <div><label className="label">Product Name</label><input name="name" required className="input" /></div>
      {inv && <div><label className="label">Active Ingredient</label><input name="activeIngredient" className="input" /></div>}
      {inv && <div><label className="label">Crop Tags (comma-separated)</label><input name="cropTags" className="input" placeholder="Rice,Corn" /></div>}
      <div><label className="label">Unit Cost per PCS (₱)</label><input name="unitCost" type="number" step="any" min={0} className="input" /></div>
      {inv && <div><label className="label">…or Cost per Carton (₱)</label><input name="costPerCarton" type="number" step="any" min={0} className="input" placeholder="auto ÷ pieces per carton" /></div>}
      <div><label className="label">Pack Size</label><input name="packSize" className="input" placeholder={inv ? "500ml" : "e.g. XL"} /></div>
      {inv && <div><label className="label">Dealer Price (₱)</label><input name="dealerPrice" type="number" step="0.01" min={0} className="input" /></div>}
      {inv && <div><label className="label">SRP (₱)</label><input name="srp" type="number" step="0.01" min={0} className="input" /></div>}
      <div><label className="label">Reorder Point (PCS)</label><input name="reorderPoint" type="number" defaultValue={10} className="input" /></div>
      <div><label className="label">Opening Stock (PCS)</label><input name="openingStock" type="number" defaultValue={0} className="input" /></div>
      {inv && <div><label className="label">Pieces per Carton</label><input name="piecesPerCarton" type="number" min={0} className="input" placeholder="blank = no carton" /></div>}
      {inv && <div><label className="label">Carton Dealer Price (₱)</label><input name="cartonDealerPrice" type="number" step="0.01" min={0} className="input" placeholder="blank = auto" /></div>}
      <div><label className="label">Gross Weight per Pack (kg)</label><input name="packGrossWeightKg" type="number" step="any" min={0} className="input" placeholder="e.g. 13.50" /></div>
      <div><label className="label">Batch Number</label><input name="batchNo" className="input" placeholder="B26-0001" /></div>
      {inv && <div><label className="label">Manufacturing Date</label><input name="mfgDate" type="date" className="input" /></div>}
      {inv && <div><label className="label">Expiration Date</label><input name="expDate" type="date" className="input" /></div>}
      {inv && (
        <div>
          <label className="label">Parent Item (grouping, optional)</label>
          <ParentItemField options={parentOptions} />
        </div>
      )}
      <div>
        <label className="label">Supplier</label>
        <select name="supplierId" className="input">
          <option value="">—</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
    </>
  );
}
