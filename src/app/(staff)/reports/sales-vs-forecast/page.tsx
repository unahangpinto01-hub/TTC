import Link from "next/link";
import { Fragment } from "react";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter } from "@/components/company-filter";
import { getSalesVsForecast } from "@/lib/reports";
import { provincesForArea } from "@/lib/forecast-units";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const fmtEq = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 2 });

function AchievementBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-gray-400">—</span>;
  const tone = pct >= 100 ? "bg-emerald-100 text-emerald-800" : pct >= 70 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${tone}`}>{Math.round(pct)}%</span>;
}

/** Sales vs Forecast: every actual sale is converted to the forecast's unit
    (1,000-ml equivalent PCS for liquids) before achievement is computed.
    Invoice, inventory and stock-card quantities are never altered. */
export default async function SalesVsForecastPage({
  searchParams,
}: {
  searchParams: { year?: string; forecast?: string; month?: string; company?: string };
}) {
  const user = await requirePerm("reports");
  const scope = await resolveReportScope(user, searchParams.company);

  const all = await prisma.forecast.findMany({ orderBy: [{ year: "desc" }, { area: "asc" }], select: { id: true, title: true, area: true, year: true } });
  const years = [...new Set(all.map((f) => f.year))];
  const now = new Date();
  const year = years.includes(Number(searchParams.year)) ? Number(searchParams.year) : years[0] ?? now.getFullYear();
  const ofYear = all.filter((f) => f.year === year);

  const picked = ofYear.find((f) => f.id === searchParams.forecast) ?? null; // null = combined, all areas
  const defaultMonth = year < now.getFullYear() ? 12 : year > now.getFullYear() ? 12 : now.getMonth() + 1;
  const month = Math.min(12, Math.max(1, Number(searchParams.month) || defaultMonth));

  const provinces = picked ? provincesForArea(picked.area) : null;
  const r = await getSalesVsForecast({
    year,
    forecastIds: picked ? [picked.id] : ofYear.map((f) => f.id),
    companyIds: scope.ids,
    provinces,
    throughMonth: month,
  });

  const totalForecast = r.rows.reduce((s, x) => s + x.forecastQty, 0);
  const totalEquivalent = r.rows.reduce((s, x) => s + x.equivalent, 0);
  const overallPct = totalForecast > 0 ? (totalEquivalent / totalForecast) * 100 : null;
  const scopeLabel = picked ? `${picked.area}${provinces ? "" : " (area not mapped — sales from all provinces)"}` : "Combined — All Areas";

  return (
    <div className="print-page">
      <div className="no-print mb-3 flex items-center justify-between">
        <Link href="/reports" className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">← Back to Reports</Link>
        <PrintButton />
      </div>
      <PageHeader title="Sales vs Forecast by Area" />
      <p className="mb-3 hidden text-sm text-gray-600 print:block">
        {scopeLabel} · January – {MONTH_NAMES[month - 1]} {year} · generated {new Date().toLocaleDateString("en-PH", { timeZone: "Asia/Manila", dateStyle: "long" })}
      </p>

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div>
          <label className="label">Year</label>
          <select name="year" defaultValue={year} className="input w-28">
            {years.map((y) => <option key={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Forecast</label>
          <select name="forecast" defaultValue={picked?.id ?? ""} className="input w-64">
            <option value="">Combined — All Areas</option>
            {ofYear.map((f) => <option key={f.id} value={f.id}>{f.area}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Compare through</label>
          <select name="month" defaultValue={month} className="input w-40">
            {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <p className="mb-4 text-sm text-gray-600">
        <span className="font-semibold">{scopeLabel}</span> · forecast Jan–{MONTH_NAMES[month - 1].slice(0, 3)} vs invoiced sales in the same months ({r.invoiceCount} invoice{r.invoiceCount === 1 ? "" : "s"})
        {provinces ? <span className="text-xs text-gray-400"> · provinces counted: {provinces.join(", ")}</span> : null}
      </p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b-2 border-gray-300 bg-gray-50">
            <tr>
              <th className="table-th">Product (forecast unit)</th>
              <th className="table-th text-right">Forecast Qty</th>
              <th className="table-th text-right">Actual Sales</th>
              <th className="table-th text-right">Actual Equivalent</th>
              <th className="table-th text-right">Achievement</th>
              <th className="table-th text-right">Variance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {r.rows.map((row) => {
              const pct = row.forecastQty > 0 ? (row.equivalent / row.forecastQty) * 100 : row.equivalent > 0 ? null : 0;
              const variance = row.equivalent - row.forecastQty;
              const actualPieces = row.packs.reduce((s, p) => s + p.qty, 0);
              return (
                <Fragment key={row.productId}>
                  <tr className="hover:bg-gray-50">
                    <td className="table-td">
                      <span className="font-medium">{row.name}</span>
                      <span className="ml-1 text-[10px] text-gray-400">{row.sku}</span>
                    </td>
                    <td className="table-td text-right font-semibold">{row.forecastQty.toLocaleString()}</td>
                    <td className="table-td text-right">
                      {actualPieces ? (
                        <details className="inline-block text-left">
                          <summary className="cursor-pointer whitespace-nowrap text-emerald-700 hover:underline">
                            {actualPieces.toLocaleString()} pc(s) · {row.packs.length} pack size(s)
                          </summary>
                          <ul className="mt-1 space-y-0.5 rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700">
                            {row.packs.map((p) => (
                              <li key={p.productId} className="whitespace-nowrap">
                                {p.qty.toLocaleString()} × {p.packSize}
                                {p.factor !== null && p.factor !== 1 ? ` (× ${p.factor})` : ""} = {fmtEq(p.equivalent)} eq
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : (
                        <span className="text-gray-400">no sales</span>
                      )}
                    </td>
                    <td className="table-td text-right font-semibold">{fmtEq(row.equivalent)}</td>
                    <td className="table-td text-right"><AchievementBadge pct={pct} /></td>
                    <td className={`table-td text-right font-medium ${variance < 0 ? "text-red-600" : "text-emerald-700"}`}>
                      {variance > 0 ? "+" : ""}{fmtEq(variance)}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
            {!r.rows.length && (
              <tr><td colSpan={6} className="p-8 text-center text-sm text-gray-500">No forecast lines for this selection.</td></tr>
            )}
          </tbody>
          {r.rows.length > 0 && (
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <tr>
                <td className="table-td">TOTAL</td>
                <td className="table-td text-right">{totalForecast.toLocaleString()}</td>
                <td className="table-td" />
                <td className="table-td text-right">{fmtEq(totalEquivalent)}</td>
                <td className="table-td text-right"><AchievementBadge pct={overallPct} /></td>
                <td className={`table-td text-right ${totalEquivalent - totalForecast < 0 ? "text-red-600" : "text-emerald-700"}`}>
                  {totalEquivalent - totalForecast > 0 ? "+" : ""}{fmtEq(totalEquivalent - totalForecast)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Liquids are forecast on the 1,000-ml pack: sales in other sizes convert before comparing
        (500ml = 0.5, 250ml = 0.25, 100ml = 0.10, 1Gal = 3.75 equivalent PCS). Pack sizes come from the
        Product Master. Invoice, inventory and stock-card quantities are never changed by this report.
      </p>

      {r.unmatched.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 font-semibold">Sold but not in this forecast</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr><th className="table-th">Product</th><th className="table-th">Pack</th><th className="table-th text-right">Qty Sold (PCS)</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {r.unmatched.map((p) => (
                  <tr key={p.productId}><td className="table-td">{p.name}</td><td className="table-td text-gray-500">{p.packSize}</td><td className="table-td text-right">{p.qty.toLocaleString()}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            These sales have no matching forecast row and no 1,000-ml row of the same product line to convert into,
            so they are listed here instead of being guessed into the comparison.
          </p>
        </>
      )}
    </div>
  );
}
