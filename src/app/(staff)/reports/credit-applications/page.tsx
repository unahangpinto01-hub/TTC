import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { parseRange } from "@/lib/reports";
import { PrintButton, BackButton } from "@/components/print-button";

/** Credit Application History: every peso of credit put onto an invoice — from credit
    memos and from receive-payment applications — newest first. */
export default async function CreditApplicationsPage({
  searchParams,
}: {
  searchParams: { company?: string; from?: string; to?: string };
}) {
  const user = await requirePerm("reports");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);

  const [cmApps, payApps] = await Promise.all([
    prisma.creditApplication.findMany({
      where: { createdAt: { gte: range.from, lte: range.to }, refundCredit: { companyId: { in: scope.ids } } },
      include: {
        refundCredit: { select: { id: true, rcNumber: true, status: true, company: { select: { companyName: true } }, customer: { select: { businessName: true } } } },
        salesReceipt: { select: { id: true, srNumber: true } },
      },
    }),
    prisma.paymentApplication.findMany({
      where: { createdAt: { gte: range.from, lte: range.to }, receivePayment: { companyId: { in: scope.ids } } },
      include: {
        receivePayment: { select: { id: true, prNumber: true, status: true, company: { select: { companyName: true } }, customer: { select: { businessName: true } } } },
        salesReceipt: { select: { id: true, srNumber: true } },
      },
    }),
  ]);

  const rows = [
    ...cmApps.map((a) => ({
      when: a.createdAt, kind: "Credit Memo",
      source: a.refundCredit.rcNumber, sourceHref: `/refunds/${a.refundCredit.id}`,
      sourceStatus: a.refundCredit.status,
      company: a.refundCredit.company.companyName, customer: a.refundCredit.customer.businessName,
      invoice: a.salesReceipt.srNumber, invoiceHref: `/invoices/${a.salesReceipt.id}`,
      amount: a.amount,
    })),
    ...payApps.map((a) => ({
      when: a.createdAt, kind: "Payment",
      source: a.receivePayment.prNumber, sourceHref: `/payments/${a.receivePayment.id}`,
      sourceStatus: a.receivePayment.status,
      company: a.receivePayment.company.companyName, customer: a.receivePayment.customer.businessName,
      invoice: a.salesReceipt.srNumber, invoiceHref: `/invoices/${a.salesReceipt.id}`,
      amount: a.amount,
    })),
  ].sort((a, b) => b.when.getTime() - a.when.getTime());
  const total = rows.filter((r) => r.sourceStatus === "Posted").reduce((s, r) => s + r.amount, 0);

  return (
    <div className="print-page">
      <div className="no-print mb-3 flex items-center justify-between">
        <BackButton />
        <PrintButton />
      </div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">{scope.company.companyName}</h1>
        <p className="text-sm text-gray-600">Credit Application History{scope.combined && " · Combined (All Companies)"}</p>
        <p className="text-xs text-gray-500">{fmtDate(range.from)} – {fmtDate(range.to)} · generated {fmtDateTime(new Date())}</p>
      </div>

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div className="w-40"><label className="label">From</label><input type="date" name="from" defaultValue={range.from.toISOString().slice(0, 10)} className="input" /></div>
        <div className="w-40"><label className="label">To</label><input type="date" name="to" defaultValue={range.to.toISOString().slice(0, 10)} className="input" /></div>
        <button className="btn-primary" type="submit">Apply</button>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b-2 border-gray-300 bg-gray-50">
            <tr>
              <th className="table-th">Applied On</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Source</th>
              <th className="table-th">Kind</th>
              <th className="table-th">Customer</th>
              <th className="table-th">Invoice</th>
              <th className="table-th text-right">Amount</th>
              <th className="table-th">Source Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r, i) => (
              <tr key={i} className={r.sourceStatus !== "Posted" ? "opacity-50" : ""}>
                <td className="table-td whitespace-nowrap text-xs">{fmtDateTime(r.when)}</td>
                {scope.combined && <td className="table-td"><CompanyTag name={r.company} /></td>}
                <td className="table-td"><Link href={r.sourceHref} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{r.source}</Link></td>
                <td className="table-td text-xs text-gray-500">{r.kind}</td>
                <td className="table-td text-sm">{r.customer}</td>
                <td className="table-td"><Link href={r.invoiceHref} className="font-mono text-xs text-emerald-700 hover:underline">{r.invoice}</Link></td>
                <td className="table-td text-right font-semibold">{peso(r.amount)}</td>
                <td className="table-td text-xs">{r.sourceStatus}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={scope.combined ? 8 : 7} className="p-8 text-center text-sm text-gray-500">No credit applications in this period.</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <tr>
                <td colSpan={scope.combined ? 6 : 5} className="table-td">TOTAL APPLIED (posted sources)</td>
                <td className="table-td text-right text-emerald-800">{peso(total)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Applications whose source was later voided are greyed out — their effect on the invoice was reversed.
      </p>
    </div>
  );
}
