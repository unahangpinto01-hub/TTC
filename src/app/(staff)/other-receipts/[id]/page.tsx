import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { canApprovePayments } from "@/lib/receive-payments";
import { getAuditTrail } from "@/lib/salespeople";
import { submitOtherReceipt, approveAndPostOtherReceipt, cancelOtherReceipt, voidOtherReceiptAction } from "../actions";

export default async function OtherReceiptDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
  const user = await requirePerm("otherReceipts");
  const company = await getActiveCompany(user);
  const r = await prisma.otherReceipt.findUnique({
    where: { id: params.id },
    include: {
      employee: { select: { id: true, name: true, position: true } },
      cashAccount: { select: { name: true, type: true, glAccount: { select: { code: true, description: true } } } },
      receivedBy: { select: { name: true } },
      lines: { include: { glAccount: { select: { code: true, description: true } } }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!r || r.companyId !== company.id) notFound();
  const canEdit = user.perm === "READ_WRITE";
  const isApprover = canEdit && canApprovePayments(user);
  const audit = await getAuditTrail("OtherReceipt", r.id, 30);
  const bank = r.cashAccount ? (r.cashAccount.glAccount ? `${r.cashAccount.glAccount.code} ${r.cashAccount.glAccount.description}` : r.cashAccount.name) : "Cash in Bank (account not picked)";

  return (
    <div className="max-w-5xl">
      <div className="mb-3 flex items-center justify-between">
        <Link href="/other-receipts" className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">← Back to Other Receipts</Link>
        <Link href={`/other-receipts/${r.id}/print`} className="btn-secondary">🖨 Receipt / PDF</Link>
      </div>
      <PageHeader title={`${r.crNumber} — ${r.payor}`}>
        <StatusBadge status={r.status} />
      </PageHeader>

      {searchParams.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">⚠</span> {searchParams.error}</p>}

      <div className="card mb-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-3">
        <div><p className="text-xs text-gray-500">Company</p><p className="font-semibold">{company.companyName}</p></div>
        <div><p className="text-xs text-gray-500">Receipt Date</p><p className="font-semibold">{fmtDate(r.date)}</p></div>
        <div><p className="text-xs text-gray-500">Method</p><p className="font-semibold">{r.method}{r.checkNo ? ` · Check ${r.checkNo}${r.checkDate ? ` dtd ${fmtDate(r.checkDate)}` : ""}` : ""}</p></div>
        <div><p className="text-xs text-gray-500">Payor</p><p className="font-semibold">{r.payor}</p>{r.employee && <p className="text-xs text-gray-500">employee · {r.employee.position}</p>}</div>
        <div><p className="text-xs text-gray-500">Cash/Bank Account</p><p className="font-semibold">{r.cashAccount ? `${r.cashAccount.name} (${r.cashAccount.type})` : "—"}</p></div>
        <div><p className="text-xs text-gray-500">Reference #</p><p className="font-semibold">{r.refNo ?? "—"}</p></div>
        <div><p className="text-xs text-gray-500">Amount Received</p><p className="text-lg font-bold text-emerald-800">{peso(r.amount)}</p></div>
        <div><p className="text-xs text-gray-500">Received By</p><p className="font-semibold">{r.receivedBy?.name ?? "—"}</p></div>
        <div><p className="text-xs text-gray-500">Posted</p><p className="font-semibold">{r.postedAt ? fmtDateTime(r.postedAt) : "—"}</p></div>
        {r.remarks && <div className="col-span-2 md:col-span-3"><p className="text-xs text-gray-500">Remarks</p><p>{r.remarks}</p></div>}
        {r.voidReason && <div className="col-span-2 md:col-span-3"><p className="text-xs text-gray-500">Void Reason</p><p className="text-red-600">{r.voidReason}</p></div>}
      </div>

      <h2 className="mb-2 font-semibold">Entry</h2>
      <div className="card mb-4 overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr><th className="table-th">Account</th><th className="table-th">Particulars</th><th className="table-th text-right">Debit</th><th className="table-th text-right">Credit</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr><td className="table-td font-medium">{bank}</td><td className="table-td text-xs text-gray-600">money received from {r.payor}</td><td className="table-td text-right font-semibold">{peso(r.amount)}</td><td className="table-td text-right text-gray-300">—</td></tr>
            {r.lines.map((l) => (
              <tr key={l.id}><td className="table-td pl-8">{l.glAccount.code} {l.glAccount.description}</td><td className="table-td text-xs text-gray-600">{l.description}</td><td className="table-td text-right text-gray-300">—</td><td className="table-td text-right font-semibold">{peso(l.amount)}</td></tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
            <tr><td className="table-td" colSpan={2}>TOTAL</td><td className="table-td text-right">{peso(r.amount)}</td><td className="table-td text-right">{peso(r.lines.reduce((s, l) => s + l.amount, 0))}</td></tr>
          </tfoot>
        </table>
      </div>
      {r.status !== "Posted" && r.status !== "Void" && <p className="mb-4 text-xs text-gray-500">Nothing is booked until this receipt is approved and posted.</p>}

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {canEdit && r.status === "Draft" && (
          <>
            <Link href={`/other-receipts/${r.id}/edit`} className="btn-secondary">✏ Edit Draft</Link>
            <form action={submitOtherReceipt}><input type="hidden" name="id" value={r.id} /><button className="btn-primary" type="submit">Submit for Approval</button></form>
          </>
        )}
        {isApprover && (r.status === "Draft" || r.status === "Pending Approval") && (
          <form action={approveAndPostOtherReceipt}><input type="hidden" name="id" value={r.id} /><button className="btn-primary" type="submit">✔ Approve &amp; Post</button></form>
        )}
        {canEdit && (r.status === "Draft" || (r.status === "Pending Approval" && isApprover)) && (
          <form action={cancelOtherReceipt}><input type="hidden" name="id" value={r.id} /><button className="btn-secondary" type="submit">Cancel</button></form>
        )}
        {isApprover && r.status === "Posted" && (
          <form action={voidOtherReceiptAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={r.id} />
            <input name="reason" placeholder="void reason" required minLength={5} className="input w-52" />
            <button className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50" type="submit">Void Receipt</button>
          </form>
        )}
      </div>

      {audit.length > 0 && (
        <>
          <h2 className="mb-2 font-semibold">Audit Trail</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50"><tr><th className="table-th">When</th><th className="table-th">Action</th><th className="table-th">Detail</th><th className="table-th">By</th></tr></thead>
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
