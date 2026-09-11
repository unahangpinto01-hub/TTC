import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { parseRange } from "@/lib/reports";
import { getPurchaseReport } from "@/lib/ap-reports";
import { LIVE_BILL_STATUSES } from "@/lib/bills";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { SearchSelect } from "@/components/search-select";
import { PurchaseNav } from "./purchase-nav";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default async function PurchaseReportPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; company?: string; supplier?: string; status?: string; q?: string };
}) {
  const user = await requireReport("purchases");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const supplierId = searchParams.supplier ?? "";
  const supplier = supplierId ? await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true } }) : null;
  const status = LIVE_BILL_STATUSES.includes(searchParams.status ?? "") ? searchParams.status! : "";
  const { rows, totals } = await getPurchaseReport(range, scope.ids, { supplierId: supplier?.id, status: status || undefined, q: searchParams.q?.trim() || undefined });
  const fromStr = ymd(range.from);
  const toStr = ymd(range.to);
  const qs = new URLSearchParams({ from: fromStr, to: toStr, company: scope.value });
  if (supplier) qs.set("supplier", supplier.id);
  if (status) qs.set("status", status);
  if (searchParams.q) qs.set("q", searchParams.q);

  return (
    <div className="print-page">
      <PageHeader title="Purchase Report">
        {user.canExport && <a href={`/api/export/purchases?${qs.toString()}`} className="btn-secondary no-print">⬇ Excel</a>}
        {user.canPrint && <span className="no-print"><PrintButton /></span>}
      </PageHeader>
      <PurchaseNav active="bills" qs={qs.toString()} />

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <div className="w-60">
          <label className="label">Supplier</label>
          <SearchSelect entity="suppliers" name="supplier" placeholder="All suppliers" defaultValue={supplier ? { id: supplier.id, label: supplier.name } : null} submitOnSelect />
        </div>
        <div>
          <label className="label">Status</label>
          <select name="status" defaultValue={status} className="input w-40">
            <option value="">All posted</option>
            {LIVE_BILL_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div><label className="label">Search</label><input name="q" defaultValue={searchParams.q ?? ""} placeholder="bill, invoice, supplier" className="input w-44" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <p className="mb-4 text-sm text-gray-600">
        <span className="font-semibold">{scope.label}</span> · {fmtDate(range.from)} – {fmtDate(range.to)} · {totals.bills} bill(s) · Product cost{" "}
        <span className="font-bold text-emerald-800">{peso(totals.subtotal)}</span> · Freight/other {peso(totals.freight)} · Input VAT {peso(totals.inputVat)} · Total{" "}
        <span className="font-bold">{peso(totals.total)}</span> · Outstanding <span className="font-bold text-red-600">{peso(totals.outstanding)}</span>
      </p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1100px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Bill Date</th>
              <th className="table-th">Bill #</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Supplier</th>
              <th className="table-th">Supplier Invoice</th>
              <th className="table-th">PO / Receipt</th>
              <th className="table-th text-right">PCS</th>
              <th className="table-th text-right">CTN</th>
              <th className="table-th text-right">Product Cost</th>
              <th className="table-th text-right">Freight / Other</th>
              <th className="table-th text-right">Input VAT</th>
              <th className="table-th text-right">Total</th>
              <th className="table-th text-right">Outstanding</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(({ bill: b, pcs, ctn, outstanding }) => (
              <tr key={b.id} className="hover:bg-gray-50">
                <td className="table-td text-sm">{fmtDate(b.billDate)}</td>
                <td className="table-td"><Link href={`/bills/${b.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{b.billNo}</Link></td>
                {scope.combined && <td className="table-td"><CompanyTag name={b.company.companyName} /></td>}
                <td className="table-td text-sm">{b.supplier.name}</td>
                <td className="table-td text-xs text-gray-600">{b.supplierInvoiceNo ?? "—"}</td>
                <td className="table-td font-mono text-xs text-gray-600">{[b.purchaseOrder?.poNumber, b.goodsReceipt?.grnNumber].filter(Boolean).join(" / ") || "direct"}</td>
                <td className="table-td text-right text-sm">{pcs.toLocaleString()}</td>
                <td className="table-td text-right text-sm text-gray-600">{ctn.toLocaleString("en-PH", { maximumFractionDigits: 2 })}</td>
                <td className="table-td text-right font-semibold">{peso(b.subtotal)}</td>
                <td className={`table-td text-right ${b.freight + b.otherCosts ? "" : "text-gray-300"}`}>{b.freight + b.otherCosts ? peso(b.freight + b.otherCosts) : "—"}</td>
                <td className={`table-td text-right ${b.inputVat ? "" : "text-gray-300"}`}>{b.inputVat ? peso(b.inputVat) : "—"}</td>
                <td className="table-td text-right font-semibold">{peso(b.total)}</td>
                <td className={`table-td text-right ${outstanding ? "font-semibold text-red-600" : "text-gray-400"}`}>{outstanding ? peso(outstanding) : "—"}</td>
                <td className="table-td"><StatusBadge status={b.status} /></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={scope.combined ? 14 : 13} className="p-8 text-center text-sm text-gray-500">No posted supplier bills in this range.</td></tr>}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50 font-bold">
            <tr>
              <td className="table-td" colSpan={scope.combined ? 6 : 5}>{scope.combined ? "COMBINED GRAND TOTAL" : "TOTAL"}</td>
              <td className="table-td text-right">{totals.pcs.toLocaleString()}</td>
              <td className="table-td text-right">{totals.ctn.toLocaleString("en-PH", { maximumFractionDigits: 2 })}</td>
              <td className="table-td text-right text-emerald-800">{peso(totals.subtotal)}</td>
              <td className="table-td text-right">{peso(totals.freight)}</td>
              <td className="table-td text-right">{peso(totals.inputVat)}</td>
              <td className="table-td text-right">{peso(totals.total)}</td>
              <td className="table-td text-right text-red-600">{peso(totals.outstanding)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
