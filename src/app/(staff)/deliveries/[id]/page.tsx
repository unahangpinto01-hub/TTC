import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { fmtDate, peso, vatBreakdown } from "@/lib/format";
import { qtyLabel, lineGrossWeightKg, kgLabel } from "@/lib/units";
import { PageHeader, StatusBadge } from "@/components/ui";
import { markDelivered, voidDR, saveDRBatches, setDRSignatories } from "../actions";
import { getActiveCompany } from "@/lib/company";

export default async function DRDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; batch?: string; sig?: string } }) {
  const user = await requirePerm("deliveries");
  const company = await getActiveCompany(user);
  const dr = await prisma.deliveryReceipt.findUnique({
    where: { id: params.id },
    include: {
      lines: { include: { product: true } },
      salesOrder: { include: { customer: true, schedule: true } },
      salesReceipt: true,
      preparedByEmp: { select: { id: true, name: true } },
      checkedByEmp: { select: { id: true, name: true } },
      approvedByEmp: { select: { id: true, name: true } },
    },
  });
  if (!dr || dr.companyId !== company.id) notFound(); // company isolation
  const total = dr.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const { net, vat } = vatBreakdown(total);
  // delivered DRs use the weight snapshot taken at delivery; drafts compute live from the product master
  const totalKg = dr.lines.reduce(
    (s, l) => s + (dr.status === "Draft" ? lineGrossWeightKg(l.baseQty, l.product) ?? 0 : l.grossWeightKg),
    0
  );
  // batch numbers are a printed reference only, so they stay editable until the DR is voided
  const canBatch = user.perm === "READ_WRITE" && dr.status !== "Void";
  // reassigning a signatory is an approval change, so it is Super Admin / Admin only
  const canSign = ["SUPER_ADMIN", "ADMIN"].includes(user.role) && user.perm === "READ_WRITE" && dr.status !== "Void";
  const staff = canSign
    ? await prisma.employee.findMany({ where: { status: "Active" }, select: { id: true, name: true, position: true }, orderBy: { name: "asc" } })
    : [];

  return (
    <div className="max-w-4xl">
      <PageHeader title={`Delivery Receipt ${dr.drNumber}`}>
        <StatusBadge status={dr.status} />
        <Link href={`/deliveries/${dr.id}/print`} className="btn-secondary">🖨 Print / PDF</Link>
      </PageHeader>

      {searchParams.error === "short" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          ⚠ Cannot deliver — stock on hand is not enough for one or more lines (stock can never go negative). Adjust stock or void this DR and generate a smaller one.
        </p>
      )}
      {searchParams.error === "history" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          ⚠ Cannot deliver on the backdated date — stock on hand for one or more products would go below zero at some point in history. Check the stock card, or void this DR and generate one with a later date.
        </p>
      )}
      {searchParams.error === "reason" && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">A void reason is required.</p>}
      {searchParams.error === "invoiced" && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Cannot void — an invoice already exists for this DR. Void the SR first.</p>}
      {dr.status === "Void" && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">Voided: {dr.voidReason}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card py-3"><p className="text-xs text-gray-500">Customer</p><p className="text-sm font-semibold">{dr.salesOrder.customer.businessName}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Sales Order</p>
          <Link href={`/sales-orders/${dr.salesOrderId}`} className="font-mono text-sm font-semibold text-emerald-700 hover:underline">{dr.salesOrder.soNumber}</Link>
        </div>
        <div className="card py-3"><p className="text-xs text-gray-500">DR Date</p><p className="text-sm font-semibold">{fmtDate(dr.date)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Delivered At</p><p className="text-sm font-semibold">{dr.deliveredAt ? fmtDate(dr.deliveredAt) : "—"}</p></div>
        <div className="card py-3">
          <p className="text-xs text-gray-500">Total Gross Weight {dr.status === "Draft" ? "(current)" : "(at delivery)"}</p>
          <p className="text-sm font-semibold">{totalKg > 0 ? kgLabel(totalKg) : "—"}</p>
        </div>
      </div>

      {searchParams.batch === "ok" && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          ✔ Batch numbers saved. They appear on the printed delivery receipt.
        </p>
      )}

      <form action={saveDRBatches} className="card mb-4 overflow-x-auto p-0">
        <input type="hidden" name="id" value={dr.id} />
        <table className="w-full min-w-[680px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Product</th>
              <th className="table-th text-right">Qty</th>
              <th className="table-th">Batch No.</th>
              <th className="table-th text-right">Unit Price</th>
              <th className="table-th text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {dr.lines.map((l) => (
              <tr key={l.id}>
                <td className="table-td font-medium">{l.product.name}</td>
                <td className="table-td text-right">
                  {qtyLabel(l.qty, l.unit)}
                  {l.unit === "CARTON" && <p className="text-xs font-normal text-gray-400">= {l.baseQty.toLocaleString()} PCS</p>}
                </td>
                <td className="table-td">
                  {canBatch ? (
                    <input
                      name={`batch_${l.id}`}
                      defaultValue={l.batchNo ?? ""}
                      maxLength={120}
                      placeholder={l.product.batchNo ?? "type batch no."}
                      className="input w-44 py-1 font-mono text-xs"
                    />
                  ) : (
                    <span className="font-mono text-xs">{l.batchNo || <span className="text-gray-300">—</span>}</span>
                  )}
                </td>
                <td className="table-td text-right">
                  {peso(l.unitPrice)}
                  <span className="text-xs text-gray-400"> / {l.unit === "CARTON" ? "CTN" : "PC"}</span>
                </td>
                <td className="table-td text-right">{peso(l.qty * l.unitPrice)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50 text-sm">
            <tr><td colSpan={3} className="px-3 py-1 text-right text-gray-500">VAT-exclusive</td><td colSpan={2} className="px-3 py-1 text-right">{peso(net)}</td></tr>
            <tr><td colSpan={3} className="px-3 py-1 text-right text-gray-500">VAT 12%</td><td colSpan={2} className="px-3 py-1 text-right">{peso(vat)}</td></tr>
            <tr className="font-bold"><td colSpan={3} className="px-3 py-2 text-right">TOTAL</td><td colSpan={2} className="px-3 py-2 text-right">{peso(total)}</td></tr>
          </tfoot>
        </table>
        {canBatch && (
          <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 px-3 py-2">
            <button className="btn-secondary" type="submit">Save Batch Numbers</button>
            <p className="text-xs text-gray-500">
              Typed by the warehouse when picking and printed on the delivery receipt. Enter several separated by commas
              if a line was picked from more than one batch. Saved onto this receipt, so editing the product later never
              changes what a signed copy said.
            </p>
          </div>
        )}
      </form>

      {searchParams.sig === "ok" && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          ✔ Signatories updated and recorded in the audit trail.
        </p>
      )}
      {searchParams.error === "sig" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <span className="font-semibold">⚠ Not saved.</span> Pick an active employee for each signatory.
        </p>
      )}

      {canSign ? (
        <form action={setDRSignatories} className="card mb-4">
          <input type="hidden" name="id" value={dr.id} />
          <div className="grid gap-3 sm:grid-cols-3">
            {([
              ["preparedById", "Prepared by", dr.preparedByEmp?.id],
              ["checkedById", "Checked by", dr.checkedByEmp?.id],
              ["approvedById", "Approved by", dr.approvedByEmp?.id],
            ] as const).map(([field, label, current]) => (
              <div key={field}>
                <label className="label">{label}</label>
                <select name={field} defaultValue={current ?? ""} className="input">
                  <option value="">— none —</option>
                  {staff.map((e) => (
                    <option key={e.id} value={e.id}>{e.name} · {e.position}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn-secondary" type="submit">Save Signatories</button>
            <p className="text-xs text-gray-500">
              Defaults come from Company Details and are stored on this receipt as employee links, so a rename in HR
              flows through. Changes are recorded in the audit trail.
            </p>
          </div>
        </form>
      ) : (
        <div className="mb-4 grid grid-cols-3 gap-3 text-center text-sm">
          <div className="card py-3"><p className="text-xs text-gray-500">Prepared by</p><p className="font-semibold">{dr.preparedByEmp?.name || dr.preparedBy || "—"}</p></div>
          <div className="card py-3"><p className="text-xs text-gray-500">Checked by</p><p className="font-semibold">{dr.checkedByEmp?.name || dr.checkedBy || "—"}</p></div>
          <div className="card py-3"><p className="text-xs text-gray-500">Approved by</p><p className="font-semibold">{dr.approvedByEmp?.name || dr.approvedBy || "—"}</p></div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {dr.status === "Draft" && (
          <form action={markDelivered}>
            <input type="hidden" name="drId" value={dr.id} />
            <button className="btn-primary" type="submit">✔ Mark as Delivered (deducts stock)</button>
          </form>
        )}
        {dr.status === "Delivered" && !dr.salesReceipt && (
          <p className="text-sm text-gray-600">Waiting in the <Link href="/invoicing" className="text-emerald-700 underline">invoicing queue</Link>.</p>
        )}
        {dr.salesReceipt && (
          <p className="text-sm text-gray-600">
            Invoice: <Link href={`/invoices/${dr.salesReceipt.id}`} className="font-mono font-medium text-emerald-700 hover:underline">{dr.salesReceipt.srNumber}</Link>
          </p>
        )}
        {user.role === "SUPER_ADMIN" && dr.status !== "Void" && !dr.salesReceipt && (
          <form action={voidDR} className="ml-auto flex gap-2">
            <input type="hidden" name="drId" value={dr.id} />
            <input name="reason" placeholder="Void reason (required)" className="input w-52" />
            <button className="btn-danger" type="submit">Void DR</button>
          </form>
        )}
      </div>
    </div>
  );
}
