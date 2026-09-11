import Link from "next/link";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { getPerm } from "@/lib/permissions";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { getAuditTrail } from "@/lib/salespeople";
import { checkVoucherDate, periodLabel, periodOf } from "@/lib/vouchers";
import { TERMS, postBlockers, billEditBlocker, billVoidBlocker, outstandingOf } from "@/lib/bills";
import { ExpenseEditor } from "./expense-editor";
import { saveExpenseBill, postBill, voidBill } from "../actions";

const ERRORS: Record<string, string> = {
  locked: "This bill is no longer editable — only a Draft can be changed.",
  supplier: "That supplier could not be found.",
  account: "A line names an account that is not in the Chart of Accounts, or is inactive.",
  blocked: "The bill cannot be posted yet — see the reasons listed below.",
  period: "The bill is dated in a locked accounting period. Posting there needs Prior-Period Adjustment permission.",
  reason: "Posting into a locked period needs a reason (at least 5 characters).",
  voidblocked: "This bill cannot be voided — it is already void, or a payment has been made against it.",
  voidreason: "Give a reason for voiding (at least 5 characters).",
};
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Bill = NonNullable<Awaited<ReturnType<typeof loadExpenseBill>>>;
export async function loadExpenseBill(id: string) {
  return prisma.supplierBill.findUnique({
    where: { id },
    include: {
      supplier: true,
      createdBy: { select: { name: true } },
      postedBy: { select: { name: true } },
      voidedBy: { select: { name: true } },
      expenseLines: { include: { glAccount: { select: { code: true, description: true } } }, orderBy: { id: "asc" } },
    },
  });
}

/** The page for a non-inventory bill: accounts and amounts, no stock, no receipt. */
export async function ExpenseBillDetail({ bill, user, companyName, searchParams }: {
  bill: Bill; user: SessionUser & { perm: string }; companyName: string; searchParams: { error?: string; saved?: string; posted?: string };
}) {
  const audit = await getAuditTrail("SupplierBill", bill.id, 40);
  const canWrite = user.perm === "READ_WRITE";
  const canEdit = canWrite && !billEditBlocker(bill);
  const canApprove = canWrite && ["SUPER_ADMIN", "ADMIN"].includes(user.role);
  const isDraft = bill.status === "Draft";
  const blockers = isDraft ? await postBlockers({ ...bill, lines: [] }, undefined, bill.expenseLines) : [];
  const period = periodOf(bill.billDate);
  const periodCheck = isDraft
    ? await checkVoucherDate({ companyId: bill.companyId, voucherDate: bill.billDate, canPriorPeriod: getPerm(user, "priorPeriod") !== "NONE", noun: "bill" })
    : null;
  const voidBlocker = billVoidBlocker(bill);
  const outstanding = outstandingOf(bill);

  return (
    <div>
      <Link href="/bills/expense" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">← Back to Non-Inventory Bills</Link>
      <PageHeader title={`Bill ${bill.billNo}`}>
        <StatusBadge status={bill.status} />
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">Non-inventory</span>
        <Link href={`/bills/${bill.id}/print`} className="btn-secondary">🖨 Print Bill</Link>
      </PageHeader>

      {searchParams.error && ERRORS[searchParams.error] && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">⚠</span> {ERRORS[searchParams.error]}</p>}
      {searchParams.saved === "ok" && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✔ Saved. Nothing is booked until this bill is posted.</p>}
      {searchParams.posted === "ok" && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✔ Posted. {peso(bill.total)} is now payable to {bill.supplier.name}, due {fmtDate(bill.dueDate)}.</p>}
      {bill.status === "Void" && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Voided by {bill.voidedBy?.name ?? "—"} · {fmtDateTime(bill.voidedAt)}: {bill.voidReason}</p>}
      {bill.periodReason && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"><span className="font-semibold">Prior-period adjustment:</span> {bill.periodReason}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div className="card py-3"><p className="text-xs text-gray-500">Supplier / Payee</p><p className="font-semibold">{bill.supplier.name}</p><p className="text-xs text-gray-500">{bill.supplierInvoiceNo ? `Invoice ${bill.supplierInvoiceNo}` : bill.invoiceUnavailable ? "invoice no. not available" : "no invoice no. yet"}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Charged to</p><p className="text-sm font-semibold">{[...new Set(bill.expenseLines.map((l) => l.glAccount.description))].join(", ") || "—"}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Total payable</p><p className="font-semibold">{peso(bill.total)}</p><p className="text-xs text-gray-500">ex-VAT {peso(bill.subtotal)}{bill.inputVat ? ` · VAT ${peso(bill.inputVat)}` : ""}</p></div>
        <div className="card py-3">
          <p className="text-xs text-gray-500">{isDraft || bill.status === "Void" ? "Due" : "Outstanding"}</p>
          <p className={`font-semibold ${outstanding ? "text-red-600" : ""}`}>{isDraft || bill.status === "Void" ? fmtDate(bill.dueDate) : peso(outstanding)}</p>
          <p className="text-xs text-gray-500">{isDraft || bill.status === "Void" ? bill.terms : `paid ${peso(bill.paidAmount)} · due ${fmtDate(bill.dueDate)}`}</p>
        </div>
      </div>

      <form action={saveExpenseBill} className="card mb-4 space-y-4">
        <input type="hidden" name="id" value={bill.id} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="label">Supplier / Payee</label>
            {canEdit ? <SearchSelect entity="suppliers" name="supplierId" defaultValue={{ id: bill.supplierId, label: bill.supplier.name }} placeholder="Type supplier name…" /> : <input value={bill.supplier.name} disabled className="input" />}
          </div>
          <div>
            <label className="label">Supplier Invoice / Reference No.</label>
            <input name="supplierInvoiceNo" defaultValue={bill.supplierInvoiceNo ?? ""} disabled={!canEdit} className="input" />
            <label className="mt-1 flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" name="invoiceUnavailable" defaultChecked={bill.invoiceUnavailable} disabled={!canEdit} /> not available</label>
          </div>
          <div>
            <label className="label">Bill Date</label>
            <input name="billDate" type="date" defaultValue={ymd(bill.billDate)} disabled={!canEdit} className="input" />
            <p className="mt-0.5 text-[11px] text-gray-400">period {periodLabel(period.year, period.month)}</p>
          </div>
          <div><label className="label">Terms</label><select name="terms" defaultValue={bill.terms} disabled={!canEdit} className="input">{TERMS.map((t) => <option key={t}>{t}</option>)}</select></div>
          <div><label className="label">Due Date</label><input name="dueDate" type="date" defaultValue={ymd(bill.dueDate)} disabled={!canEdit} className="input" /></div>
          <div className="sm:col-span-2"><label className="label">Memo / Remarks</label><input name="memo" defaultValue={bill.memo ?? ""} disabled={!canEdit} className="input" /></div>
        </div>

        <ExpenseEditor
          lines={bill.expenseLines.map((l) => ({ id: l.id, glAccountId: l.glAccountId, account: `${l.glAccount.code} ${l.glAccount.description}`, description: l.description, amount: l.amount }))}
          canEdit={canEdit}
          applyVat={bill.vatRate > 0}
        />

        {canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary" type="submit">💾 Save Bill</button>
            <p className="text-xs text-gray-500">Saving keeps the bill a Draft. Every change is written to the audit trail.</p>
          </div>
        )}
      </form>

      {isDraft && canWrite && (
        <div className="card mb-4">
          <p className="mb-2 text-sm font-semibold">Post this bill</p>
          {blockers.length > 0 ? (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"><p className="font-semibold">Not ready to post:</p><ul className="mt-1 list-inside list-disc text-xs">{blockers.map((b) => <li key={b}>{b}</li>)}</ul></div>
          ) : !canApprove ? (
            <p className="text-sm text-gray-500">Ready. Waiting for an Admin to post it.</p>
          ) : periodCheck && !periodCheck.ok ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{periodCheck.why}</p>
          ) : (
            <form action={postBill} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={bill.id} />
              {periodCheck?.reasonRequired && (
                <div className="w-full max-w-lg"><p className="mb-1 text-xs text-amber-700">{periodCheck.why}</p><input name="periodReason" placeholder="reason for posting into a locked period" required minLength={5} className="input" /></div>
              )}
              <button className="btn-primary" type="submit">📒 Post — expense booked, payable up</button>
              <p className="text-xs text-gray-500">
                {bill.expenseLines.map((l) => `Dr ${l.glAccount.description} ${peso(l.amount)}`).join(" · ")}{bill.inputVat ? ` · Dr Input VAT ${peso(bill.inputVat)}` : ""} · Cr Accounts Payable {peso(bill.total)}.
              </p>
            </form>
          )}
        </div>
      )}

      {canApprove && bill.status !== "Void" && (
        <form action={voidBill} className="card mb-4 flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={bill.id} />
          <span className="text-sm font-semibold">{isDraft ? "Void draft" : "Void / reverse"}</span>
          {voidBlocker ? <span className="text-xs text-gray-500">{voidBlocker}</span> : (
            <>
              <input name="voidReason" placeholder="reason (required)" required minLength={5} className="input w-64 py-1 text-sm" />
              <button className="text-sm font-medium text-red-600 hover:underline" type="submit">{isDraft ? "Void" : "Reverse this bill"}</button>
              {!isDraft && <span className="text-xs text-gray-500">Cancels the payable and the expense. You will be asked to sign in again.</span>}
            </>
          )}
        </form>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card text-sm">
          <p className="mb-2 font-semibold">Document</p>
          <dl className="space-y-1">
            {([
              ["Company", companyName],
              ["Created by", `${bill.createdBy?.name ?? "—"} · ${fmtDateTime(bill.createdAt)}`],
              ["Last modified", fmtDateTime(bill.updatedAt)],
              ["Posted by", bill.postedAt ? `${bill.postedBy?.name ?? "—"} · ${fmtDateTime(bill.postedAt)}` : "not posted"],
              ["Accounting period", bill.postedAt ? periodLabel(bill.accountingYear, bill.accountingMonth) : `${periodLabel(period.year, period.month)} (on posting)`],
              ["Memo", bill.memo ?? "—"],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-dotted border-gray-200 py-1"><dt className="text-gray-500">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
            ))}
          </dl>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">Audit Trail</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50"><tr><th className="table-th">When</th><th className="table-th">Action</th><th className="table-th">By</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {audit.map((a) => (
                  <tr key={a.id}><td className="table-td whitespace-nowrap text-xs text-gray-600">{fmtDateTime(a.createdAt)}</td><td className="table-td text-sm"><span className="font-medium">{a.action.replaceAll("_", " ")}</span><p className="text-xs text-gray-500">{a.detail}</p></td><td className="table-td text-xs text-gray-500">{a.actorName}</td></tr>
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
