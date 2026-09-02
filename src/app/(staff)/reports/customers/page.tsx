import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { getCustomerReport, getProvinces, parseRange } from "@/lib/reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";

export default async function CustomerReportPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; company?: string; province?: string };
}) {
  const user = await requirePerm("reports");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const provinces = await getProvinces();
  const province = provinces.includes(searchParams.province || "") ? searchParams.province! : "";
  const r = await getCustomerReport(range, scope.ids);
  const rows = province ? r.rows.filter((x) => x.province === province) : r.rows;
  const fromStr = range.from.toISOString().slice(0, 10);
  const toStr = range.to.toISOString().slice(0, 10);

  const totals = province
    ? {
        invoices: rows.reduce((s, x) => s + x.invoices, 0),
        sales: Math.round(rows.reduce((s, x) => s + x.sales, 0) * 100) / 100,
        collected: Math.round(rows.reduce((s, x) => s + x.collected, 0) * 100) / 100,
        balance: Math.round(rows.reduce((s, x) => s + x.balance, 0) * 100) / 100,
      }
    : r.totals;

  const qs = new URLSearchParams({ from: fromStr, to: toStr, company: scope.value });
  if (province) qs.set("province", province);

  return (
    <div className="print-page">
      <PageHeader title="Customer Report">
        <a href={`/api/export/customers?${qs.toString()}`} className="btn-secondary no-print">⬇ Excel</a>
        <span className="no-print"><PrintButton /></span>
      </PageHeader>

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <div>
          <label className="label">Province</label>
          <select name="province" defaultValue={province} className="input w-48">
            <option value="">All provinces</option>
            {provinces.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <p className="mb-4 text-sm text-gray-600">
        <span className="font-semibold">{scope.label}</span> · {fmtDate(range.from)} – {fmtDate(range.to)}
        {province ? ` · ${province}` : ""} · {rows.length} customer account(s) · Sales{" "}
        <span className="font-bold text-emerald-800">{peso(totals.sales)}</span> · Outstanding{" "}
        <span className="font-bold text-red-600">{peso(totals.balance)}</span>
      </p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[860px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Customer</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Region</th>
              <th className="table-th">Province</th>
              <th className="table-th text-right">Invoices</th>
              <th className="table-th text-right">Sales</th>
              <th className="table-th text-right">Collected</th>
              <th className="table-th text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((x) => (
              <tr key={x.key} className="hover:bg-gray-50">
                <td className="table-td">
                  <Link href={`/customers/${x.customerId}`} className="font-medium text-emerald-700 hover:underline">{x.customer}</Link>
                </td>
                {scope.combined && <td className="table-td"><CompanyTag name={x.company} /></td>}
                <td className="table-td text-sm text-gray-600">{x.region}</td>
                <td className="table-td text-sm text-gray-600">{x.province}</td>
                <td className="table-td text-right">{x.invoices}</td>
                <td className="table-td text-right">{peso(x.sales)}</td>
                <td className="table-td text-right text-emerald-700">{peso(x.collected)}</td>
                <td className={`table-td text-right font-semibold ${x.balance > 0 ? "text-red-600" : "text-gray-400"}`}>{peso(x.balance)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={scope.combined ? 8 : 7} className="p-8 text-center text-sm text-gray-500">No customer sales in this range.</td></tr>
            )}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50 font-bold">
            <tr>
              <td className="table-td" colSpan={scope.combined ? 4 : 3}>{scope.combined ? "COMBINED GRAND TOTAL" : "TOTAL"}</td>
              <td className="table-td text-right">{totals.invoices}</td>
              <td className="table-td text-right text-emerald-800">{peso(totals.sales)}</td>
              <td className="table-td text-right text-emerald-700">{peso(totals.collected)}</td>
              <td className="table-td text-right text-red-600">{peso(totals.balance)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
