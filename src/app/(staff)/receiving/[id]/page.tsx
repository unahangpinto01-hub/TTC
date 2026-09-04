import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { qtyLabel, lineCartonSize, ctnValue } from "@/lib/units";
import { CtnEquiv } from "@/components/qty";
import { PageHeader, StatusBadge } from "@/components/ui";
import { getAuditTrail } from "@/lib/salespeople";
import { saveGRNLines, setGRNStatus, postGRN, voidGRN } from "../actions";

const ERRORS: Record<string, string> = {
  locked: "This receipt is no longer editable — only a Draft can be changed.",
  exceeds: "A quantity is more than the purchase order has outstanding. Only an Admin or Super Admin may accept an over-receipt.",
  cost: "A unit cost differs from the purchase order. Only an Admin or Super Admin may approve a cost difference.",
  empty: "Enter what arrived before moving the receipt on.",
  notready: "A receipt must reach Received before it can be posted.",
  nothing: "There is nothing accepted to post.",
  posted: "A posted receipt cannot be voided — reverse it with a stock adjustment instead.",
  reason: "Give a reason for voiding.",
};

export default async function GRNDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string; saved?: string; posted?: string };
}) {
  const user = await requirePerm("purchaseOrders");
  const company = await getActiveCompany(user);
  const grn = await prisma.goodsReceipt.findUnique({
    where: { id: params.id },
    include: {
      purchaseOrder: { include: { supplier: true } },
      createdBy: { select: { name: true } },
      postedBy: { select: { name: true } },
      lines: { include: { product: true, poLine: true }, orderBy: { id: "asc" } },
    },
  });
  if (!grn || grn.companyId !== company.id) notFound(); // company isolation
  const audit = await getAuditTrail("GoodsReceipt", params.id, 30);

  const canEdit = user.perm === "READ_WRITE" && grn.status === "Draft";
  const canApprove = ["SUPER_ADMIN", "ADMIN"].includes(user.role) && user.perm === "READ_WRITE";
  const isOpen = !["Posted", "Void"].includes(grn.status);
  const today = grn.receivedDate.toISOString().slice(0, 10);

  const accepted = grn.lines.reduce((s, l) => s + l.acceptedQty, 0);
  // cartons are summed across products because a carton is a physical box, not a per-product unit
  const acceptedCtn = grn.lines.reduce((s, l) => s + (ctnValue(l.acceptedBaseQty, lineCartonSize(l, l.product)) ?? 0), 0);
  const acceptedPcs = grn.lines.reduce((s, l) => s + l.acceptedBaseQty, 0);
  const rejected = grn.lines.reduce((s, l) => s + l.rejectedQty, 0);
  const value = grn.lines.reduce((s, l) => s + l.acceptedQty * l.unitCost, 0);
  const costDiffs = grn.lines.filter((l) => Math.abs(l.unitCost - l.poUnitCost) > 0.004);

  return (
    <div>
      <Link href="/receiving" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
        ← Back to Receiving
      </Link>
      <PageHeader title={`Receiving ${grn.grnNumber}`}>
        <StatusBadge status={grn.status} />
        <Link href={`/receiving/${grn.id}/print`} className="btn-secondary">🖨 Print GRN</Link>
      </PageHeader>

      {searchParams.error && ERRORS[searchParams.error] && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <span className="font-semibold">⚠</span> {ERRORS[searchParams.error]}
        </p>
      )}
      {searchParams.saved === "ok" && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✔ Saved. Inventory is unchanged until this receipt is posted.</p>
      )}
      {searchParams.posted === "ok" && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          ✔ Posted. Accepted quantities are in stock at weighted average cost and the purchase order has been updated.
        </p>
      )}
      {grn.status === "Void" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Voided: {grn.voidReason}</p>
      )}
      {grn.overrideReason && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span className="font-semibold">Override recorded:</span> {grn.overrideReason}
        </p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div className="card py-3"><p className="text-xs text-gray-500">Supplier</p><p className="font-semibold">{grn.purchaseOrder.supplier.name}</p></div>
        <div className="card py-3">
          <p className="text-xs text-gray-500">Purchase Order</p>
          <Link href={`/purchase-orders/${grn.purchaseOrderId}`} className="font-mono font-semibold text-emerald-700 hover:underline">
            {grn.purchaseOrder.poNumber}
          </Link>
          <p className="text-xs text-gray-400">{grn.purchaseOrder.status}</p>
        </div>
        <div className="card py-3">
          <p className="text-xs text-gray-500">Accepted / Rejected</p>
          <p className="font-semibold">{accepted.toLocaleString()} <span className={rejected ? "text-red-600" : "text-gray-300"}>/ {rejected.toLocaleString()}</span></p>
          <p className="text-xs text-gray-500">
            {acceptedPcs.toLocaleString()} PCS = {acceptedCtn.toLocaleString("en-PH", { maximumFractionDigits: 2 })} CTN
          </p>
        </div>
        <div className="card py-3"><p className="text-xs text-gray-500">Accepted Value</p><p className="font-semibold">{peso(value)}</p></div>
      </div>

      <form action={saveGRNLines} className="card mb-4 space-y-4">
        <input type="hidden" name="id" value={grn.id} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label">Receiving Date</label>
            <input name="receivedDate" type="date" defaultValue={today} disabled={!canEdit} className="input" />
          </div>
          <div><label className="label">Warehouse / Location</label><input name="warehouse" defaultValue={grn.warehouse ?? ""} disabled={!canEdit} className="input" /></div>
          <div><label className="label">Supplier DR No.</label><input name="deliveryRefNo" defaultValue={grn.deliveryRefNo ?? ""} disabled={!canEdit} className="input" /></div>
          <div><label className="label">Supplier Invoice No.</label><input name="supplierInvoiceNo" defaultValue={grn.supplierInvoiceNo ?? ""} disabled={!canEdit} className="input" /></div>
          <div className="sm:col-span-2"><label className="label">Remarks</label><input name="remarks" defaultValue={grn.remarks ?? ""} disabled={!canEdit} className="input" /></div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full min-w-[1240px]">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="table-th">Product</th>
                <th className="table-th">Size</th>
                <th className="table-th text-right">Ordered</th>
                <th className="table-th text-right">Prev. Rec.</th>
                <th className="table-th text-right">Remaining</th>
                <th className="table-th text-right">Received</th>
                <th className="table-th text-right">Rejected</th>
                <th className="table-th text-right">Accepted</th>
                <th className="table-th text-right">Accepted (PCS)</th>
                <th className="table-th text-right">Equivalent (CTN)</th>
                <th className="table-th text-right">Unit Cost</th>
                <th className="table-th text-right">Total</th>
                <th className="table-th">Batch / Expiry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {grn.lines.map((l) => {
                const remaining = Math.max(0, l.poLine.qty - l.poLine.receivedQty);
                const diff = Math.abs(l.unitCost - l.poUnitCost) > 0.004;
                const ppc = lineCartonSize(l, l.product);
                return (
                  <tr key={l.id}>
                    <td className="table-td font-medium">{l.product.name}</td>
                    <td className="table-td text-xs text-gray-500">{l.product.packSize}</td>
                    <td className="table-td text-right text-sm">{qtyLabel(l.poLine.qty, l.unit)}</td>
                    <td className="table-td text-right text-sm text-gray-500">{l.poLine.receivedQty || "—"}</td>
                    <td className="table-td text-right text-sm font-semibold">{remaining || "—"}</td>
                    <td className="table-td text-right">
                      {canEdit ? (
                        <input name={`qty_${l.id}`} type="number" min={0} defaultValue={l.qty || ""} placeholder="0" className="input w-20 py-1 text-right" />
                      ) : (
                        <span className="font-semibold">{l.qty}</span>
                      )}
                    </td>
                    <td className="table-td text-right">
                      {canEdit ? (
                        <input name={`rej_${l.id}`} type="number" min={0} defaultValue={l.rejectedQty || ""} placeholder="0" className="input w-20 py-1 text-right" />
                      ) : (
                        <span className={l.rejectedQty ? "font-semibold text-red-600" : "text-gray-300"}>{l.rejectedQty || "—"}</span>
                      )}
                    </td>
                    <td className="table-td text-right font-semibold text-emerald-700">{l.acceptedQty || "—"}</td>
                    <td className="table-td text-right text-sm">{l.acceptedBaseQty.toLocaleString()}</td>
                    <td className="table-td text-right text-sm">
                      <CtnEquiv basePcs={l.acceptedBaseQty} ppc={ppc} />
                    </td>
                    <td className="table-td text-right">
                      {canEdit ? (
                        <input name={`cost_${l.id}`} type="number" min={0} step="0.01" defaultValue={l.unitCost} className={`input w-24 py-1 text-right ${diff ? "border-amber-400 bg-amber-50" : ""}`} />
                      ) : (
                        <span className={diff ? "font-semibold text-amber-700" : ""}>{peso(l.unitCost)}</span>
                      )}
                      {diff && <p className="text-[10px] text-amber-600">PO {peso(l.poUnitCost)}</p>}
                    </td>
                    <td className="table-td text-right text-sm">{peso(l.acceptedQty * l.unitCost)}</td>
                    <td className="table-td">
                      {canEdit ? (
                        <div className="flex gap-1">
                          <input name={`batch_${l.id}`} defaultValue={l.batchNo ?? ""} placeholder="batch" className="input w-24 py-1 font-mono text-xs" />
                          <input name={`exp_${l.id}`} type="date" defaultValue={l.expDate ? l.expDate.toISOString().slice(0, 10) : ""} className="input w-32 py-1 text-xs" />
                        </div>
                      ) : (
                        <span className="text-xs">
                          {l.batchNo || "—"}
                          {l.expDate && <span className="block text-gray-400">exp {fmtDate(l.expDate)}</span>}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" type="submit">💾 Save Receiving</button>
            <p className="text-xs text-gray-500">
              Accepted = Received − Rejected, calculated on save. Rejected goods are recorded but never stocked and stay
              outstanding on the purchase order. Going over the remaining quantity, or changing a unit cost, needs an
              Admin and is written to the audit trail.
            </p>
          </div>
        )}
      </form>

      {costDiffs.length > 0 && grn.status !== "Void" && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <span className="font-semibold">Cost difference on {costDiffs.length} line(s).</span> The purchase order cost is
          kept for comparison; posting values stock at the actual receiving cost.
        </p>
      )}

      {isOpen && user.perm === "READ_WRITE" && (
        <div className="card mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Workflow:</span>
          {grn.status === "Draft" && (
            <form action={setGRNStatus}>
              <input type="hidden" name="id" value={grn.id} />
              <input type="hidden" name="status" value="Pending Inspection" />
              <button className="btn-secondary" type="submit">Send for Inspection →</button>
            </form>
          )}
          {grn.status === "Pending Inspection" && (
            <>
              <form action={setGRNStatus}>
                <input type="hidden" name="id" value={grn.id} />
                <input type="hidden" name="status" value="Received" />
                <button className="btn-secondary" type="submit">Mark Received →</button>
              </form>
              <form action={setGRNStatus}>
                <input type="hidden" name="id" value={grn.id} />
                <input type="hidden" name="status" value="Rejected" />
                <button className="text-sm text-red-600 hover:underline" type="submit">Reject delivery</button>
              </form>
              <form action={setGRNStatus}>
                <input type="hidden" name="id" value={grn.id} />
                <input type="hidden" name="status" value="Draft" />
                <button className="text-sm text-gray-500 hover:underline" type="submit">← back to Draft</button>
              </form>
            </>
          )}
          {grn.status === "Received" &&
            (canApprove ? (
              <form action={postGRN}>
                <input type="hidden" name="id" value={grn.id} />
                <button className="btn-primary" type="submit">📦 Post to Inventory</button>
              </form>
            ) : (
              <span className="text-sm text-gray-500">Waiting for an Admin to post this to inventory.</span>
            ))}
          {canApprove && (
            <form action={voidGRN} className="ml-auto flex gap-2">
              <input type="hidden" name="id" value={grn.id} />
              <input name="voidReason" placeholder="reason to void" required className="input w-52 py-1 text-sm" />
              <button className="text-sm font-medium text-red-600 hover:underline" type="submit">Void</button>
            </form>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card text-sm">
          <p className="mb-2 font-semibold">Document</p>
          <dl className="space-y-1">
            {([
              ["Company", company.companyName],
              ["Created by", `${grn.createdBy?.name ?? "—"} · ${fmtDateTime(grn.createdAt)}`],
              ["Posted by", grn.postedAt ? `${grn.postedBy?.name ?? "—"} · ${fmtDateTime(grn.postedAt)}` : "not posted"],
              ["Warehouse", grn.warehouse ?? "—"],
              ["Supplier DR", grn.deliveryRefNo ?? "—"],
              ["Supplier Invoice", grn.supplierInvoiceNo ?? "—"],
              ["Remarks", grn.remarks ?? "—"],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-dotted border-gray-200 py-1">
                <dt className="text-gray-500">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <h2 className="mb-2 font-semibold">Audit Trail</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr><th className="table-th">When</th><th className="table-th">Action</th><th className="table-th">By</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="table-td whitespace-nowrap text-xs text-gray-600">{fmtDateTime(a.createdAt)}</td>
                    <td className="table-td text-sm"><span className="font-medium">{a.action.replaceAll("_", " ")}</span><p className="text-xs text-gray-500">{a.detail}</p></td>
                    <td className="table-td text-xs text-gray-500">{a.actorName}</td>
                  </tr>
                ))}
                {!audit.length && <tr><td colSpan={3} className="p-6 text-center text-sm text-gray-500">No activity recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
