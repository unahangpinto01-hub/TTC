import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter } from "@/components/company-filter";
import { getExpenseReport, parseRange } from "@/lib/reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { createExpense } from "../actions";
import { SearchSelect } from "@/components/search-select";

const CATEGORIES = ["Fuel", "Salaries", "Utilities", "Freight", "Rent", "Supplies", "Others"];

export default async function ExpensesPage({ searchParams }: { searchParams: { from?: string; to?: string; company?: string } }) {
  const user = await requirePerm("expenses");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const { expenses, total, byCategory, byCompany } = await getExpenseReport(range, scope.ids);
  const today = new Date().toISOString().slice(0, 10);
  const fromStr = range.from.toISOString().slice(0, 10);
  const toStr = range.to.toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader title="Expenses">
        <a href={`/api/export/expenses?from=${fromStr}&to=${toStr}&company=${scope.value}`} className="btn-secondary">⬇ Excel</a>
      </PageHeader>

      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card py-3"><p className="text-xs text-gray-500">Total ({fmtDate(range.from)} – {fmtDate(range.to)})</p><p className="text-lg font-bold">{peso(total)}</p></div>
        {byCategory.slice(0, 3).map((c) => (
          <div key={c.category} className="card py-3"><p className="text-xs text-gray-500">{c.category}</p><p className="text-lg font-bold">{peso(c.amount)}</p></div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[560px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr><th className="table-th">Date</th><th className="table-th">Category</th><th className="table-th">Notes</th><th className="table-th text-right">Amount</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="table-td">{fmtDate(e.date)}</td>
                    <td className="table-td">{e.category}</td>
                    <td className="table-td text-sm text-gray-600">{e.notes ?? "—"}</td>
                    <td className="table-td text-right">{peso(e.amount)}</td>
                  </tr>
                ))}
                {!expenses.length && <tr><td colSpan={4} className="p-8 text-center text-sm text-gray-500">No expenses in this range.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <form action={createExpense} className="card h-fit space-y-3">
          <h2 className="font-semibold">Add Expense</h2>
          <div><label className="label">Date</label><input type="date" name="date" defaultValue={today} required className="input" /></div>
          <div><label className="label">Category</label>
            <select name="category" className="input">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label">Amount (₱)</label><input name="amount" type="number" step="0.01" min="0.01" required className="input" /></div>
          <div>
            <label className="label">GL Account (Chart of Accounts)</label>
            <SearchSelect entity="gl-accounts" name="glAccountId" params={{ statement: "IS" }} placeholder="Type account code or name…" />
          </div>
          <div><label className="label">Notes</label><input name="notes" className="input" /></div>
          <button className="btn-primary" type="submit">Save Expense</button>
        </form>
      </div>
    </div>
  );
}
