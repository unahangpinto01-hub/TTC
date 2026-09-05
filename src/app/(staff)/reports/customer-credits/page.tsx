import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { PrintButton, BackButton } from "@/components/print-button";
import { unappliedOf } from "@/lib/receive-payments";
import { remainingOf } from "@/lib/refunds-credits";

/** Customer Credit Balance / Unused Credits: ONE combined pot per customer —
    unapplied posted payments plus open credit memos, itemised per source. */
export default async function CustomerCreditsPage({ searchParams }: { searchParams: { company?: string } }) {
  const user = await requirePerm("reports");
  const scope = await resolveReportScope(user, searchParams.company);

  const [payments, credits] = await Promise.all([
    prisma.receivePayment.findMany({
      where: { companyId: { in: scope.ids }, status: "Posted" },
      include: {
        company: { select: { companyName: true } },
        customer: { select: { id: true, businessName: true } },
        applications: { select: { amount: true } },
        refunds: { where: { status: "Posted" }, select: { amount: true, status: true } },
      },
    }),
    prisma.refundCredit.findMany({
      where: { companyId: { in: scope.ids }, type: "Credit", status: "Posted" },
      include: {
        company: { select: { companyName: true } },
        customer: { select: { id: true, businessName: true } },
        applications: { select: { amount: true } },
        refundsDrawn: { where: { status: "Posted" }, select: { amount: true, status: true } },
      },
    }),
  ]);

  type SourceRow = { kind: string; href: string; number: string; date: Date; company: string; original: number; available: number };
  const byCustomer = new Map<string, { name: string; rows: SourceRow[] }>();
  const put = (customerId: string, name: string, row: SourceRow) => {
    const g = byCustomer.get(customerId) ?? { name, rows: [] };
    g.rows.push(row);
    byCustomer.set(customerId, g);
  };
  for (const p of payments) {
    const avail = unappliedOf(p);
    if (avail > 0.005) put(p.customer.id, p.customer.businessName, {
      kind: "Unapplied Payment", href: `/payments/${p.id}`, number: p.prNumber, date: p.date,
      company: p.company.companyName, original: p.amount, available: avail,
    });
  }
  for (const c of credits) {
    const avail = remainingOf(c);
    if (avail > 0.005) put(c.customer.id, c.customer.businessName, {
      kind: "Credit Memo", href: `/refunds/${c.id}`, number: c.rcNumber, date: c.date,
      company: c.company.companyName, original: c.amount, available: avail,
    });
  }
  const groups = [...byCustomer.values()]
    .map((g) => ({ ...g, total: g.rows.reduce((s, r) => s + r.available, 0) }))
    .sort((a, b) => b.total - a.total);
  const grand = groups.reduce((s, g) => s + g.total, 0);

  return (
    <div className="print-page">
      <div className="no-print mb-3 flex items-center justify-between">
        <BackButton />
        <PrintButton />
      </div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">{scope.company.companyName}</h1>
        <p className="text-sm text-gray-600">Customer Credit Balances / Unused Credits{scope.combined && " · Combined (All Companies)"}</p>
        <p className="text-xs text-gray-500">as of {fmtDateTime(new Date())}</p>
      </div>
      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        {scope.options.length > 1 && <button className="btn-secondary" type="submit">Apply</button>}
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b-2 border-gray-300 bg-gray-50">
            <tr>
              <th className="table-th">Customer / Source</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Kind</th>
              <th className="table-th">Date</th>
              <th className="table-th text-right">Original</th>
              <th className="table-th text-right">Available Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {groups.map((g) => (
              <>
                <tr key={g.name} className="bg-emerald-50/80 font-bold text-emerald-900">
                  <td className="px-3 py-1.5" colSpan={scope.combined ? 5 : 4}>{g.name}</td>
                  <td className="px-3 py-1.5 text-right">{peso(g.total)}</td>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.number}>
                    <td className="table-td pl-6">
                      <Link href={r.href} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{r.number}</Link>
                    </td>
                    {scope.combined && <td className="table-td"><CompanyTag name={r.company} /></td>}
                    <td className="table-td text-xs text-gray-500">{r.kind}</td>
                    <td className="table-td whitespace-nowrap text-xs">{fmtDate(r.date)}</td>
                    <td className="table-td text-right">{peso(r.original)}</td>
                    <td className="table-td text-right font-semibold text-amber-700">{peso(r.available)}</td>
                  </tr>
                ))}
              </>
            ))}
            {!groups.length && (
              <tr><td colSpan={scope.combined ? 6 : 5} className="p-8 text-center text-sm text-gray-500">No customer holds unused credit.</td></tr>
            )}
          </tbody>
          {groups.length > 0 && (
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <tr>
                <td colSpan={scope.combined ? 5 : 4} className="table-td">TOTAL CREDIT HELD</td>
                <td className="table-td text-right text-amber-700">{peso(grand)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        One combined balance per customer: unapplied posted payments and open credit memos. Apply credit from the
        source document&rsquo;s own page; cash refunds drawn from a source reduce it here automatically.
      </p>
    </div>
  );
}
