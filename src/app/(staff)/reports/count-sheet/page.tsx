import { Fragment } from "react";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { fmtDate } from "@/lib/format";
import { cartonBreakdown, displayCartonSize, ctnLabel } from "@/lib/units";
import { PageHeader } from "@/components/ui";
import { PrintButton, BackButton } from "@/components/print-button";
import { getCategoryNames } from "@/lib/categories";

export default async function CountSheetPage({ searchParams }: { searchParams: { category?: string } }) {
  await requirePerm("reports");
  const company = await getActiveCompany();
  const CATEGORIES = await getCategoryNames();
  const category = searchParams.category || "";
  const products = await prisma.product.findMany({
    where: { companyId: company.id, status: "Active", ...(category ? { category } : {}) },
    orderBy: [{ category: "asc" }, { sku: "asc" }],
  });

  let lastCategory = "";

  return (
    <div className="print-page">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <BackButton />
        <div className="flex flex-wrap gap-2">
          <form method="GET" className="flex gap-2">
            <select name="category" defaultValue={category} className="input max-w-[180px]">
              <option value="">All categories</option>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <button className="btn-secondary" type="submit">Apply</button>
          </form>
          <a href={`/api/export/count-sheet${category ? `?category=${encodeURIComponent(category)}` : ""}`} className="btn-secondary">⬇ Excel</a>
          <PrintButton />
        </div>
      </div>

      <header className="mb-4 border-b-2 border-emerald-800 pb-3">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-emerald-900">TEAMAGRO TRADING CORP.</h1>
            <p className="text-sm font-semibold text-gray-700">Product Masterlist — Physical Count Sheet</p>
          </div>
          <div className="text-right text-sm text-gray-600">
            <p>Count Date: <span className="font-semibold">{fmtDate(new Date())}</span></p>
            <p>Category: <span className="font-semibold">{category || "All"}</span> · {products.length} item(s)</p>
          </div>
        </div>
      </header>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-gray-300 text-left">
            <th className="py-1.5 pr-2">#</th>
            <th className="py-1.5 pr-2">SKU</th>
            <th className="py-1.5 pr-2">Product</th>
            <th className="py-1.5 pr-2">Pack</th>
            <th className="py-1.5 pr-2">Batch</th>
            <th className="py-1.5 pr-2 text-right">Stock (PCS)</th>
            <th className="py-1.5 pr-2 text-right">Equivalent (CTN)</th>
            <th className="py-1.5 pr-2 text-right">Loose PCS</th>
            <th className="w-28 py-1.5 pr-2 text-center">Physical Count</th>
            <th className="w-24 py-1.5 pr-2 text-center">Variance</th>
            <th className="w-32 py-1.5 text-center">Remarks</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p, i) => {
            const showCat = p.category !== lastCategory;
            lastCategory = p.category;
            return (
              <Fragment key={p.id}>
                {showCat && !category && (
                  <tr className="bg-gray-100 print:bg-gray-100">
                    <td colSpan={11} className="py-1 pl-1 text-xs font-bold uppercase tracking-wide text-emerald-900">{p.category}</td>
                  </tr>
                )}
                <tr className="border-b border-gray-200">
                  <td className="py-1.5 pr-2 text-gray-400">{i + 1}</td>
                  <td className="py-1.5 pr-2 font-mono text-xs">{p.sku}</td>
                  <td className="py-1.5 pr-2">{p.name}</td>
                  <td className="py-1.5 pr-2">{p.packSize}</td>
                  <td className="py-1.5 pr-2 font-mono text-xs">{p.batchNo ?? "—"}</td>
                  <td className="py-1.5 pr-2 text-right font-semibold">{p.stockQty.toLocaleString()}</td>
                  {(() => {
                    const b = cartonBreakdown(p.stockQty, p);
                    return (
                      <>
                        <td className="py-1.5 pr-2 text-right">
                          {b ? (
                            <>
                              {ctnLabel(p.stockQty, displayCartonSize(p))}
                              <span className="block text-[10px] text-gray-500">{b.cartons.toLocaleString()} × {p.piecesPerCarton}</span>
                            </>
                          ) : (
                            <span className="text-amber-700">N/A ⚠</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2 text-right">{b ? b.loose : "—"}</td>
                      </>
                    );
                  })()}
                  <td className="py-1.5 pr-2"><div className="mx-auto h-6 w-24 rounded border border-gray-400" /></td>
                  <td className="py-1.5 pr-2"><div className="mx-auto h-6 w-20 rounded border border-gray-400" /></td>
                  <td className="py-1.5"><div className="h-6 w-full rounded border border-gray-400" /></td>
                </tr>
              </Fragment>
            );
          })}
          {!products.length && (
            <tr><td colSpan={11} className="p-8 text-center text-gray-500">No active products in this category.</td></tr>
          )}
        </tbody>
      </table>

      <div className="mt-12 grid grid-cols-3 gap-8">
        {["Counted by (Inventory Controller)", "Checked by (Supervisor)", "Noted by (Super Admin)"].map((label) => (
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
