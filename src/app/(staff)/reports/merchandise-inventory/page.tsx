import { Fragment } from "react";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate } from "@/lib/format";
import { getMerchandiseInventory } from "@/lib/reports";
import { PrintButton, BackButton } from "@/components/print-button";

const CATEGORIES = ["Insecticide", "Herbicide", "Fungicide", "Molluscicide", "Foliar Fertilizer", "Others"];

export default async function MerchandiseInventoryPage({
  searchParams,
}: {
  searchParams: { asOf?: string; category?: string; q?: string; zero?: string };
}) {
  await requirePerm("reports");
  const company = await getActiveCompany();
  const today = new Date().toISOString().slice(0, 10);
  const asOfStr = searchParams.asOf || today;
  const category = searchParams.category || "";
  const q = searchParams.q?.trim() || "";
  const showZero = searchParams.zero === "1";

  const report = await getMerchandiseInventory({
    companyId: company.id,
    asOf: new Date(asOfStr),
    category,
    q,
    showZero,
  });

  const exportParams = new URLSearchParams();
  exportParams.set("asOf", asOfStr);
  if (category) exportParams.set("category", category);
  if (q) exportParams.set("q", q);
  if (showZero) exportParams.set("zero", "1");

  const filtersLabel = [
    category ? `Category: ${category}` : "All Categories",
    q ? `Search: "${q}"` : "All Products",
    showZero ? "Including zero stock" : "Zero stock hidden",
  ].join(" · ");

  let lastCategory = "";

  return (
    <div className="print-page">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <BackButton />
        <div className="flex flex-wrap items-end gap-2">
          <form method="GET" className="flex flex-wrap items-end gap-2">
            <div>
              <label className="label">As of Date</label>
              <input name="asOf" type="date" defaultValue={asOfStr} max={today} className="input" />
            </div>
            <div>
              <label className="label">Category</label>
              <select name="category" defaultValue={category} className="input max-w-[170px]">
                <option value="">All categories</option>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Search Product</label>
              <input name="q" defaultValue={q} placeholder="Name, SKU, pack…" className="input max-w-[190px]" />
            </div>
            <label className="mb-2 flex items-center gap-1.5 text-sm text-gray-600">
              <input type="checkbox" name="zero" value="1" defaultChecked={showZero} />
              Show zero stock
            </label>
            <button className="btn-secondary" type="submit">Apply</button>
          </form>
          <a href={`/api/export/merchandise-inventory?${exportParams.toString()}`} className="btn-secondary">⬇ Excel</a>
          <PrintButton />
        </div>
      </div>

      <header className="mb-4 border-b-2 border-emerald-800 pb-3">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-emerald-900">TEAMAGRO TRADING CORP.</h1>
            <p className="text-sm font-semibold text-gray-700">MERCHANDISE INVENTORY — Valuation at Cost</p>
          </div>
          <div className="text-right text-sm text-gray-600">
            <p>As of: <span className="font-semibold">{fmtDate(new Date(asOfStr))}</span>{report.historical ? " (reconstructed from stock card)" : ""}</p>
            <p>{filtersLabel}</p>
          </div>
        </div>
      </header>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="card py-3"><p className="text-xs text-gray-500">Inventory Items</p><p className="text-lg font-bold">{report.items.toLocaleString()}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Total Stock</p><p className="text-lg font-bold">{report.totalStock.toLocaleString()} PCS</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Total Inventory Value</p><p className="text-lg font-bold text-emerald-800">{peso(report.totalValue)}</p></div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-gray-300 text-left">
            <th className="py-1.5 pr-2">#</th>
            <th className="py-1.5 pr-2">SKU</th>
            <th className="py-1.5 pr-2">Product Name</th>
            <th className="py-1.5 pr-2">Pack</th>
            <th className="py-1.5 pr-2 text-right">Unit Cost</th>
            <th className="py-1.5 pr-2 text-right">Stock (PCS)</th>
            <th className="py-1.5 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r, i) => {
            const showCat = r.category !== lastCategory;
            lastCategory = r.category;
            return (
              <Fragment key={r.id}>
                {showCat && !category && (
                  <tr className="bg-gray-100 print:bg-gray-100">
                    <td colSpan={7} className="py-1 pl-1 text-xs font-bold uppercase tracking-wide text-emerald-900">{r.category}</td>
                  </tr>
                )}
                <tr className={`border-b border-gray-200 ${r.stock < 0 ? "bg-red-50 text-red-700" : ""}`}>
                  <td className="py-1.5 pr-2 text-gray-400">{i + 1}</td>
                  <td className="py-1.5 pr-2 font-mono text-xs">{r.sku}</td>
                  <td className="py-1.5 pr-2">{r.name}</td>
                  <td className="py-1.5 pr-2">{r.packSize}</td>
                  <td className="py-1.5 pr-2 text-right">{peso(r.unitCost)}</td>
                  <td className="py-1.5 pr-2 text-right">{r.stock.toLocaleString()}{r.stock < 0 ? " ⚠" : ""}</td>
                  <td className="py-1.5 text-right font-semibold">{peso(r.amount)}</td>
                </tr>
              </Fragment>
            );
          })}
          {!report.rows.length && (
            <tr><td colSpan={7} className="p-8 text-center text-gray-500">No products match the filters{showZero ? "" : " (zero-stock products are hidden — tick “Show zero stock”)"}.</td></tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-400 text-base font-bold">
            <td colSpan={6} className="py-2 pr-2 text-right">TOTAL INVENTORY VALUE</td>
            <td className="py-2 text-right text-emerald-900">{peso(report.totalValue)}</td>
          </tr>
        </tfoot>
      </table>

      <div className="mt-12 grid grid-cols-3 gap-8">
        {["Prepared by (Inventory Controller)", "Checked by (Accounting)", "Noted by (Super Admin)"].map((label) => (
          <div key={label} className="text-center">
            <div className="mt-10 border-t border-gray-400 pt-1">
              <p className="text-xs text-gray-500">{label} / Date</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
