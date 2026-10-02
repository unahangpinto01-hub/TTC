import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { canApprovePayments } from "@/lib/receive-payments";
import { createTransfer, submitTransfer, postTransfer, cancelTransfer, voidTransfer } from "./actions";

/** Money moved between the company's own cash/bank accounts: deposit cash on hand to a
    bank, draw petty cash, or shift between banks. One account down, the other up — both
    only when Posted, with the same draft → approval discipline as every money document. */
export default async function TransfersPage({ searchParams }: { searchParams: { error?: string } }) {
  const user = await requirePerm("receivePayments");
  const company = await getActiveCompany(user);
  const [transfers, accounts] = await Promise.all([
    prisma.accountTransfer.findMany({
      where: { companyId: company.id },
      include: {
        fromAccount: { select: { name: true } },
        toAccount: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.cashAccount.findMany({ where: { companyId: company.id, status: "Active" }, orderBy: { name: "asc" } }),
  ]);
  const canEdit = user.perm === "READ_WRITE";
  const isApprover = canEdit && canApprovePayments(user);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader title={`Account Transfers — ${company.companyName}`} />
      {searchParams.error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">⚠</span> {searchParams.error}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[760px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="table-th">TR No.</th>
                  <th className="table-th">Date</th>
                  <th className="table-th">From → To</th>
                  <th className="table-th text-right">Amount</th>
                  <th className="table-th">Status</th>
                  <th className="table-th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transfers.map((t) => (
                  <tr key={t.id} className={["Void", "Cancelled"].includes(t.status) ? "opacity-50" : ""}>
                    <td className="table-td">
                      <span className="font-mono text-xs font-semibold">{t.trNumber}</span>
                      <span className="block text-[10px] text-gray-400">{t.refNo ?? ""}</span>
                    </td>
                    <td className="table-td whitespace-nowrap text-sm">{fmtDate(t.date)}</td>
                    <td className="table-td text-sm">
                      {t.fromAccount.name} <span className="text-gray-400">→</span> {t.toAccount.name}
                      <span className="block text-xs text-gray-400" title={t.voidReason ?? undefined}>
                        {t.remarks}{t.voidReason ? ` · void: ${t.voidReason}` : ""}
                      </span>
                    </td>
                    <td className="table-td text-right font-semibold">{peso(t.amount)}</td>
                    <td className="table-td"><StatusBadge status={t.status} /></td>
                    <td className="table-td">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {canEdit && t.status === "Draft" && (
                          <form action={submitTransfer}><input type="hidden" name="id" value={t.id} /><button className="text-xs font-medium text-emerald-700 hover:underline" type="submit">submit</button></form>
                        )}
                        {isApprover && (t.status === "Draft" || t.status === "Pending Approval") && (
                          <form action={postTransfer}><input type="hidden" name="id" value={t.id} /><button className="text-xs font-medium text-emerald-700 hover:underline" type="submit">✔ post</button></form>
                        )}
                        {canEdit && (t.status === "Draft" || (t.status === "Pending Approval" && isApprover)) && (
                          <form action={cancelTransfer}><input type="hidden" name="id" value={t.id} /><button className="text-xs text-gray-500 hover:underline" type="submit">cancel</button></form>
                        )}
                        {isApprover && t.status === "Posted" && (
                          <form action={voidTransfer} className="flex items-center gap-1">
                            <input type="hidden" name="id" value={t.id} />
                            <input name="reason" placeholder="void reason" className="input w-28 px-1.5 py-0.5 text-xs" />
                            <button className="text-xs text-red-500 hover:underline" type="submit">void</button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!transfers.length && (
                  <tr><td colSpan={6} className="p-8 text-center text-sm text-gray-500">No transfers yet — e.g. deposit collected cash into a bank account.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            A Posted transfer lowers the From account and raises the To account on the Cash / Bank Accounts
            register. Voiding puts both back. Every action is recorded in the audit trail.
          </p>
        </div>

        {canEdit && (
          <form action={createTransfer} className="card h-fit space-y-3">
            <h2 className="font-semibold">New Transfer</h2>
            <div><label className="label">Date</label><input name="date" type="date" defaultValue={today} max={today} required className="input" /></div>
            <div>
              <label className="label">From Account</label>
              <select name="fromAccountId" required className="input">
                <option value="">— pick —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
              </select>
            </div>
            <div>
              <label className="label">To Account</label>
              <select name="toAccountId" required className="input">
                <option value="">— pick —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
              </select>
            </div>
            <div><label className="label">Amount (₱)</label><input name="amount" type="number" min="0.01" step="0.01" required className="input font-semibold" /></div>
            <div><label className="label">Reference # (deposit/withdrawal slip)</label><input name="refNo" className="input" /></div>
            <div><label className="label">Remarks (required)</label><input name="remarks" required className="input" placeholder="e.g. deposit of cash collections" /></div>
            <button className="btn-primary" type="submit">Save as Draft</button>
            {accounts.length < 2 && <p className="text-xs text-amber-700">A transfer needs at least two active accounts — add them under Cash / Bank Accounts.</p>}
          </form>
        )}
      </div>
    </div>
  );
}
