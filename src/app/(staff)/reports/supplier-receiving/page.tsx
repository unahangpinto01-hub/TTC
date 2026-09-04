import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter } from "@/components/company-filter";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { parseRange } from "@/lib/reports";
import { getSupplierReceivingHistory } from "@/lib/receiving-reports";
import { PrintButton, BackButton } from "@/components/print-button";

export default async function SupplierReceivingPage({
  searchParams,
}: {
  searchParams: { company?: string; from?: string; to?: string };
}) {
  const user = await requirePerm("reports");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const { rows, totals } = await getSupplierReceivingHistory(range, scope.ids);
  const qs = new URLSearchParams(Object.entries(searchParams).filter(([, v]) => v) as [string, string][]).toString();

  const share = (v: number) => (totals.value > 0 ? ((v / totals.value) * 100).toFixed(1) + "%" : "—");

  return (
    <div className="print-page">
      <div className="no-print mb-3 flex items-center justify-between">
        <BackButton />
        <div className="flex gap-2">
          <a href={`/api/export/supplier-receiving?${qs}`} className="btn-secondary">⬇ Excel</a>
          <PrintButton />
        </div>
      </div>

      <div className="mb-4">
        <h1 className="text-2xl font-bold">{scope.company.companyName}</h1>
        <p className="text-sm text-gray-600">Supplier Receiving History{scope.combined && " · Combined (All Companies)"}</p>
        <p className="text-xs text-gray-500">
          {fmtDate(range.from)} – {fmtDate(range.to)} · generated {fmtDateTime(new Date())}
        </p>
      </div>

      <form method="GET" className="no-print card mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div className="w-40"><label className="label">From</label><input type="date" name="from" defaultValue={range.from.toISOString().slice(0, 10)} className="input" /></div>
        <div className="w-40"><label className="label">To</label><input type="date" name="to" defaultValue={range.to.toISOString().slice(0, 10)} className="input" /></div>
        <button className="btn-primary" type="submit">Apply</button>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card py-3"><p className="text-xs text-gray-500">Suppliers</p><p className="text-lg font-bold">{totals.suppliers}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Receipts</p><p className="text-lg font-bold">{totals.receipts}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Accepted Value</p><p className="text-lg font-bold text-emerald-800">{peso(totals.value)}</p></div>
        <div className="card py-3">
          <p className="text-xs text-gray-500">Reject Rate</p>
          <p className={`text-lg font-bold ${totals.rejected ? "text-red-600" : "text-gray-400"}`}>
            {totals.received > 0 ? ((totals.rejected / totals.received) * 100).toFixed(1) + "%" : "—"}
          </p>
        </div>
      </div>

      {!rows.length ? (
        <div className="card p-10 text-center text-sm text-gray-500">No receiving from any supplier in this period.</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b-2 border-gray-300 bg-gray-50">
              <tr>
                <th className="table-th">Supplier</th>
                <th className="table-th text-right">Receipts</th>
                <th className="table-th text-right">Received</th>
                <th className="table-th text-right">Rejected</th>
                <th className="table-th text-right">Reject Rate</th>
                <th className="table-th text-right">Accepted</th>
                <th className="table-th text-right">Accepted Value</th>
                <th className="table-th text-right">Share</th>
                <th className="table-th text-right">Cost Variance</th>
                <th className="table-th">Last Delivery</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="table-td font-medium">{r.name}</td>
                  <td className="table-td text-right">{r.receipts}</td>
                  <td className="table-td text-right">{r.received.toLocaleString()}</td>
                  <td className={`table-td text-right ${r.rejected ? "font-semibold text-red-600" : "text-gray-300"}`}>{r.rejected || "—"}</td>
                  <td className="table-td text-right">
                    <span className={r.rejectRate > 5 ? "font-semibold text-red-600" : r.rejectRate > 0 ? "text-amber-600" : "text-gray-400"}>
                      {r.rejectRate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="table-td text-right font-semibold">{r.accepted.toLocaleString()}</td>
                  <td className="table-td text-right">{peso(r.value)}</td>
                  <td className="table-td text-right text-gray-500">{share(r.value)}</td>
                  <td className={`table-td text-right ${Math.abs(r.costVariance) > 0.005 ? "text-amber-700" : "text-gray-300"}`}>
                    {Math.abs(r.costVariance) > 0.005 ? peso(r.costVariance) : "—"}
                  </td>
                  <td className="table-td whitespace-nowrap text-sm">{r.last ? fmtDate(r.last) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <tr>
                <td className="table-td">TOTAL</td>
                <td className="table-td text-right">{totals.receipts}</td>
                <td className="table-td text-right">{totals.received.toLocaleString()}</td>
                <td className="table-td text-right text-red-600">{totals.rejected || "—"}</td>
                <td className="table-td text-right">{totals.received > 0 ? ((totals.rejected / totals.received) * 100).toFixed(1) + "%" : "—"}</td>
                <td className="table-td text-right">{totals.accepted.toLocaleString()}</td>
                <td className="table-td text-right">{peso(totals.value)}</td>
                <td className="table-td text-right">100%</td>
                <td className="table-td text-right">{peso(totals.costVariance)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-gray-500">
        Counts goods received notes that are not draft or void. <strong>Reject rate</strong> is rejected ÷ received, a
        quick read on delivery quality. <strong>Cost variance</strong> is what the accepted goods cost against their
        purchase order price — positive means the supplier charged more than ordered.
      </p>
    </div>
  );
}
