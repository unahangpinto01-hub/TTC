import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter } from "@/components/company-filter";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { getCategoryNames } from "@/lib/categories";
import { getSalespeople } from "@/lib/salespeople";
import {
  getSalesMetrics, getArMetrics, getCollectionMetrics, getInventoryMetrics,
  getMonthlyTrend, getForecastVsActual, getCompanyComparison,
  getSalesBreakdown, getCustomerPerformance, getProductPerformance,
  getInventoryPerformance, getPurchasingMetrics, getCreditMetrics,
  buildAlerts, getRecentTransactions,
  previousPeriod, growthPct, type ExecFilters,
} from "@/lib/executive";
import { getPayablesMetrics } from "@/lib/ap-reports";
import { SalesTrendChart, ForecastChart, CompanyBars } from "./charts";
import {
  BreakdownTable, CustomersSection, ProductsSection, ArSection,
  InventorySection, PurchasingSection, AlertsSection, RecentSection,
  MEASURES, type Measure,
} from "./sections";

/** A KPI tile: the figure, and how it moved against the same window a year earlier. */
function Kpi({
  label, value, sub, delta, invert = false, muted = false, comparable = true,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  /** true when going up is bad (receivables, overdue) */
  invert?: boolean;
  muted?: boolean;
  /** false when last year holds no data at all — then the tile says nothing about it */
  comparable?: boolean;
}) {
  const good = delta == null ? null : invert ? delta < 0 : delta > 0;
  return (
    <div className="card py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold ${muted ? "text-gray-400" : "text-emerald-900"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
      {delta != null && (
        <p className={`text-xs font-semibold ${good === null ? "text-gray-400" : good ? "text-emerald-700" : "text-red-600"}`}>
          {delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {Math.abs(delta).toFixed(1)}% vs same period last year
        </p>
      )}
      {comparable && delta === null && sub === undefined && (
        <p className="text-xs text-gray-300">nothing to compare last year</p>
      )}
    </div>
  );
}

const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);
/** yyyy-mm-dd in LOCAL time — toISOString() would shift a Manila midnight back a day. */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const num = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Aug 2026" for a single month, "Jan–Sep 2026" for a span. */
const monthSpan = (a: number, b: number, year: number) =>
  a === b ? `${MONTH_NAMES[a - 1]} ${year}` : `${MONTH_NAMES[a - 1]}–${MONTH_NAMES[b - 1]} ${year}`;

export default async function ExecutiveDashboard({
  searchParams,
}: {
  searchParams: {
    from?: string; to?: string; company?: string;
    salesperson?: string; customer?: string; area?: string; category?: string;
    measure?: string;
  };
}) {
  const user = await requireReport("executive");
  const scope = await resolveReportScope(user, searchParams.company);

  const today = new Date();
  const from = searchParams.from ? new Date(`${searchParams.from}T00:00:00`) : new Date(today.getFullYear(), 0, 1);
  const to = searchParams.to ? new Date(`${searchParams.to}T23:59:59.999`) : today;
  const fromStr = ymd(from);
  const toStr = ymd(to);

  const f: ExecFilters = {
    from, to,
    companyIds: scope.ids,
    salespersonId: searchParams.salesperson || undefined,
    customerId: searchParams.customer || undefined,
    area: searchParams.area || undefined,
    category: searchParams.category || undefined,
  };
  const prev = previousPeriod(f);
  const year = to.getFullYear();
  const throughMonth = to.getMonth() + 1;
  // a period starting in an earlier year still begins at January of the forecast year
  const fromMonth = from.getFullYear() === year ? from.getMonth() + 1 : 1;

  const [sales, prevSales, ar, trend, priorTrend, forecast, comparison, categories, salespeople, customers, areas] =
    await Promise.all([
      getSalesMetrics(f),
      getSalesMetrics({ ...f, from: prev.from, to: prev.to }),
      getArMetrics(f),
      getMonthlyTrend(year, f),
      getMonthlyTrend(year - 1, f),
      getForecastVsActual(f, year, fromMonth, throughMonth),
      getCompanyComparison(f, year, fromMonth, throughMonth),
      getCategoryNames(),
      getSalespeople(),
      prisma.customer.findMany({ orderBy: { businessName: "asc" }, select: { id: true, businessName: true } }),
      prisma.forecast.findMany({ where: { year }, select: { area: true }, distinct: ["area"], orderBy: { area: "asc" } }),
    ]);

  const [collections, prevCollections, inventory] = await Promise.all([
    getCollectionMetrics(f, sales.grossSales),
    getCollectionMetrics({ ...f, from: prev.from, to: prev.to }, prevSales.grossSales),
    getInventoryMetrics(f, sales.cogs),
  ]);

  // ---- phase 2 datasets, all narrowed by the same filters as everything above
  const measure = (MEASURES.some((m) => m.key === searchParams.measure) ? searchParams.measure : "amount") as Measure;
  const [byProduct, byCustomer, bySalesperson, byArea, custRows, prodRows, stockRows, purchasing, credits, recent, payables] =
    await Promise.all([
      getSalesBreakdown(f, "product"),
      getSalesBreakdown(f, "customer"),
      getSalesBreakdown(f, "salesperson"),
      getSalesBreakdown(f, "area"),
      getCustomerPerformance(f),
      getProductPerformance(f),
      getInventoryPerformance(f),
      getPurchasingMetrics(f),
      getCreditMetrics(f),
      getRecentTransactions(f, 10),
      getPayablesMetrics(f.companyIds, { from: f.from, to: f.to }),
    ]);
  const alerts = buildAlerts({ ar, stock: stockRows, forecast, customers: custRows, credits, purchasing, sales, prevSales });
  // management attention: goods on the shelf with no supplier invoice, and invoices that disagree with the receipt
  if (payables.unbilled.receipts > 0)
    alerts.push({ level: payables.unbilled.over30 > 0 ? "amber" : "yellow", title: "Received but not yet billed", detail: `${payables.unbilled.receipts} receipt(s) worth ₱${payables.unbilled.value.toLocaleString("en-PH", { minimumFractionDigits: 2 })} at receiving cost have no posted supplier invoice${payables.unbilled.over30 ? ` — ${payables.unbilled.over30} older than 30 days` : ""}.`, href: "/reports/unbilled-receipts" });
  if (payables.discrepancies.over > 0)
    alerts.push({ level: "red", title: "Supplier invoice exceeds receipt", detail: `${payables.discrepancies.over} bill(s) claim more than was received.`, href: "/reports/invoice-discrepancies" });
  if (payables.overdue > 0)
    alerts.push({ level: "red", title: "Overdue supplier bills", detail: `₱${payables.overdue.toLocaleString("en-PH", { minimumFractionDigits: 2 })} on ${payables.overdueBills} bill(s) is past due.`, href: "/finance/ap" });

  const trendData = trend.map((m, i) => ({ ...m, prior: priorTrend[i]?.netSales ?? 0 }));
  // with no trading last year there is nothing to compare against, so the dashboard says
  // nothing about it rather than showing a comparison that is empty by construction
  const hasPrior = prevSales.invoices > 0 || prevSales.orders > 0 || prevSales.grossSales > 0;
  const hasPriorYear = priorTrend.some((m) => m.invoices > 0);
  const forecastChart = forecast.rows
    .filter((r) => r.forecastValue > 0 || r.actualValue > 0)
    .map((r) => ({ name: r.salesperson.replace("— Unassigned —", "Unassigned"), forecast: r.forecastValue, actual: r.actualValue }));
  // money from separate companies genuinely adds up; a CUSTOMER does not — one that buys
  // from both companies is still one customer, so the combined count is the distinct count
  // already computed over the whole scope, never the sum of the per-company columns
  const combinedRow = {
    ...comparison.reduce(
      (t, c) => ({
        netSales: round2(t.netSales + c.netSales), grossProfit: round2(t.grossProfit + c.grossProfit),
        collections: round2(t.collections + c.collections), ar: round2(t.ar + c.ar),
        inventory: round2(t.inventory + c.inventory), forecastValue: round2(t.forecastValue + c.forecastValue),
      }),
      { netSales: 0, grossProfit: 0, collections: 0, ar: 0, inventory: 0, forecastValue: 0 }
    ),
    customers: sales.customers,
  };

  const filterQuery = new URLSearchParams(
    Object.entries({ from: fromStr, to: toStr, company: scope.value, salesperson: searchParams.salesperson, customer: searchParams.customer, area: searchParams.area, category: searchParams.category })
      .filter(([, v]) => v) as [string, string][]
  ).toString();

  return (
    <div className="print-page">
      <PageHeader title="Executive Dashboard">
        {user.canExport && (
          <a href={`/api/export/executive?${filterQuery}`} className="btn-secondary no-print">⬇ Excel</a>
        )}
        {user.canPrint && (
          <span className="no-print"><PrintButton /></span>
        )}
      </PageHeader>

      {/* ---------------------------------------------------------- global filters */}
      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <div>
          <label className="label">Salesperson</label>
          <select name="salesperson" defaultValue={searchParams.salesperson ?? ""} className="input max-w-[180px]">
            <option value="">All salespeople</option>
            {salespeople.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Area</label>
          <select name="area" defaultValue={searchParams.area ?? ""} className="input max-w-[190px]">
            <option value="">All areas</option>
            {areas.map((a) => <option key={a.area} value={a.area}>{a.area}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Customer</label>
          <select name="customer" defaultValue={searchParams.customer ?? ""} className="input max-w-[190px]">
            <option value="">All customers</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.businessName}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Category</label>
          <select name="category" defaultValue={searchParams.category ?? ""} className="input max-w-[170px]">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Measure</label>
          <select name="measure" defaultValue={measure} className="input max-w-[170px]" title="Applies to the sales breakdowns below">
            {MEASURES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </div>
        <button className="btn-primary" type="submit">Apply</button>
        <Link href="/executive" className="btn-secondary">Reset</Link>
      </form>

      <p className="mb-4 text-sm text-gray-600">
        <span className="font-semibold">{scope.label}</span> · {fmtDate(from)} – {fmtDate(to)}
        {hasPrior && <> · compared against the same period last year, {fmtDate(prev.from)} – {fmtDate(prev.to)}</>}
        {searchParams.category ? ` · ${searchParams.category}` : ""}
      </p>

      {/* ------------------------------------------------------------- row 1: KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Product Sales" value={peso(sales.components.productSales)} sub="products only — the primary figure" delta={growthPct(sales.components.productSales, prevSales.components.productSales)} />
        <Kpi label="Net Product Sales" value={peso(sales.netSales)} sub={sales.components.returns ? `less ${peso(sales.components.returns)} returns` : "no returns"} delta={growthPct(sales.netSales, prevSales.netSales)} />
        <Kpi label="Gross Profit" value={peso(sales.grossProfit)} sub={`margin ${pct(sales.marginPct)}`} delta={growthPct(sales.grossProfit, prevSales.grossProfit)} />
        <Kpi label="Accounts Receivable" value={peso(ar.total)} sub={`${peso(ar.overdue)} overdue`} invert />
        <Kpi label="Collections" value={peso(collections.collected)} sub={collections.collected ? `rate ${pct(collections.rate)}` : "no payments recorded yet"} delta={growthPct(collections.collected, prevCollections.collected)} muted={!collections.collected} />
        <Kpi label="Forecast Achievement" value={pct(forecast.totals.achievementPct)} sub={`${peso(forecast.totals.actualValue)} of ${peso(forecast.totals.forecastValue)}`} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Sales Orders" value={num(sales.orders)} delta={growthPct(sales.orders, prevSales.orders)} comparable={hasPrior} />
        <Kpi label="Sales Invoices" value={num(sales.invoices)} delta={growthPct(sales.invoices, prevSales.invoices)} comparable={hasPrior} />
        <Kpi label="Average Order Value" value={sales.avgOrderValue == null ? "—" : peso(sales.avgOrderValue)} delta={growthPct(sales.avgOrderValue ?? 0, prevSales.avgOrderValue ?? 0)} comparable={hasPrior} />
        <Kpi label="Freight Charges" value={peso(sales.freight)} sub="billed, not product revenue" delta={growthPct(sales.freight, prevSales.freight)} />
        <Kpi label="Other Charges" value={peso(sales.otherCharges)} sub="billed, not product revenue" delta={growthPct(sales.otherCharges, prevSales.otherCharges)} muted={!sales.otherCharges} />
        <Kpi label="Total Customer Billing" value={peso(sales.components.totalBilling)} sub="products + freight + other" delta={growthPct(sales.components.totalBilling, prevSales.components.totalBilling)} />
        <Kpi label="Cost of Goods Sold" value={peso(sales.cogs)} sub={`${num(sales.qtyPcs)} PCS · ${num(sales.qtyCtn)} CTN`} invert delta={growthPct(sales.cogs, prevSales.cogs)} />
        <Kpi label="Inventory Value" value={peso(inventory.value)} sub={`${num(inventory.pcs)} PCS · ${num(inventory.ctn)} CTN`} />
        <Kpi label="Inventory Turnover" value={inventory.turnover == null ? "—" : `${inventory.turnover.toFixed(2)}×`} sub="COGS ÷ closing stock" />
      </div>

      {/* --------------------------------------- row 2: sales trend & forecast */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-1 font-semibold text-emerald-900">Monthly Sales Trend · {year}</h2>
          <p className="mb-2 text-xs text-gray-500">
            Net sales and gross profit by month{hasPriorYear ? `, with ${year - 1} behind for comparison` : ""}.
          </p>
          <SalesTrendChart data={trendData} showPrior={hasPriorYear} />
        </div>
        <div className="card">
          <h2 className="mb-1 font-semibold text-emerald-900">Sales vs Forecast</h2>
          <p className="mb-2 text-xs text-gray-500">
            {monthSpan(fromMonth, throughMonth, year)}, by salesperson.
          </p>
          {forecastChart.length ? <ForecastChart data={forecastChart} /> : <p className="py-16 text-center text-sm text-gray-400">No forecast for {year} in this scope.</p>}
        </div>
      </div>

      {/* ------------------------------------------- row 3a: forecast by salesperson */}
      <div className="card mb-6 overflow-x-auto p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
          <h2 className="font-semibold text-emerald-900">Sales vs Forecast by Salesperson</h2>
          <p className="text-xs text-gray-500">
            {monthSpan(fromMonth, throughMonth, year)} · quantities normalised to the 1,000-ml equivalent before
            comparing.
          </p>
        </div>
        <table className="mt-2 w-full min-w-[860px]">
          <thead className="border-y border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Salesperson</th>
              <th className="table-th">Area</th>
              <th className="table-th text-right">Forecast Qty</th>
              <th className="table-th text-right">Actual Qty</th>
              <th className="table-th text-right">Forecast</th>
              <th className="table-th text-right">Actual Sales</th>
              <th className="table-th text-right">Variance</th>
              <th className="table-th text-right">Achievement</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {forecast.rows.map((r) => (
              <tr key={r.key} className="hover:bg-gray-50">
                <td className="table-td font-medium">
                  {r.key === "none" ? <span className="text-gray-400">— Unassigned —</span> : (
                    <Link href={`/reports/forecast?salesperson=${r.key}&year=${year}`} className="text-emerald-700 hover:underline">
                      {r.salesperson}
                    </Link>
                  )}
                </td>
                <td className="table-td text-sm text-gray-600">{r.area}</td>
                <td className="table-td text-right text-sm">{num(r.forecastQty)}</td>
                <td className="table-td text-right text-sm">{num(r.actualQty)}</td>
                <td className="table-td text-right">{peso(r.forecastValue)}</td>
                <td className="table-td text-right font-semibold">{peso(r.actualValue)}</td>
                <td className={`table-td text-right ${r.variance < 0 ? "text-red-600" : "text-emerald-700"}`}>{peso(r.variance)}</td>
                <td className="table-td text-right">
                  <span className={`font-semibold ${(r.achievementPct ?? 0) >= 100 ? "text-emerald-700" : (r.achievementPct ?? 0) >= 70 ? "text-amber-600" : "text-red-600"}`}>
                    {pct(r.achievementPct)}
                  </span>
                </td>
              </tr>
            ))}
            {!forecast.rows.length && (
              <tr><td colSpan={8} className="p-8 text-center text-sm text-gray-500">No forecast or sales for {year} in this scope.</td></tr>
            )}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
            <tr>
              <td className="table-td" colSpan={2}>TOTAL</td>
              <td className="table-td text-right">{num(forecast.totals.forecastQty)}</td>
              <td className="table-td text-right">{num(forecast.totals.actualQty)}</td>
              <td className="table-td text-right">{peso(forecast.totals.forecastValue)}</td>
              <td className="table-td text-right">{peso(forecast.totals.actualValue)}</td>
              <td className={`table-td text-right ${forecast.totals.variance < 0 ? "text-red-600" : "text-emerald-700"}`}>{peso(forecast.totals.variance)}</td>
              <td className="table-td text-right">{pct(forecast.totals.achievementPct)}</td>
            </tr>
          </tfoot>
        </table>
        <div className="flex flex-wrap gap-4 px-4 py-3 text-sm">
          {forecast.best && (
            <p className="text-emerald-800">🏆 <span className="font-semibold">Best:</span> {forecast.best.salesperson} at {pct(forecast.best.achievementPct)}</p>
          )}
          {forecast.worst && (
            <p className="text-red-700">⚠ <span className="font-semibold">Lowest:</span> {forecast.worst.salesperson} at {pct(forecast.worst.achievementPct)}</p>
          )}
          {forecast.unmatchedValue > 0 && (
            <p className="text-gray-500">{peso(forecast.unmatchedValue)} of sales are on products no forecast covers.</p>
          )}
        </div>
      </div>

      {/* ------------------------------------------------ row 3b: company comparison */}
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="card overflow-x-auto lg:col-span-2">
          <h2 className="mb-2 font-semibold text-emerald-900">Company Comparison</h2>
          <table className="w-full min-w-[520px] text-sm">
            <thead className="border-b-2 border-gray-300">
              <tr>
                <th className="py-1.5 text-left">Metric</th>
                {comparison.map((c) => <th key={c.companyId} className="py-1.5 text-right">{c.company}</th>)}
                {comparison.length > 1 && <th className="py-1.5 text-right">Combined</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {([
                ["Net Sales", (c) => peso(c.netSales), peso(combinedRow.netSales)],
                ["Gross Profit", (c) => peso(c.grossProfit), peso(combinedRow.grossProfit)],
                ["Gross Margin %", (c) => pct(c.marginPct), pct(combinedRow.netSales ? (combinedRow.grossProfit / combinedRow.netSales) * 100 : null)],
                ["Customers", (c) => num(c.customers), num(combinedRow.customers)],
                ["Collections", (c) => peso(c.collections), peso(combinedRow.collections)],
                ["Accounts Receivable", (c) => peso(c.ar), peso(combinedRow.ar)],
                ["Inventory Value", (c) => peso(c.inventory), peso(combinedRow.inventory)],
                ["Sales Forecast", (c) => peso(c.forecastValue), peso(combinedRow.forecastValue)],
              ] as [string, (c: (typeof comparison)[number]) => string, string][]).map(([label, cell, total]) => (
                <tr key={label}>
                  <td className="py-1.5 font-medium text-gray-700">{label}</td>
                  {comparison.map((c) => <td key={c.companyId} className="py-1.5 text-right">{cell(c)}</td>)}
                  {comparison.length > 1 && <td className="py-1.5 text-right font-semibold text-emerald-900">{total}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {comparison.length > 1 && (
            <p className="mt-2 text-xs text-gray-500">
              Customers is the distinct count — an account buying from both companies is counted once, so the Combined
              figure is not the sum of the columns beside it.
            </p>
          )}
          {comparison.length === 1 && (
            <p className="mt-2 text-xs text-gray-500">
              Showing one company. Choose <span className="font-medium">Combined (All Companies)</span> above to compare
              Teamagro against Trigreen.
            </p>
          )}
        </div>
        <div className="card">
          <h2 className="mb-2 font-semibold text-emerald-900">Net Sales by Company</h2>
          <CompanyBars data={comparison.map((c) => ({ company: c.company, value: c.netSales }))} label="Net sales" />
        </div>
      </div>

      {/* ------------------------------------------- row 3c: sales broken down four ways */}
      <div className="mb-6">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold text-emerald-900">Sales Breakdown</h2>
          <p className="text-xs text-gray-500">
            Ranked by <span className="font-semibold">{MEASURES.find((m) => m.key === measure)?.label}</span> — change it
            in the Measure filter above.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <BreakdownTable title="By Product" rows={byProduct} measure={measure} hrefFor={(r) => `/inventory/${r.key}`} />
          <BreakdownTable title="By Customer" rows={byCustomer} measure={measure} hrefFor={(r) => `/customers/${r.key}`} />
          <BreakdownTable title="By Salesperson" rows={bySalesperson} measure={measure} />
          <BreakdownTable title="By Area" note="Customer province" rows={byArea} measure={measure} />
        </div>
      </div>

      {/* ---------------------------------------- row 4: top customers | top products */}
      <div className="mb-6 grid gap-4">
        <CustomersSection rows={custRows} measure={measure} />
        <ProductsSection rows={prodRows} measure={measure} />
      </div>

      {/* ------------------------------------ row 5: AR ageing | inventory performance */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <ArSection ar={ar} collections={collections} credits={credits} />
        <InventorySection rows={stockRows} />
      </div>

      {/* ------------------------------------------------------------ purchasing */}
      <div className="mb-6">
        <PurchasingSection p={purchasing} payables={payables} />
      </div>

      {/* --------------------------------- row 6: alerts | recent transactions */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <AlertsSection alerts={alerts} />
        <RecentSection rows={recent} combined={scope.combined} />
      </div>

      {/* -------------------------------------------------------- honest limitations */}
      <div className="card border-amber-200 bg-amber-50/60 text-sm text-amber-900">
        <p className="font-semibold">What these figures do and do not cover</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs">
          <li>Only posted, non-void invoices count. Drafts and voided documents are excluded everywhere.</li>
          <li>
            Every ranking — by product, customer, salesperson and area — and the forecast comparison use{" "}
            <strong>product sales</strong>. Freight and other charges are billed to the customer but are not product
            revenue, so they are shown on their own and never inflate a product, a customer or a salesperson.
          </li>
          <li>
            Sales are attributed through each customer&rsquo;s <strong>current</strong> salesperson. No sales document
            stores one, so reassigning an account moves its past sales with it. Forecast rows keep the salesperson they
            were planned under.
          </li>
          <li>Forecasts have no approval status in the system, so every {year} forecast in scope is included.</li>
          {!collections.collected && (
            <li><strong>No customer payments have been recorded yet</strong>, so Collections is ₱0 and the whole invoiced balance sits in Receivables.</li>
          )}
          <li>Inventory turnover uses closing stock at weighted average cost — the system keeps one current cost per product, not a cost history.</li>
          {inventory.noConversion > 0 && <li>{inventory.noConversion} product(s) have no carton conversion, so they add nothing to the CTN totals.</li>}
          <li>
            Accounts payable comes from posted supplier bills (Enter Bills Against Inventory) and ages on each bill&rsquo;s
            due date. Goods received but not yet billed are in stock but not yet a payable.
          </li>
          <li>Movement is judged on the period&rsquo;s own selling rate: under two months of cover is Fast, over six is Slow.</li>
        </ul>
      </div>
    </div>
  );
}
