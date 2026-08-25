import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { getPnl, parseRange } from "@/lib/reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

export default async function PnlPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  await requirePerm("reports");
  const company = await getActiveCompany();
  const range = parseRange(searchParams);
  const r = await getPnl(range, company.id);
  const fromStr = range.from.toISOString().slice(0, 10);
  const toStr = range.to.toISOString().slice(0, 10);

  return (
    <div className="print-page mx-auto max-w-2xl">
      <PageHeader title="Income Statement (P&L)">
        <a href={`/api/export/pnl?from=${fromStr}&to=${toStr}`} className="btn-secondary no-print">⬇ Excel</a>
        <span className="no-print"><PrintButton /></span>
      </PageHeader>

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <div className="card">
        <p className="mb-4 text-center text-sm text-gray-500">Teamagro Trading Corp. · {fmtDate(range.from)} – {fmtDate(range.to)}</p>
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b border-gray-100"><td className="py-2">Revenue (invoiced sales)</td><td className="py-2 text-right font-semibold">{peso(r.revenue)}</td></tr>
            <tr className="border-b border-gray-100"><td className="py-2">Cost of Goods Sold</td><td className="py-2 text-right">({peso(r.cogs)})</td></tr>
            <tr className="border-b-2 border-gray-300 font-bold"><td className="py-2">Gross Profit</td><td className="py-2 text-right">{peso(r.grossProfit)}</td></tr>
            <tr><td className="pt-3 font-semibold text-gray-600" colSpan={2}>Operating Expenses</td></tr>
            {r.expenses.map((e) => (
              <tr key={e.category} className="border-b border-gray-50"><td className="py-1 pl-4 text-gray-600">{e.category}</td><td className="py-1 text-right">({peso(e.amount)})</td></tr>
            ))}
            <tr className="border-b border-gray-300"><td className="py-2 font-semibold">Total Expenses</td><td className="py-2 text-right">({peso(r.totalExpenses)})</td></tr>
            <tr className={`text-base font-bold ${r.netIncome >= 0 ? "text-emerald-800" : "text-red-600"}`}>
              <td className="py-3">NET INCOME</td><td className="py-3 text-right">{peso(r.netIncome)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
