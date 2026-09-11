import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate } from "@/lib/format";
import { OPEN_BILL_STATUSES, round2 } from "@/lib/bills";
import { PageHeader } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { PayLines, type PayRow } from "./pay-lines";
import { recordSupplierPayment } from "../actions";

const METHODS = ["Cash", "Check", "Bank Transfer", "E-Wallet"];
const ERRORS: Record<string, string> = {
  method: "Choose a payment method.", account: "Choose the cash or bank account the money comes from.", check: "A cheque payment needs the cheque number.",
  dv: "That voucher could not be found.", dvstatus: "Only a Posted voucher can be paid — it must be approved and posted first.",
  bill: "A bill on this payment is not open.", payee: "All bills on one payment must belong to the same payee.",
  over: "A bill is being paid more than it is owed.", notondv: "That bill is not on the voucher.", overdv: "A bill is being paid more than the voucher authorised for it.",
  empty: "Enter an amount against at least one bill.", dupecheck: "That cheque number is already recorded on this account (see payment",
};

export default async function NewSupplierPaymentPage({ searchParams }: { searchParams: { dv?: string; supplier?: string; error?: string; bill?: string } }) {
  const user = await requirePerm("payBills");
  if (user.perm !== "READ_WRITE") return <div className="card text-sm text-gray-600">You have read-only access to payments.</div>;
  const company = await getActiveCompany(user);
  const dv = searchParams.dv
    ? await prisma.disbursementVoucher.findFirst({ where: { id: searchParams.dv, companyId: company.id }, include: { supplier: true, bills: { include: { bill: true } }, payments: { where: { status: "Posted" }, include: { lines: true } } } })
    : null;
  const supplier = dv?.supplier ?? (searchParams.supplier ? await prisma.supplier.findUnique({ where: { id: searchParams.supplier } }) : null);
  const accounts = await prisma.cashAccount.findMany({ where: { companyId: company.id, status: "Active" }, orderBy: { name: "asc" } });
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // the bills to pay: under a voucher, those it authorises (less what it already paid); otherwise the payee's open bills
  let rows: PayRow[] = [];
  if (dv) {
    for (const b of dv.bills) {
      const paidUnder = dv.payments.reduce((s, p) => s + p.lines.filter((l) => l.billId === b.billId).reduce((x, l) => x + l.amount, 0), 0);
      const authorisedLeft = round2(b.amount - paidUnder);
      const outstanding = round2(b.bill.total - b.bill.paidAmount);
      const max = round2(Math.min(authorisedLeft, outstanding));
      if (max <= 0) continue;
      rows.push({ billId: b.billId, billNo: b.bill.billNo, dated: fmtDate(b.bill.billDate), due: fmtDate(b.bill.dueDate), supplierInvoiceNo: b.bill.supplierInvoiceNo, outstanding, authorised: authorisedLeft, max, suggested: max });
    }
  } else if (supplier) {
    const bills = await prisma.supplierBill.findMany({ where: { companyId: company.id, supplierId: supplier.id, status: { in: OPEN_BILL_STATUSES } }, orderBy: { dueDate: "asc" } });
    rows = bills.map((b) => { const o = round2(b.total - b.paidAmount); return { billId: b.id, billNo: b.billNo, dated: fmtDate(b.billDate), due: fmtDate(b.dueDate), supplierInvoiceNo: b.supplierInvoiceNo, outstanding: o, authorised: null, max: o, suggested: 0 }; });
  }

  return (
    <div className="max-w-4xl">
      <Link href="/payments/bills" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">← Back to Pay Bills</Link>
      <PageHeader title="Record Supplier Payment" />
      {searchParams.error && ERRORS[searchParams.error] && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">⚠ {ERRORS[searchParams.error]}{searchParams.bill ? ` ${searchParams.bill})` : ""}</p>}
      {!accounts.length && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">No cash or bank account is set up for {company.companyName} — add one under Finance → Cash / Bank Accounts first.</p>}

      {!dv && !supplier ? (
        <div className="card space-y-3">
          <p className="text-sm text-gray-600">Pay against a posted Disbursement Voucher (the normal route), or pick a payee to pay open bills directly.</p>
          <form method="GET" className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Disbursement Voucher</label><SearchSelect entity="disbursement-vouchers" name="dv" params={{ company: company.id, open: "1" }} placeholder="Posted voucher…" submitOnSelect /></div>
            <div><label className="label">or Payee</label><SearchSelect entity="suppliers" name="supplier" placeholder="Type supplier name…" submitOnSelect /></div>
          </form>
        </div>
      ) : (
        <form action={recordSupplierPayment} className="card space-y-4">
          {dv && <input type="hidden" name="dvId" value={dv.id} />}
          {!dv && supplier && <input type="hidden" name="supplierId" value={supplier.id} />}
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
            <span className="font-semibold">{dv ? `${dv.dvNo} · ${dv.payee}` : supplier!.name}</span>
            {dv && <span className="text-gray-600"> · authorised {peso(dv.amount)} · paid so far {peso(dv.paidAmount)} · {dv.status}</span>}
            {!dv && <span className="text-xs text-amber-700"> · paying without a voucher — the payment will not carry an authorisation</span>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><label className="label">Payment Date</label><input name="date" type="date" defaultValue={ymd} required className="input" /></div>
            <div><label className="label">Cash / Bank Account</label><select name="cashAccountId" required className="input">{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}</select></div>
            <div><label className="label">Method</label><select name="method" defaultValue="Check" className="input">{METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
            <div><label className="label">Reference No.</label><input name="refNo" className="input" placeholder="transfer ref, OR no…" /></div>
            <div><label className="label">Cheque No. <span className="font-normal text-gray-400">(cheque payments)</span></label><input name="checkNo" className="input" /></div>
            <div><label className="label">Cheque Date</label><input name="checkDate" type="date" className="input" /></div>
            <div className="sm:col-span-2"><label className="label">Remarks</label><input name="remarks" className="input" /></div>
          </div>
          <PayLines rows={rows} />
          <div className="flex items-center gap-3">
            <button className="btn-primary" type="submit" disabled={!accounts.length || !rows.length}>💸 Record Payment</button>
            <p className="text-xs text-gray-500">Posts at once: Dr Accounts Payable per bill, Cr the account chosen. Bills and the voucher move to Partially Paid / Paid.</p>
          </div>
        </form>
      )}
    </div>
  );
}
