import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { parseRange } from "@/lib/reports";
import { getCashReceiptsJournal } from "@/lib/cash-receipts";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Every peso that came in, in date order, with the accounts credited — the cash receipts book. */
export default async function CashReceiptsJournalPage({ searchParams }: { searchParams: { from?: string; to?: string; company?: string; account?: string; q?: string } }) {
  const user = await requireReport("cash-receipts");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const cashAccountId = searchParams.account || "";
  const q = searchParams.q?.trim() || "";
  const [j, accounts] = await Promise.all([
    getCashReceiptsJournal(range, scope.ids, { cashAccountId: cashAccountId || undefined, q: q || undefined }),
    prisma.cashAccount.findMany({ where: { companyId: { in: scope.ids } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const qs = new URLSearchParams({ from: ymd(range.from), to: ymd(range.to), company: scope.value });
  if (cashAccountId) qs.set("account", cashAccountId);
  if (q) qs.set("q", q);

  return (
    <div className="print-page">
      <PageHeader title="Cash Receipts Journal">
        {user.canExport && <a href={`/api/export/cash-receipts?${qs.toString()}`} className="btn-secondary no-print">⬇ Excel</a>}
        {user.canPrint && <span className="no-print"><PrintButton /></span>}
      </PageHeader>

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={ymd(range.from)} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={ymd(range.to)} className="input" /></div>
        <div><label className="label">Cash / Bank</label><select name="account" defaultValue={cashAccountId} className="input"><option value="">All accounts</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div><label className="label">Payor / No. / Ref</label><input name="q" defaultValue={q} className="input w-44" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <p className="mb-3 text-sm text-gray-600">
        <span className="font-semibold">{scope.label}</span> · {fmtDate(range.from)} – {fmtDate(range.to)} · {j.rows.length} receipt{j.rows.length === 1 ? "" : "s"} · Cash in{" "}
        <span className="font-bold text-emerald-800">{peso(j.total)}</span> · customers {peso(j.customerTotal)} · other {peso(j.otherTotal)}
      </p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1080px] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Date</th>
              <th className="table-th">No.</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Payor</th>
              <th className="table-th">Reference</th>
              <th className="table-th">Bank / Cash (Dr)</th>
              <th className="table-th text-right">Amount</th>
              <th className="table-th">Credited to</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {j.rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="table-td whitespace-nowrap">{fmtDate(r.date)}</td>
                <td className="table-td"><Link href={r.href} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{r.docNo}</Link><span className="block text-[10px] text-gray-500">{r.kind}</span></td>
                {scope.combined && <td className="table-td"><CompanyTag name={r.company} /></td>}
                <td className="table-td">{r.payor}</td>
                <td className="table-td text-xs text-gray-600">{r.reference || "—"}<span className="block text-[10px] text-gray-500">{r.method}</span></td>
                <td className="table-td text-sm">{r.cashAccount}</td>
                <td className="table-td text-right font-semibold">{peso(r.amount)}</td>
                <td className="table-td text-xs">
                  {r.credits.map((c, i) => <span key={i} className="block">{c.code && <span className="font-mono text-gray-500">{c.code} </span>}{c.name} <span className="font-semibold">{peso(c.amount)}</span></span>)}
                </td>
              </tr>
            ))}
            {!j.rows.length && <tr><td colSpan={scope.combined ? 8 : 7} className="p-6 text-center text-sm text-gray-500">No receipts in this period.</td></tr>}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
            <tr><td className="table-td" colSpan={scope.combined ? 6 : 5}>TOTAL CASH IN</td><td className="table-td text-right">{peso(j.total)}</td><td /></tr>
          </tfoot>
        </table>
      </div>

      {j.byAccount.length > 0 && (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div>
            <h2 className="mb-2 font-semibold">Credits by account <span className="text-sm font-normal text-gray-500">— the journal&rsquo;s column totals</span></h2>
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200 bg-gray-50"><tr><th className="table-th">Account</th><th className="table-th text-right">Receipts</th><th className="table-th text-right">Amount</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {j.byAccount.map((a) => <tr key={`${a.code}|${a.name}`}><td className="table-td"><span className="font-mono text-xs text-gray-500">{a.code}</span> {a.name}</td><td className="table-td text-right text-gray-600">{a.count}</td><td className="table-td text-right font-semibold">{peso(a.amount)}</td></tr>)}
                </tbody>
                <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold"><tr><td className="table-td">TOTAL</td><td /><td className="table-td text-right">{peso(j.total)}</td></tr></tfoot>
              </table>
            </div>
          </div>
          <div>
            <h2 className="mb-2 font-semibold">Debits by bank / cash account</h2>
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200 bg-gray-50"><tr><th className="table-th">Account</th><th className="table-th text-right">Receipts</th><th className="table-th text-right">Amount</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {j.byCash.map((a) => <tr key={a.name}><td className="table-td">{a.name}</td><td className="table-td text-right text-gray-600">{a.count}</td><td className="table-td text-right font-semibold">{peso(a.amount)}</td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      <p className="mt-2 text-xs text-gray-500">Posted receipts only. A customer collection credits Accounts Receivable for what was applied on posting and Advances from Customers for the rest; discounts are not cash and are not here. Credit applied to an invoice later is not a receipt either.</p>
    </div>
  );
}
