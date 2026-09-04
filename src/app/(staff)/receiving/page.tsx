import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate } from "@/lib/format";
import { ctnValue, lineCartonSize } from "@/lib/units";
import { PageHeader, StatusBadge } from "@/components/ui";

const STATUSES = ["Draft", "Pending Inspection", "Received", "Posted", "Rejected", "Void"];

export default async function ReceivingListPage({
  searchParams,
}: {
  searchParams: { status?: string; q?: string };
}) {
  const user = await requirePerm("purchaseOrders");
  const company = await getActiveCompany(user);
  const canEdit = user.perm === "READ_WRITE";

  const where: any = { companyId: company.id };
  if (STATUSES.includes(searchParams.status ?? "")) where.status = searchParams.status;
  const q = searchParams.q?.trim();
  if (q) {
    where.OR = [
      { grnNumber: { contains: q, mode: "insensitive" } },
      { deliveryRefNo: { contains: q, mode: "insensitive" } },
      { supplierInvoiceNo: { contains: q, mode: "insensitive" } },
      { purchaseOrder: { poNumber: { contains: q, mode: "insensitive" } } },
      { purchaseOrder: { supplier: { name: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const [receipts, openPOs] = await Promise.all([
    prisma.goodsReceipt.findMany({
      where,
      orderBy: [{ receivedDate: "desc" }, { grnNumber: "desc" }],
      take: 100,
      include: {
        purchaseOrder: { include: { supplier: { select: { name: true } } } },
        lines: { include: { product: { select: { piecesPerCarton: true } } } },
      },
    }),
    // a receipt can only be raised against a purchase order that is still open
    prisma.purchaseOrder.findMany({
      where: { companyId: company.id, status: { in: ["Sent", "Partially Received"] } },
      orderBy: { date: "desc" },
      include: { supplier: { select: { name: true } }, lines: true },
    }),
  ]);

  return (
    <div>
      <PageHeader title="Receive Inventory">
        {canEdit && openPOs.length > 0 && (
          <Link href="/receiving/new" className="btn-primary">+ New Receiving</Link>
        )}
      </PageHeader>

      <form method="GET" className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q ?? ""} placeholder="GRN, PO, supplier, DR or invoice no…" className="input max-w-xs" />
        <select name="status" defaultValue={searchParams.status ?? ""} className="input max-w-[190px]">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn-secondary" type="submit">Filter</button>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[860px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">GRN #</th>
              <th className="table-th">Date</th>
              <th className="table-th">Supplier</th>
              <th className="table-th">Purchase Order</th>
              <th className="table-th">Supplier DR / Invoice</th>
              <th className="table-th text-right">Accepted (PCS / CTN)</th>
              <th className="table-th text-right">Rejected</th>
              <th className="table-th text-right">Value</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {receipts.map((g) => {
              // acceptedQty is in each line's entered unit, so a mixed receipt would add
              // cartons to pieces — PCS and CTN are the figures that actually compare
              const accepted = g.lines.reduce((s, l) => s + l.acceptedQty, 0);
              const acceptedPcs = g.lines.reduce((s, l) => s + l.acceptedBaseQty, 0);
              const acceptedCtn = g.lines.reduce((s, l) => s + (ctnValue(l.acceptedBaseQty, lineCartonSize(l, l.product)) ?? 0), 0);
              const rejected = g.lines.reduce((s, l) => s + l.rejectedQty, 0);
              const value = g.lines.reduce((s, l) => s + l.acceptedQty * l.unitCost, 0);
              return (
                <tr key={g.id} className={g.status === "Void" ? "opacity-50" : "hover:bg-gray-50"}>
                  <td className="table-td">
                    <Link href={`/receiving/${g.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">
                      {g.grnNumber}
                    </Link>
                  </td>
                  <td className="table-td text-sm">{fmtDate(g.receivedDate)}</td>
                  <td className="table-td text-sm">{g.purchaseOrder.supplier.name}</td>
                  <td className="table-td">
                    <Link href={`/purchase-orders/${g.purchaseOrderId}`} className="font-mono text-xs text-emerald-700 hover:underline">
                      {g.purchaseOrder.poNumber}
                    </Link>
                  </td>
                  <td className="table-td text-xs text-gray-600">
                    {g.deliveryRefNo || "—"}
                    {g.supplierInvoiceNo && <p className="text-gray-400">Inv {g.supplierInvoiceNo}</p>}
                  </td>
                  <td className="table-td text-right">
                    {acceptedPcs.toLocaleString()}
                    <span className="block text-xs font-normal text-gray-500">
                      {acceptedCtn.toLocaleString("en-PH", { maximumFractionDigits: 2 })} CTN
                    </span>
                  </td>
                  <td className={`table-td text-right ${rejected > 0 ? "font-semibold text-red-600" : "text-gray-300"}`}>
                    {rejected || "—"}
                  </td>
                  <td className="table-td text-right">{peso(value)}</td>
                  <td className="table-td"><StatusBadge status={g.status} /></td>
                </tr>
              );
            })}
            {!receipts.length && (
              <tr>
                <td colSpan={9} className="p-8 text-center text-sm text-gray-500">
                  No receiving transactions yet.
                  {openPOs.length > 0
                    ? " Start one from an open purchase order."
                    : " No purchase order is open for receiving — send a PO first."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Inventory is untouched until a receipt is <strong>Posted</strong>. Only accepted quantities are added to stock,
        at weighted average cost; rejected or damaged quantities are recorded but never stocked, and stay outstanding on
        the purchase order.
      </p>
    </div>
  );
}
