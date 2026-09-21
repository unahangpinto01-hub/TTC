import { prisma } from "@/lib/db";
import { peso, fmtDate } from "@/lib/format";
import { round2 } from "@/lib/bills";
import { directPaidOf, dvStatusLabel } from "@/lib/dv";
import { PayLines, type PayRow } from "./pay-lines";
import { recordSupplierPayment } from "../actions";

const METHODS = ["Check", "Cash", "Bank Transfer", "E-Wallet"];
export const PAYMENT_ERRORS: Record<string, string> = {
  method: "Choose a payment method.", account: "Choose the cash or bank account the money comes from.", check: "A cheque payment needs the cheque number.",
  dv: "That voucher could not be found.", dvstatus: "Only a Posted voucher can be paid — it must be approved and posted first.",
  bill: "A bill on this payment is not open.", payee: "All bills on one payment must belong to the same payee.",
  over: "A bill is being paid more than it is owed.", notondv: "That bill is not on the voucher.", overdv: "A bill is being paid more than the voucher authorised for it.",
  overdirect: "The voucher's own items are being paid more than the voucher authorised.", overvoucher: "This cheque is more than the voucher still has to pay.",
  empty: "Enter an amount against at least one bill or the voucher's own items.", dupecheck: "That cheque number is already recorded on this account (see payment",
};

type DvForPayment = {
  id: string; dvNo: string; payee: string; amount: number; paidAmount: number; status: string; directAmount: number; companyId: string;
  bills: { billId: string; amount: number; bill: { billNo: string; billDate: Date; dueDate: Date; supplierInvoiceNo: string | null; total: number; paidAmount: number } }[];
  payments: { amount: number; status: string; lines: { billId: string; amount: number }[] }[];
};

/**
 * Add Cheque / Payment against a posted voucher — the one form used from the voucher page and
 * from Cheques / Payments. Each cheque is its own record with its own number, date, bank and amount;
 * the voucher's remaining balance is what caps it.
 */
export async function PaymentForm({ dv, backTo, error, errorRef }: { dv: DvForPayment; backTo?: string; error?: string; errorRef?: string }) {
  const accounts = await prisma.cashAccount.findMany({ where: { companyId: dv.companyId, status: "Active" }, orderBy: { name: "asc" } });
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const posted = dv.payments.filter((p) => p.status === "Posted");

  // the bills it authorises, less what it already paid on each
  const rows: PayRow[] = [];
  for (const b of dv.bills) {
    const paidUnder = posted.reduce((s, p) => s + p.lines.filter((l) => l.billId === b.billId).reduce((x, l) => x + l.amount, 0), 0);
    const authorisedLeft = round2(b.amount - paidUnder);
    const outstanding = round2(b.bill.total - b.bill.paidAmount);
    const max = round2(Math.min(authorisedLeft, outstanding));
    if (max <= 0) continue;
    rows.push({ billId: b.billId, billNo: b.bill.billNo, dated: fmtDate(b.bill.billDate), due: fmtDate(b.bill.dueDate), supplierInvoiceNo: b.bill.supplierInvoiceNo, outstanding, authorised: authorisedLeft, max, suggested: max });
  }
  const directLeft = dv.directAmount > 0 ? round2(Math.max(0, dv.directAmount - directPaidOf(posted))) : 0;
  const remaining = round2(dv.amount - dv.paidAmount);
  const payable = ["Posted", "Partially Paid"].includes(dv.status);

  return (
    <form action={recordSupplierPayment} className="card space-y-4">
      <input type="hidden" name="dvId" value={dv.id} />
      {backTo && <input type="hidden" name="back" value={backTo} />}
      {error && PAYMENT_ERRORS[error] && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">⚠ {PAYMENT_ERRORS[error]}{errorRef ? ` ${errorRef})` : ""}</p>}
      {!accounts.length && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">No cash or bank account is set up for this company — add one under Finance → Cash / Bank Accounts first.</p>}
      <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
        <span className="font-semibold">{dv.dvNo} · {dv.payee}</span>
        <span className="text-gray-600"> · authorised {peso(dv.amount)} · paid so far {peso(dv.paidAmount)} · remaining <span className="font-semibold text-amber-700">{peso(remaining)}</span> · {dvStatusLabel(dv.status)}</span>
      </div>
      {!payable ? (
        <p className="text-sm text-gray-500">Cheques can be added once the voucher is Posted.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><label className="label">Bank / Cash Account</label><select name="cashAccountId" required className="input">{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}</select></div>
            <div><label className="label">Method</label><select name="method" defaultValue="Check" className="input">{METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
            <div><label className="label">Cheque No. <span className="font-normal text-gray-400">(cheque payments)</span></label><input name="checkNo" className="input" /></div>
            <div><label className="label">Cheque Date</label><input name="checkDate" type="date" defaultValue={ymd} className="input" /></div>
            <div><label className="label">Payment Date <span className="font-normal text-gray-400">(when it leaves the bank)</span></label><input name="date" type="date" defaultValue={ymd} required className="input" /></div>
            <div><label className="label">Reference No.</label><input name="refNo" className="input" placeholder="transfer ref, OR no…" /></div>
            <div className="sm:col-span-2"><label className="label">Remarks</label><input name="remarks" className="input" /></div>
          </div>
          <PayLines rows={rows} direct={directLeft > 0 ? { label: `${dv.dvNo} — the voucher's own items (no bill)`, max: directLeft } : null} />
          <div className="flex items-center gap-3">
            <button className="btn-primary" type="submit" disabled={!accounts.length || (!rows.length && directLeft <= 0)}>💸 Add Cheque / Payment</button>
            <p className="text-xs text-gray-500">Posts at once: Dr Accounts Payable per bill and for the voucher&rsquo;s own items, Cr the account chosen. A cheque can never take the voucher past what it authorised; the same cheque number cannot be used twice on one account.</p>
          </div>
        </>
      )}
    </form>
  );
}
