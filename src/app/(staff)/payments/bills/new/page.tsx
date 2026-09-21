import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { PageHeader } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { PaymentForm, PAYMENT_ERRORS } from "./payment-form";

/**
 * Cheques / Payments: every payment is a cheque or transfer against a POSTED Disbursement Voucher —
 * the voucher is the company's authorisation, so there is no way to pay without one.
 */
export default async function NewSupplierPaymentPage({ searchParams }: { searchParams: { dv?: string; error?: string; bill?: string } }) {
  const user = await requirePerm("payBills");
  if (user.perm !== "READ_WRITE") return <div className="card text-sm text-gray-600">You have read-only access to payments.</div>;
  const company = await getActiveCompany(user);
  const dv = searchParams.dv
    ? await prisma.disbursementVoucher.findFirst({
        where: { id: searchParams.dv, companyId: company.id },
        include: { bills: { include: { bill: { select: { billNo: true, billDate: true, dueDate: true, supplierInvoiceNo: true, total: true, paidAmount: true } } } }, payments: { select: { amount: true, status: true, lines: { select: { billId: true, amount: true } } } } },
      })
    : null;

  return (
    <div className="max-w-4xl">
      <Link href="/payments/bills" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">← Back to Cheques / Payments</Link>
      <PageHeader title="Add Cheque / Payment" />
      {!dv && searchParams.error && PAYMENT_ERRORS[searchParams.error] && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">⚠ {PAYMENT_ERRORS[searchParams.error]}</p>}
      {!dv ? (
        <div className="card space-y-3">
          <p className="text-sm text-gray-600">Every payment is made against a posted Disbursement Voucher — the voucher is the authorisation. Pick the voucher to pay.</p>
          <form method="GET" className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Disbursement Voucher</label><SearchSelect entity="disbursement-vouchers" name="dv" params={{ company: company.id, open: "1" }} placeholder="Posted voucher…" submitOnSelect /></div>
          </form>
          <p className="text-xs text-gray-500">No voucher yet? Raise one under Finance → Disbursement Vouchers, walk it through Prepared → Checked → Approved → Posted, then come back here or add the cheque from the voucher itself.</p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-gray-600">Voucher <Link href={`/dv/${dv.id}`} className="font-mono font-semibold text-emerald-700 hover:underline">{dv.dvNo}</Link> — cheques can also be added from the voucher page.</p>
          <PaymentForm dv={dv} error={searchParams.error} errorRef={searchParams.bill} />
        </>
      )}
    </div>
  );
}
