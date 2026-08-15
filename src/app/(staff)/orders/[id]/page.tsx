import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { fmtDateTime, peso, termLabel } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { convertToSO, cancelIncoming } from "../actions";

export default async function IncomingOrderPage({ params }: { params: { id: string } }) {
  await requireStaff();
  const order = await prisma.incomingOrder.findUnique({
    where: { id: params.id },
    include: { customer: true, lines: { include: { product: true } }, salesOrders: true },
  });
  if (!order) notFound();
  const total = order.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);

  return (
    <div className="max-w-3xl">
      <PageHeader title={`Incoming Order · ${order.customer.businessName}`}>
        <StatusBadge status={order.status} />
        <Link href={`/orders/${order.id}/print`} className="btn-secondary">🖨 Print / PDF</Link>
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card py-3"><p className="text-xs text-gray-500">Received</p><p className="text-sm font-semibold">{fmtDateTime(order.createdAt)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Source</p><p className="text-sm font-semibold uppercase">{order.source}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Payment Term</p><p className="text-sm font-semibold">{termLabel(order.term)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Total</p><p className="text-sm font-semibold">{peso(total)}</p></div>
      </div>

      {order.notes && <p className="card mb-4 text-sm text-gray-700"><span className="font-semibold">Notes:</span> {order.notes}</p>}

      <div className="card mb-4 overflow-x-auto p-0">
        <table className="w-full min-w-[560px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Product</th>
              <th className="table-th text-right">Qty</th>
              <th className="table-th text-right">Unit Price</th>
              <th className="table-th text-right">Total</th>
              <th className="table-th text-right">Stock Avail.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {order.lines.map((l) => (
              <tr key={l.id}>
                <td className="table-td font-medium">{l.product.name}</td>
                <td className="table-td text-right">{l.qty}</td>
                <td className="table-td text-right">{peso(l.unitPrice)}</td>
                <td className="table-td text-right">{peso(l.qty * l.unitPrice)}</td>
                <td className={`table-td text-right font-semibold ${l.product.stockQty < l.qty ? "text-red-600" : "text-emerald-700"}`}>
                  {l.product.stockQty}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {order.status === "Pending" && (
        <div className="flex gap-2">
          <form action={convertToSO}>
            <input type="hidden" name="orderId" value={order.id} />
            <button className="btn-primary" type="submit">Convert to Sales Order →</button>
          </form>
          <form action={cancelIncoming}>
            <input type="hidden" name="orderId" value={order.id} />
            <button className="btn-danger" type="submit">Cancel Order</button>
          </form>
        </div>
      )}
      {order.salesOrders.length > 0 && (
        <p className="text-sm text-gray-600">
          Converted to{" "}
          <Link href={`/sales-orders/${order.salesOrders[0].id}`} className="font-mono font-medium text-emerald-700 hover:underline">
            {order.salesOrders[0].soNumber}
          </Link>
        </p>
      )}
    </div>
  );
}
