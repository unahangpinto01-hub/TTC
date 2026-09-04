import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate } from "@/lib/format";
import { qtyLabel } from "@/lib/units";
import { PageHeader } from "@/components/ui";
import { createGRN } from "../actions";

export default async function NewReceivingPage({
  searchParams,
}: {
  searchParams: { po?: string; error?: string; ref?: string };
}) {
  const user = await requirePermWrite("purchaseOrders");
  const company = await getActiveCompany(user);

  const openPOs = await prisma.purchaseOrder.findMany({
    where: { companyId: company.id, status: { in: ["Sent", "Partially Received"] } },
    orderBy: { date: "desc" },
    include: { supplier: { select: { name: true } }, lines: { include: { product: true } } },
  });
  const selected = openPOs.find((p) => p.id === searchParams.po) ?? null;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-4xl">
      <Link href="/receiving" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
        ← Back to Receiving
      </Link>
      <PageHeader title="New Receiving" />

      {searchParams.error === "duplicate" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <span className="font-semibold">⚠ Not created.</span> That supplier DR number has already been received on{" "}
          <span className="font-mono">{searchParams.ref}</span>. Use a different reference, or void that receipt first.
        </p>
      )}

      <form method="GET" className="card mb-4 flex flex-wrap items-end gap-2">
        <div className="min-w-[320px] flex-1">
          <label className="label">Purchase Order</label>
          <select name="po" defaultValue={selected?.id ?? ""} className="input">
            <option value="">— select an open purchase order —</option>
            {openPOs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.poNumber} · {p.supplier.name} · {p.status}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-secondary" type="submit">Load</button>
      </form>

      {!openPOs.length && (
        <div className="card p-8 text-center text-sm text-gray-500">
          No purchase order is open for receiving. A PO must be sent before goods can be received against it.
        </div>
      )}

      {selected && (
        <form action={createGRN} className="card space-y-4">
          <input type="hidden" name="poId" value={selected.id} />

          <div className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-3 text-sm md:grid-cols-4">
            <div><p className="text-xs text-gray-500">Company</p><p className="font-semibold">{company.companyName}</p></div>
            <div><p className="text-xs text-gray-500">Supplier</p><p className="font-semibold">{selected.supplier.name}</p></div>
            <div><p className="text-xs text-gray-500">Purchase Order</p><p className="font-mono font-semibold">{selected.poNumber}</p></div>
            <div><p className="text-xs text-gray-500">PO Date</p><p className="font-semibold">{fmtDate(selected.date)}</p></div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">Receiving Date</label>
              <input name="receivedDate" type="date" defaultValue={today} className="input" />
              <p className="mt-1 text-xs text-gray-500">Backdate to record a past delivery.</p>
            </div>
            <div><label className="label">Warehouse / Location</label><input name="warehouse" className="input" placeholder="Main warehouse" /></div>
            <div><label className="label">Supplier DR No.</label><input name="deliveryRefNo" className="input" placeholder="their delivery receipt no." /></div>
            <div><label className="label">Supplier Invoice No.</label><input name="supplierInvoiceNo" className="input" /></div>
            <div className="sm:col-span-2"><label className="label">Remarks</label><input name="remarks" className="input" /></div>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold">Outstanding on this purchase order</p>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-[620px]">
                <thead className="border-b border-gray-200 bg-gray-50">
                  <tr>
                    <th className="table-th">Product</th>
                    <th className="table-th">Size / Packaging</th>
                    <th className="table-th text-right">Ordered</th>
                    <th className="table-th text-right">Received</th>
                    <th className="table-th text-right">Remaining</th>
                    <th className="table-th text-right">PO Unit Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {selected.lines.map((l) => {
                    const remaining = Math.max(0, l.qty - l.receivedQty);
                    return (
                      <tr key={l.id} className={remaining === 0 ? "text-gray-300" : ""}>
                        <td className="table-td font-medium">{l.product.name}</td>
                        <td className="table-td text-sm">{l.product.packSize}</td>
                        <td className="table-td text-right text-sm">{qtyLabel(l.qty, l.unit)}</td>
                        <td className="table-td text-right text-sm">{l.receivedQty || "—"}</td>
                        <td className={`table-td text-right ${remaining > 0 ? "font-semibold" : ""}`}>{remaining || "—"}</td>
                        <td className="table-td text-right text-sm">{peso(l.unitCost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Every line with an outstanding quantity is carried onto the receipt at zero. You enter what actually
              arrived on the next screen. Nothing reaches inventory until the receipt is posted.
            </p>
          </div>

          <button className="btn-primary" type="submit">Create Receiving (Draft)</button>
        </form>
      )}
    </div>
  );
}
