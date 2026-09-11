import Link from "next/link";
import { requireReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { parseRange } from "@/lib/reports";
import { getPurchaseBySupplier } from "@/lib/ap-reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { PurchaseNav } from "../purchase-nav";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default async function PurchaseBySupplierPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; company?: string };
}) {
  const user = await requireReport("purchases-by-supplier");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const { rows, totals } = await getPurchaseBySupplier(range, scope.ids);
  const fromStr = ymd(range.from);
  const toStr = ymd(range.to);
  const qs = new URLSearchParams({ from: fromStr, to: toStr, company: scope.value });

  return (
    <div className="print-page">
      <PageHeader title="Purchase by Supplier">
        {user.canExport && <a href={`/api/export/purchases-by-supplier?${qs.toString()}`} className="btn-secondary no-print">⬇ Excel</a>}
        {user.canPrint && <span className="no-print"><PrintButton /></span>}
      </PageHeader>
      <PurchaseNav active="supplier" qs={qs.toString()} />

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <p className="mb-4 text-sm text-gray-600">
        <span className="font-semibold">{scope.label}</span> · {fmtDate(range.from)} – {fmtDate(range.to)} · {rows.length} supplier(s) · {totals.bills} bill(s) · Total{" "}
        <span className="font-bold">{peso(totals.total)}</span> · Outstanding <span className="font-bold text-red-600">{peso(totals.outstanding)}</span>
      </p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[960px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Supplier</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th text-right">Bills</th>
              <th className="table-th text-right">PCS</th>
              <th className="table-th text-right">Product Cost</th>
              <th className="table-th text-right">Freight / Other</th>
              <th className="table-th text-right">Input VAT</th>
              <th className="table-th text-right">Total</th>
              <th className="table-th text-right">Paid</th>
              <th className="table-th text-right">Outstanding</th>
              <th className="table-th">Last Bill</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={`${r.company}:${r.supplierId}`} className="hover:bg-gray-50">
                <td className="table-td">
                  <Link href={`/reports/supplier-statement?supplier=${r.supplierId}&from=${fromStr}&to=${toStr}&company=${scope.value}`} className="font-medium text-emerald-700 hover:underline">{r.supplier}</Link>
                </td>
                {scope.combined && <td className="table-td"><CompanyTag name={r.company} /></td>}
                <td className="table-td text-right text-sm">{r.bills}</td>
                <td className="table-td text-right text-sm">{r.pcs.toLocaleString()}</td>
                <td className="table-td text-right">{peso(r.subtotal)}</td>
                <td className={`table-td text-right ${r.freight ? "" : "text-gray-300"}`}>{r.freight ? peso(r.freight) : "—"}</td>
                <td className={`table-td text-right ${r.inputVat ? "" : "text-gray-300"}`}>{r.inputVat ? peso(r.inputVat) : "—"}</td>
                <td className="table-td text-right font-semibold">{peso(r.total)}</td>
                <td className="table-td text-right text-emerald-700">{r.paid ? peso(r.paid) : "—"}</td>
                <td className={`table-td text-right font-semibold ${r.outstanding ? "text-red-600" : "text-gray-400"}`}>{r.outstanding ? peso(r.outstanding) : "—"}</td>
                <td className="table-td text-sm">{r.last ? fmtDate(r.last) : "—"}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={scope.combined ? 11 : 10} className="p-8 text-center text-sm text-gray-500">No posted supplier bills in this range.</td></tr>}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50 font-bold">
            <tr>
              <td className="table-td" colSpan={scope.combined ? 2 : 1}>{scope.combined ? "COMBINED GRAND TOTAL" : "TOTAL"}</td>
              <td className="table-td text-right">{totals.bills}</td>
              <td className="table-td text-right">{totals.pcs.toLocaleString()}</td>
              <td className="table-td text-right">{peso(totals.subtotal)}</td>
              <td className="table-td text-right">{peso(totals.freight)}</td>
              <td className="table-td text-right">{peso(totals.inputVat)}</td>
              <td className="table-td text-right">{peso(totals.total)}</td>
              <td className="table-td text-right text-emerald-700">{peso(totals.paid)}</td>
              <td className="table-td text-right text-red-600">{peso(totals.outstanding)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
