import Link from "next/link";
import { requireReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { getUnbilledReceipts } from "@/lib/purchasing-reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { InvoiceBadge } from "@/components/invoice-badge";
import { markReceiptsBilledOutsideBefore } from "@/app/(staff)/receiving/actions";

export default async function UnbilledReceiptsPage({ searchParams }: { searchParams: { company?: string; supplier?: string; cutover?: string; error?: string } }) {
  const user = await requireReport("unbilled-receipts");
  const scope = await resolveReportScope(user, searchParams.company);
  const rep = await getUnbilledReceipts(scope.ids);
  const rows = searchParams.supplier ? rep.rows.filter((r) => r.supplierId === searchParams.supplier) : rep.rows;

  return (
    <div className="print-page">
      <PageHeader title="Received but Not Yet Billed">
        {user.canExport && <a href={`/api/export/unbilled-receipts?company=${scope.value}`} className="btn-secondary no-print">⬇ Excel</a>}
        {user.canPrint && <span className="no-print"><PrintButton /></span>}
      </PageHeader>
      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div>
          <label className="label">Supplier</label>
          <select name="supplier" defaultValue={searchParams.supplier ?? ""} className="input w-56">
            <option value="">All suppliers</option>
            {rep.bySupplier.map((s) => <option key={s.supplierId} value={s.supplierId}>{s.supplier} ({s.receipts})</option>)}
          </select>
        </div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      {searchParams.cutover && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✔ {searchParams.cutover} receipt(s) marked as billed and settled outside the BMS.</p>}
      {searchParams.error === "cutover" && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Give a date and a note of at least 5 characters.</p>}
      <p className="mb-4 text-sm text-gray-600">
        <span className="font-semibold">{scope.label}</span> · as of {fmtDate(rep.asOf)} · goods in stock whose supplier invoice has not been posted:{" "}
        <span className="font-bold">{rep.totals.receipts}</span> receipt(s), {rep.totals.pcs.toLocaleString()} PCS, worth{" "}
        <span className="font-bold text-amber-700">{peso(rep.totals.value)}</span> at receiving cost
        {rep.totals.over30 > 0 && <> · <span className="font-semibold text-red-600">{rep.totals.over30} older than 30 days</span></>}
      </p>

      {rep.bySupplier.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          {rep.bySupplier.map((s) => (
            <span key={s.supplierId} className="rounded-full bg-gray-100 px-2.5 py-1 text-gray-700">{s.supplier}: {peso(s.value)} · {s.receipts} · oldest {s.oldest}d</span>
          ))}
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1000px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Received</th>
              <th className="table-th text-right">Days</th>
              <th className="table-th">Receipt</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Supplier</th>
              <th className="table-th">PO / Supplier DR</th>
              <th className="table-th">Unbilled items</th>
              <th className="table-th text-right">Unbilled PCS</th>
              <th className="table-th text-right">Value (receiving cost)</th>
              <th className="table-th">Invoice</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50 align-top">
                <td className="table-td text-sm">{fmtDate(r.receivedDate)}</td>
                <td className={`table-td text-right text-sm ${r.days > 30 ? "font-semibold text-red-600" : r.days > 14 ? "text-amber-700" : ""}`}>{r.days}</td>
                <td className="table-td"><Link href={`/receiving/${r.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{r.grnNumber}</Link></td>
                {scope.combined && <td className="table-td"><CompanyTag name={r.company} /></td>}
                <td className="table-td text-sm">{r.supplier}</td>
                <td className="table-td text-xs text-gray-600">
                  <Link href={`/purchase-orders/${r.poId}`} className="font-mono text-emerald-700 hover:underline">{r.poNumber}</Link>
                  {r.deliveryRefNo && <span className="block">DR {r.deliveryRefNo}</span>}
                </td>
                <td className="table-td text-xs">
                  {r.lines.map((l) => (
                    <span key={l.productId} className="block">{l.name} — {l.remaining.toLocaleString()} {l.unit === "CARTON" ? "CTN" : "PCS"}{l.billed ? ` (${l.billed} billed)` : ""}</span>
                  ))}
                  {r.drafts.length > 0 && (
                    <span className="block text-sky-700">draft: {r.drafts.map((d) => <Link key={d.id} href={`/bills/${d.id}`} className="font-mono hover:underline">{d.billNo}</Link>)}</span>
                  )}
                </td>
                <td className="table-td text-right">{r.remainingPcs.toLocaleString()}</td>
                <td className="table-td text-right font-semibold text-amber-700">{peso(r.remainingValue)}</td>
                <td className="table-td"><InvoiceBadge status={r.invoiceStatus} /></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={scope.combined ? 10 : 9} className="p-8 text-center text-sm text-gray-500">Every posted receipt has been billed. 🎉</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t border-gray-200 bg-gray-50 font-bold">
              <tr>
                <td className="table-td" colSpan={scope.combined ? 7 : 6}>TOTAL — {rows.length} receipt(s)</td>
                <td className="table-td text-right">{rows.reduce((s, r) => s + r.remainingPcs, 0).toLocaleString()}</td>
                <td className="table-td text-right text-amber-700">{peso(rows.reduce((s, r) => s + r.remainingValue, 0))}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {user.role === "SUPER_ADMIN" && rows.length > 0 && !scope.combined && (
        <form action={markReceiptsBilledOutsideBefore} className="no-print mt-4 card flex flex-wrap items-end gap-2 border-dashed">
          <div>
            <p className="text-sm font-semibold">Cutover: receipts already invoiced and paid before Enter Bills existed</p>
            <p className="text-xs text-gray-500">Marks every posted, unbilled receipt of the active company received up to the date as billed outside the BMS. Each one gets an audit entry with your name and the note. Receipts that already have a bill are left alone.</p>
          </div>
          <div><label className="label">Received up to</label><input type="date" name="before" required className="input" /></div>
          <div className="w-80"><label className="label">Note</label><input name="note" required minLength={5} placeholder="e.g. invoices settled on paper before Sep 2026" className="input" /></div>
          <button className="btn-secondary" type="submit">Mark as billed outside the BMS</button>
        </form>
      )}
      <p className="mt-2 text-xs text-gray-500">
        These goods are in stock and available for sale. The value here sits in Goods Received Not Billed until the supplier&rsquo;s
        invoice is entered and posted, when it moves to Accounts Payable. A receipt older than 30 days without an invoice is worth
        chasing with the supplier.
      </p>
    </div>
  );
}
