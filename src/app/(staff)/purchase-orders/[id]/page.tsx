import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { fmtDate, peso } from "@/lib/format";
import { qtyLabel, lineCartonSize } from "@/lib/units";
import { CtnEquiv } from "@/components/qty";
import { PageHeader, StatusBadge } from "@/components/ui";
import { markPOSent, cancelPO } from "../actions";
import { getActiveCompany } from "@/lib/company";

export default async function PODetailPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
  const user = await requirePerm("purchaseOrders");
  const company = await getActiveCompany(user);
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.id },
    include: {
      supplier: true,
      lines: { include: { product: true } },
      goodsReceipts: { include: { lines: true }, orderBy: { receivedDate: "desc" } },
    },
  });
  if (!po || po.companyId !== company.id) notFound(); // company isolation
  const canEdit = user.perm === "READ_WRITE";
  const receivable = canEdit && ["Sent", "Partially Received"].includes(po.status);
  const anyReceived = po.lines.some((l) => l.receivedQty > 0);
  const cancellable = canEdit && !["Received", "Cancelled"].includes(po.status) && !anyReceived;
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

      {searchParams.error === "reason" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">A cancellation reason is required.</p>
      )}
      {searchParams.error === "received" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Cannot cancel — items were already received against this PO and stock has moved.
        </p>
      )}
      {po.status === "Cancelled" && (
        <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">Cancelled: {po.voidReason}</p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card py-3"><p className="text-xs text-gray-500">Supplier</p><p className="text-sm font-semibold">{po.supplier.name}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Date</p><p className="text-sm font-semibold">{fmtDate(po.date)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Total Cost</p><p className="text-sm font-semibold">{peso(total)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Lines</p><p className="text-sm font-semibold">{po.lines.length}</p></div>
      </div>

      {/* Receiving now runs through the Receive Inventory module: a goods received note is
          drafted, inspected and only then posted to stock. This table just shows progress. */}
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[860px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Product</th>
              <th className="table-th text-right">Ordered</th>
              <th className="table-th text-right">Received</th>
              <th className="table-th text-right">Remaining</th>
              <th className="table-th text-right">Ordered (PCS)</th>
              <th className="table-th text-right">Equivalent (CTN)</th>
              <th className="table-th text-right">Unit Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {po.lines.map((l) => {
              const remaining = Math.max(0, l.qty - l.receivedQty);
              // the line's own conversion, so an old order keeps the packaging it was raised under
              const ppc = lineCartonSize(l, l.product);
              const factor = l.qty > 0 ? l.baseQty / l.qty : 1;
              return (
                <tr key={l.id}>
                  <td className="table-td">
                    <span className="font-mono text-xs text-gray-500">{l.product.sku}</span>{" "}
                    <span className="font-medium">{l.product.name}</span>
                  </td>
                  <td className="table-td text-right">{qtyLabel(l.qty, l.unit)}</td>
                  <td className="table-td text-right">
                    {qtyLabel(l.receivedQty, l.unit)}
                    <p className="text-xs font-normal text-gray-400">
                      <CtnEquiv basePcs={Math.round(l.receivedQty * factor)} ppc={ppc} showLoose={false} />
                    </p>
                  </td>
                  <td className={`table-td text-right ${remaining > 0 ? "font-semibold" : "text-gray-300"}`}>
                    {remaining ? qtyLabel(remaining, l.unit) : "—"}
                    {remaining > 0 && (
                      <p className="text-xs font-normal text-gray-400">
                        <CtnEquiv basePcs={Math.round(remaining * factor)} ppc={ppc} showLoose={false} />
                      </p>
                    )}
                  </td>
                  <td className="table-td text-right">{l.baseQty.toLocaleString()}</td>
                  <td className="table-td text-right text-sm">
                    <CtnEquiv basePcs={l.baseQty} ppc={ppc} />
                  </td>
                  <td className="table-td text-right">
                    {peso(l.unitCost)}
                    <span className="text-xs text-gray-400"> / {l.unit === "CARTON" ? "CTN" : "PC"}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {receivable && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Link href={`/receiving/new?po=${po.id}`} className="btn-primary">📦 Receive Against This PO</Link>
          <p className="text-xs text-gray-500">
            Opens a goods received note. Stock is added only when that receipt is posted, so a delivery can be checked
            first and damaged goods recorded without stocking them.
          </p>
        </div>
      )}

      {po.goodsReceipts.length > 0 && (
        <div className="mt-4">
          <h2 className="mb-2 font-semibold">Receiving History</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[560px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="table-th">GRN #</th>
                  <th className="table-th">Date</th>
                  <th className="table-th">Supplier DR</th>
                  <th className="table-th text-right">Accepted</th>
                  <th className="table-th text-right">Rejected</th>
                  <th className="table-th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {po.goodsReceipts.map((g) => (
                  <tr key={g.id} className={g.status === "Void" ? "opacity-50" : ""}>
                    <td className="table-td">
                      <Link href={`/receiving/${g.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">
                        {g.grnNumber}
                      </Link>
                    </td>
                    <td className="table-td text-sm">{fmtDate(g.receivedDate)}</td>
                    <td className="table-td text-xs text-gray-600">{g.deliveryRefNo || "—"}</td>
                    <td className="table-td text-right">{g.lines.reduce((s, l) => s + l.acceptedQty, 0).toLocaleString()}</td>
                    <td className="table-td text-right text-red-600">{g.lines.reduce((s, l) => s + l.rejectedQty, 0) || "—"}</td>
                    <td className="table-td"><StatusBadge status={g.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {cancellable && (
        <form action={cancelPO} className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <input type="hidden" name="id" value={po.id} />
          <input name="reason" placeholder="Cancel reason (required)" className="input w-64" />
          <button className="btn-danger" type="submit">Cancel PO</button>
        </form>
      )}
    </div>
  );
}
