import { NoConversion } from "@/components/qty";
import { Fragment } from "react";
import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter } from "@/components/company-filter";
import { getMonthlyProductSales, getProvinces } from "@/lib/reports";
import { peso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton, BackButton } from "@/components/print-button";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const REGIONS = ["Luzon", "Visayas", "Mindanao"];

export default async function MonthlySalesPage({ searchParams }: { searchParams: { year?: string; region?: string; province?: string; company?: string } }) {
  const user = await requirePerm("reports");
  const scope = await resolveReportScope(user, searchParams.company);
  const year = Number(searchParams.year) || new Date().getFullYear();
  const region = REGIONS.includes(searchParams.region || "") ? searchParams.region! : "";
  const provinces = await getProvinces();
  const province = provinces.includes(searchParams.province || "") ? searchParams.province! : "";
  const rows = await getMonthlyProductSales(year, scope.ids, region || undefined, province || undefined);

  const monthQty = (mi: number) => rows.reduce((s, r) => s + r.monthsQty[mi], 0);
  const monthAmt = (mi: number) => rows.reduce((s, r) => s + r.monthsAmt[mi], 0);
  const grandQty = rows.reduce((s, r) => s + r.monthsQty.reduce((a, b) => a + b, 0), 0);
  const grandCtn = rows.reduce((s, r) => s + r.monthsCtn.reduce((a, b) => a + b, 0), 0);
  const grandAmt = rows.reduce((s, r) => s + r.monthsAmt.reduce((a, b) => a + b, 0), 0);

  let lastCategory = "";

  return (
    <div className="print-page">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <BackButton />
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/reports/sales" className="btn-secondary">Summary view</Link>
          <a href={`/api/export/sales-monthly?year=${year}${region ? `&region=${region}` : ""}${province ? `&province=${encodeURIComponent(province)}` : ""}`} className="btn-secondary">⬇ Excel</a>
          <PrintButton />
        </div>
      </div>

      <PageHeader title={`Monthly Sales per Product — ${province || region || "All Regions"} ${year}`} />

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div>
          <label className="label">Year</label>
          <input name="year" type="number" defaultValue={year} className="input w-28" />
        </div>
        <div>
          <label className="label">Region</label>
          <select name="region" defaultValue={region} className="input w-40">
            <option value="">All Regions</option>
            {REGIONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Province</label>
          <select name="province" defaultValue={province} className="input w-48">
            <option value="">All provinces</option>
            {provinces.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <button className="btn-primary" type="submit">View</button>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1200px] text-xs">
          <thead className="border-b-2 border-gray-300 bg-gray-50">
            <tr>
              <th className="px-2 py-2 text-left font-semibold">PRODUCT</th>
              {MONTHS.map((m) => <th key={m} className="px-1 py-2 text-right font-semibold">{m}</th>)}
              <th className="px-2 py-2 text-right font-bold text-red-600">TOTAL QTY (PCS)</th>
              <th className="px-2 py-2 text-right font-bold">EQUIV. (CTN)</th>
              <th className="px-2 py-2 text-right font-bold">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const showCat = r.category !== lastCategory;
              lastCategory = r.category;
              const totalQty = r.monthsQty.reduce((a, b) => a + b, 0);
              const totalCtn = r.monthsCtn.reduce((a, b) => a + b, 0);
              const totalAmt = r.monthsAmt.reduce((a, b) => a + b, 0);
              return (
                <Fragment key={r.name}>
                  {showCat && (
                    <tr className="bg-emerald-50/80">
                      <td colSpan={16} className="px-2 py-1 font-bold uppercase tracking-wide text-emerald-900">{r.category}</td>
                    </tr>
                  )}
                  <tr className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="max-w-[220px] truncate px-2 py-1 font-medium" title={r.name}>{r.name}</td>
                    {r.monthsQty.map((q, mi) => (
                      <td key={mi} className="px-1 py-1 text-right">{q ? q.toLocaleString() : "-"}</td>
                    ))}
                    <td className="px-2 py-1 text-right font-semibold text-red-600">{totalQty.toLocaleString()}</td>
                    <td className="px-2 py-1 text-right font-semibold">
                      {r.noConversion ? <NoConversion compact /> : `${totalCtn.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`}
                    </td>
                    <td className="px-2 py-1 text-right font-semibold">{peso(totalAmt)}</td>
                  </tr>
                </Fragment>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={16} className="p-8 text-center text-sm text-gray-500">No invoiced sales for {region || "any region"} in {year}.</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-gray-300 bg-gray-50">
              <tr className="font-bold">
                <td className="px-2 py-1.5">TOTAL QTY</td>
                {MONTHS.map((_, mi) => (
                  <td key={mi} className="px-1 py-1.5 text-right">{monthQty(mi).toLocaleString()}</td>
                ))}
                <td className="bg-yellow-100 px-2 py-1.5 text-right text-red-600">{grandQty.toLocaleString()}</td>
                <td className="bg-yellow-100 px-2 py-1.5 text-right">{grandCtn.toLocaleString("en-PH", { maximumFractionDigits: 2 })}</td>
                <td className="px-2 py-1.5" />
              </tr>
              <tr className="font-semibold text-emerald-900">
                <td className="px-2 py-1.5">AMOUNT (₱)</td>
                {MONTHS.map((_, mi) => (
                  <td key={mi} className="px-1 py-1.5 text-right">{monthAmt(mi).toLocaleString("en-PH", { maximumFractionDigits: 0 })}</td>
                ))}
                <td className="px-2 py-1.5" />
                <td className="px-2 py-1.5" />
                <td className="bg-yellow-100 px-2 py-1.5 text-right font-bold">{peso(grandAmt)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Rows are product lines (parent items); figures are actual invoiced sales (quantity and peso amount) by invoice month.
      </p>
    </div>
  );
}
