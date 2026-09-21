import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { getAuditTrail } from "@/lib/salespeople";
import { OPEN_BILL_STATUSES, outstandingOf } from "@/lib/bills";
import { availableForVoucher, voucherLines, amountInWords, dvEditBlocker, dvStatusLabel } from "@/lib/dv";
import { getPerm } from "@/lib/permissions";
import { PaymentForm } from "@/app/(staff)/payments/bills/new/payment-form";
import { DvAllocations, type OpenBillRow } from "./dv-allocations";
import { DvAccountLines } from "./dv-account-lines";
import { DvItems } from "./dv-items";
import { DvPreview } from "../dv-preview";
import type { DvSheetData } from "@/components/dv-sheet";
import { saveDV, regenerateDVLines, advanceDV, noteDV, voidDV } from "../actions";

const ERRORS: Record<string, string> = {
  locked: "This voucher can only be changed while it is a Draft.",
  bill: "A bill on this voucher is not this payee's, or is not open.",
  over: "An allocation is more than the bill has available (its outstanding balance less what other vouchers already authorise).",
  step: "That step is not next in the approval chain.",
  empty: "Allocate at least one bill before moving the voucher on.",
  samecheck: "The person who prepared a voucher cannot also check it.",
  paid: "A voucher with a payment against it cannot be voided — reverse the payment first.",
  reason: "Give a reason for voiding (at least 5 characters).",
  account: "An account line or item names an account that is not in the Chart of Accounts, or is inactive.",
  negative: "The voucher's own items net to less than nothing — the deductions exceed the charges.",
  items: "The voucher's own items cannot be posted yet:",
  period: "This voucher cannot be posted in its accounting period:",
};
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default async function DvDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; saved?: string; bill?: string; perror?: string; pbill?: string } }) {
  const user = await requirePerm("dv");
  const company = await getActiveCompany(user);
  const dv = await prisma.disbursementVoucher.findUnique({
    where: { id: params.id },
    include: {
      supplier: true, employee: { select: { id: true, name: true, position: true } },
      items: { orderBy: { sortOrder: "asc" }, include: { glAccount: { select: { code: true, description: true } } } },
      company: { select: { companyName: true, glPayablesId: true, glPayables: { select: { code: true, description: true } }, glInputVatId: true, glInputVat: { select: { code: true, description: true } } } },
      bills: { include: { bill: { select: { id: true, billNo: true, kind: true, billDate: true, dueDate: true, supplierInvoiceNo: true, total: true, inputVat: true, paidAmount: true, status: true, supplier: { select: { name: true } }, expenseLines: { include: { glAccount: { select: { code: true, description: true } } } }, purchaseOrder: { select: { id: true, poNumber: true } }, goodsReceipt: { select: { id: true, grnNumber: true } } } } } },
      accountLines: { orderBy: { sortOrder: "asc" } },
      preparedBy: { select: { name: true } }, checkedBy: { select: { name: true } }, approvedBy: { select: { name: true } },
      notedBy: { select: { name: true } }, postedBy: { select: { name: true } }, voidedBy: { select: { name: true } },
      payments: { include: { lines: { select: { billId: true, amount: true } }, cashAccount: { include: { glAccount: { select: { code: true, description: true } } } }, createdBy: { select: { name: true } } }, orderBy: [{ date: "asc" }, { paymentNo: "asc" }] },
    },
  });
  if (!dv || dv.companyId !== company.id) notFound();
  const audit = await getAuditTrail("DisbursementVoucher", params.id, 40);
  const canWrite = user.perm === "READ_WRITE";
  const canEdit = canWrite && !dvEditBlocker(dv);
  const isAdmin = ["SUPER_ADMIN", "ADMIN"].includes(user.role);
  const canPay = getPerm(user, "payBills") === "READ_WRITE" && ["Posted", "Partially Paid"].includes(dv.status);
  const remaining = Math.round((dv.amount - dv.paidAmount) * 100) / 100;
  const liveCheques = dv.payments.filter((p) => p.status === "Posted");

  // the payee's open bills, with what is available to this voucher
  const openBills = canEdit && dv.supplierId
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
  const lines = voucherLines({ ...dv, payments: dv.payments.filter((p) => p.status === "Posted") });
  const generated = !dv.accountLines.length;
  const sheet: DvSheetData = {
    companyName: dv.company.companyName, dvNo: dv.dvNo, padRef: dv.padRef, payee: dv.payee, date: fmtDate(dv.date), terms: dv.terms ?? "", particulars: dv.particulars,
    items: [
      ...dv.bills.map((b) => ({ label: `${b.bill.billNo}${b.bill.supplierInvoiceNo ? ` · Inv ${b.bill.supplierInvoiceNo}` : ""} · ${fmtDate(b.bill.billDate)}`, amount: b.amount })),
      ...dv.items.map((it) => ({ label: it.description, amount: it.amount })),
    ],
    amount: dv.amount, amountInWords: amountInWords(dv.amount),
    lines: lines.map((l) => ({ title: l.title, debit: l.debit, credit: l.credit })),
    signatures: { preparedBy: dv.preparedBy?.name, checkedBy: dv.checkedBy?.name, approvedBy: dv.approvedBy?.name, notedBy: dv.notedBy?.name, postedBy: dv.postedBy?.name },
    payments: dv.payments.filter((p) => p.status === "Posted").map((p) => ({ checkNo: p.checkNo ?? p.refNo ?? p.method, date: fmtDate(p.checkDate ?? p.date), amount: p.amount })),
    paidTotal: dv.paidAmount, status: dv.status,
  };
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
        <StatusBadge status={dvStatusLabel(dv.status)} />
        <Link href={`/dv/${dv.id}/print`} className="btn-secondary">🖨 Print DV</Link>
      </PageHeader>

      {searchParams.error && ERRORS[searchParams.error] && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">⚠</span> {ERRORS[searchParams.error]}{searchParams.bill ? ` (${searchParams.bill})` : ""}</p>}
      {searchParams.saved === "ok" && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✔ Saved.</p>}
      {dv.status === "Void" && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Voided by {dv.voidedBy?.name ?? "—"} · {fmtDateTime(dv.voidedAt)}: {dv.voidReason}</p>}
      {dv.status === "Partially Paid" && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{peso(dv.paidAmount)} of {peso(dv.amount)} has been paid on {liveCheques.length} cheque(s); {peso(remaining)} remains.</p>}
      {dv.status === "Paid" && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Fully paid — {peso(dv.amount)} on {liveCheques.length} cheque(s).</p>}
      {dv.status === "Posted" && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Payment of {peso(dv.amount)} to {dv.payee} is authorised. Nothing has left the bank yet — the payee is paid when a cheque or payment is added below.{dv.items.length > 0 && <> Its own items ({peso(dv.directAmount)}) are booked: Dr their accounts / Cr Accounts Payable — {dv.payee}.</>}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div className="card py-3"><p className="text-xs text-gray-500">Payee</p><p className="font-semibold">{dv.payee}</p><p className="text-xs text-gray-500">{dv.supplier ? `supplier · ${dv.supplier.name}` : dv.employee ? `employee · ${dv.employee.name}` : "named payee"}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Amount authorised</p><p className="font-semibold">{peso(dv.amount)}</p><p className="text-xs text-gray-500">{[dv.bills.length ? `${dv.bills.length} bill(s)` : "", dv.items.length ? `${dv.items.length} item(s) ${peso(dv.directAmount)}` : ""].filter(Boolean).join(" + ") || "nothing yet"}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Paid so far</p><p className={`font-semibold ${dv.paidAmount ? "text-emerald-700" : ""}`}>{peso(dv.paidAmount)}</p><p className="text-xs text-gray-500">{liveCheques.length ? `${liveCheques.length} cheque(s) · ` : ""}{remaining > 0.005 ? `${peso(remaining)} remaining` : dv.amount ? "fully paid" : ""}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Date / Terms</p><p className="font-semibold">{fmtDate(dv.date)}</p><p className="text-xs text-gray-500">{dv.terms ?? "—"}{dv.padRef ? ` · pad DVN ${dv.padRef}` : ""}</p></div>
      </div>

      <form id="dv-form" action={saveDV} className="card mb-4 space-y-4">
        <input type="hidden" name="id" value={dv.id} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2"><label className="label">Payee (as printed)</label><input name="payee" defaultValue={dv.payee} disabled={!canEdit} className="input" /></div>
          <div><label className="label">Date</label><input name="date" type="date" defaultValue={ymd(dv.date)} disabled={!canEdit} className="input" /></div>
          <div><label className="label">Terms</label><input name="terms" defaultValue={dv.terms ?? ""} disabled={!canEdit} className="input" placeholder="e.g. 30 days, COD" /></div>
          <div className="sm:col-span-2 lg:col-span-3"><label className="label">Particulars</label><textarea name="particulars" defaultValue={dv.particulars} disabled={!canEdit} rows={3} className="input" placeholder="what this payment is for, as it should read on the voucher" /></div>
          <div><label className="label">Pad DVN <span className="font-normal text-gray-400">(if stamped)</span></label><input name="padRef" defaultValue={dv.padRef ?? ""} disabled={!canEdit} className="input" placeholder="e.g. 24251" /></div>
          <div className="sm:col-span-2 lg:col-span-4"><label className="label">Memo (internal)</label><input name="memo" defaultValue={dv.memo ?? ""} disabled={!canEdit} className="input" /></div>
        </div>
        {(dv.supplierId || rows.length > 0) && (
          <div>
            <p className="mb-1 text-sm font-semibold">Bills this voucher pays</p>
            <DvAllocations key={rows.map((r) => `${r.billId}:${r.allocated}`).join("|")} rows={rows} canEdit={canEdit} />
          </div>
        )}
        <div>
          <p className="mb-1 text-sm font-semibold">Items with no bill behind them <span className="font-normal text-gray-500">— a liquidation, a permit, a reimbursement; each charged to its account, a negative is a deduction</span></p>
          <DvItems key={dv.items.map((it) => `${it.id}:${it.amount}`).join("|")} items={dv.items.map((it) => ({ glAccountId: it.glAccountId ?? "", account: it.glAccount ? `${it.glAccount.code} ${it.glAccount.description}` : "", description: it.description, amount: it.amount }))} canEdit={canEdit} />
        </div>
        <div>
          <p className="mb-1 text-sm font-semibold">Account Title / Debit (Credit) <span className="font-normal text-gray-500">— {generated ? "suggested from the bills' and items' accounts; edit freely, any account from the chart" : "as saved on this voucher"}</span></p>
          <DvAccountLines key={lines.map((l) => `${l.title}:${l.debit}:${l.credit}`).join("|")} lines={lines.map((l, i) => ({ id: String(i), glAccountId: l.glAccountId ?? "", title: l.title, debit: l.debit, credit: l.credit }))} canEdit={canEdit} />
        </div>
        {canEdit && <div className="flex items-center gap-3"><button className="btn-primary" type="submit">💾 Save Voucher</button><p className="text-xs text-gray-500">Allocations are checked against each bill&rsquo;s available balance so no peso is authorised twice. The account lines print exactly as saved. The books are posted from the bills and payments — and, when the voucher is posted, from its own items.</p></div>}
      </form>
      {canEdit && !generated && (
        <form action={regenerateDVLines} className="-mt-2 mb-4 text-right"><input type="hidden" name="id" value={dv.id} /><button type="submit" className="text-xs text-gray-500 hover:underline">↺ Rebuild the account lines from the bills and items</button></form>
      )}

      {(dv.bills.length > 0 || dv.items.length > 0) && (
        <div className="card mb-4 text-sm">
          <p className="mb-1 font-semibold">Supporting transactions</p>
          <table className="w-full text-xs"><thead className="text-gray-500"><tr><th className="py-1 text-left font-medium">Bill</th><th className="py-1 text-left font-medium">Supplier invoice</th><th className="py-1 text-left font-medium">Purchase order</th><th className="py-1 text-left font-medium">Receipt</th><th className="py-1 text-right font-medium">Bill total</th><th className="py-1 text-right font-medium">On this voucher</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {dv.bills.map((b) => (
                <tr key={b.id}>
                  <td className="py-1"><Link href={`/bills/${b.bill.id}`} className="font-mono font-semibold text-emerald-700 hover:underline">{b.bill.billNo}</Link> <span className="text-gray-500">{b.bill.kind === "EXPENSE" ? "non-inventory" : "inventory"}</span></td>
                  <td className="py-1 text-gray-600">{b.bill.supplierInvoiceNo ?? "—"}</td>
                  <td className="py-1">{b.bill.purchaseOrder ? <Link href={`/purchase-orders/${b.bill.purchaseOrder.id}`} className="font-mono text-emerald-700 hover:underline">{b.bill.purchaseOrder.poNumber}</Link> : "—"}</td>
                  <td className="py-1">{b.bill.goodsReceipt ? <Link href={`/receiving/${b.bill.goodsReceipt.id}`} className="font-mono text-emerald-700 hover:underline">{b.bill.goodsReceipt.grnNumber}</Link> : "—"}</td>
                  <td className="py-1 text-right">{peso(b.bill.total)}</td>
                  <td className="py-1 text-right font-semibold">{peso(b.amount)}</td>
                </tr>
              ))}
              {dv.items.length > 0 && <tr><td className="py-1" colSpan={4}>The voucher&rsquo;s own items ({dv.items.length}) — no bill; booked when the voucher is posted</td><td className="py-1 text-right">{peso(dv.directAmount)}</td><td className="py-1 text-right font-semibold">{peso(dv.directAmount)}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {(dv.payments.length > 0 || canPay) && (
        <div className="mb-4">
          <div className="card mb-3 text-sm">
            <p className="mb-1 font-semibold">Cheques / Payments <span className="font-normal text-gray-500">— {liveCheques.length} issued · {peso(dv.paidAmount)} paid · {peso(Math.max(0, remaining))} remaining</span></p>
            {dv.payments.length > 0 ? (
              <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-xs">
                <thead className="text-gray-500"><tr><th className="py-1 text-left font-medium">Payment</th><th className="py-1 text-left font-medium">Cheque No.</th><th className="py-1 text-left font-medium">Cheque date</th><th className="py-1 text-left font-medium">Payment date</th><th className="py-1 text-left font-medium">Bank / Cash</th><th className="py-1 text-left font-medium">Method</th><th className="py-1 text-right font-medium">Amount</th><th className="py-1 text-left font-medium">Status</th><th className="py-1 text-left font-medium">By</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {dv.payments.map((p) => (
                    <tr key={p.id} className={p.status === "Void" ? "opacity-50" : ""}>
                      <td className="py-1"><Link href={`/payments/bills/${p.id}`} className="font-mono font-semibold text-emerald-700 hover:underline">{p.paymentNo}</Link></td>
                      <td className="py-1 font-mono">{p.checkNo ?? (p.refNo ? `ref ${p.refNo}` : "—")}</td>
                      <td className="py-1">{p.checkDate ? fmtDate(p.checkDate) : "—"}</td>
                      <td className="py-1">{fmtDate(p.date)}</td>
                      <td className="py-1">{p.cashAccount.name}</td>
                      <td className="py-1">{p.method}</td>
                      <td className={`py-1 text-right font-semibold ${p.status === "Void" ? "line-through" : ""}`}>{peso(p.amount)}</td>
                      <td className="py-1"><StatusBadge status={p.status} /></td>
                      <td className="py-1 text-gray-500">{p.createdBy?.name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            ) : <p className="text-xs text-gray-500">No cheque issued yet.</p>}
          </div>
          {canPay && remaining > 0.005 && (
            <PaymentForm dv={{ ...dv, payments: dv.payments.map((p) => ({ amount: p.amount, status: p.status, lines: p.lines })) }} backTo={`/dv/${dv.id}`} error={searchParams.perror} errorRef={searchParams.pbill} />
          )}
        </div>
      )}

      <div className="mb-4">
        <DvPreview key={JSON.stringify(sheet)} formId="dv-form" base={sheet} />
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
