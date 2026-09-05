import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { PrintButton, BackButton } from "@/components/print-button";
import { unappliedOf } from "@/lib/receive-payments";

/** Every posted payment still holding customer credit — money received but not yet
    applied to an invoice. Apply it from the payment's own page. */
export default async function UnappliedPaymentsPage({ searchParams }: { searchParams: { company?: string } }) {
  const user = await requirePerm("reports");
  const scope = await resolveReportScope(user, searchParams.company);

  const posted = await prisma.receivePayment.findMany({
    where: { companyId: { in: scope.ids }, status: "Posted" },
    include: {
      company: { select: { companyName: true } },
      customer: { select: { businessName: true } },
      applications: { select: { amount: true } },
    },
    orderBy: { date: "asc" },
  });
  const rows = posted
    .map((p) => ({ p, applied: p.applications.reduce((s, a) => s + a.amount, 0), unapplied: unappliedOf(p) }))
    .filter((r) => r.unapplied > 0.005);
  const total = rows.reduce((s, r) => s + r.unapplied, 0);

  return (
    <div className="print-page">
      <div className="no-print mb-3 flex items-center justify-between">
        <BackButton />
        <PrintButton />
      </div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">{scope.company.companyName}</h1>
        <p className="text-sm text-gray-600">Unapplied Payments / Customer Credits{scope.combined && " · Combined (All Companies)"}</p>
        <p className="text-xs text-gray-500">as of {fmtDateTime(new Date())}</p>
      </div>
      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        {scope.options.length > 1 && <button className="btn-secondary" type="submit">Apply</button>}
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b-2 border-gray-300 bg-gray-50">
            <tr>
              <th className="table-th">PR No.</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Date</th>
              <th className="table-th">Customer</th>
              <th className="table-th text-right">Original Payment</th>
              <th className="table-th text-right">Applied</th>
              <th className="table-th text-right">Unapplied Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(({ p, applied, unapplied }) => (
              <tr key={p.id}>
                <td className="table-td">
                  <Link href={`/payments/${p.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{p.prNumber}</Link>
                </td>
                {scope.combined && <td className="table-td"><CompanyTag name={p.company.companyName} /></td>}
                <td className="table-td whitespace-nowrap text-sm">{fmtDate(p.date)}</td>
                <td className="table-td text-sm">{p.customer.businessName}</td>
                <td className="table-td text-right">{peso(p.amount)}</td>
                <td className="table-td text-right">{peso(applied)}</td>
                <td className="table-td text-right font-bold text-amber-700">{peso(unapplied)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={scope.combined ? 7 : 6} className="p-8 text-center text-sm text-gray-500">No unapplied customer credit — every posted payment is fully applied.</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <tr>
                <td colSpan={scope.combined ? 6 : 5} className="table-td">TOTAL CUSTOMER CREDIT</td>
                <td className="table-td text-right text-amber-700" colSpan={1}>{peso(total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Credit is applied to an open invoice from the payment&rsquo;s own page. It stays with the customer and the
        company that received it.
      </p>
    </div>
  );
}
