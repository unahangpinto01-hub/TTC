import { requirePerm } from "@/lib/auth";
import { canExportReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter } from "@/components/company-filter";
import { getExpenseReport, parseRange } from "@/lib/reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { getPerm } from "@/lib/permissions";
import { periodLabel, periodStatus, getCutoff, inCutoffWindow } from "@/lib/vouchers";
import { setAccountingPeriod, saveCutoffConfig } from "../actions";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const NOTES: Record<string, string> = { period: "Pick a valid period and status." };
const OK: Record<string, string> = { period: "Accounting period updated.", cutoff: "Year-end cutoff saved." };

/**
 * The Expense Report: what the company spent in an accounting period — every non-inventory
 * bill line and every posted voucher item, by account. Also home to the accounting period
 * and year-end cutoff controls, which govern what may still be posted into a month.
 */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; company?: string; year?: string; month?: string; error?: string; saved?: string };
}) {
  const user = await requirePerm("expenses");
  const canExport = await canExportReport(user, "expenses");
  const canPriorPeriod = getPerm(user, "priorPeriod") !== "NONE";
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);

  const now = new Date();
  const year = Number(searchParams.year) || now.getFullYear();
  const month = Number(searchParams.month) || 0; // 0 = whole year
  const { bills, total, byCategory } = await getExpenseReport(range, scope.ids, { year, month: month || null });
  const cutoff = await getCutoff();
  const inCutoff = inCutoffWindow(now, cutoff);
  const shownStatus = month ? await periodStatus(scope.company.id, year, month) : null;

  const years = Array.from(new Set([now.getFullYear(), now.getFullYear() - 1, year])).sort((a, b) => b - a);
  const q = new URLSearchParams({ year: String(year), ...(month ? { month: String(month) } : {}), company: scope.value }).toString();

  return (
    <div>
      <PageHeader title="Expense Report">
        {canExport && <a href={`/api/export/expenses?${q}`} className="btn-secondary">⬇ Excel</a>}
      </PageHeader>

      {searchParams.error && NOTES[searchParams.error] && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">⚠ {NOTES[searchParams.error]}</p>}
      {searchParams.saved && OK[searchParams.saved] && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✔ {OK[searchParams.saved]}</p>}
      {inCutoff && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="font-semibold">Year-end cutoff is open</span> until {cutoff.lastDay} January. A late {now.getFullYear() - 1} bill or voucher
          entered now should keep its <strong>December {now.getFullYear() - 1}</strong> date, so it lands in December and takes a {now.getFullYear() - 1} number.
        </p>
      )}

      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div>
          <label className="label">Accounting Year</label>
          <select name="year" defaultValue={String(year)} className="input max-w-[120px]">{years.map((y) => <option key={y}>{y}</option>)}</select>
        </div>
        <div>
          <label className="label">Accounting Period</label>
          <select name="month" defaultValue={String(month)} className="input max-w-[160px]">
            <option value="0">Whole year</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card py-3">
          <p className="text-xs text-gray-500">{month ? periodLabel(year, month) : `Year ${year}`}</p>
          <p className="text-lg font-bold">{peso(total)}</p>
          <p className="text-xs text-gray-500">
            {bills.length} line(s)
            {shownStatus && shownStatus !== "Open" && <span className={shownStatus === "Locked" ? "ml-1 font-semibold text-red-600" : "ml-1 font-semibold text-amber-600"}>· {shownStatus}</span>}
          </p>
        </div>
        {byCategory.slice(0, 3).map((c) => (
          <div key={c.category} className="card py-3"><p className="text-xs text-gray-500">{c.category}</p><p className="text-lg font-bold">{peso(c.amount)}</p></div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-2 font-semibold">Non-inventory bills and posted vouchers <span className="text-sm font-normal text-gray-500">(accrued expenses, ex-VAT)</span></h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[900px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="table-th">Bill / DV No.</th><th className="table-th">Date</th><th className="table-th">Period</th><th className="table-th">Payee</th>
                  <th className="table-th">Account</th><th className="table-th">Description</th><th className="table-th">Status</th><th className="table-th text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bills.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="table-td"><a href={b.href} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{b.billNo}</a></td>
                    <td className="table-td whitespace-nowrap text-sm">{fmtDate(b.billDate)}</td>
                    <td className="table-td whitespace-nowrap text-xs text-gray-600">{b.accountingYear ? periodLabel(b.accountingYear, b.accountingMonth) : "—"}</td>
                    <td className="table-td text-sm">{b.supplier}</td>
                    <td className="table-td text-sm">{b.account}</td>
                    <td className="table-td text-sm text-gray-600">{b.description || "—"}</td>
                    <td className="table-td text-xs">{b.status}</td>
                    <td className="table-td text-right font-semibold">{peso(b.amount)}</td>
                  </tr>
                ))}
                {!bills.length && <tr><td colSpan={8} className="p-8 text-center text-sm text-gray-500">No expenses in {month ? periodLabel(year, month) : year}.</td></tr>}
              </tbody>
              {bills.length > 0 && <tfoot className="border-t border-gray-200 bg-gray-50 font-bold"><tr><td className="table-td" colSpan={7}>TOTAL</td><td className="table-td text-right">{peso(total)}</td></tr></tfoot>}
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Listed by <span className="font-semibold">accounting period</span>, which comes from the bill or voucher date — a December document
            entered in January appears under December. Expenses are entered as <a href="/bills/expense" className="font-semibold text-emerald-700 hover:underline">Non-Inventory Bills</a> or
            as items on a <a href="/dv" className="font-semibold text-emerald-700 hover:underline">Disbursement Voucher</a>.
          </p>
        </div>

        <div className="space-y-4">
          <div className="card">
            <h2 className="mb-2 font-semibold">By account</h2>
            <table className="w-full text-sm"><tbody className="divide-y divide-gray-100">
              {byCategory.map((c) => <tr key={c.category}><td className="py-1">{c.category}</td><td className="py-1 text-right font-semibold">{peso(c.amount)}</td></tr>)}
              {!byCategory.length && <tr><td className="py-2 text-center text-xs text-gray-500" colSpan={2}>Nothing yet.</td></tr>}
            </tbody></table>
          </div>
          {canPriorPeriod && (
            <>
              <form action={setAccountingPeriod} className="card space-y-2">
                <h2 className="font-semibold">Accounting Period</h2>
                <p className="text-xs text-gray-500">
                  A period is Open until you change it. <strong>Locked</strong> stops bills and vouchers being posted into it
                  unless the person holds Prior-Period Adjustment and gives a reason.
                </p>
                <div className="flex flex-wrap gap-2">
                  <select name="month" defaultValue={String(month || now.getMonth() + 1)} className="input max-w-[130px]">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
                  <select name="year" defaultValue={String(year)} className="input max-w-[100px]">{years.map((y) => <option key={y}>{y}</option>)}</select>
                  <select name="status" defaultValue={shownStatus ?? "Open"} className="input max-w-[120px]"><option>Open</option><option>Closing</option><option>Locked</option></select>
                </div>
                <button className="btn-secondary" type="submit">Set Period Status</button>
              </form>
              <form action={saveCutoffConfig} className="card space-y-2">
                <h2 className="font-semibold">Year-End Cutoff</h2>
                <p className="text-xs text-gray-500">The window each January in which late December documents may still be dated 31 December.</p>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="cutoffEnabled" defaultChecked={cutoff.enabled} className="h-4 w-4" /> Accept late December entries</label>
                <div><label className="label">Open until January</label><input name="cutoffLastDay" type="number" min={1} max={31} defaultValue={cutoff.lastDay} className="input max-w-[110px]" /></div>
                <button className="btn-secondary" type="submit">Save Cutoff</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
