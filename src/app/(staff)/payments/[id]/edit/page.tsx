import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { PageHeader } from "@/components/ui";
import { getOutstandingInvoices, PAYMENT_METHODS, ppdDeadline, ppdSettingsOf } from "@/lib/receive-payments";
import { getPerm } from "@/lib/permissions";
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
  const initial = Object.fromEntries(rp.applications.map((a) => [a.salesReceiptId, {
    amount: a.amount, ppdRatePct: Math.round(a.ppdRate * 10000) / 100, ppd: a.ppdAmount, other: a.otherDiscount,
    reasonId: a.otherDiscountReasonId ?? "", remarks: a.otherDiscountRemarks ?? "", override: a.ppdOverrideReason ?? "",
  }]));
  const [policy, reasons] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: company.id }, select: { ppdRate: true, ppdDays: true, ppdMaxRate: true, glAffiliateAdvancesId: true, affiliateCompany: { select: { companyName: true } } } }),
    prisma.otherDiscountReason.findMany({ where: { status: "Active" }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, requiresRemarks: true } }),
  ]);
  const canDiscount = getPerm(user, "paymentDiscounts") === "READ_WRITE";
  const canOverride = getPerm(user, "ppdOverride") === "READ_WRITE";
  const settings = ppdSettingsOf(policy);
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  return (
    <div className="max-w-5xl">
      <Link href={`/payments/${rp.id}`} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
        ← Back to {rp.prNumber}
      </Link>
      <PageHeader title={`Edit Draft ${rp.prNumber} — ${rp.customer.businessName}`} />
      {rp.mirrorOfId && (
        <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
          This receipt mirrors a collection the affiliate made for us: the amount, date and account are fixed by the originating receipt. Apply it to our invoices and save.
        </p>
      )}
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
          invoices={invoices.map((i) => {
            const dl = ppdDeadline(i, settings);
            return { id: i.id, srNumber: i.srNumber, kind: i.kind, invoiceDate: fmtDate(i.invoiceDate), dueDate: fmtDate(i.dueDate), amount: i.amount, discountable: i.discountable, reference: i.reference, outstanding: i.outstanding, ppdDeadline: dl ? ymd(dl) : null };
          })}
          initial={initial}
          initialPayment={rp.amount}
          canDiscount={canDiscount}
          canOverride={canOverride}
          reasons={reasons}
          ppdDefaultRatePct={Math.round(policy.ppdRate * 10000) / 100}
          ppdMaxRatePct={Math.round(policy.ppdMaxRate * 10000) / 100}
          ppdHasWindow={policy.ppdDays > 0}
          affiliate={!rp.mirrorOfId && policy.affiliateCompany && policy.glAffiliateAdvancesId ? { name: policy.affiliateCompany.companyName, initialAmount: rp.affiliateAmount, initialRemarks: rp.affiliateRemarks ?? "" } : null}
        />

        <button className="btn-primary" type="submit">Save Changes</button>
      </form>
    </div>
  );
}
