import { requireReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter } from "@/components/company-filter";
import { getIncomeStatement, parseMonth, type IsLine, type InventoryValue } from "@/lib/income-statement";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

const money = (n: number) => (n === 0 ? "-" : n < 0 ? `(${Math.abs(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function Row({ code, label, amount, indent = 0, bold = false, muted = false, rule = false }: { code?: string; label: string; amount?: number; indent?: number; bold?: boolean; muted?: boolean; rule?: boolean }) {
  return (
    <tr className={`${bold ? "font-semibold" : ""} ${muted ? "text-gray-400" : ""} ${rule ? "border-t border-gray-300" : ""}`}>
      <td className="w-16 py-0.5 pr-2 font-mono text-[11px] text-gray-400">{code ?? ""}</td>
      <td className="py-0.5" style={{ paddingLeft: `${indent * 1.25}rem` }}>{label}</td>
      <td className="py-0.5 pl-4 text-right tabular-nums">{amount === undefined ? "" : money(amount)}</td>
    </tr>
  );
}
const Head = ({ label }: { label: string }) => <tr><td colSpan={3} className="pt-3 pb-0.5 font-bold uppercase tracking-wide text-emerald-900">{label}</td></tr>;
const Lines = ({ lines, indent = 1 }: { lines: IsLine[]; indent?: number }) => <>{lines.map((l) => <Row key={l.code} code={l.code} label={l.description} amount={l.amount} indent={indent} />)}</>;
const Inventory = ({ v }: { v: InventoryValue }) => (
  <>
    <Row label="Good stock" amount={v.good} indent={3} muted />
    <Row label="Labels" amount={v.labels} indent={3} muted />
    <Row label="For label replacement" amount={v.relabel} indent={3} muted />
    <Row label="Reformulation stocks in supplier" amount={v.atSupplier} indent={3} muted />
    <Row label="Obsolete inventory" amount={v.obsolete} indent={3} muted />
  </>
);

export default async function IncomeStatementPage({ searchParams }: { searchParams: { month?: string; company?: string } }) {
  const user = await requireReport("income-statement");
  const scope = await resolveReportScope(user, searchParams.company);
  const { year, month } = parseMonth(searchParams.month);
  const s = await getIncomeStatement(year, month, scope.ids);
  const ym = `${year}-${String(month).padStart(2, "0")}`;

  return (
    <div className="print-page mx-auto max-w-3xl">
      <PageHeader title="Income Statement">
        {user.canExport && <a href={`/api/export/income-statement?month=${ym}&company=${scope.value}`} className="btn-secondary no-print">⬇ Excel</a>}
        {user.canPrint && <span className="no-print"><PrintButton /></span>}
      </PageHeader>

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">Month</label><input type="month" name="month" defaultValue={ym} className="input" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <div className="card">
        <div className="mb-4 text-center">
          <p className="font-bold uppercase">{scope.label}</p>
          <p className="font-semibold">INCOME STATEMENT</p>
          <p className="text-sm text-gray-600">For the month of {s.monthLabel}</p>
        </div>
        <table className="w-full text-sm">
          <tbody>
            <Head label="Sales" />
            <Row code={s.grossSales.code} label="GROSS SALES" amount={s.grossSales.amount} indent={1} />
            {s.discounts.map((l, i) => <Row key={l.code} code={l.code} label={`${i === 0 ? "Less: " : ""}${l.description}`} amount={l.amount} indent={2} />)}
            <Row label="NET SALES" amount={s.netSales} bold rule />

            <Head label="Cost of Sales" />
            <Row code="420001" label="Merchandise Inventory, Beginning" amount={s.beginning.total} indent={1} />
            <Inventory v={s.beginning} />
            <Row code={s.purchases.code} label="Add: Purchases" amount={s.purchases.amount} indent={1} />
            <Row code={s.freightIn.code} label="Freight In" amount={s.freightIn.amount} indent={2} />
            <Row code={s.purchaseReturns.code} label="Purchase Return" amount={s.purchaseReturns.amount} indent={2} />
            <Row code={s.labels.code} label="Labels" amount={s.labels.amount} indent={2} />
            <Row label="Cost Of Goods Available For Sale" amount={s.goodsAvailable} indent={1} bold rule />
            <Row code="420002" label="Less: Merchandise Inventory, Ending" amount={-s.ending.total} indent={1} />
            <Inventory v={s.ending} />
            <Row label="TOTAL COST OF SALES" amount={s.costOfSales} bold rule />
            <Row label={`memo: the goods delivered this month cost ${money(s.costOfGoodsDelivered)} at the cost on each delivery line`} indent={1} muted />

            <Row label="GROSS PROFIT" amount={s.grossProfit} bold rule />

            <Head label="Operating Expenses" />
            <Row label="ADMINISTRATIVE EXPENSE" indent={1} bold />
            <Lines lines={s.admin} indent={2} />
            <Row label="TOTAL ADMINISTRATIVE EXPENSES" amount={s.adminTotal} indent={1} bold rule />
            <Row label="MARKETING & SALES" indent={1} bold />
            <Lines lines={s.marketing} indent={2} />
            <Row label="TOTAL SALES & MARKETING EXPENSES" amount={s.marketingTotal} indent={1} bold rule />
            <Row label="TOTAL EXPENSES" amount={s.totalExpenses} bold rule />

            <Row label="NET INCOME (LOSS) BEFORE OTHER INCOME (EXPENSE)" amount={s.incomeBeforeOther} bold rule />

            <Head label="Add: Other Income" />
            <Lines lines={s.otherIncome} indent={2} />
            <Row label="TOTAL OTHER INCOME" amount={s.otherIncomeTotal} indent={1} bold rule />
            <Head label="Less: Other Expense" />
            <Lines lines={s.otherExpense} indent={2} />
            <Row label="TOTAL OTHER EXPENSE" amount={s.otherExpenseTotal} indent={1} bold rule />
            <Row code={s.incomeTax.code} label="Less: Income Tax Expense" amount={s.incomeTax.amount} indent={1} />
            <tr className={`border-t-2 border-gray-400 text-base font-bold ${s.netIncome >= 0 ? "text-emerald-800" : "text-red-600"}`}>
              <td className="py-2"></td><td className="py-2">NET INCOME</td><td className="py-2 pl-4 text-right tabular-nums">{money(s.netIncome)}</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-10 grid grid-cols-2 gap-8 text-xs text-gray-600">
          <div><p>Prepared by:</p><p className="mt-8 border-t border-gray-400 pt-1">&nbsp;</p></div>
          <div><p>Reviewed by:</p><p className="mt-8 border-t border-gray-400 pt-1">&nbsp;</p></div>
        </div>
        <p className="mt-6 text-[11px] text-gray-400">
          Built from the ledger entries of the month, aggregated per GL account, and the Merchandise Inventory valuation at the start and end of the month
          (good stock at the cost in force that month, labels, and the stock for label replacement, at the supplier and obsolete). Cost of sales is beginning
          stock plus purchases less ending stock, as the books compute it.
        </p>
      </div>
    </div>
  );
}
