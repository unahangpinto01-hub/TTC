import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { fmtDate, peso, termLabel, vatBreakdown } from "@/lib/format";
import { cartonLabel, qtyLabel } from "@/lib/units";
import { PageHeader, StatusBadge } from "@/components/ui";
import { confirmSO, cancelSO, scheduleSO, generateDR, updateLineQty, removeLine } from "../actions";

export default async function SODetailPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
  const user = await requirePerm("salesOrders");
  const so = await prisma.salesOrder.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      preparedBy: true,
      lines: { include: { product: true } },
      schedule: true,
      deliveryReceipts: { where: { status: { not: "Void" } } },
      incomingOrder: true,
    },
  });
  if (!so) notFound();

  const total = so.lines.reduce((s, l) => s + l.lineTotal, 0);
  const { net, vat } = vatBreakdown(total);
  // stock check in base PCS, aggregated per product across lines
  const neededPcs = new Map<string, number>();
  for (const l of so.lines) neededPcs.set(l.productId, (neededPcs.get(l.productId) ?? 0) + l.baseQty);
  const isShort = (l: (typeof so.lines)[number]) => l.product.stockQty < (neededPcs.get(l.productId) ?? 0);
  const anyShort = so.lines.some(isShort);
  const canApprove = user.perm === "READ_WRITE";
  const dr = so.deliveryReceipts[0];
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (
    <div className="max-w-4xl">
      <PageHeader title={`Sales Order ${so.soNumber}`}>
        <StatusBadge status={so.status} />
        <Link href={`/sales-orders/${so.id}/print`} className="btn-secondary">🖨 Print / PDF</Link>
      </PageHeader>

      {searchParams.error === "short" && (
        <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          ⚠ Cannot confirm — one or more lines exceed available stock. Adjust the highlighted quantities below.
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card py-3"><p className="text-xs text-gray-500">Customer</p>
          <Link href={`/customers/${so.customerId}`} className="text-sm font-semibold text-emerald-700 hover:underline">{so.customer.businessName}</Link>
          <p className="text-xs text-gray-500">{so.customer.region} · {so.customer.province}</p>
        </div>
        <div className="card py-3"><p className="text-xs text-gray-500">Date</p><p className="text-sm font-semibold">{fmtDate(so.orderDate)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Term</p><p className="text-sm font-semibold">{termLabel(so.term)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Prepared by</p><p className="text-sm font-semibold">{so.preparedBy?.name ?? "—"}</p></div>
      </div>

      {so.status === "Cancelled" && so.voidReason && (
        <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">Cancelled: {so.voidReason}</p>
      )}

      <div className="card mb-4 overflow-x-auto p-0">
        <table className="w-full min-w-[680px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Product</th>
              <th className="table-th text-right">Qty</th>
              <th className="table-th text-right">Unit Price</th>
              <th className="table-th text-right">Line Total</th>
              <th className="table-th text-right">Stock</th>
              <th className="table-th">Check</th>
              {so.status === "Draft" && <th className="table-th" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {so.lines.map((l) => {
              const short = isShort(l);
              return (
                <tr key={l.id} className={short ? "bg-red-50/70" : ""}>
                  <td className="table-td font-medium">{l.product.name}</td>
                  <td className="table-td text-right">
                    {so.status === "Draft" ? (
                      <form action={updateLineQty} className="flex items-center justify-end gap-1">
                        <input type="hidden" name="lineId" value={l.id} />
                        <input name="qty" type="number" min={1} defaultValue={l.qty} className="input w-20 text-right" />
                        <span className="text-xs text-gray-500">{l.unit === "CARTON" ? "CTN" : "PCS"}</span>
                        <button className="btn-secondary px-2 py-1 text-xs" type="submit">Set</button>
                      </form>
                    ) : (
                      qtyLabel(l.qty, l.unit)
                    )}
                    {l.unit === "CARTON" && (
                      <p className="text-xs font-normal text-gray-400">= {l.baseQty.toLocaleString()} PCS</p>
                    )}
                  </td>
                  <td className="table-td text-right">
                    {peso(l.unitPrice)}
                    <span className="text-xs text-gray-400"> / {l.unit === "CARTON" ? "CTN" : "PC"}</span>
                  </td>
                  <td className="table-td text-right">{peso(l.lineTotal)}</td>
                  <td className="table-td text-right">
                    {l.product.stockQty.toLocaleString()} <span className="text-xs text-gray-400">PCS</span>
                    {(() => {
                      const c = cartonLabel(l.product.stockQty, l.product);
                      return c ? <p className="text-xs font-normal text-gray-400">{c}</p> : null;
                    })()}
                  </td>
                  <td className="table-td">
                    <StatusBadge status={short ? "Out" : "In Stock"} />
                  </td>
                  {so.status === "Draft" && (
                    <td className="table-td">
                      <form action={removeLine}>
                        <input type="hidden" name="lineId" value={l.id} />
                        <button className="text-xs text-red-600 hover:underline" type="submit">remove</button>
                      </form>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50 text-sm">
            <tr><td colSpan={3} className="px-3 py-1 text-right text-gray-500">VAT-exclusive</td><td className="px-3 py-1 text-right">{peso(net)}</td><td colSpan={3} /></tr>
            <tr><td colSpan={3} className="px-3 py-1 text-right text-gray-500">VAT 12%</td><td className="px-3 py-1 text-right">{peso(vat)}</td><td colSpan={3} /></tr>
            <tr className="font-bold"><td colSpan={3} className="px-3 py-2 text-right">TOTAL</td><td className="px-3 py-2 text-right">{peso(total)}</td><td colSpan={3} /></tr>
          </tfoot>
        </table>
      </div>

      <div className="space-y-4">
        {so.status === "Draft" && (
          <div className="flex flex-wrap gap-2">
            <form action={confirmSO}>
              <input type="hidden" name="soId" value={so.id} />
              <button className="btn-primary" type="submit" title={anyShort ? "Fix short lines first" : ""}>
                ✔ Confirm SO (verifies stock)
              </button>
            </form>
            {canApprove && (
              <form action={cancelSO} className="flex gap-2">
                <input type="hidden" name="soId" value={so.id} />
                <input name="reason" placeholder="Cancel reason" className="input w-48" />
                <button className="btn-danger" type="submit">Cancel</button>
              </form>
            )}
          </div>
        )}

        {["Confirmed", "Scheduled"].includes(so.status) && (
          <div className="card">
            <h2 className="mb-2 font-semibold">{so.schedule ? "Delivery Schedule" : "Schedule Delivery"}</h2>
            <form action={scheduleSO} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="soId" value={so.id} />
              <div><label className="label">Date</label>
                <input name="date" type="date" required defaultValue={so.schedule ? so.schedule.date.toISOString().slice(0, 10) : tomorrow} className="input" /></div>
              <div><label className="label">Truck</label>
                <input name="truck" defaultValue={so.schedule?.truck ?? ""} placeholder="Isuzu Elf ABC-1234" className="input" /></div>
              <div><label className="label">Driver</label>
                <input name="driver" defaultValue={so.schedule?.driver ?? ""} placeholder="Driver name" className="input" /></div>
              <button className="btn-primary" type="submit">{so.schedule ? "Update Schedule" : "Schedule →"}</button>
            </form>
          </div>
        )}

        {["Confirmed", "Scheduled"].includes(so.status) && !dr && (
          <div className="card">
            <h2 className="mb-2 font-semibold">Generate Delivery Receipt</h2>
            <p className="mb-2 text-xs text-gray-500">Adjust quantities below for a partial delivery, then generate.</p>
            <form action={generateDR}>
              <input type="hidden" name="soId" value={so.id} />
              <div className="mb-3 space-y-1.5">
                {so.lines.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 text-sm">
                    <input type="hidden" name="lineId" value={l.id} />
                    <span className="w-72 truncate">{l.product.name}</span>
                    <input name="drQty" type="number" min={0} max={l.qty} defaultValue={l.qty} className="input w-24 text-right" />
                    <span className="text-xs text-gray-400">of {qtyLabel(l.qty, l.unit)}</span>
                  </div>
                ))}
              </div>
              <button className="btn-primary" type="submit">Generate DR →</button>
            </form>
          </div>
        )}

        {dr && (
          <p className="text-sm text-gray-600">
            Delivery Receipt:{" "}
            <Link href={`/deliveries/${dr.id}`} className="font-mono font-medium text-emerald-700 hover:underline">{dr.drNumber}</Link>{" "}
            <StatusBadge status={dr.status} />
          </p>
        )}
        {so.incomingOrder && (
          <p className="text-xs text-gray-500">
            From incoming order received {fmtDate(so.incomingOrder.createdAt)} via {so.incomingOrder.source.toLowerCase()}
          </p>
        )}
      </div>
    </div>
  );
}
