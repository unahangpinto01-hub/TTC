import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { canApprovePayments, getOutstandingInvoices, PAYMENT_METHODS } from "@/lib/receive-payments";
import { remainingOf, creditDisplayStatus, combinedCustomerCredit } from "@/lib/refunds-credits";
import { getAuditTrail } from "@/lib/salespeople";
import {
  submitRefundCredit, approveRefundCredit, rejectRefundCredit, postRefundCreditAction,
  voidRefundCreditAction, applyCreditMemoAction, unapplyCreditAction,
} from "../actions";

export default async function RefundCreditDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string };
}) {
  const user = await requirePerm("refundsCredits");
  const company = await getActiveCompany(user);
  const rc = await prisma.refundCredit.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { id: true, businessName: true } },
      salesReceipt: { select: { id: true, srNumber: true } },
      cashAccount: { select: { name: true } },
      sourcePayment: { select: { id: true, prNumber: true } },
      sourceCredit: { select: { id: true, rcNumber: true } },
      createdBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      lines: { include: { product: { select: { name: true, sku: true } } } },
      applications: { include: { salesReceipt: { select: { id: true, srNumber: true, amount: true, status: true } } }, orderBy: { createdAt: "asc" } },
      refundsDrawn: { where: { status: "Posted" }, select: { amount: true, status: true, rcNumber: true } },
    },
  });
  if (!rc || rc.companyId !== company.id) notFound();

  const applied = rc.applications.reduce((s, a) => s + a.amount, 0);
  const remaining = remainingOf(rc);
  const canEdit = user.perm === "READ_WRITE";
  const isApprover = canEdit && canApprovePayments(user);
  const audit = await getAuditTrail("RefundCredit", rc.id, 30);
  const openInvoices = rc.type === "Credit" && rc.status === "Posted" && remaining > 0.005 && canEdit
    ? await getOutstandingInvoices(rc.customerId, company.id)
    : [];
  // posting a refund may draw on the customer's existing credit
  const creditSources = rc.type === "Refund" && rc.status === "Approved" && isApprover
    ? (await combinedCustomerCredit(rc.customerId, company.id)).sources.filter((s) => !(s.kind === "Credit" && s.id === rc.id))
    : [];
  const accounts = rc.type === "Refund" && rc.status === "Approved" && isApprover
    ? await prisma.cashAccount.findMany({ where: { companyId: company.id, status: "Active" }, orderBy: { name: "asc" } })
    : [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-5xl">
      <div className="mb-3 flex items-center justify-between">
        <Link href="/refunds" className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
          ← Back to Refunds &amp; Credits
        </Link>
        <Link href={`/refunds/${rc.id}/print`} className="btn-secondary">🖨 Print / PDF</Link>
      </div>
      <PageHeader title={`${rc.rcNumber} — ${rc.customer.businessName}`}>
        <StatusBadge status={creditDisplayStatus(rc)} />
      </PageHeader>

      {searchParams.error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">⚠</span> {searchParams.error}</p>
      )}

      <div className="card mb-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-3">
        <div><p className="text-xs text-gray-500">Type</p><p className="font-semibold">{rc.type === "Credit" ? "Customer Credit (memo)" : "Customer Refund"}</p></div>
        <div><p className="text-xs text-gray-500">Date</p><p className="font-semibold">{fmtDate(rc.date)}</p></div>
        <div><p className="text-xs text-gray-500">Reason</p><p className="font-semibold">{rc.reason}</p></div>
        <div><p className="text-xs text-gray-500">Related Invoice</p><p className="font-semibold">{rc.salesReceipt ? <Link href={`/invoices/${rc.salesReceipt.id}`} className="text-emerald-700 hover:underline">{rc.salesReceipt.srNumber}</Link> : "—"}</p></div>
        <div><p className="text-xs text-gray-500">Amount</p><p className="text-lg font-bold text-emerald-800">{peso(rc.amount)}</p></div>
        {rc.type === "Credit" ? (
          <div><p className="text-xs text-gray-500">Applied / Remaining</p><p className="text-lg font-bold">{peso(applied)} <span className="text-sm font-normal text-gray-500">/ {peso(remaining)} left</span></p></div>
        ) : (
          <div><p className="text-xs text-gray-500">Refund Payout</p><p className="font-semibold">{rc.refundMethod ? `${rc.refundMethod}${rc.refundDate ? ` · ${fmtDate(rc.refundDate)}` : ""}${rc.refundRefNo ? ` · ${rc.refundRefNo}` : ""}` : "recorded at posting"}</p></div>
        )}
        {rc.cashAccount && <div><p className="text-xs text-gray-500">Paid From</p><p className="font-semibold">{rc.cashAccount.name}</p></div>}
        {(rc.sourcePayment || rc.sourceCredit) && (
          <div><p className="text-xs text-gray-500">Drawn From Credit</p><p className="font-semibold">{rc.sourcePayment ? <Link href={`/payments/${rc.sourcePayment.id}`} className="text-emerald-700 hover:underline">{rc.sourcePayment.prNumber}</Link> : <Link href={`/refunds/${rc.sourceCredit!.id}`} className="text-emerald-700 hover:underline">{rc.sourceCredit!.rcNumber}</Link>}</p></div>
        )}
        <div><p className="text-xs text-gray-500">Created / Approved By</p><p className="font-semibold">{rc.createdBy?.name ?? "—"}{rc.approvedBy ? ` / ${rc.approvedBy.name}` : ""}</p></div>
        <div className="col-span-2 md:col-span-3"><p className="text-xs text-gray-500">Remarks</p><p>{rc.remarks}</p></div>
        {rc.voidReason && <div className="col-span-2 md:col-span-3"><p className="text-xs text-gray-500">{rc.status === "Rejected" ? "Rejection" : "Void"} Reason</p><p className="text-red-600">{rc.voidReason}</p></div>}
      </div>

      {rc.lines.length > 0 && (
        <>
          <h2 className="mb-2 font-semibold">Items</h2>
          <div className="card mb-4 overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr><th className="table-th">Item</th><th className="table-th text-right">Qty</th><th className="table-th text-right">Unit Price</th><th className="table-th text-right">Total</th><th className="table-th">Returned to Stock</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rc.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="table-td">{l.product ? <>{l.product.name} <span className="text-xs text-gray-400">{l.product.sku}</span></> : <span className="italic">{l.description}</span>}</td>
                    <td className="table-td text-right">{l.qty}</td>
                    <td className="table-td text-right">{peso(l.unitPrice)}</td>
                    <td className="table-td text-right font-semibold">{peso(l.qty * l.unitPrice)}</td>
                    <td className="table-td text-xs">{l.returnToStock ? "✔ yes (on posting)" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {rc.type === "Credit" && rc.applications.length > 0 && (
        <>
          <h2 className="mb-2 font-semibold">Applied to Invoices</h2>
          <div className="card mb-4 overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr><th className="table-th">Invoice</th><th className="table-th text-right">Amount Applied</th><th className="table-th">Invoice Status</th><th className="table-th">Applied On</th>{isApprover && rc.status === "Posted" && <th className="table-th" />}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rc.applications.map((a) => (
                  <tr key={a.id}>
                    <td className="table-td"><Link href={`/invoices/${a.salesReceipt.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{a.salesReceipt.srNumber}</Link></td>
                    <td className="table-td text-right font-semibold">{peso(a.amount)}</td>
                    <td className="table-td"><StatusBadge status={a.salesReceipt.status} /></td>
                    <td className="table-td text-xs text-gray-500">{fmtDateTime(a.createdAt)}</td>
                    {isApprover && rc.status === "Posted" && (
                      <td className="table-td text-right">
                        <form action={unapplyCreditAction}>
                          <input type="hidden" name="id" value={rc.id} />
                          <input type="hidden" name="applicationId" value={a.id} />
                          <button className="text-xs text-red-500 hover:underline" type="submit">unapply</button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {rc.type === "Credit" && rc.status === "Posted" && remaining > 0.005 && canEdit && (
        <form action={applyCreditMemoAction} className="card mb-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={rc.id} />
          <div className="min-w-[260px]">
            <label className="label">Apply remaining credit to invoice</label>
            <select name="invoiceId" className="input" required>
              <option value="">— pick an open invoice —</option>
              {openInvoices.map((i) => <option key={i.id} value={i.id}>{i.srNumber} · balance {peso(i.outstanding)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Amount (max {peso(remaining)})</label>
            <input name="amount" type="number" min={0.01} max={remaining} step="0.01" required className="input w-36" />
          </div>
          <button className="btn-primary" type="submit">Apply Credit</button>
          {!openInvoices.length && <p className="pb-2 text-xs text-gray-500">No open invoices — the credit waits for the next one.</p>}
        </form>
      )}

      {/* workflow */}
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && rc.status === "Draft" && (
            <>
              <Link href={`/refunds/${rc.id}/edit`} className="btn-secondary">✏ Edit Draft</Link>
              <form action={submitRefundCredit}><input type="hidden" name="id" value={rc.id} /><button className="btn-primary" type="submit">Submit for Approval</button></form>
            </>
          )}
          {isApprover && rc.status === "Pending Approval" && (
            <>
              <form action={approveRefundCredit}><input type="hidden" name="id" value={rc.id} /><button className="btn-primary" type="submit">✔ Approve</button></form>
              <form action={rejectRefundCredit} className="flex items-center gap-2">
                <input type="hidden" name="id" value={rc.id} />
                <input name="reason" placeholder="rejection reason" className="input w-48" />
                <button className="btn-secondary" type="submit">Reject</button>
              </form>
            </>
          )}
          {isApprover && rc.status === "Approved" && rc.type === "Credit" && (
            <form action={postRefundCreditAction}><input type="hidden" name="id" value={rc.id} /><button className="btn-primary" type="submit">📗 Post Credit</button></form>
          )}
          {isApprover && rc.status === "Posted" && (
            <form action={voidRefundCreditAction} className="flex items-center gap-2">
              <input type="hidden" name="id" value={rc.id} />
              <input name="reason" placeholder="void reason" required className="input w-52" />
              <button className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50" type="submit">Void</button>
            </form>
          )}
        </div>

        {isApprover && rc.status === "Approved" && rc.type === "Refund" && (
          <form action={postRefundCreditAction} className="card flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={rc.id} />
            <p className="w-full text-sm font-semibold">Process refund payout of {peso(rc.amount)}:</p>
            <div>
              <label className="label">Refund Method</label>
              <select name="refundMethod" required className="input">
                {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div><label className="label">Refund Date</label><input name="refundDate" type="date" defaultValue={today} required className="input" /></div>
            <div><label className="label">Reference #</label><input name="refundRefNo" className="input w-40" placeholder="check / txn no." /></div>
            <div>
              <label className="label">Paid From Account</label>
              <select name="cashAccountId" className="input">
                <option value="">— none —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Draw From Credit (optional)</label>
              <select name="source" className="input">
                <option value="">— none (standalone refund) —</option>
                {creditSources.map((s) => (
                  <option key={s.id} value={`${s.kind === "Payment" ? "pay" : "cm"}:${s.id}`}>
                    {s.number} · available {peso(s.available)}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn-primary" type="submit">💸 Post Refund</button>
            <p className="w-full text-xs text-gray-500">
              Drawing from a credit reduces that credit&rsquo;s balance — use it when refunding an overpayment or an
              unused credit memo, so the money is not counted twice.
            </p>
          </form>
        )}
      </div>

      {audit.length > 0 && (
        <>
          <h2 className="mb-2 font-semibold">Audit Trail</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr><th className="table-th">When</th><th className="table-th">Action</th><th className="table-th">Detail</th><th className="table-th">By</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {audit.map((e) => (
                  <tr key={e.id}>
                    <td className="table-td whitespace-nowrap text-xs">{fmtDateTime(e.createdAt)}</td>
                    <td className="table-td text-xs font-semibold">{e.action}</td>
                    <td className="table-td text-xs">{e.detail}</td>
                    <td className="table-td text-xs text-gray-600">{e.actorName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
