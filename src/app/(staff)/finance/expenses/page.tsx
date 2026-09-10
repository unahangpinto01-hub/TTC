import { requirePerm } from "@/lib/auth";
import { canExportReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter } from "@/components/company-filter";
import { getExpenseReport, parseRange } from "@/lib/reports";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { getPerm } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import {
  periodOf, periodLabel, periodStatus, getCutoff, inCutoffWindow, companyCode,
} from "@/lib/vouchers";
import { createExpense, editVoucherNumber, setAccountingPeriod, saveCutoffConfig } from "../actions";
import { SearchSelect } from "@/components/search-select";
import { VoucherNoEditor } from "./voucher-no-editor";

const CATEGORIES = ["Fuel", "Salaries", "Utilities", "Freight", "Rent", "Supplies", "Others"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const NOTES: Record<string, string> = {
  locked: "That voucher date falls in a locked period, and you do not have Prior-Period Adjustment permission.",
  reason: "A voucher dated in a locked period needs a reason of at least a few words.",
  gl: "Pick a valid GL account.",
  missing: "That voucher no longer exists, or belongs to another company.",
  vno: "Enter the voucher number.",
  vreason: "Changing a voucher number needs a reason.",
  dupe: "That voucher number is already used by another voucher in this company.",
  period: "Pick a valid period and status.",
};
const OK: Record<string, string> = {
  ok: "Voucher recorded.",
  vno: "Voucher number changed. The original is kept in the audit trail.",
  period: "Accounting period updated.",
  cutoff: "Year-end cutoff saved.",
  none: "Nothing changed.",
};

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; company?: string; year?: string; month?: string; error?: string; saved?: string };
}) {
  const user = await requirePerm("expenses");
  const canExport = await canExportReport(user, "expenses");
  const canEditVoucherNo = getPerm(user, "voucherNumber") !== "NONE";
  const canPriorPeriod = getPerm(user, "priorPeriod") !== "NONE";
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);

  const now = new Date();
  const year = Number(searchParams.year) || now.getFullYear();
  const month = Number(searchParams.month) || 0; // 0 = whole year
  const { expenses, total, byCategory } = await getExpenseReport(range, scope.ids, { year, month: month || null });

  const [company, cutoff] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: scope.company.id }, select: { code: true, companyName: true } }),
    getCutoff(),
  ]);
  const inCutoff = inCutoffWindow(now, cutoff);
  // the period the form will default to, and whether it is still accepting entries
  const defaultVoucher = inCutoff ? new Date(now.getFullYear() - 1, 11, 31) : now;
  const dp = periodOf(defaultVoucher);
  const defaultStatus = await periodStatus(scope.company.id, dp.year, dp.month);
  const shownStatus = month ? await periodStatus(scope.company.id, year, month) : null;

  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const years = Array.from(new Set([now.getFullYear(), now.getFullYear() - 1, year])).sort((a, b) => b - a);
  const q = new URLSearchParams({ year: String(year), ...(month ? { month: String(month) } : {}), company: scope.value }).toString();

  return (
    <div>
      <PageHeader title="Expense Vouchers">
        {canExport && <a href={`/api/export/expenses?${q}`} className="btn-secondary">⬇ Excel</a>}
      </PageHeader>

      {searchParams.error && NOTES[searchParams.error] && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">⚠ {NOTES[searchParams.error]}</p>
      )}
      {searchParams.saved && OK[searchParams.saved] && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✔ {OK[searchParams.saved]}</p>
      )}
      {inCutoff && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="font-semibold">Year-end cutoff is open</span> until {cutoff.lastDay} January. A late{" "}
          {now.getFullYear() - 1} expense entered now should keep <strong>31 December {now.getFullYear() - 1}</strong> as
          its voucher date, so it takes a {now.getFullYear() - 1} number and lands in December. A genuine{" "}
          {now.getFullYear()} expense keeps today&rsquo;s date and starts the {now.getFullYear()} series.
        </p>
      )}

      {/* ------------------------------------------------- accounting period filter */}
      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div>
          <label className="label">Accounting Year</label>
          <select name="year" defaultValue={String(year)} className="input max-w-[120px]">
            {years.map((y) => <option key={y}>{y}</option>)}
          </select>
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
            {expenses.length} voucher(s)
            {shownStatus && shownStatus !== "Open" && (
              <span className={shownStatus === "Locked" ? "ml-1 font-semibold text-red-600" : "ml-1 font-semibold text-amber-600"}>
                · {shownStatus}
              </span>
            )}
          </p>
        </div>
        {byCategory.slice(0, 3).map((c) => (
          <div key={c.category} className="card py-3"><p className="text-xs text-gray-500">{c.category}</p><p className="text-lg font-bold">{peso(c.amount)}</p></div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[980px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="table-th">Voucher No.</th>
                  <th className="table-th">Voucher Date</th>
                  <th className="table-th">Actual Expense</th>
                  <th className="table-th">Received</th>
                  <th className="table-th">Encoded</th>
                  <th className="table-th">Period</th>
                  <th className="table-th">Payee</th>
                  <th className="table-th">Category</th>
                  <th className="table-th">Description</th>
                  <th className="table-th text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {expenses.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="table-td font-mono text-xs font-semibold text-gray-700">
                      {e.voucherNo ?? "—"}
                      {e.priorYearEntry && (
                        <span
                          className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-800"
                          title="Entered in a later calendar year than it is dated"
                        >
                          PRIOR YR
                        </span>
                      )}
                      {canEditVoucherNo && <VoucherNoEditor id={e.id} voucherNo={e.voucherNo ?? ""} action={editVoucherNumber} />}
                    </td>
                    <td className="table-td whitespace-nowrap text-sm font-medium">{fmtDate(e.voucherDate)}</td>
                    <td className="table-td whitespace-nowrap text-sm">{fmtDate(e.date)}</td>
                    <td className="table-td whitespace-nowrap text-sm text-gray-600">{e.receivedDate ? fmtDate(e.receivedDate) : "—"}</td>
                    <td className="table-td whitespace-nowrap text-xs text-gray-500">{fmtDateTime(e.createdAt)}</td>
                    <td className="table-td whitespace-nowrap text-xs text-gray-600">
                      {e.accountingYear ? periodLabel(e.accountingYear, e.accountingMonth) : "—"}
                    </td>
                    <td className="table-td text-sm">{e.payee ?? "—"}</td>
                    <td className="table-td text-sm">{e.category}</td>
                    <td className="table-td text-sm text-gray-600">{e.notes ?? "—"}</td>
                    <td className="table-td text-right font-semibold">{peso(e.amount)}</td>
                  </tr>
                ))}
                {!expenses.length && (
                  <tr><td colSpan={10} className="p-8 text-center text-sm text-gray-500">
                    No vouchers in {month ? periodLabel(year, month) : year}.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Vouchers are listed by <span className="font-semibold">accounting period</span>, which comes from the voucher
            date — a December voucher encoded in January appears under December, not January.
          </p>
        </div>

        {/* ---------------------------------------------------------- new voucher */}
        <div className="space-y-4">
          <form action={createExpense} className="card h-fit space-y-3">
            <h2 className="font-semibold">New Expense Voucher</h2>
            <p className="text-xs text-gray-500">
              Next number: <span className="font-mono font-semibold">EV-{companyCode(company)}-{dp.year}-…</span> — drawn
              from the voucher date&rsquo;s own series.
            </p>
            <div>
              <label className="label">Voucher Date</label>
              <input type="date" name="voucherDate" defaultValue={ymd(defaultVoucher)} required className="input" />
              <p className="mt-0.5 text-xs text-gray-500">
                Sets the number series and the accounting period{defaultStatus !== "Open" ? ` — ${periodLabel(dp.year, dp.month)} is ${defaultStatus}` : ""}.
              </p>
            </div>
            <div><label className="label">Actual Expense Date</label><input type="date" name="date" defaultValue={ymd(now)} required className="input" /></div>
            <div><label className="label">Date Received</label><input type="date" name="receivedDate" defaultValue={ymd(now)} className="input" /></div>
            <div><label className="label">Payee</label><input name="payee" className="input" placeholder="who was paid" /></div>
            <div>
              <label className="label">Category</label>
              <select name="category" className="input">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
            </div>
            <div><label className="label">Amount (₱)</label><input name="amount" type="number" step="0.01" min="0.01" required className="input" /></div>
            <div>
              <label className="label">GL Account (Chart of Accounts)</label>
              <SearchSelect entity="gl-accounts" name="glAccountId" params={{ statement: "IS" }} placeholder="Type account code or name…" />
            </div>
            <div><label className="label">Description</label><input name="notes" className="input" /></div>
            {canPriorPeriod && (
              <div>
                <label className="label">Reason (only if the period is locked)</label>
                <input name="periodReason" className="input" placeholder="why this is posted to a closed period" />
              </div>
            )}
            <button className="btn-primary" type="submit">Save Voucher</button>
          </form>

          {/* ------------------------------------------------ period & cutoff control */}
          {canPriorPeriod && (
            <>
              <form action={setAccountingPeriod} className="card space-y-2">
                <h2 className="font-semibold">Accounting Period</h2>
                <p className="text-xs text-gray-500">
                  A period is Open until you change it. <strong>Locked</strong> stops new vouchers being dated into it
                  unless the person holds Prior-Period Adjustment and gives a reason.
                </p>
                <div className="flex flex-wrap gap-2">
                  <select name="month" defaultValue={String(month || now.getMonth() + 1)} className="input max-w-[130px]">
                    {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                  </select>
                  <select name="year" defaultValue={String(year)} className="input max-w-[100px]">
                    {years.map((y) => <option key={y}>{y}</option>)}
                  </select>
                  <select name="status" defaultValue={shownStatus ?? "Open"} className="input max-w-[120px]">
                    <option>Open</option><option>Closing</option><option>Locked</option>
                  </select>
                </div>
                <button className="btn-secondary" type="submit">Set Period Status</button>
              </form>

              <form action={saveCutoffConfig} className="card space-y-2">
                <h2 className="font-semibold">Year-End Cutoff</h2>
                <p className="text-xs text-gray-500">
                  The window each January in which late December vouchers may still be dated 31 December.
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="cutoffEnabled" defaultChecked={cutoff.enabled} className="h-4 w-4" />
                  Accept late December entries
                </label>
                <div>
                  <label className="label">Open until January</label>
                  <input name="cutoffLastDay" type="number" min={1} max={31} defaultValue={cutoff.lastDay} className="input max-w-[110px]" />
                </div>
                <button className="btn-secondary" type="submit">Save Cutoff</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
