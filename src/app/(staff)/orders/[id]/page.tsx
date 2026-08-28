import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { fmtDate, fmtDateTime, peso, termLabel } from "@/lib/format";
import { qtyLabel } from "@/lib/units";
import { PageHeader, StatusBadge } from "@/components/ui";
import { convertToSO, cancelIncoming } from "../actions";
import { getActiveCompany } from "@/lib/company";

export default async function IncomingOrderPage({ params }: { params: { id: string } }) {
  const user = await requirePerm("orders");
  const company = await getActiveCompany(user);
  const order = await prisma.incomingOrder.findUnique({
    where: { id: params.id },
    include: { customer: true, lines: { include: { product: true } }, salesOrders: true },
  });
  if (!order || order.companyId !== company.id) notFound();
  const subtotal = order.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const total = subtotal + order.freightTotal;

  return (
    <div className="max-w-3xl">
      <PageHeader title={`Incoming Order ${order.orderNo ? `#${order.orderNo}` : ""} · ${order.customer.businessName}`}>
        <StatusBadge status={order.status} />
        <Link href={`/orders/${order.id}/print`} className="btn-secondary">🖨 Print / PDF</Link>
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card py-3">
          <p className="text-xs text-gray-500">Order Date</p>
          <p className="text-sm font-semibold">{fmtDate(order.orderDate)}</p>
          <p className="text-xs text-gray-400">encoded {fmtDateTime(order.createdAt)}</p>
        </div>
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
                <td className="table-td text-right">
                  {qtyLabel(l.qty, l.unit)}
                  {l.unit === "CARTON" && <p className="text-xs font-normal text-gray-400">= {l.baseQty.toLocaleString()} PCS</p>}
                </td>
                <td className="table-td text-right">
                  {peso(l.unitPrice)}
                  <span className="text-xs text-gray-400"> / {l.unit === "CARTON" ? "CTN" : "PC"}</span>
                </td>
                <td className="table-td text-right">{peso(l.qty * l.unitPrice)}</td>
                <td className={`table-td text-right font-semibold ${l.product.stockQty < l.baseQty ? "text-red-600" : "text-emerald-700"}`}>
                  {l.product.stockQty} <span className="text-xs font-normal text-gray-400">PCS</span>
                </td>
              </tr>
            ))}
          </tbody>
          {order.freightTotal > 0 && (
            <tfoot className="border-t border-gray-200 bg-gray-50 text-sm">
              <tr><td colSpan={3} className="px-3 py-1 text-right text-gray-500">Merchandise</td><td className="px-3 py-1 text-right">{peso(subtotal)}</td><td /></tr>
              <tr>
                <td colSpan={3} className="px-3 py-1 text-right text-gray-500">
                  Freight ({order.lines.filter((l) => l.unit === "CARTON").reduce((s, l) => s + l.qty, 0)} CTN × {peso(order.freightPerCarton)})
                </td>
                <td className="px-3 py-1 text-right">{peso(order.freightTotal)}</td><td />
              </tr>
              <tr className="font-bold"><td colSpan={3} className="px-3 py-2 text-right">TOTAL</td><td className="px-3 py-2 text-right">{peso(total)}</td><td /></tr>
            </tfoot>
          )}
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
