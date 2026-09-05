import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { PageHeader } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { getOutstandingInvoices, customerCredit, PAYMENT_METHODS } from "@/lib/receive-payments";
import { fmtDate, peso } from "@/lib/format";
import { createReceivePayment } from "../actions";
import { EntryTable } from "./entry-table";

/** New provisional receipt. Picking a customer reloads the page (GET) with every
    outstanding invoice of that customer in the ACTIVE company listed for application. */
export default async function NewPaymentPage({
  searchParams,
}: {
  searchParams: { customer?: string; invoice?: string; error?: string };
}) {
  const user = await requirePermWrite("receivePayments");
  const company = await getActiveCompany(user);

  // arriving from an invoice page pre-selects that invoice's customer
  let customerId = searchParams.customer || "";
  if (!customerId && searchParams.invoice) {
    const sr = await prisma.salesReceipt.findFirst({
      where: { id: searchParams.invoice, companyId: company.id },
      select: { customerId: true },
    });
    customerId = sr?.customerId ?? "";
  }
  const customer = customerId
    ? await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, businessName: true, province: true } })
    : null;

  const [invoices, credit, accounts] = customer
    ? await Promise.all([
        getOutstandingInvoices(customer.id, company.id),
        customerCredit(customer.id, company.id),
        prisma.cashAccount.findMany({ where: { companyId: company.id, status: "Active" }, orderBy: { name: "asc" } }),
      ])
    : [[], 0, await prisma.cashAccount.findMany({ where: { companyId: company.id, status: "Active" }, orderBy: { name: "asc" } })];

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-5xl">
      <Link href="/payments" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
        ← Back to Receive Payments
      </Link>
      <PageHeader title={`Receive Payment — ${company.companyName}`} />

      {searchParams.error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <span className="font-semibold">⚠ Not saved.</span> {searchParams.error}
        </p>
      )}

      <form method="GET" className="card mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[280px] flex-1">
          <label className="label">Customer</label>
          <SearchSelect
            entity="customers"
            name="customer"
            placeholder="Type customer name…"
            submitOnSelect
            defaultValue={customer ? { id: customer.id, label: customer.businessName, sub: customer.province } : null}
          />
        </div>
        <button className="btn-secondary" type="submit">Load Invoices</button>
        {customer && credit > 0 && (
          <p className="pb-2 text-sm text-amber-700">
            Available credit from earlier payments: <span className="font-bold">{peso(credit)}</span> — applied from those payments&rsquo; pages.
          </p>
        )}
      </form>

      {customer && (
        <form action={createReceivePayment} className="space-y-4">
          <input type="hidden" name="customerId" value={customer.id} />
          <div className="card grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className="label">Payment Date</label>
              <input name="date" type="date" defaultValue={today} max={today} required className="input" />
            </div>
            <div>
              <label className="label">Method</label>
              <select name="method" className="input">
                {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Cash/Bank Account</label>
              <select name="cashAccountId" className="input">
                <option value="">— none —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Reference #</label>
              <input name="refNo" className="input" placeholder="OR / deposit slip / txn no." />
            </div>
            <div>
              <label className="label">Check # (if check)</label>
              <input name="checkNo" className="input" />
            </div>
            <div>
              <label className="label">Check Date</label>
              <input name="checkDate" type="date" className="input" />
            </div>
            <div className="col-span-2">
              <label className="label">Remarks</label>
              <input name="remarks" className="input" placeholder="optional notes" />
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
          />

          <div className="flex items-center gap-3">
            <button className="btn-primary" type="submit">Save as Draft</button>
            <p className="text-xs text-gray-500">
              A draft is submitted for approval from its page; only a Posted payment updates AR.
              Anything not applied to an invoice becomes the customer&rsquo;s credit.
            </p>
          </div>
        </form>
      )}
      {!customer && <p className="card p-8 text-center text-sm text-gray-500">Pick a customer to see their outstanding invoices.</p>}
    </div>
  );
}
