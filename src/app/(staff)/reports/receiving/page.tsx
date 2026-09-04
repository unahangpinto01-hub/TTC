import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { parseRange } from "@/lib/reports";
import { getReceivingReport } from "@/lib/receiving-reports";
import { PrintButton, BackButton } from "@/components/print-button";

const STATUSES = ["Draft", "Pending Inspection", "Received", "Posted", "Rejected", "Void"];

export default async function ReceivingReportPage({
  searchParams,
}: {
  searchParams: { company?: string; from?: string; to?: string; supplier?: string; status?: string; q?: string };
}) {
  const user = await requirePerm("reports");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);

  const [report, suppliers] = await Promise.all([
    getReceivingReport(range, scope.ids, {
      supplierId: searchParams.supplier || undefined,
      status: searchParams.status || undefined,
      q: searchParams.q || undefined,
    }),
    prisma.supplier.findMany({ where: { status: "Active" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const { rows, totals } = report;
  const qs = new URLSearchParams(Object.entries(searchParams).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div className="print-page">
      <div className="no-print mb-3 flex items-center justify-between">
        <BackButton />
        <div className="flex gap-2">
          <a href={`/api/export/receiving?${qs}`} className="btn-secondary">⬇ Excel</a>
          <PrintButton />
        </div>
      </div>

      <div className="mb-4">
        <h1 className="text-2xl font-bold">{scope.company.companyName}</h1>
        <p className="text-sm text-gray-600">Receiving Report{scope.combined && " · Combined (All Companies)"}</p>
        <p className="text-xs text-gray-500">
          {fmtDate(range.from)} – {fmtDate(range.to)} · generated {fmtDateTime(new Date())}
        </p>
      </div>

      <form method="GET" className="no-print card mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div className="w-40"><label className="label">From</label><input type="date" name="from" defaultValue={range.from.toISOString().slice(0, 10)} className="input" /></div>
        <div className="w-40"><label className="label">To</label><input type="date" name="to" defaultValue={range.to.toISOString().slice(0, 10)} className="input" /></div>
        <div className="w-52">
          <label className="label">Supplier</label>
          <select name="supplier" defaultValue={searchParams.supplier ?? ""} className="input">
            <option value="">All suppliers</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="w-44">
          <label className="label">Status</label>
          <select name="status" defaultValue={searchParams.status ?? ""} className="input">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="w-44"><label className="label">Search</label><input name="q" defaultValue={searchParams.q ?? ""} placeholder="GRN, PO, DR no." className="input" /></div>
        <button className="btn-primary" type="submit">Apply</button>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="card py-3"><p className="text-xs text-gray-500">Receipts</p><p className="text-lg font-bold">{totals.receipts}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Accepted</p><p className="text-lg font-bold text-emerald-800">{totals.accepted.toLocaleString()}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Rejected</p><p className={`text-lg font-bold ${totals.rejected ? "text-red-600" : ""}`}>{totals.rejected.toLocaleString()}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Accepted Value</p><p className="text-lg font-bold">{peso(totals.value)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Cost Variance</p><p className={`text-lg font-bold ${Math.abs(totals.costVariance) > 0.005 ? "text-amber-700" : "text-gray-400"}`}>{peso(totals.costVariance)}</p></div>
      </div>

      {!rows.length ? (
        <div className="card p-10 text-center text-sm text-gray-500">No receiving in this period.</div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="border-b-2 border-gray-300 bg-gray-50">
              <tr>
                <th className="table-th">Date</th>
                <th className="table-th">GRN #</th>
                {scope.combined && <th className="table-th">Company</th>}
                <th className="table-th">Supplier</th>
                <th className="table-th">PO</th>
                <th className="table-th">Supplier DR / Invoice</th>
                <th className="table-th text-right">Received (PCS / CTN)</th>
                <th className="table-th text-right">Rejected (PCS / CTN)</th>
                <th className="table-th text-right">Accepted (PCS / CTN)</th>
                <th className="table-th text-right">Value</th>
                <th className="table-th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.grn.id} className={r.grn.status === "Void" ? "opacity-50" : ""}>
                  <td className="table-td whitespace-nowrap text-sm">{fmtDate(r.grn.receivedDate)}</td>
                  <td className="table-td">
                    <Link href={`/receiving/${r.grn.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">
                      {r.grn.grnNumber}
                    </Link>
                  </td>
                  {scope.combined && <td className="table-td"><CompanyTag name={r.grn.company.companyName} /></td>}
                  <td className="table-td text-sm">{r.grn.purchaseOrder.supplier.name}</td>
                  <td className="table-td font-mono text-xs">{r.grn.purchaseOrder.poNumber}</td>
                  <td className="table-td text-xs text-gray-600">
                    {r.grn.deliveryRefNo || "—"}
                    {r.grn.supplierInvoiceNo && <span className="block text-gray-400">Inv {r.grn.supplierInvoiceNo}</span>}
                  </td>
                  <td className="table-td text-right"><Qty pcs={r.receivedPcs} ctn={r.receivedCtn} /></td>
                  <td className={`table-td text-right ${r.rejected ? "font-semibold text-red-600" : ""}`}>
                    <Qty pcs={r.rejectedPcs} ctn={r.rejectedCtn} dash />
                  </td>
                  <td className="table-td text-right font-semibold"><Qty pcs={r.acceptedPcs} ctn={r.acceptedCtn} /></td>
                  <td className="table-td text-right">{peso(r.value)}</td>
                  <td className="table-td text-xs">{r.grn.status}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <tr>
                <td className="table-td" colSpan={scope.combined ? 6 : 5}>TOTAL — {totals.receipts} receipt(s)</td>
                <td className="table-td text-right"><Qty pcs={totals.receivedPcs} ctn={totals.receivedCtn} /></td>
                <td className="table-td text-right text-red-600"><Qty pcs={totals.rejectedPcs} ctn={totals.rejectedCtn} dash /></td>
                <td className="table-td text-right"><Qty pcs={totals.acceptedPcs} ctn={totals.acceptedCtn} /></td>
                <td className="table-td text-right">{peso(totals.value)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-gray-500">
        Value is the accepted quantity at the actual receiving cost. <strong>Cost variance</strong> is the difference from
        the purchase order cost on accepted quantities — a positive figure means the delivery cost more than ordered.
        Only <strong>Posted</strong> receipts have reached inventory; of the value above, {peso(totals.postedValue)} is posted.
      </p>
    </div>
  );
}

/** PCS on top, carton equivalent beneath — the standard quantity cell in these reports. */
function Qty({ pcs, ctn, className = "", dash = false }: { pcs: number; ctn: number; className?: string; dash?: boolean }) {
  if (dash && pcs === 0) return <span className="text-gray-300">—</span>;
  return (
    <span className={`whitespace-nowrap ${className}`}>
      {pcs.toLocaleString()}
      <span className="block text-xs font-normal text-gray-500">
        {ctn.toLocaleString("en-PH", { maximumFractionDigits: 2 })} CTN
      </span>
    </span>
  );
}
