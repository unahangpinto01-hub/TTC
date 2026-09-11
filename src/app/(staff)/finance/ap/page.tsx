import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { canExportReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { getApAging } from "@/lib/ap-reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

export default async function ApAgingPage({ searchParams }: { searchParams: { company?: string } }) {
  const user = await requirePerm("ap");
  const scope = await resolveReportScope(user, searchParams.company);
  // the AP module page carries the AP Aging report's export, so the report policy governs it
  const canExport = await canExportReport(user, "ap-aging");
  const { rows, open, totals } = await getApAging(scope.ids);

  return (
    <div className="print-page">
      <PageHeader title="AP Aging Report">
        {canExport && (
          <a href={`/api/export/ap-aging?company=${scope.value}`} className="btn-secondary no-print">⬇ Excel</a>
        )}
        <Link href="/bills" className="btn-secondary no-print">Bills</Link>
        <span className="no-print"><PrintButton /></span>
      </PageHeader>
      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <button className="btn-secondary" type="submit">Apply</button>
      </form>
      <p className="mb-4 text-sm text-gray-500">
        <span className="font-semibold">{scope.label}</span> · Outstanding supplier bills by days past their due date. A bill
        inside its terms is Current. Total owed:{" "}
        <span className="font-bold text-red-600">{peso(totals.total)}</span> on {totals.bills} bill(s)
      </p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[820px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Supplier</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th text-right">Bills</th>
              <th className="table-th text-right">Current</th>
              <th className="table-th text-right">1–30</th>
              <th className="table-th text-right">31–60</th>
              <th className="table-th text-right">61–90</th>
              <th className="table-th text-right">90+</th>
              <th className="table-th text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={`${r.company}:${r.supplierId}`} className="hover:bg-gray-50">
                <td className="table-td">
                  <Link href={`/reports/supplier-statement?supplier=${r.supplierId}&company=${scope.value}`} className="font-medium text-emerald-700 hover:underline">{r.supplier}</Link>
                </td>
                {scope.combined && <td className="table-td"><CompanyTag name={r.company} /></td>}
                <td className="table-td text-right text-sm text-gray-600">{r.bills}</td>
                <td className="table-td text-right">{r.current ? peso(r.current) : "—"}</td>
                <td className="table-td text-right">{r.d1_30 ? peso(r.d1_30) : "—"}</td>
                <td className="table-td text-right">{r.d31_60 ? peso(r.d31_60) : "—"}</td>
                <td className="table-td text-right text-amber-700">{r.d61_90 ? peso(r.d61_90) : "—"}</td>
                <td className="table-td text-right font-semibold text-red-600">{r.d90plus ? peso(r.d90plus) : "—"}</td>
                <td className="table-td text-right font-bold">{peso(r.total)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={scope.combined ? 9 : 8} className="p-8 text-center text-sm text-gray-500">Nothing owed to any supplier. 🎉</td></tr>}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
            <tr>
              <td className="table-td" colSpan={scope.combined ? 2 : 1}>{scope.combined ? "COMBINED TOTAL" : "TOTAL"}</td>
              <td className="table-td text-right">{totals.bills}</td>
              <td className="table-td text-right">{peso(totals.current)}</td>
              <td className="table-td text-right">{peso(totals.d1_30)}</td>
              <td className="table-td text-right">{peso(totals.d31_60)}</td>
              <td className="table-td text-right">{peso(totals.d61_90)}</td>
              <td className="table-td text-right text-red-600">{peso(totals.d90plus)}</td>
              <td className="table-td text-right">{peso(totals.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {open.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 font-semibold">Open Bills</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[820px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="table-th">Bill #</th>
                  {scope.combined && <th className="table-th">Company</th>}
                  <th className="table-th">Supplier</th>
                  <th className="table-th">Supplier Invoice</th>
                  <th className="table-th">Bill Date</th>
                  <th className="table-th">Due</th>
                  <th className="table-th text-right">Days Over</th>
                  <th className="table-th text-right">Total</th>
                  <th className="table-th text-right">Paid</th>
                  <th className="table-th text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {open.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="table-td"><Link href={`/bills/${b.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{b.billNo}</Link></td>
                    {scope.combined && <td className="table-td"><CompanyTag name={b.company} /></td>}
                    <td className="table-td text-sm">{b.supplier}</td>
                    <td className="table-td text-xs text-gray-600">{b.supplierInvoiceNo ?? "—"}</td>
                    <td className="table-td text-sm">{fmtDate(b.billDate)}</td>
                    <td className="table-td text-sm">{fmtDate(b.dueDate)}</td>
                    <td className={`table-td text-right text-sm ${b.daysOverdue > 0 ? "font-semibold text-red-600" : "text-gray-400"}`}>{b.daysOverdue > 0 ? b.daysOverdue : "—"}</td>
                    <td className="table-td text-right">{peso(b.total)}</td>
                    <td className="table-td text-right text-gray-600">{b.paid ? peso(b.paid) : "—"}</td>
                    <td className="table-td text-right font-semibold text-red-600">{peso(b.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
