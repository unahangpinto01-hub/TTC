import Link from "next/link";
import { requireReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { parseRange } from "@/lib/reports";
import { getCustomerDiscounts } from "@/lib/discount-reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Management view: per customer, product sales against the PPD and other discounts granted — the real cost of customer discounts. */
export default async function CustomerDiscountsPage({ searchParams }: { searchParams: { from?: string; to?: string; company?: string } }) {
  const user = await requireReport("customer-discounts");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const r = await getCustomerDiscounts(range, scope.ids);
  const qs = new URLSearchParams({ from: ymd(range.from), to: ymd(range.to), company: scope.value });

  return (
    <div className="print-page">
      <PageHeader title="Customer Discounts">
        {user.canExport && <a href={`/api/export/customer-discounts?${qs.toString()}`} className="btn-secondary no-print">⬇ Excel</a>}
        {user.canPrint && <span className="no-print"><PrintButton /></span>}
      </PageHeader>

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={ymd(range.from)} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={ymd(range.to)} className="input" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <p className="mb-3 text-sm text-gray-600">
        <span className="font-semibold">{scope.label}</span> · {fmtDate(range.from)} – {fmtDate(range.to)} · Sales <span className="font-bold">{peso(r.totals.sales)}</span> · Total discounts{" "}
        <span className="font-bold text-red-700">{peso(r.totals.totalDiscounts)}</span>{r.rate !== null && <> ({r.rate}% of sales)</>}
      </p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Customer</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Area</th>
              <th className="table-th text-right">Sales</th>
              <th className="table-th text-right">PPD</th>
              <th className="table-th text-right">Other Discount</th>
              <th className="table-th text-right">Total Discounts</th>
              <th className="table-th text-right">% of Sales</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {r.rows.map((x) => (
              <tr key={x.key} className="hover:bg-gray-50">
                <td className="table-td"><Link href={`/customers/${x.customerId}`} className="font-medium text-emerald-700 hover:underline">{x.customer}</Link></td>
                {scope.combined && <td className="table-td"><CompanyTag name={x.company} /></td>}
                <td className="table-td text-xs text-gray-600">{x.region}</td>
                <td className="table-td text-right">{peso(x.sales)}</td>
                <td className="table-td text-right">{x.ppd ? peso(x.ppd) : "—"}</td>
                <td className="table-td text-right">{x.otherDiscount ? peso(x.otherDiscount) : "—"}</td>
                <td className={`table-td text-right font-semibold ${x.totalDiscounts ? "text-red-700" : "text-gray-400"}`}>{peso(x.totalDiscounts)}</td>
                <td className="table-td text-right text-xs">{x.rate === null ? "—" : `${x.rate}%`}</td>
              </tr>
            ))}
            {!r.rows.length && <tr><td colSpan={scope.combined ? 8 : 7} className="p-6 text-center text-sm text-gray-500">No sales or discounts in this period.</td></tr>}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
            <tr>
              <td className="table-td" colSpan={scope.combined ? 3 : 2}>TOTAL</td>
              <td className="table-td text-right">{peso(r.totals.sales)}</td>
              <td className="table-td text-right">{peso(r.totals.ppd)}</td>
              <td className="table-td text-right">{peso(r.totals.otherDiscount)}</td>
              <td className="table-td text-right text-red-700">{peso(r.totals.totalDiscounts)}</td>
              <td className="table-td text-right text-xs">{r.rate === null ? "—" : `${r.rate}%`}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">Sales are product sales invoiced in the period (freight and other charges excluded); discounts are those granted on receive payments posted in the period, whichever invoice they settled.</p>
    </div>
  );
}
