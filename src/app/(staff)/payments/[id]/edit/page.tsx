import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { PageHeader } from "@/components/ui";
import { getOutstandingInvoices, PAYMENT_METHODS } from "@/lib/receive-payments";
import { fmtDate } from "@/lib/format";
import { updateReceivePayment } from "../../actions";
import { EntryTable } from "../../new/entry-table";

export default async function EditPaymentPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string };
}) {
  const user = await requirePermWrite("receivePayments");
  const company = await getActiveCompany(user);
  const rp = await prisma.receivePayment.findUnique({
    where: { id: params.id },
    include: { customer: { select: { businessName: true } }, applications: true },
  });
  if (!rp || rp.companyId !== company.id) notFound();
  if (rp.status !== "Draft") notFound(); // only drafts are editable

  const [invoices, accounts] = await Promise.all([
    getOutstandingInvoices(rp.customerId, company.id),
    prisma.cashAccount.findMany({ where: { companyId: company.id, status: "Active" }, orderBy: { name: "asc" } }),
  ]);
  const initialAmounts = Object.fromEntries(rp.applications.map((a) => [a.salesReceiptId, a.amount]));

  return (
    <div className="max-w-5xl">
      <Link href={`/payments/${rp.id}`} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
        ← Back to {rp.prNumber}
      </Link>
      <PageHeader title={`Edit Draft ${rp.prNumber} — ${rp.customer.businessName}`} />
      {searchParams.error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">⚠ Not saved.</span> {searchParams.error}</p>
      )}

      <form action={updateReceivePayment} className="space-y-4">
        <input type="hidden" name="id" value={rp.id} />
        <div className="card grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <label className="label">Payment Date</label>
            <input name="date" type="date" defaultValue={rp.date.toISOString().slice(0, 10)} required className="input" />
          </div>
          <div>
            <label className="label">Method</label>
            <select name="method" defaultValue={rp.method} className="input">
              {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Cash/Bank Account</label>
            <select name="cashAccountId" defaultValue={rp.cashAccountId ?? ""} className="input">
              <option value="">— none —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
            </select>
          </div>
          <div>
            <label className="label">Reference #</label>
            <input name="refNo" defaultValue={rp.refNo ?? ""} className="input" />
          </div>
          <div>
            <label className="label">Check # (if check)</label>
            <input name="checkNo" defaultValue={rp.checkNo ?? ""} className="input" />
          </div>
          <div>
            <label className="label">Check Date</label>
            <input name="checkDate" type="date" defaultValue={rp.checkDate ? rp.checkDate.toISOString().slice(0, 10) : ""} className="input" />
          </div>
          <div className="col-span-2">
            <label className="label">Remarks</label>
            <input name="remarks" defaultValue={rp.remarks ?? ""} className="input" />
          </div>
        </div>

        <EntryTable
          invoices={invoices.map((i) => ({
            id: i.id,
            srNumber: i.srNumber,
            invoiceDate: fmtDate(i.invoiceDate),
            dueDate: fmtDate(i.dueDate),
            amount: i.amount,
            previousPayments: i.previousPayments,
            creditApplied: i.creditApplied,
            outstanding: i.outstanding,
          }))}
          initialAmounts={initialAmounts}
          initialPayment={rp.amount}
        />

        <button className="btn-primary" type="submit">Save Changes</button>
      </form>
    </div>
  );
}
