import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { getAuditTrail } from "@/lib/salespeople";
import { OPEN_BILL_STATUSES, outstandingOf } from "@/lib/bills";
import { availableForVoucher, accountingLines, amountInWords, dvEditBlocker } from "@/lib/dv";
import { DvAllocations, type OpenBillRow } from "./dv-allocations";
import { saveDV, advanceDV, noteDV, voidDV } from "../actions";

const ERRORS: Record<string, string> = {
  locked: "This voucher can only be changed while it is a Draft.",
  bill: "A bill on this voucher is not this payee's, or is not open.",
  over: "An allocation is more than the bill has available (its outstanding balance less what other vouchers already authorise).",
  step: "That step is not next in the approval chain.",
  empty: "Allocate at least one bill before moving the voucher on.",
  samecheck: "The person who prepared a voucher cannot also check it.",
  paid: "A voucher with a payment against it cannot be voided — reverse the payment first.",
  reason: "Give a reason for voiding (at least 5 characters).",
};
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default async function DvDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; saved?: string; bill?: string } }) {
  const user = await requirePerm("dv");
  const company = await getActiveCompany(user);
  const dv = await prisma.disbursementVoucher.findUnique({
    where: { id: params.id },
    include: {
      supplier: true,
      company: { select: { companyName: true, glPayables: { select: { code: true, description: true } } } },
      bills: { include: { bill: { select: { id: true, billNo: true, kind: true, billDate: true, dueDate: true, supplierInvoiceNo: true, total: true, paidAmount: true, status: true, supplier: { select: { name: true } } } } } },
      preparedBy: { select: { name: true } }, checkedBy: { select: { name: true } }, approvedBy: { select: { name: true } },
      notedBy: { select: { name: true } }, postedBy: { select: { name: true } }, voidedBy: { select: { name: true } },
      payments: { include: { cashAccount: { include: { glAccount: { select: { code: true, description: true } } } } }, orderBy: { date: "asc" } },
    },
  });
  if (!dv || dv.companyId !== company.id) notFound();
  const audit = await getAuditTrail("DisbursementVoucher", params.id, 40);
  const canWrite = user.perm === "READ_WRITE";
  const canEdit = canWrite && !dvEditBlocker(dv);
  const isAdmin = ["SUPER_ADMIN", "ADMIN"].includes(user.role);

  // the payee's open bills, with what is available to this voucher
  const openBills = canEdit
    ? await prisma.supplierBill.findMany({
        where: { companyId: company.id, supplierId: dv.supplierId, status: { in: OPEN_BILL_STATUSES } },
        select: { id: true, billNo: true, kind: true, billDate: true, dueDate: true, supplierInvoiceNo: true, total: true, paidAmount: true, status: true },
        orderBy: [{ dueDate: "asc" }],
      })
    : dv.bills.map((b) => ({ ...b.bill }));
  const rows: OpenBillRow[] = [];
  for (const b of openBills) {
    const a = await availableForVoucher(b.id, dv.id);
    rows.push({
      billId: b.id, billNo: b.billNo, kind: b.kind, billDate: fmtDate(b.billDate), dueDate: fmtDate(b.dueDate), supplierInvoiceNo: b.supplierInvoiceNo,
      total: b.total, outstanding: outstandingOf(b), onOtherVouchers: a.onOtherVouchers, available: a.available,
      allocated: dv.bills.find((x) => x.billId === b.id)?.amount ?? 0,
    });
  }
  const lines = accountingLines({ ...dv, payments: dv.payments.filter((p) => p.status === "Posted") });
  const next: Record<string, { to: string; label: string; admin?: boolean }> = {
    Draft: { to: "Prepared", label: "✔ Mark Prepared" },
    Prepared: { to: "Checked", label: "✔ Mark Checked" },
    Checked: { to: "Approved", label: "✔ Approve", admin: true },
    Approved: { to: "Posted", label: "📌 Post — authorise payment", admin: true },
  };
  const step = next[dv.status];

  return (
    <div>
      <Link href="/dv" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">← Back to Disbursement Vouchers</Link>
      <PageHeader title={`Disbursement Voucher ${dv.dvNo}`}>
        <StatusBadge status={dv.status} />
        <Link href={`/dv/${dv.id}/print`} className="btn-secondary">🖨 Print DV</Link>
      </PageHeader>

      {searchParams.error && ERRORS[searchParams.error] && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">⚠</span> {ERRORS[searchParams.error]}{searchParams.bill ? ` (${searchParams.bill})` : ""}</p>}
      {searchParams.saved === "ok" && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✔ Saved.</p>}
      {dv.status === "Void" && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Voided by {dv.voidedBy?.name ?? "—"} · {fmtDateTime(dv.voidedAt)}: {dv.voidReason}</p>}
      {dv.status === "Posted" && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Payment of {peso(dv.amount)} to {dv.payee} is authorised. The supplier is paid when a Payment is recorded against this voucher.</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div className="card py-3"><p className="text-xs text-gray-500">Payee</p><p className="font-semibold">{dv.payee}</p><p className="text-xs text-gray-500">{dv.supplier.name}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Amount authorised</p><p className="font-semibold">{peso(dv.amount)}</p><p className="text-xs text-gray-500">{dv.bills.length} bill(s)</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Paid so far</p><p className={`font-semibold ${dv.paidAmount ? "text-emerald-700" : ""}`}>{peso(dv.paidAmount)}</p><p className="text-xs text-gray-500">{dv.amount - dv.paidAmount > 0.005 ? `${peso(dv.amount - dv.paidAmount)} to pay` : dv.amount ? "fully paid" : ""}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Date / Terms</p><p className="font-semibold">{fmtDate(dv.date)}</p><p className="text-xs text-gray-500">{dv.terms ?? "—"}{dv.padRef ? ` · pad DVN ${dv.padRef}` : ""}</p></div>
      </div>

      <form action={saveDV} className="card mb-4 space-y-4">
        <input type="hidden" name="id" value={dv.id} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2"><label className="label">Payee (as printed)</label><input name="payee" defaultValue={dv.payee} disabled={!canEdit} className="input" /></div>
          <div><label className="label">Date</label><input name="date" type="date" defaultValue={ymd(dv.date)} disabled={!canEdit} className="input" /></div>
          <div><label className="label">Terms</label><input name="terms" defaultValue={dv.terms ?? ""} disabled={!canEdit} className="input" placeholder="e.g. 30 days, COD" /></div>
          <div className="sm:col-span-2 lg:col-span-3"><label className="label">Particulars</label><textarea name="particulars" defaultValue={dv.particulars} disabled={!canEdit} rows={3} className="input" placeholder="what this payment is for, as it should read on the voucher" /></div>
          <div><label className="label">Pad DVN <span className="font-normal text-gray-400">(if stamped)</span></label><input name="padRef" defaultValue={dv.padRef ?? ""} disabled={!canEdit} className="input" placeholder="e.g. 24251" /></div>
          <div className="sm:col-span-2 lg:col-span-4"><label className="label">Memo (internal)</label><input name="memo" defaultValue={dv.memo ?? ""} disabled={!canEdit} className="input" /></div>
        </div>
        <div>
          <p className="mb-1 text-sm font-semibold">Bills this voucher pays</p>
          <DvAllocations rows={rows} canEdit={canEdit} />
        </div>
        {canEdit && <div className="flex items-center gap-3"><button className="btn-primary" type="submit">💾 Save Voucher</button><p className="text-xs text-gray-500">Allocations are checked against each bill&rsquo;s available balance so no peso is authorised twice.</p></div>}
      </form>

      {dv.payments.length > 0 && (
        <div className="card mb-4 text-sm">
          <p className="mb-1 font-semibold">Payments</p>
          {dv.payments.map((p) => (
            <p key={p.id} className={`text-xs ${p.status === "Void" ? "line-through opacity-60" : ""}`}>
              <Link href={`/payments/bills/${p.id}`} className="font-mono font-semibold text-emerald-700 hover:underline">{p.paymentNo}</Link> · {fmtDate(p.date)} · {p.cashAccount.name} · {p.method}{p.checkNo ? ` #${p.checkNo}` : ""} · {peso(p.amount)}{p.status === "Void" ? " · VOID" : ""}
            </p>
          ))}
        </div>
      )}

      <div className="card mb-4">
        <p className="mb-2 text-sm font-semibold">Account Title / Debit (Credit) <span className="font-normal text-gray-500">— generated from the bills, not typed</span></p>
        <table className="w-full max-w-2xl text-sm">
          <thead><tr className="border-b border-gray-200 text-left text-xs text-gray-500"><th className="py-1">Account Title</th><th className="py-1">Ref</th><th className="py-1 text-right">Debit</th><th className="py-1 text-right">(Credit)</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {lines.map((l, i) => (
              <tr key={i}><td className="py-1">{l.title}</td><td className="py-1 font-mono text-xs text-gray-500">{l.ref}</td><td className="py-1 text-right">{l.debit ? peso(l.debit) : ""}</td><td className="py-1 text-right">{l.credit ? `(${peso(l.credit)})` : ""}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      {canWrite && dv.status !== "Void" && !["Paid", "Partially Paid"].includes(dv.status) && (
        <div className="card mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Workflow:</span>
          {step && (step.admin && !isAdmin ? (
            <span className="text-sm text-gray-500">Waiting for an Admin to {step.to === "Posted" ? "post" : "approve"} this voucher.</span>
          ) : (
            <form action={advanceDV}><input type="hidden" name="id" value={dv.id} /><input type="hidden" name="to" value={step.to} /><button className="btn-primary" type="submit">{step.label}</button></form>
          ))}
          {["Prepared", "Checked", "Approved"].includes(dv.status) && (
            <form action={advanceDV}><input type="hidden" name="id" value={dv.id} /><input type="hidden" name="to" value="Draft" /><button className="text-sm text-gray-500 hover:underline" type="submit">← back to Draft</button></form>
          )}
          {isAdmin && !dv.notedById && (
            <form action={noteDV}><input type="hidden" name="id" value={dv.id} /><button className="btn-secondary" type="submit">Noted by me</button></form>
          )}
          {dv.status === "Posted" && (
            <Link href={`/payments/bills/new?dv=${dv.id}`} className="btn-primary ml-auto">💸 Record Payment</Link>
          )}
          {isAdmin && (
            <form action={voidDV} className="ml-auto flex gap-2">
              <input type="hidden" name="id" value={dv.id} />
              <input name="voidReason" placeholder="reason to void" required minLength={5} className="input w-52 py-1 text-sm" />
              <button className="text-sm font-medium text-red-600 hover:underline" type="submit">Void</button>
            </form>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card text-sm">
          <p className="mb-2 font-semibold">Signatures</p>
          <dl className="space-y-1">
            {([
              ["Prepared by", dv.preparedAt ? `${dv.preparedBy?.name ?? "—"} · ${fmtDateTime(dv.preparedAt)}` : dv.preparedBy?.name ?? "—"],
              ["Checked by", dv.checkedAt ? `${dv.checkedBy?.name ?? "—"} · ${fmtDateTime(dv.checkedAt)}` : "—"],
              ["Approved by", dv.approvedAt ? `${dv.approvedBy?.name ?? "—"} · ${fmtDateTime(dv.approvedAt)}` : "—"],
              ["Noted by", dv.notedAt ? `${dv.notedBy?.name ?? "—"} · ${fmtDateTime(dv.notedAt)}` : "—"],
              ["Posted by", dv.postedAt ? `${dv.postedBy?.name ?? "—"} · ${fmtDateTime(dv.postedAt)}` : "—"],
              ["Amount in words", amountInWords(dv.amount)],
              ["Company", dv.company.companyName],
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
