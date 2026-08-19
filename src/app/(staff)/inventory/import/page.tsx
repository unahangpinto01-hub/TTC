"use client";

import { useFormState, useFormStatus } from "react-dom";
import { importProducts } from "./actions";

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" type="submit" disabled={pending}>
      {pending ? "Importing…" : "Upload & Import"}
    </button>
  );
}

export default function ProductImportPage() {
  const [result, formAction] = useFormState(importProducts, null);
  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">Bulk Import Products</h1>
      <div className="card mb-4 space-y-3">
        <p className="text-sm text-gray-600">
          Upload an Excel file with columns: <code className="rounded bg-gray-100 px-1 text-xs">sku, name, parentItem, activeIngredient, category, cropTags, packSize, piecesPerCarton, unitCost, dealerPrice, cartonDealerPrice, srp, reorderPoint, supplier, openingStock</code>.
          Opening stock (in PCS) creates an initial IN stock-card entry. Parent item is the product-line label used for grouping and forecasts (e.g. &quot;AgroShield 5 EC&quot;) — leave blank for a standalone product.
          piecesPerCarton enables selling/buying by carton; cartonDealerPrice is optional (blank = PCS price × pieces per carton).
        </p>
        <a href="/api/templates/products" className="btn-secondary w-fit">⬇ Download Template</a>
      </div>
      <form action={formAction} className="card space-y-3">
        <input type="file" name="file" accept=".xlsx,.xls" required className="input" />
        <SubmitBtn />
      </form>
      {result && (
        <div className="card mt-4">
          <p className="mb-2 font-semibold text-emerald-700">✔ {result.imported} product(s) imported.</p>
          {result.errors.length > 0 && (
            <>
              <p className="mb-1 text-sm font-semibold text-red-700">{result.errors.length} row(s) skipped:</p>
              <ul className="max-h-64 space-y-1 overflow-y-auto text-sm text-red-600">
                {result.errors.map((e, i) => (
                  <li key={i}>Row {e.row}: {e.message}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
