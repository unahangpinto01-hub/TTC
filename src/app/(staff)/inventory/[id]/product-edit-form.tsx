"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { updateProduct } from "../actions";
import { ParentItemField } from "../parent-item-field";

const CATEGORIES = ["Insecticide", "Herbicide", "Fungicide", "Molluscicide", "Foliar Fertilizer", "Others"];

type ProductFields = {
  id: string;
  sku: string;
  name: string;
  activeIngredient: string;
  category: string;
  cropTags: string;
  packSize: string;
  unitCost: number;
  dealerPrice: number;
  srp: number;
  reorderPoint: number;
  piecesPerCarton: number | null;
  cartonDealerPrice: number | null;
  packGrossWeightKg: number | null;
  supplierId: string | null;
  batchNo: string | null;
  mfgDate: string; // yyyy-mm-dd or ""
  expDate: string;
  parentItem: string | null;
};

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

/** Superadmin-only full product editor. SKU and stock are not editable here. */
export function ProductEditForm({
  product,
  suppliers,
  parentOptions,
}: {
  product: ProductFields;
  suppliers: { id: string; name: string }[];
  parentOptions: string[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="mb-4">
        <button className="btn-secondary" type="button" onClick={() => setOpen(true)}>
          ✎ Edit Product
        </button>
      </div>
    );
  }

  return (
    <form action={updateProduct} className="card mb-4 space-y-4">
      <input type="hidden" name="productId" value={product.id} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        <div>
          <label className="label">SKU (not editable)</label>
          <input value={product.sku} disabled className="input bg-gray-100 text-gray-500" />
        </div>
        <div><label className="label">Product Name</label><input name="name" required defaultValue={product.name} className="input" /></div>
        <div><label className="label">Active Ingredient</label><input name="activeIngredient" defaultValue={product.activeIngredient} className="input" /></div>
        <div>
          <label className="label">Category</label>
          <select name="category" defaultValue={product.category} className="input">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
        <div><label className="label">Crop Tags (comma-separated)</label><input name="cropTags" defaultValue={product.cropTags} className="input" placeholder="Rice,Corn" /></div>
        <div><label className="label">Pack Size</label><input name="packSize" required defaultValue={product.packSize} className="input" placeholder="500ml" /></div>
        <div>
          <label className="label">Unit Cost per PCS (₱)</label>
          <input name="unitCost" type="number" step="any" min="0" defaultValue={product.unitCost} className="input" />
          <p className="mt-0.5 text-xs text-gray-400">full decimals kept, e.g. 100.429167</p>
        </div>
        <div>
          <label className="label">…or Cost per Carton (₱)</label>
          <input name="costPerCarton" type="number" step="any" min="0" className="input" placeholder="auto ÷ pieces per carton" />
          <p className="mt-0.5 text-xs text-gray-400">if filled, overrides unit cost at full precision</p>
        </div>
        <div><label className="label">Dealer Price (₱)</label><input name="dealerPrice" type="number" step="0.01" min="0" defaultValue={product.dealerPrice} className="input" /></div>
        <div><label className="label">SRP (₱)</label><input name="srp" type="number" step="0.01" min="0" defaultValue={product.srp} className="input" /></div>
        <div><label className="label">Reorder Point (PCS)</label><input name="reorderPoint" type="number" min="0" defaultValue={product.reorderPoint} className="input" /></div>
        <div>
          <label className="label">Pieces per Carton</label>
          <input name="piecesPerCarton" type="number" min="0" defaultValue={product.piecesPerCarton ?? ""} className="input" placeholder="blank = no carton" />
        </div>
        <div>
          <label className="label">Carton Dealer Price (₱)</label>
          <input name="cartonDealerPrice" type="number" step="0.01" min="0" defaultValue={product.cartonDealerPrice ?? ""} className="input" placeholder="blank = PCS price × per-carton" />
        </div>
        <div>
          <label className="label">Gross Weight per Pack (kg)</label>
          <input name="packGrossWeightKg" type="number" step="any" min="0" defaultValue={product.packGrossWeightKg ?? ""} className="input" placeholder="e.g. 13.50 — full carton incl. packaging" />
        </div>
        <div>
          <label className="label">Supplier</label>
          <select name="supplierId" defaultValue={product.supplierId ?? ""} className="input">
            <option value="">—</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div><label className="label">Batch Number</label><input name="batchNo" defaultValue={product.batchNo ?? ""} className="input" placeholder="B26-0001" /></div>
        <div><label className="label">Manufacturing Date</label><input name="mfgDate" type="date" defaultValue={product.mfgDate} className="input" /></div>
        <div><label className="label">Expiration Date</label><input name="expDate" type="date" defaultValue={product.expDate} className="input" /></div>
        <div>
          <label className="label">Parent Item (grouping)</label>
          <ParentItemField options={parentOptions} defaultValue={product.parentItem} />
        </div>
      </div>
      <div className="flex gap-2">
        <SaveBtn />
        <button className="btn-secondary" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
