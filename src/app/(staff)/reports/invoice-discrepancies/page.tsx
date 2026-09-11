import Link from "next/link";
import { requireReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { parseRange } from "@/lib/reports";
import { getInvoiceDiscrepancies } from "@/lib/purchasing-reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default async function InvoiceDiscrepanciesPage({ searchParams }: { searchParams: { from?: string; to?: string; company?: string } }) {
  const user = await requireReport("invoice-discrepancies");
  const scope = await resolveReportScope(user, searchParams.company);
  // a whole year back by default — a disputed invoice can stay open for months
  const now = new Date();
  const range = parseRange({ from: searchParams.from ?? ymd(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())), to: searchParams.to });
  const rep = await getInvoiceDiscrepancies(range, scope.ids);
  const fromStr = ymd(range.from);
  const toStr = ymd(range.to);

  return (
    <div className="print-page">
      <PageHeader title="Supplier Invoice Discrepancies">
        {user.canExport && <a href={`/api/export/invoice-discrepancies?from=${fromStr}&to=${toStr}&company=${scope.value}`} className="btn-secondary no-print">⬇ Excel</a>}
        {user.canPrint && <span className="no-print"><PrintButton /></span>}
      </PageHeader>
      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>
      <p className="mb-4 text-sm text-gray-600">
        <span className="font-semibold">{scope.label}</span> · bills dated {fmtDate(range.from)} – {fmtDate(range.to)} whose quantities disagree with the receipt:{" "}
        <span className="font-bold text-red-600">{rep.over} over-billed</span> · <span className="font-bold text-amber-700">{rep.partial} short (partial)</span>
      </p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1000px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Bill</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Supplier / Invoice</th>
              <th className="table-th">Receipt</th>
              <th className="table-th">Difference</th>
              <th className="table-th">Lines</th>
              <th className="table-th">Note / Approval</th>
              <th className="table-th text-right">Bill total</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rep.rows.map((r) => (
              <tr key={r.billId} className="align-top hover:bg-gray-50">
                <td className="table-td">
                  <Link href={`/bills/${r.billId}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{r.billNo}</Link>
                  <span className="block text-xs text-gray-500">{fmtDate(r.billDate)}</span>
                </td>
                {scope.combined && <td className="table-td"><CompanyTag name={r.company} /></td>}
                <td className="table-td text-sm">{r.supplier}<span className="block text-xs text-gray-500">{r.supplierInvoiceNo ? `Inv ${r.supplierInvoiceNo}` : "no invoice no."}</span></td>
                <td className="table-td"><Link href={`/receiving/${r.grnId}`} className="font-mono text-xs text-emerald-700 hover:underline">{r.grnNumber}</Link><span className="block text-xs text-gray-500">{fmtDate(r.receivedDate)}</span></td>
                <td className={`table-td text-xs font-semibold ${r.matchStatus === "Over" ? "text-red-600" : "text-amber-700"}`}>{r.matchStatus === "Over" ? "Invoice exceeds receipt" : "Invoice short of receipt"}</td>
                <td className="table-td text-xs">
                  {r.lines.map((l, i) => (
                    <span key={i} className="block">{l.product}: invoice {l.invoiceQty} vs received {l.receivedQty}{l.billedElsewhere ? ` (${l.billedElsewhere} on other bills)` : ""} → <span className={l.difference > 0 ? "text-red-600" : "text-amber-700"}>{l.difference > 0 ? `+${l.difference}` : l.difference} {l.unit === "CARTON" ? "CTN" : "PCS"}</span></span>
                  ))}
                </td>
                <td className="table-td text-xs text-gray-600">
                  {r.discrepancyNote && <span className="block">{r.discrepancyNote}</span>}
                  {r.overrideReason && <span className="block text-red-700">Approved: {r.overrideReason}</span>}
                  {!r.discrepancyNote && !r.overrideReason && <span className="text-gray-300">—</span>}
                </td>
                <td className="table-td text-right">{peso(r.total)}</td>
                <td className="table-td"><StatusBadge status={r.status} /></td>
              </tr>
            ))}
            {!rep.rows.length && <tr><td colSpan={scope.combined ? 9 : 8} className="p-8 text-center text-sm text-gray-500">No supplier invoice disagrees with its receipt in this range.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        A receipt is never changed by an invoice. A short invoice posts for what it covers and leaves the receipt partly billed; an
        invoice for more than was received posts only when an Admin records a reason. The note is what was raised with the supplier.
      </p>
    </div>
  );
}
