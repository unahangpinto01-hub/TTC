import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter } from "@/components/company-filter";
import { getLedger, parseRange } from "@/lib/reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";

export default async function LedgerPage({ searchParams }: { searchParams: { from?: string; to?: string; company?: string } }) {
  const user = await requirePerm("ledger");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const entries = await getLedger(range, scope.ids);
  const fromStr = range.from.toISOString().slice(0, 10);
  const toStr = range.to.toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader title="General Ledger (Journal View)" />
      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>
      <p className="mb-3 text-xs text-gray-500">Auto-generated entries from sales, collections, expenses, and inventory receipts.</p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[760px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Date</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Ref</th>
              <th className="table-th">Description</th>
              <th className="table-th">Debit</th>
              <th className="table-th">Credit</th>
              <th className="table-th text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {entries.map((e, i) => (
              <tr key={i}>
                <td className="table-td text-sm">{fmtDate(e.date)}</td>
                {scope.combined && <td className="table-td text-xs text-gray-600">{e.company}</td>}
                <td className="table-td font-mono text-xs">{e.ref}</td>
                <td className="table-td text-sm">{e.description}</td>
                <td className="table-td text-sm font-medium text-emerald-800">{e.debit}</td>
                <td className="table-td text-sm text-gray-600">{e.credit}</td>
                <td className="table-td text-right">{peso(e.amount)}</td>
              </tr>
            ))}
            {!entries.length && <tr><td colSpan={scope.combined ? 7 : 6} className="p-8 text-center text-sm text-gray-500">No entries in this range.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
