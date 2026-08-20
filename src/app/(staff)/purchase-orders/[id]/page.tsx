import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { fmtDate, peso } from "@/lib/format";
import { qtyLabel } from "@/lib/units";
import { PageHeader, StatusBadge } from "@/components/ui";
import { markPOSent, receivePO } from "../actions";

export default async function PODetailPage({ params }: { params: { id: string } }) {
  const user = await requirePerm("purchaseOrders");
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.id },
    include: { supplier: true, lines: { include: { product: true } } },
  });
  if (!po) notFound();
  const canEdit = user.perm === "READ_WRITE";
  const receivable = canEdit && ["Sent", "Partially Received"].includes(po.status);
  const total = po.lines.reduce((s, l) => s + l.qty * l.unitCost, 0);

  return (
    <div className="max-w-4xl">
      <Link href="/purchase-orders" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
        ← Back to Purchase Orders
      </Link>
      <PageHeader title={`Purchase Order ${po.poNumber}`}>
        <StatusBadge status={po.status} />
        <Link href={`/purchase-orders/${po.id}/print`} className="btn-secondary">🖨 Print / PDF</Link>
        {canEdit && po.status === "Draft" && (
          <form action={markPOSent}>
            <input type="hidden" name="id" value={po.id} />
            <button className="btn-primary" type="submit">Mark as Sent</button>
          </form>
        )}
      </PageHeader>

      {po.status === "Cancelled" && (
        <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">Cancelled: {po.voidReason}</p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card py-3"><p className="text-xs text-gray-500">Supplier</p><p className="text-sm font-semibold">{po.supplier.name}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Date</p><p className="text-sm font-semibold">{fmtDate(po.date)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Total Cost</p><p className="text-sm font-semibold">{peso(total)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Lines</p><p className="text-sm font-semibold">{po.lines.length}</p></div>
      </div>

      <form action={receivePO}>
        <input type="hidden" name="poId" value={po.id} />
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[640px]">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="table-th">Product</th>
                <th className="table-th text-right">Ordered</th>
                <th className="table-th text-right">Received</th>
                <th className="table-th text-right">Unit Cost</th>
                {receivable && <th className="table-th text-right">Receive Now</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {po.lines.map((l) => (
                <tr key={l.id}>
                  <td className="table-td">
                    <span className="font-mono text-xs text-gray-500">{l.product.sku}</span>{" "}
                    <span className="font-medium">{l.product.name}</span>
                  </td>
                  <td className="table-td text-right">
                    {qtyLabel(l.qty, l.unit)}
                    {l.unit === "CARTON" && <p className="text-xs font-normal text-gray-400">= {l.baseQty.toLocaleString()} PCS</p>}
                  </td>
                  <td className="table-td text-right">{qtyLabel(l.receivedQty, l.unit)}</td>
                  <td className="table-td text-right">
                    {peso(l.unitCost)}
                    <span className="text-xs text-gray-400"> / {l.unit === "CARTON" ? "CTN" : "PC"}</span>
                  </td>
                  {receivable && (
                    <td className="table-td text-right">
                      <input type="hidden" name="lineId" value={l.id} />
                      <div className="flex items-center justify-end gap-1">
                        <input name="recvQty" type="number" min={0} max={l.qty - l.receivedQty} defaultValue={l.qty - l.receivedQty} className="input w-24 text-right" />
                        <span className="text-xs text-gray-500">{l.unit === "CARTON" ? "CTN" : "PCS"}</span>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {receivable && (
          <button className="btn-primary mt-3" type="submit">Receive Items (adds stock IN)</button>
        )}
      </form>

    </div>
  );
}
