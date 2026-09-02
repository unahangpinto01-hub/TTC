import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { getProductReport, parseRange } from "@/lib/reports";
import { getCategoryNames } from "@/lib/categories";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";

export default async function ProductReportPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; company?: string; category?: string };
}) {
  const user = await requirePerm("reports");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const categories = await getCategoryNames();
  const category = categories.includes(searchParams.category || "") ? searchParams.category! : "";
  const r = await getProductReport(range, scope.ids, category ? { category } : undefined);
  const fromStr = range.from.toISOString().slice(0, 10);
  const toStr = range.to.toISOString().slice(0, 10);
  const marginPct = r.totals.revenue > 0 ? (r.totals.margin / r.totals.revenue) * 100 : 0;

  const qs = new URLSearchParams({ from: fromStr, to: toStr, company: scope.value });
  if (category) qs.set("category", category);

  return (
    <div className="print-page">
      <PageHeader title="Product Report">
        <a href={`/api/export/products?${qs.toString()}`} className="btn-secondary no-print">⬇ Excel</a>
        <span className="no-print"><PrintButton /></span>
      </PageHeader>

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <div>
          <label className="label">Category</label>
          <select name="category" defaultValue={category} className="input max-w-[170px]">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <p className="mb-4 text-sm text-gray-600">
        <span className="font-semibold">{scope.label}</span> · {fmtDate(range.from)} – {fmtDate(range.to)}
        {category ? ` · ${category}` : ""} · {r.rows.length} product(s) sold · Revenue{" "}
        <span className="font-bold text-emerald-800">{peso(r.totals.revenue)}</span> · Margin{" "}
        <span className="font-bold">{peso(r.totals.margin)}</span> ({marginPct.toFixed(1)}%)
      </p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[880px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">SKU</th>
              <th className="table-th">Product</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Category</th>
              <th className="table-th text-right">Qty Sold (PCS)</th>
              <th className="table-th text-right">Revenue</th>
              <th className="table-th text-right">COGS</th>
              <th className="table-th text-right">Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {r.rows.map((x) => (
              <tr key={x.key} className="hover:bg-gray-50">
                <td className="table-td font-mono text-xs">{x.sku}</td>
                <td className="table-td text-sm">{x.name}</td>
                {scope.combined && <td className="table-td"><CompanyTag name={x.company} /></td>}
                <td className="table-td text-sm text-gray-600">{x.category}</td>
                <td className="table-td text-right">{x.qty.toLocaleString()}</td>
                <td className="table-td text-right">{peso(x.revenue)}</td>
                <td className="table-td text-right text-gray-600">{peso(x.cogs)}</td>
                <td className={`table-td text-right font-semibold ${x.margin < 0 ? "text-red-600" : "text-emerald-700"}`}>{peso(x.margin)}</td>
              </tr>
            ))}
            {!r.rows.length && (
              <tr><td colSpan={scope.combined ? 8 : 7} className="p-8 text-center text-sm text-gray-500">No products sold in this range.</td></tr>
            )}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50 font-bold">
            <tr>
              <td className="table-td" colSpan={scope.combined ? 4 : 3}>{scope.combined ? "COMBINED GRAND TOTAL" : "TOTAL"}</td>
              <td className="table-td text-right">{r.totals.qty.toLocaleString()}</td>
              <td className="table-td text-right text-emerald-800">{peso(r.totals.revenue)}</td>
              <td className="table-td text-right text-gray-600">{peso(r.totals.cogs)}</td>
              <td className="table-td text-right text-emerald-700">{peso(r.totals.margin)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        COGS uses the cost captured when each delivery was made; margin is revenue less that cost.
      </p>
    </div>
  );
}
