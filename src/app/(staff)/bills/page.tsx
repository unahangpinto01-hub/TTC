import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate } from "@/lib/format";
import { BILL_STATUSES, outstandingOf } from "@/lib/bills";
import { PageHeader, StatusBadge } from "@/components/ui";
import { LiveSearch } from "@/components/live-search";

export default async function BillsListPage({
  searchParams,
}: {
  searchParams: { status?: string; q?: string };
}) {
  const user = await requirePerm("bills");
  const company = await getActiveCompany(user);
  const canEdit = user.perm === "READ_WRITE";

  const where: any = { companyId: company.id };
  if ((BILL_STATUSES as readonly string[]).includes(searchParams.status ?? "")) where.status = searchParams.status;
  const q = searchParams.q?.trim();
  if (q) {
    where.OR = [
      { billNo: { contains: q, mode: "insensitive" } },
      { supplierInvoiceNo: { contains: q, mode: "insensitive" } },
      { supplier: { name: { contains: q, mode: "insensitive" } } },
      { purchaseOrder: { poNumber: { contains: q, mode: "insensitive" } } },
      { goodsReceipt: { grnNumber: { contains: q, mode: "insensitive" } } },
    ];
  }

  const bills = await prisma.supplierBill.findMany({
    where,
    orderBy: [{ billDate: "desc" }, { billNo: "desc" }],
    take: 150,
    include: {
      supplier: { select: { name: true } },
      purchaseOrder: { select: { id: true, poNumber: true } },
      goodsReceipt: { select: { id: true, grnNumber: true } },
      lines: { select: { baseQty: true } },
    },
  });
  const today = Date.now();
  const openTotal = bills.reduce((s, b) => s + outstandingOf(b), 0);

  return (
    <div>
      <PageHeader title="Enter Bills Against Inventory">
        <Link href="/finance/ap" className="btn-secondary">AP Aging</Link>
        {canEdit && <Link href="/bills/new" className="btn-primary">+ New Bill</Link>}
      </PageHeader>

      <form method="GET" className="mb-4 flex flex-wrap gap-2">
        <LiveSearch placeholder="Bill no., supplier, invoice, PO or GRN…" />
        <select name="status" defaultValue={searchParams.status ?? ""} className="input max-w-[190px]">
          <option value="">All statuses</option>
          {BILL_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn-secondary" type="submit">Filter</button>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[980px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Bill #</th>
              <th className="table-th">Bill Date</th>
              <th className="table-th">Due</th>
              <th className="table-th">Supplier</th>
              <th className="table-th">Supplier Invoice</th>
              <th className="table-th">PO / Receipt</th>
              <th className="table-th text-right">PCS</th>
              <th className="table-th text-right">Total</th>
              <th className="table-th text-right">Outstanding</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {bills.map((b) => {
              const outstanding = outstandingOf(b);
              const overdue = outstanding > 0 && b.dueDate.getTime() < today;
              return (
                <tr key={b.id} className={b.status === "Void" ? "opacity-50" : "hover:bg-gray-50"}>
                  <td className="table-td">
                    <Link href={`/bills/${b.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{b.billNo}</Link>
                  </td>
                  <td className="table-td text-sm">{fmtDate(b.billDate)}</td>
                  <td className={`table-td text-sm ${overdue ? "font-semibold text-red-600" : ""}`}>
                    {fmtDate(b.dueDate)}
                    {overdue && <span className="block text-[10px] font-normal">overdue</span>}
                  </td>
                  <td className="table-td text-sm">{b.supplier.name}</td>
                  <td className="table-td text-xs text-gray-600">
                    {b.supplierInvoiceNo || (b.invoiceUnavailable ? <span className="italic text-gray-400">not available</span> : "—")}
                  </td>
                  <td className="table-td text-xs">
                    {b.purchaseOrder && (
                      <Link href={`/purchase-orders/${b.purchaseOrder.id}`} className="font-mono text-emerald-700 hover:underline">{b.purchaseOrder.poNumber}</Link>
                    )}
                    {b.goodsReceipt && (
                      <Link href={`/receiving/${b.goodsReceipt.id}`} className="block font-mono text-emerald-700 hover:underline">{b.goodsReceipt.grnNumber}</Link>
                    )}
                    {!b.purchaseOrder && !b.goodsReceipt && <span className="text-gray-400">direct</span>}
                  </td>
                  <td className="table-td text-right text-sm">{b.lines.reduce((s, l) => s + l.baseQty, 0).toLocaleString()}</td>
                  <td className="table-td text-right font-semibold">{peso(b.total)}</td>
                  <td className={`table-td text-right ${outstanding ? "font-semibold text-red-600" : "text-gray-400"}`}>{outstanding ? peso(outstanding) : "—"}</td>
                  <td className="table-td"><StatusBadge status={b.status} /></td>
                </tr>
              );
            })}
            {!bills.length && (
              <tr><td colSpan={10} className="p-8 text-center text-sm text-gray-500">No supplier bills yet. Raise one from a posted receipt, a purchase order, or on its own.</td></tr>
            )}
          </tbody>
          {bills.length > 0 && (
            <tfoot className="border-t border-gray-200 bg-gray-50 font-bold">
              <tr>
                <td className="table-td" colSpan={8}>OUTSTANDING ON THESE BILLS</td>
                <td className="table-td text-right text-red-600">{peso(openTotal)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        A bill raises the supplier&rsquo;s payable and fixes what the goods cost — Dr Inventory, Dr Input VAT, Cr Accounts
        Payable. Goods received through Receiving are already in stock; the bill re-costs them. A bill with no receipt
        stocks the goods itself. Nothing moves while it is a <strong>Draft</strong>. A posted bill is paid through Pay
        Bills, never by editing it.
      </p>
    </div>
  );
}
