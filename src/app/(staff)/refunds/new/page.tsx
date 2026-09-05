import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { PageHeader } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { RC_REASONS, combinedCustomerCredit } from "@/lib/refunds-credits";
import { peso, fmtDate } from "@/lib/format";
import { createRefundCredit } from "../actions";
import { LinesEditor } from "../lines-editor";

/** New credit memo / customer refund. Picking the customer reloads the page (GET) with
    their invoices available as the optional related invoice. */
export default async function NewRefundCreditPage({
  searchParams,
}: {
  searchParams: { customer?: string; invoice?: string; type?: string; error?: string };
}) {
  const user = await requirePermWrite("refundsCredits");
  const company = await getActiveCompany(user);

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
  const [invoices, credit] = customer
    ? await Promise.all([
        prisma.salesReceipt.findMany({
          where: { customerId: customer.id, companyId: company.id, status: { not: "Void" } },
          select: { id: true, srNumber: true, invoiceDate: true, amount: true, status: true },
          orderBy: { invoiceDate: "desc" },
          take: 60,
        }),
        combinedCustomerCredit(customer.id, company.id).then((c) => c.total),
      ])
    : [[], 0];
  const today = new Date().toISOString().slice(0, 10);
  const defaultType = searchParams.type === "Refund" ? "Refund" : "Credit";

  return (
    <div className="max-w-5xl">
      <Link href="/refunds" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
        ← Back to Refunds &amp; Credits
      </Link>
      <PageHeader title={`New Refund / Credit — ${company.companyName}`} />

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
        <button className="btn-secondary" type="submit">Load</button>
        {customer && credit > 0 && (
          <p className="pb-2 text-sm text-amber-700">Existing credit balance: <span className="font-bold">{peso(credit)}</span></p>
        )}
      </form>

      {customer ? (
        <form action={createRefundCredit} className="space-y-4">
          <input type="hidden" name="customerId" value={customer.id} />
          <div className="card grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className="label">Transaction Type</label>
              <select name="type" defaultValue={defaultType} className="input">
                <option value="Credit">Customer Credit (credit memo)</option>
                <option value="Refund">Customer Refund (money back)</option>
              </select>
            </div>
            <div>
              <label className="label">Date</label>
              <input name="date" type="date" defaultValue={today} max={today} required className="input" />
            </div>
            <div>
              <label className="label">Reason</label>
              <select name="reason" className="input">
                {RC_REASONS.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Related Invoice (optional)</label>
              <select name="salesReceiptId" defaultValue={searchParams.invoice ?? ""} className="input">
                <option value="">— none —</option>
                {invoices.map((i) => (
                  <option key={i.id} value={i.id}>{i.srNumber} · {fmtDate(i.invoiceDate)} · {peso(i.amount)} · {i.status}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 md:col-span-4">
              <label className="label">Remarks (required)</label>
              <input name="remarks" required className="input" placeholder="why this credit/refund exists — required before approval" />
            </div>
          </div>

          <div className="card">
            <LinesEditor companyId={company.id} />
          </div>

          <div className="flex items-center gap-3">
            <button className="btn-primary" type="submit">Save as Draft</button>
            <p className="text-xs text-gray-500">
              Draft → submit → admin approval → posting. A posted credit with a related open invoice offsets it
              immediately; the rest becomes the customer&rsquo;s credit. Ticked items re-enter stock only on posting.
            </p>
          </div>
        </form>
      ) : (
        <p className="card p-8 text-center text-sm text-gray-500">Pick a customer to start.</p>
      )}
    </div>
  );
}
