import Link from "next/link";
import { peso, fmtDate } from "@/lib/format";
import type {
  BreakdownRow, CustomerRow, ProductRow, StockRow, ArMetrics,
  PurchasingMetrics, CreditMetrics, CollectionMetrics, Alert, RecentTx,
} from "@/lib/executive";
import type { PayablesMetrics } from "@/lib/ap-reports";

const num = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 2 });
const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);

/** The measure a breakdown table is sorted and charted by. */
export type Measure = "amount" | "qtyPcs" | "qtyCtn" | "grossProfit";
export const MEASURES: { key: Measure; label: string }[] = [
  { key: "amount", label: "Sales Amount" },
  { key: "qtyPcs", label: "Quantity (PCS)" },
  { key: "qtyCtn", label: "Equivalent (CTN)" },
  { key: "grossProfit", label: "Gross Profit" },
];
const show = (r: BreakdownRow, m: Measure) => (m === "amount" || m === "grossProfit" ? peso(r[m]) : num(r[m]));

/** A bar rendered in CSS — no chart library needed for a simple share-of-total row. */
function Bar({ value, max }: { value: number; max: number }) {
  const w = max > 0 ? Math.max(1, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full rounded bg-gray-100">
      <div className="h-1.5 rounded bg-emerald-600" style={{ width: `${w}%` }} />
    </div>
  );
}

/** Sales cut by one dimension, ranked on the chosen measure. */
export function BreakdownTable({
  title, note, rows, measure, limit = 10, hrefFor,
}: {
  title: string;
  note?: string;
  rows: BreakdownRow[];
  measure: Measure;
  limit?: number;
  hrefFor?: (r: BreakdownRow) => string;
}) {
  const ranked = [...rows].sort((a, b) => b[measure] - a[measure]).slice(0, limit);
  const max = ranked[0]?.[measure] ?? 0;
  return (
    <div className="card">
      <h2 className="font-semibold text-emerald-900">{title}</h2>
      {note && <p className="mb-2 text-xs text-gray-500">{note}</p>}
      <table className="w-full text-sm">
        <tbody className="divide-y divide-gray-100">
          {ranked.map((r) => (
            <tr key={r.key}>
              <td className="py-1.5 pr-2">
                {hrefFor ? (
                  <Link href={hrefFor(r)} className="font-medium text-emerald-700 hover:underline">{r.label}</Link>
                ) : (
                  <span className="font-medium">{r.label}</span>
                )}
                {r.sub && <span className="block text-xs text-gray-400">{r.sub}</span>}
                <Bar value={r[measure]} max={max} />
              </td>
              <td className="whitespace-nowrap py-1.5 text-right align-top font-semibold">{show(r, measure)}</td>
            </tr>
          ))}
          {!ranked.length && <tr><td className="py-6 text-center text-sm text-gray-500">Nothing in this period.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Customer performance, with the salesperson who owns each account. */
export function CustomersSection({ rows, measure }: { rows: CustomerRow[]; measure: Measure }) {
  const active = rows.filter((r) => r.amount > 0);
  const quiet = rows.filter((r) => r.amount === 0);
  const brandNew = rows.filter((r) => r.isNew);
  const ranked = [...active].sort((a, b) => b[measure] - a[measure]).slice(0, 12);
  return (
    <div className="card overflow-x-auto">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-emerald-900">Customer Performance</h2>
        <p className="text-xs text-gray-500">
          {active.length} active · {brandNew.length} new · {quiet.length} with no sales this period
        </p>
      </div>
      <table className="mt-2 w-full min-w-[760px] text-sm">
        <thead className="border-b border-gray-200 bg-gray-50">
          <tr>
            <th className="table-th">Customer</th>
            <th className="table-th">Salesperson</th>
            <th className="table-th text-right">Sales</th>
            <th className="table-th text-right">Gross Profit</th>
            <th className="table-th text-right">Margin</th>
            <th className="table-th text-right">Outstanding</th>
            <th className="table-th text-right">Last Sale</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {ranked.map((r) => (
            <tr key={r.key} className="hover:bg-gray-50">
              <td className="table-td font-medium">
                <Link href={`/customers/${r.key}`} className="text-emerald-700 hover:underline">{r.label}</Link>
                {r.isNew && <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">NEW</span>}
              </td>
              <td className="table-td text-sm text-gray-600">{r.salesperson}</td>
              <td className="table-td text-right font-semibold">{peso(r.amount)}</td>
              <td className="table-td text-right">{peso(r.grossProfit)}</td>
              <td className="table-td text-right">{pct(r.marginPct)}</td>
              <td className={`table-td text-right ${r.outstanding > 0 ? "text-amber-700" : "text-gray-300"}`}>{r.outstanding > 0 ? peso(r.outstanding) : "—"}</td>
              <td className="table-td whitespace-nowrap text-right text-sm text-gray-500">{r.lastSale ? fmtDate(r.lastSale) : "—"}</td>
            </tr>
          ))}
          {!ranked.length && <tr><td colSpan={7} className="p-6 text-center text-sm text-gray-500">No customer sales in this period.</td></tr>}
        </tbody>
      </table>
      {quiet.length > 0 && (
        <p className="mt-2 text-xs text-amber-700">
          No sales this period: {quiet.slice(0, 6).map((q) => q.label).join(", ")}{quiet.length > 6 ? ` and ${quiet.length - 6} more` : ""}.
        </p>
      )}
    </div>
  );
}

/** Product profitability, ranked on the chosen measure. */
export function ProductsSection({ rows, measure }: { rows: ProductRow[]; measure: Measure }) {
  const ranked = [...rows].sort((a, b) => b[measure] - a[measure]).slice(0, 12);
  const withMargin = rows.filter((r) => r.marginPct != null);
  const best = [...withMargin].sort((a, b) => (b.marginPct ?? 0) - (a.marginPct ?? 0))[0];
  const worst = [...withMargin].sort((a, b) => (a.marginPct ?? 0) - (b.marginPct ?? 0))[0];
  return (
    <div className="card overflow-x-auto">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-emerald-900">Product Profitability</h2>
        <p className="text-xs text-gray-500">Cost and price are those captured on each sale, not today&rsquo;s.</p>
      </div>
      <table className="mt-2 w-full min-w-[820px] text-sm">
        <thead className="border-b border-gray-200 bg-gray-50">
          <tr>
            <th className="table-th">Product</th>
            <th className="table-th text-right">Qty (PCS)</th>
            <th className="table-th text-right">Equiv. (CTN)</th>
            <th className="table-th text-right">Avg Price</th>
            <th className="table-th text-right">Unit Cost</th>
            <th className="table-th text-right">Sales</th>
            <th className="table-th text-right">Gross Profit</th>
            <th className="table-th text-right">Margin</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {ranked.map((r) => (
            <tr key={r.key} className="hover:bg-gray-50">
              <td className="table-td">
                <Link href={`/inventory/${r.key}`} className="font-medium text-emerald-700 hover:underline">{r.label}</Link>
                <span className="block font-mono text-xs text-gray-400">{r.sku} · {r.packSize}</span>
              </td>
              <td className="table-td text-right">{num(r.qtyPcs)}</td>
              <td className="table-td text-right text-gray-600">{num(r.qtyCtn)}</td>
              <td className="table-td text-right">{r.avgPrice == null ? "—" : peso(r.avgPrice)}</td>
              <td className="table-td text-right text-gray-600">{peso(r.unitCost)}</td>
              <td className="table-td text-right font-semibold">{peso(r.amount)}</td>
              <td className="table-td text-right">{peso(r.grossProfit)}</td>
              <td className={`table-td text-right font-semibold ${(r.marginPct ?? 0) < 15 ? "text-red-600" : (r.marginPct ?? 0) < 25 ? "text-amber-600" : "text-emerald-700"}`}>{pct(r.marginPct)}</td>
            </tr>
          ))}
          {!ranked.length && <tr><td colSpan={8} className="p-6 text-center text-sm text-gray-500">No products sold in this period.</td></tr>}
        </tbody>
      </table>
      {best && worst && best.key !== worst.key && (
        <p className="mt-2 text-xs text-gray-600">
          Highest margin <span className="font-semibold text-emerald-700">{best.label} ({pct(best.marginPct)})</span> ·
          lowest <span className="font-semibold text-red-600">{worst.label} ({pct(worst.marginPct)})</span>
        </p>
      )}
    </div>
  );
}

/** Receivables ageing, collections and the credits sitting unapplied. */
export function ArSection({
  ar, collections, credits,
}: {
  ar: ArMetrics;
  collections: CollectionMetrics;
  credits: CreditMetrics;
}) {
  const buckets: [string, number, string][] = [
    ["Current", ar.current, "text-emerald-700"],
    ["1–30 days", ar.d1_30, "text-amber-600"],
    ["31–60 days", ar.d31_60, "text-amber-700"],
    ["61–90 days", ar.d61_90, "text-red-600"],
    ["Over 90 days", ar.d90plus, "text-red-700"],
  ];
  return (
    <div className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-emerald-900">Accounts Receivable</h2>
        <Link href="/finance/ar" className="text-xs text-emerald-700 hover:underline">Open AR Aging →</Link>
      </div>
      <p className="mb-2 text-lg font-bold text-emerald-900">{peso(ar.total)}<span className="ml-2 text-xs font-normal text-gray-500">outstanding</span></p>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-gray-100">
          {buckets.map(([label, value, cls]) => (
            <tr key={label}>
              <td className="py-1.5">{label}</td>
              <td className="py-1.5 text-right text-xs text-gray-400">{ar.total ? `${((value / ar.total) * 100).toFixed(1)}%` : "—"}</td>
              <td className={`py-1.5 text-right font-semibold ${value > 0 ? cls : "text-gray-300"}`}>{value > 0 ? peso(value) : "—"}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-gray-300">
            <td className="py-1.5 font-semibold">Overdue</td>
            <td />
            <td className={`py-1.5 text-right font-bold ${ar.overdue > 0 ? "text-red-700" : "text-gray-300"}`}>{peso(ar.overdue)}</td>
          </tr>
        </tbody>
      </table>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-gray-200 pt-3 text-sm">
        <div><p className="text-xs text-gray-500">Collections</p><p className={`font-semibold ${collections.collected ? "" : "text-gray-400"}`}>{peso(collections.collected)}</p></div>
        <div><p className="text-xs text-gray-500">Collection Rate</p><p className={`font-semibold ${collections.rate ? "" : "text-gray-400"}`}>{pct(collections.rate)}</p></div>
        <div><p className="text-xs text-gray-500">Unapplied Payments</p><p className={`font-semibold ${credits.unapplied ? "text-amber-700" : "text-gray-400"}`}>{peso(credits.unapplied)}</p></div>
        <div><p className="text-xs text-gray-500">Customer Credits</p><p className={`font-semibold ${credits.credits ? "text-amber-700" : "text-gray-400"}`}>{peso(credits.credits)}</p></div>
      </div>
    </div>
  );
}

/** Inventory movement, cover and ageing. */
export function InventorySection({ rows }: { rows: StockRow[] }) {
  const value = rows.reduce((s, r) => s + r.value, 0);
  const group = (m: StockRow["movement"]) => rows.filter((r) => r.movement === m);
  const fast = group("Fast"), slow = group("Slow"), none = group("None");
  const low = rows.filter((r) => r.lowStock);
  const risk = rows.filter((r) => r.stockout);
  const oldest = [...rows].filter((r) => r.ageDays != null && r.stockPcs > 0).sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0)).slice(0, 5);

  const Cell = ({ label, list, cls }: { label: string; list: StockRow[]; cls: string }) => (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`font-semibold ${list.length ? cls : "text-gray-400"}`}>{list.length}</p>
      <p className="text-xs text-gray-400">{peso(list.reduce((s, r) => s + r.value, 0))}</p>
    </div>
  );

  return (
    <div className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-emerald-900">Inventory Performance</h2>
        <Link href="/reports/merchandise-inventory" className="text-xs text-emerald-700 hover:underline">Open valuation →</Link>
      </div>
      <p className="mb-2 text-lg font-bold text-emerald-900">{peso(value)}<span className="ml-2 text-xs font-normal text-gray-500">at weighted average cost</span></p>
      <div className="grid grid-cols-3 gap-2 border-y border-gray-200 py-2 sm:grid-cols-5">
        <Cell label="Fast-moving" list={fast} cls="text-emerald-700" />
        <Cell label="Slow-moving" list={slow} cls="text-amber-700" />
        <Cell label="No movement" list={none} cls="text-red-600" />
        <Cell label="Low stock" list={low} cls="text-amber-700" />
        <Cell label="Stockout risk" list={risk} cls="text-red-700" />
      </div>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
            <th className="py-1">Longest without movement</th>
            <th className="py-1 text-right">Stock</th>
            <th className="py-1 text-right">Value</th>
            <th className="py-1 text-right">Age</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {oldest.map((r) => (
            <tr key={r.id}>
              <td className="py-1.5">
                <Link href={`/inventory/${r.id}`} className="text-emerald-700 hover:underline">{r.name}</Link>
              </td>
              <td className="py-1.5 text-right">
                {num(r.stockPcs)} PCS
                <span className="block text-xs text-gray-400">{r.stockCtn == null ? "N/A ⚠" : `${num(r.stockCtn)} CTN`}</span>
              </td>
              <td className="py-1.5 text-right">{peso(r.value)}</td>
              <td className={`py-1.5 text-right ${(r.ageDays ?? 0) > 180 ? "font-semibold text-red-600" : "text-gray-600"}`}>{r.ageDays == null ? "—" : `${r.ageDays}d`}</td>
            </tr>
          ))}
          {!oldest.length && <tr><td colSpan={4} className="py-6 text-center text-sm text-gray-500">No stock on hand.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Purchasing from purchase orders and receipts. Payables have no data source yet. */
export function PurchasingSection({ p, payables }: { p: PurchasingMetrics; payables: PayablesMetrics }) {
  return (
    <div className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-emerald-900">Purchasing</h2>
        <Link href="/reports/po-receiving" className="text-xs text-emerald-700 hover:underline">PO receiving status →</Link>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div><p className="text-xs text-gray-500">Ordered</p><p className="font-semibold">{peso(p.totalOrdered)}</p></div>
        <div><p className="text-xs text-gray-500">Received</p><p className="font-semibold">{peso(p.totalReceived)}</p></div>
        <div><p className="text-xs text-gray-500">Still to arrive</p><p className={`font-semibold ${p.outstandingValue ? "text-amber-700" : "text-gray-400"}`}>{peso(p.outstandingValue)}</p></div>
        <div><p className="text-xs text-gray-500">Open orders</p><p className="font-semibold">{p.openOrders}</p></div>
      </div>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
            <th className="py-1">Supplier</th>
            <th className="py-1 text-right">Orders</th>
            <th className="py-1 text-right">Ordered</th>
            <th className="py-1 text-right">Received</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {p.bySupplier.slice(0, 6).map((s) => (
            <tr key={s.id}>
              <td className="py-1.5 font-medium">{s.name}</td>
              <td className="py-1.5 text-right text-gray-600">{s.orders}</td>
              <td className="py-1.5 text-right">{peso(s.ordered)}</td>
              <td className="py-1.5 text-right font-semibold">{peso(s.received)}</td>
            </tr>
          ))}
          {!p.bySupplier.length && <tr><td colSpan={4} className="py-6 text-center text-sm text-gray-500">No purchase orders in this period.</td></tr>}
        </tbody>
      </table>
      <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-semibold text-gray-700">Accounts Payable</p>
          <Link href="/finance/ap" className="text-xs text-emerald-700 hover:underline">AP aging →</Link>
        </div>
        <div className="mt-1 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><p className="text-xs text-gray-500">Outstanding</p><p className={`font-semibold ${payables.outstanding ? "text-red-600" : "text-gray-400"}`}>{peso(payables.outstanding)}</p><p className="text-[10px] text-gray-400">{payables.openBills} open bill(s)</p></div>
          <div><p className="text-xs text-gray-500">Overdue</p><p className={`font-semibold ${payables.overdue ? "text-red-600" : "text-gray-400"}`}>{peso(payables.overdue)}</p><p className="text-[10px] text-gray-400">{payables.overdueBills} bill(s)</p></div>
          <div><p className="text-xs text-gray-500">Due within 7 days</p><p className={`font-semibold ${payables.dueSoon ? "text-amber-700" : "text-gray-400"}`}>{peso(payables.dueSoon)}</p></div>
          <div><p className="text-xs text-gray-500">Billed this period</p><p className="font-semibold">{peso(payables.billedInPeriod)}</p></div>
        </div>
        {(payables.unbilled.receipts > 0 || payables.discrepancies.over + payables.discrepancies.partial > 0) && (
          <p className="mt-2 text-xs">
            <Link href="/reports/unbilled-receipts" className="text-amber-700 hover:underline">Received, not yet billed: {payables.unbilled.receipts} receipt(s) · {peso(payables.unbilled.value)}</Link>
            {payables.discrepancies.over + payables.discrepancies.partial > 0 && (
              <> · <Link href="/reports/invoice-discrepancies" className="text-red-600 hover:underline">Invoice discrepancies: {payables.discrepancies.over} over, {payables.discrepancies.partial} short</Link></>
            )}
          </p>
        )}
        {payables.bySupplier.length > 0 && (
          <p className="mt-2 text-xs text-gray-600">
            Owed to: {payables.bySupplier.slice(0, 4).map((s) => `${s.name} ${peso(s.outstanding)}${s.overdue ? ` (overdue ${peso(s.overdue)})` : ""}`).join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}

/** Automatic alerts, worst first. */
export function AlertsSection({ alerts }: { alerts: Alert[] }) {
  const dot = { red: "🔴", amber: "🟠", yellow: "🟡", green: "🟢" } as const;
  const bg = {
    red: "border-red-200 bg-red-50/60",
    amber: "border-amber-200 bg-amber-50/60",
    yellow: "border-yellow-200 bg-yellow-50/60",
    green: "border-emerald-200 bg-emerald-50/60",
  } as const;
  const order = { red: 0, amber: 1, yellow: 2, green: 3 };
  const sorted = [...alerts].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <div className="card">
      <h2 className="mb-2 font-semibold text-emerald-900">Business Alerts</h2>
      <div className="space-y-2">
        {sorted.map((a, i) => (
          <div key={i} className={`rounded-lg border px-3 py-2 ${bg[a.level]}`}>
            <p className="text-sm font-semibold text-gray-800">
              {dot[a.level]} {a.title}
              {a.href && <Link href={a.href} className="ml-2 text-xs font-normal text-emerald-700 hover:underline">open →</Link>}
            </p>
            <p className="text-xs text-gray-600">{a.detail}</p>
          </div>
        ))}
        {!sorted.length && <p className="py-6 text-center text-sm text-gray-500">Nothing needs attention.</p>}
      </div>
    </div>
  );
}

/** The latest documents, each linking to the record itself. */
export function RecentSection({ rows, combined }: { rows: RecentTx[]; combined: boolean }) {
  return (
    <div className="card overflow-x-auto">
      <h2 className="mb-2 font-semibold text-emerald-900">Recent Transactions</h2>
      <table className="w-full min-w-[520px] text-sm">
        <thead className="border-b border-gray-200 text-left text-xs text-gray-500">
          <tr>
            <th className="py-1">Date</th>
            <th className="py-1">Document</th>
            <th className="py-1">Party</th>
            {combined && <th className="py-1">Company</th>}
            <th className="py-1 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.kind + r.id} className="hover:bg-gray-50">
              <td className="whitespace-nowrap py-1.5">{fmtDate(r.date)}</td>
              <td className="py-1.5">
                <Link href={r.href} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{r.ref}</Link>
                <span className="block text-xs text-gray-400">{r.kind}</span>
              </td>
              <td className="py-1.5">{r.party}</td>
              {combined && <td className="py-1.5 text-xs text-gray-500">{r.company}</td>}
              <td className="py-1.5 text-right font-semibold">{peso(r.amount)}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={combined ? 5 : 4} className="py-6 text-center text-sm text-gray-500">No transactions in this period.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
