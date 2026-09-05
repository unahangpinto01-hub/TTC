import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { canApprovePayments, unappliedOf, getOutstandingInvoices } from "@/lib/receive-payments";
import { getAuditTrail } from "@/lib/salespeople";
import {
  submitForApproval, approveAndPost, cancelReceivePayment, voidPayment, applyCreditAction, unapplyAction,
} from "../actions";

export default async function PaymentDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string };
}) {
  const user = await requirePerm("receivePayments");
  const company = await getActiveCompany(user);
  const rp = await prisma.receivePayment.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { id: true, businessName: true, province: true } },
      cashAccount: { select: { name: true, type: true } },
      receivedBy: { select: { name: true } },
      applications: { include: { salesReceipt: { select: { id: true, srNumber: true, amount: true, status: true } } }, orderBy: { createdAt: "asc" } },
      refunds: { where: { status: "Posted" }, select: { rcNumber: true, amount: true, status: true } },
    },
  });
  if (!rp || rp.companyId !== company.id) notFound();

  const applied = rp.applications.reduce((s, a) => s + a.amount, 0);
  const unapplied = unappliedOf(rp);
  const canEdit = user.perm === "READ_WRITE";
  const isApprover = canEdit && canApprovePayments(user);
  const audit = await getAuditTrail("ReceivePayment", rp.id, 30);
  // for applying leftover credit: which of this customer's invoices still owe money
  const openInvoices = rp.status === "Posted" && unapplied > 0.005 && canEdit
    ? await getOutstandingInvoices(rp.customerId, company.id)
    : [];

  return (
    <div className="max-w-5xl">
      <div className="mb-3 flex items-center justify-between">
        <Link href="/payments" className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
          ← Back to Receive Payments
        </Link>
        <Link href={`/payments/${rp.id}/print`} className="btn-secondary">🖨 Receipt / PDF</Link>
      </div>
      <PageHeader title={`${rp.prNumber} — ${rp.customer.businessName}`}>
        <StatusBadge status={rp.status} />
      </PageHeader>

      {searchParams.error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <span className="font-semibold">⚠</span> {searchParams.error}
        </p>
      )}

      <div className="card mb-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-3">
        <div><p className="text-xs text-gray-500">Company</p><p className="font-semibold">{company.companyName}</p></div>
        <div><p className="text-xs text-gray-500">Payment Date</p><p className="font-semibold">{fmtDate(rp.date)}</p></div>
        <div><p className="text-xs text-gray-500">Method</p><p className="font-semibold">{rp.method}{rp.checkNo ? ` · Check ${rp.checkNo}${rp.checkDate ? ` dtd ${fmtDate(rp.checkDate)}` : ""}` : ""}</p></div>
        <div><p className="text-xs text-gray-500">Cash/Bank Account</p><p className="font-semibold">{rp.cashAccount ? `${rp.cashAccount.name} (${rp.cashAccount.type})` : "—"}</p></div>
        <div><p className="text-xs text-gray-500">Reference #</p><p className="font-semibold">{rp.refNo ?? "—"}</p></div>
        <div><p className="text-xs text-gray-500">Received By</p><p className="font-semibold">{rp.receivedBy?.name ?? "—"}</p></div>
        <div><p className="text-xs text-gray-500">Payment Amount</p><p className="text-lg font-bold text-emerald-800">{peso(rp.amount)}</p></div>
        <div><p className="text-xs text-gray-500">Applied</p><p className="text-lg font-bold">{peso(applied)}</p></div>
        <div><p className="text-xs text-gray-500">Unapplied (credit)</p><p className={`text-lg font-bold ${unapplied > 0.005 ? "text-amber-700" : ""}`}>{peso(unapplied)}</p></div>
        {rp.remarks && <div className="col-span-2 md:col-span-3"><p className="text-xs text-gray-500">Remarks</p><p>{rp.remarks}</p></div>}
        {rp.voidReason && <div className="col-span-2 md:col-span-3"><p className="text-xs text-gray-500">Void Reason</p><p className="text-red-600">{rp.voidReason}</p></div>}
      </div>

      <h2 className="mb-2 font-semibold">Applied to Invoices</h2>
      <div className="card mb-4 overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Invoice</th>
              <th className="table-th text-right">Invoice Amount</th>
              <th className="table-th text-right">Amount Applied</th>
              <th className="table-th">Invoice Status</th>
              <th className="table-th">Applied On</th>
              {isApprover && rp.status === "Posted" && <th className="table-th" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rp.applications.map((a) => (
              <tr key={a.id}>
                <td className="table-td">
                  <Link href={`/invoices/${a.salesReceipt.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">
                    {a.salesReceipt.srNumber}
                  </Link>
                </td>
                <td className="table-td text-right">{peso(a.salesReceipt.amount)}</td>
                <td className="table-td text-right font-semibold">{peso(a.amount)}</td>
                <td className="table-td"><StatusBadge status={a.salesReceipt.status} /></td>
                <td className="table-td text-xs text-gray-500">{fmtDateTime(a.createdAt)}</td>
                {isApprover && rp.status === "Posted" && (
                  <td className="table-td text-right">
                    <form action={unapplyAction}>
                      <input type="hidden" name="id" value={rp.id} />
                      <input type="hidden" name="applicationId" value={a.id} />
                      <button className="text-xs text-red-500 hover:underline" type="submit">unapply</button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
            {!rp.applications.length && (
              <tr><td colSpan={6} className="p-6 text-center text-sm text-gray-500">Nothing applied — the full amount is customer credit.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* apply leftover credit to another open invoice */}
      {rp.status === "Posted" && unapplied > 0.005 && canEdit && (
        <form action={applyCreditAction} className="card mb-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={rp.id} />
          <div className="min-w-[260px]">
            <label className="label">Apply credit to invoice</label>
            <select name="invoiceId" className="input" required>
              <option value="">— pick an open invoice —</option>
              {openInvoices.map((i) => (
                <option key={i.id} value={i.id}>{i.srNumber} · balance {peso(i.outstanding)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Amount (max {peso(unapplied)})</label>
            <input name="amount" type="number" min={0.01} max={unapplied} step="0.01" required className="input w-36" />
          </div>
          <button className="btn-primary" type="submit">Apply Credit</button>
          {!openInvoices.length && <p className="pb-2 text-xs text-gray-500">No open invoices right now — the credit waits for the next one.</p>}
        </form>
      )}

      {/* workflow */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {canEdit && rp.status === "Draft" && (
          <>
            <Link href={`/payments/${rp.id}/edit`} className="btn-secondary">✏ Edit Draft</Link>
            <form action={submitForApproval}><input type="hidden" name="id" value={rp.id} /><button className="btn-primary" type="submit">Submit for Approval</button></form>
          </>
        )}
        {isApprover && (rp.status === "Draft" || rp.status === "Pending Approval") && (
          <form action={approveAndPost}><input type="hidden" name="id" value={rp.id} /><button className="btn-primary" type="submit">✔ Approve &amp; Post</button></form>
        )}
        {canEdit && (rp.status === "Draft" || (rp.status === "Pending Approval" && isApprover)) && (
          <form action={cancelReceivePayment}><input type="hidden" name="id" value={rp.id} /><button className="btn-secondary" type="submit">Cancel</button></form>
        )}
        {isApprover && rp.status === "Posted" && (
          <form action={voidPayment} className="flex items-center gap-2">
            <input type="hidden" name="id" value={rp.id} />
            <input name="reason" placeholder="void reason" required className="input w-52" />
            <button className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50" type="submit">Void Payment</button>
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
