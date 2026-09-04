import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { getPOReceivingStatus } from "@/lib/receiving-reports";
import { PrintButton, BackButton } from "@/components/print-button";

export default async function POReceivingStatusPage({
  searchParams,
}: {
  searchParams: { company?: string; supplier?: string; outstanding?: string };
}) {
  const user = await requirePerm("reports");
  const scope = await resolveReportScope(user, searchParams.company);
  // the same report, narrowed: outstanding-only IS the Partial Receiving Report
  const outstandingOnly = searchParams.outstanding === "1";

  const [{ rows, totals }, suppliers] = await Promise.all([
    getPOReceivingStatus(scope.ids, { outstandingOnly, supplierId: searchParams.supplier || undefined }),
    prisma.supplier.findMany({ where: { status: "Active" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const qs = new URLSearchParams(Object.entries(searchParams).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div className="print-page">
      <div className="no-print mb-3 flex items-center justify-between">
        <BackButton />
        <div className="flex gap-2">
          <a href={`/api/export/po-receiving?${qs}`} className="btn-secondary">⬇ Excel</a>
          <PrintButton />
        </div>
      </div>

      <div className="mb-4">
        <h1 className="text-2xl font-bold">{scope.company.companyName}</h1>
        <p className="text-sm text-gray-600">
          {outstandingOnly ? "Partial Receiving Report" : "Purchase Order Receiving Status"}
          {scope.combined && " · Combined (All Companies)"}
        </p>
        <p className="text-xs text-gray-500">generated {fmtDateTime(new Date())}</p>
      </div>

      <form method="GET" className="no-print card mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div className="w-56">
          <label className="label">Supplier</label>
          <select name="supplier" defaultValue={searchParams.supplier ?? ""} className="input">
            <option value="">All suppliers</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="w-56">
          <label className="label">Show</label>
          <select name="outstanding" defaultValue={outstandingOnly ? "1" : ""} className="input">
            <option value="">All purchase orders</option>
            <option value="1">Outstanding only (partial)</option>
          </select>
        </div>
        <button className="btn-primary" type="submit">Apply</button>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="card py-3"><p className="text-xs text-gray-500">Orders</p><p className="text-lg font-bold">{totals.orders}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Ordered</p><p className="text-lg font-bold">{totals.ordered.toLocaleString()}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Received</p><p className="text-lg font-bold text-emerald-800">{totals.received.toLocaleString()}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Remaining</p><p className={`text-lg font-bold ${totals.remaining ? "text-amber-700" : "text-gray-400"}`}>{totals.remaining.toLocaleString()}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Value Received</p><p className="text-lg font-bold">{peso(totals.receivedValue)}</p></div>
      </div>

      {!rows.length ? (
        <div className="card p-10 text-center text-sm text-gray-500">
          {outstandingOnly ? "Nothing is outstanding — every purchase order is fully received." : "No purchase orders."}
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="border-b-2 border-gray-300 bg-gray-50">
              <tr>
                <th className="table-th">PO #</th>
                <th className="table-th">Date</th>
                {scope.combined && <th className="table-th">Company</th>}
                <th className="table-th">Supplier</th>
                <th className="table-th text-right">Ordered</th>
                <th className="table-th text-right">Received</th>
                <th className="table-th text-right">Remaining</th>
                <th className="table-th text-right">% Received</th>
                <th className="table-th text-right">Receipts</th>
                <th className="table-th text-right">Ordered Value</th>
                <th className="table-th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.po.id} className="hover:bg-gray-50">
                  <td className="table-td">
                    <Link href={`/purchase-orders/${r.po.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">
                      {r.po.poNumber}
                    </Link>
                  </td>
                  <td className="table-td whitespace-nowrap text-sm">{fmtDate(r.po.date)}</td>
                  {scope.combined && <td className="table-td"><CompanyTag name={r.po.company.companyName} /></td>}
                  <td className="table-td text-sm">{r.po.supplier.name}</td>
                  <td className="table-td text-right">{r.ordered.toLocaleString()}</td>
                  <td className="table-td text-right">{r.received.toLocaleString()}</td>
                  <td className={`table-td text-right ${r.remaining ? "font-semibold text-amber-700" : "text-gray-300"}`}>{r.remaining || "—"}</td>
                  <td className="table-td text-right">
                    <span className={r.pct >= 100 ? "font-semibold text-emerald-700" : r.pct > 0 ? "text-amber-600" : "text-gray-400"}>
                      {r.pct.toFixed(1)}%
                    </span>
                  </td>
                  <td className="table-td text-right text-gray-600">{r.receipts || "—"}</td>
                  <td className="table-td text-right">{peso(r.orderedValue)}</td>
                  <td className="table-td text-xs">{r.po.status}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <tr>
                <td className="table-td" colSpan={scope.combined ? 4 : 3}>TOTAL — {totals.orders} order(s)</td>
                <td className="table-td text-right">{totals.ordered.toLocaleString()}</td>
                <td className="table-td text-right">{totals.received.toLocaleString()}</td>
                <td className="table-td text-right text-amber-700">{totals.remaining.toLocaleString()}</td>
                <td className="table-td text-right">
                  {totals.ordered > 0 ? ((totals.received / totals.ordered) * 100).toFixed(1) + "%" : "—"}
                </td>
                <td />
                <td className="table-td text-right">{peso(totals.orderedValue)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-gray-500">
        Quantities are in each line&rsquo;s own unit, summed across the order. <strong>Received</strong> counts accepted
        quantities only, so goods rejected on a receipt stay outstanding here. <strong>Receipts</strong> counts goods
        received notes that are not draft or void. Draft purchase orders are excluded.
      </p>
    </div>
  );
}
