import { Fragment } from "react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { peso, fmtDateTime } from "@/lib/format";
import { PrintButton, BackButton } from "@/components/print-button";
import { getSalespeople, NO_SALESPERSON, NO_CUSTOMER } from "@/lib/salespeople";

type SP = {
  company?: string;
  forecast?: string;
  salesperson?: string;
  customer?: string;
  product?: string;
  view?: string;
  year?: string;
  period?: string;
};

const VIEWS = [
  ["breakdown", "Salesperson → Customer → Product"],
  ["salesperson", "By Salesperson"],
  ["customer", "By Customer"],
] as const;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Every period the report can be cut by, as the 1-based months it covers. */
const PERIODS: { value: string; label: string; group: string; months: number[] }[] = [
  { value: "annual", label: "Annual (Jan–Dec)", group: "Annual", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { value: "h1", label: "1st Semester (Jan–Jun)", group: "Semi-annual", months: [1, 2, 3, 4, 5, 6] },
  { value: "h2", label: "2nd Semester (Jul–Dec)", group: "Semi-annual", months: [7, 8, 9, 10, 11, 12] },
  { value: "q1", label: "Q1 (Jan–Mar)", group: "Quarterly", months: [1, 2, 3] },
  { value: "q2", label: "Q2 (Apr–Jun)", group: "Quarterly", months: [4, 5, 6] },
  { value: "q3", label: "Q3 (Jul–Sep)", group: "Quarterly", months: [7, 8, 9] },
  { value: "q4", label: "Q4 (Oct–Dec)", group: "Quarterly", months: [10, 11, 12] },
  ...MONTH_NAMES.map((m, i) => ({ value: `m${i + 1}`, label: m, group: "Monthly", months: [i + 1] })),
];

type Totals = { fcPcs: number; fcValue: number; actPcs: number; actValue: number };

type Row = Totals & {
  spId: string;
  spName: string;
  customerId: string;
  customerName: string;
  productId: string;
  productName: string;
  sku: string;
  companyId: string;
  piecesPerCarton: number | null;
};

const zero = (): Totals => ({ fcPcs: 0, fcValue: 0, actPcs: 0, actValue: 0 });
const add = (t: Totals, r: Totals) => {
  t.fcPcs += r.fcPcs;
  t.fcValue += r.fcValue;
  t.actPcs += r.actPcs;
  t.actValue += r.actValue;
};

/** Pieces shown the way the warehouse counts them: cartons, with the piece count beneath. */
function Qty({ pcs, ppc }: { pcs: number; ppc: number | null }) {
  if (!pcs) return <span className="text-gray-300">—</span>;
  if (!ppc || ppc < 2) {
    return <span>{pcs.toLocaleString()} <span className="text-[10px] text-gray-400">PCS</span></span>;
  }
  const ctn = pcs / ppc;
  const shown = Number.isInteger(ctn) ? ctn.toLocaleString() : ctn.toFixed(1);
  return (
    <span>
      {shown} <span className="text-[10px] text-gray-400">CTN</span>
      <span className="block text-[10px] text-gray-400">({pcs.toLocaleString()} pcs)</span>
    </span>
  );
}

/** A group mixes pack sizes, so its quantity only makes sense in pieces. */
function GroupQty({ pcs }: { pcs: number }) {
  return pcs ? (
    <span>{pcs.toLocaleString()} <span className="text-[10px] opacity-60">pcs</span></span>
  ) : (
    <span className="opacity-40">—</span>
  );
}

function Achievement({ t, strong }: { t: Totals; strong?: boolean }) {
  if (t.fcValue <= 0) return <span className="text-gray-300">—</span>;
  const pct = (t.actValue / t.fcValue) * 100;
  const tone = pct >= 100 ? "text-emerald-700" : pct >= 80 ? "text-amber-600" : "text-red-600";
  return <span className={`${tone} ${strong ? "font-bold" : "font-semibold"}`}>{pct.toFixed(1)}%</span>;
}

function Variance({ t }: { t: Totals }) {
  if (!t.fcValue && !t.actValue) return <span className="text-gray-300">—</span>;
  const v = t.actValue - t.fcValue;
  return (
    <span className={v >= 0 ? "text-emerald-700" : "text-red-600"}>
      {v >= 0 ? "+" : "−"}{peso(Math.abs(v))}
    </span>
  );
}

export default async function ForecastReportPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePerm("reports");
  const scope = await resolveReportScope(user, searchParams.company);
  const view = VIEWS.some(([v]) => v === searchParams.view) ? searchParams.view! : "breakdown";
  const period = PERIODS.find((p) => p.value === searchParams.period) ?? PERIODS[0];

  const [forecasts, salespeople, customers] = await Promise.all([
    prisma.forecast.findMany({
      orderBy: [{ year: "desc" }, { createdAt: "desc" }],
      select: { id: true, title: true, year: true, area: true },
    }),
    getSalespeople(),
    prisma.customer.findMany({
      where: { status: "Active" },
      select: { id: true, businessName: true },
      orderBy: { businessName: "asc" },
    }),
  ]);
  const forecastId = forecasts.some((f) => f.id === searchParams.forecast) ? searchParams.forecast! : "";

  // one year at a time, so forecast months and invoice dates line up
  const years = [...new Set(forecasts.map((f) => f.year))].sort((a, b) => b - a);
  const wanted = forecastId ? forecasts.find((f) => f.id === forecastId)!.year : Number(searchParams.year);
  const year = years.includes(wanted) ? wanted : years[0] ?? new Date().getFullYear();

  const from = new Date(Date.UTC(year, period.months[0] - 1, 1));
  const to = new Date(Date.UTC(year, period.months[period.months.length - 1], 0, 23, 59, 59, 999));

  const where: any = { product: { companyId: { in: scope.ids } }, forecast: { year } };
  if (forecastId) where.forecastId = forecastId;
  if (searchParams.customer === "none") where.customerId = null;
  else if (searchParams.customer) where.customerId = searchParams.customer;

  const [lines, srs, ownedByRep] = await Promise.all([
    prisma.forecastLine.findMany({
      where,
      include: {
        product: { select: { id: true, sku: true, name: true, srp: true, companyId: true, piecesPerCarton: true } },
        customer: { select: { id: true, businessName: true, salespersonId: true, salesperson: { select: { name: true } } } },
        salesperson: { select: { id: true, name: true } },
      },
    }),
    // ACTUAL SALES: invoiced, void excluded, goods only — freight sits on the invoice, not the line
    prisma.salesReceipt.findMany({
      where: { companyId: { in: scope.ids }, status: { not: "Void" }, invoiceDate: { gte: from, lte: to } },
      select: {
        customerId: true,
        deliveryReceipt: { select: { lines: { select: { productId: true, baseQty: true, qty: true, unitPrice: true } } } },
      },
    }),
    prisma.customer.findMany({ where: { salespersonId: { not: null } }, select: { id: true, salespersonId: true } }),
  ]);

  // customer+product -> what was actually invoiced inside the period
  const soldKey = (c: string, p: string) => `${c}:${p}`;
  const sold = new Map<string, { pcs: number; value: number }>();
  for (const sr of srs) {
    for (const l of sr.deliveryReceipt.lines) {
      const k = soldKey(sr.customerId, l.productId);
      const cur = sold.get(k) ?? { pcs: 0, value: 0 };
      cur.pcs += l.baseQty;
      cur.value += l.qty * l.unitPrice;
      sold.set(k, cur);
    }
  }
  const repCustomers = new Map<string, string[]>();
  for (const c of ownedByRep) {
    const list = repCustomers.get(c.salespersonId!) ?? [];
    list.push(c.id);
    repCustomers.set(c.salespersonId!, list);
  }
  // a customer with its own forecast line for a product must not also be counted inside an
  // area total for that same product, or its sales would land twice
  const claimed = new Set(lines.filter((l) => l.customerId).map((l) => soldKey(l.customerId!, l.productId)));

  const q = (searchParams.product || "").trim().toLowerCase();
  const all: Row[] = lines
    .filter((l) => !q || l.product.name.toLowerCase().includes(q) || l.product.sku.toLowerCase().includes(q))
    .map((l) => {
      const fcPcs = period.months.reduce((s, m) => s + ((l as unknown as Record<string, number>)["m" + m] ?? 0), 0);
      const price = l.unitPrice ?? l.product.srp;
      // a stamped line keeps its salesperson; one never stamped follows the account's owner
      const spId = l.salespersonId ?? l.customer?.salespersonId ?? "none";

      let actPcs = 0;
      let actValue = 0;
      if (l.customerId) {
        const s = sold.get(soldKey(l.customerId, l.productId));
        if (s) { actPcs = s.pcs; actValue = s.value; }
      } else if (spId !== "none") {
        // area total: every account this salesperson owns, minus any that forecast separately
        for (const cid of repCustomers.get(spId) ?? []) {
          const k = soldKey(cid, l.productId);
          if (claimed.has(k)) continue;
          const s = sold.get(k);
          if (s) { actPcs += s.pcs; actValue += s.value; }
        }
      }

      return {
        spId,
        spName: l.salesperson?.name ?? l.customer?.salesperson?.name ?? NO_SALESPERSON,
        customerId: l.customerId ?? "none",
        customerName: l.customer?.businessName ?? NO_CUSTOMER,
        productId: l.productId,
        productName: l.product.name,
        sku: l.product.sku,
        companyId: l.product.companyId,
        piecesPerCarton: l.product.piecesPerCarton,
        fcPcs,
        fcValue: fcPcs * price,
        actPcs,
        actValue,
      };
    })
    .sort(
      (a, b) =>
        (a.spName === NO_SALESPERSON ? 1 : 0) - (b.spName === NO_SALESPERSON ? 1 : 0) ||
        a.spName.localeCompare(b.spName) ||
        (a.customerName === NO_CUSTOMER ? 1 : 0) - (b.customerName === NO_CUSTOMER ? 1 : 0) ||
        a.customerName.localeCompare(b.customerName) ||
        a.productName.localeCompare(b.productName)
    );

  const rows =
    searchParams.salesperson === "none"
      ? all.filter((r) => r.spId === "none")
      : searchParams.salesperson
        ? all.filter((r) => r.spId === searchParams.salesperson)
        : all;

  const grand = zero();
  for (const r of rows) add(grand, r);

  const rollup = (keyField: "spId" | "customerId", labelField: "spName" | "customerName") => {
    const out: { key: string; label: string; t: Totals; rows: Row[] }[] = [];
    for (const r of rows) {
      const key = r[keyField];
      let g = out.find((x) => x.key === key);
      if (!g) { g = { key, label: r[labelField], t: zero(), rows: [] }; out.push(g); }
      add(g.t, r);
      g.rows.push(r);
    }
    return out.sort((a, b) => b.t.fcValue - a.t.fcValue);
  };

  const bySalesperson = rollup("spId", "spName");
  const byCustomer = rollup("customerId", "customerName");
  const breakdown = bySalesperson.map((sp) => {
    const custs: { key: string; label: string; t: Totals; rows: Row[] }[] = [];
    for (const r of sp.rows) {
      let c = custs.find((x) => x.key === r.customerId);
      if (!c) { c = { key: r.customerId, label: r.customerName, t: zero(), rows: [] }; custs.push(c); }
      add(c.t, r);
      c.rows.push(r);
    }
    return { ...sp, customers: custs.sort((a, b) => b.t.fcValue - a.t.fcValue) };
  });

  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...searchParams, ...extra })) if (v) p.set(k, String(v));
    return `/reports/forecast?${p.toString()}`;
  };

  return (
    <div className="print-page">
      <div className="no-print mb-3 flex items-center justify-between">
        <BackButton />
        <PrintButton />
      </div>

      <div className="mb-4">
        <h1 className="text-2xl font-bold">{scope.company.companyName}</h1>
        <p className="text-sm text-gray-600">
          Sales Forecast vs Sales — {VIEWS.find(([v]) => v === view)![1]}
          {scope.combined && " · Combined (All Companies)"}
        </p>
        <p className="text-xs text-gray-500">
          {forecastId ? forecasts.find((f) => f.id === forecastId)!.title : "All forecasts"} · {period.label} {year} ·
          generated {fmtDateTime(new Date())}
        </p>
      </div>

      <form method="GET" className="no-print card mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div className="w-24">
          <label className="label">Year</label>
          <select name="year" defaultValue={String(year)} className="input">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="w-48">
          <label className="label">Period</label>
          <select name="period" defaultValue={period.value} className="input">
            {["Annual", "Semi-annual", "Quarterly", "Monthly"].map((g) => (
              <optgroup key={g} label={g}>
                {PERIODS.filter((p) => p.group === g).map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="w-52">
          <label className="label">Forecast</label>
          <select name="forecast" defaultValue={forecastId} className="input">
            <option value="">All forecasts</option>
            {forecasts.map((f) => (
              <option key={f.id} value={f.id}>{f.title} ({f.year})</option>
            ))}
          </select>
        </div>
        <div className="w-44">
          <label className="label">Salesperson</label>
          <select name="salesperson" defaultValue={searchParams.salesperson ?? ""} className="input">
            <option value="">All salespeople</option>
            <option value="none">{NO_SALESPERSON}</option>
            {salespeople.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
          </select>
        </div>
        <div className="w-48">
          <label className="label">Customer</label>
          <select name="customer" defaultValue={searchParams.customer ?? ""} className="input">
            <option value="">All customers</option>
            <option value="none">{NO_CUSTOMER}</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.businessName}</option>)}
          </select>
        </div>
        <div className="w-40">
          <label className="label">Product</label>
          <input name="product" defaultValue={searchParams.product ?? ""} placeholder="name or SKU" className="input" />
        </div>
        <div className="w-52">
          <label className="label">View</label>
          <select name="view" defaultValue={view} className="input">
            {VIEWS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </div>
        <button className="btn-primary" type="submit">Apply</button>
        <Link href="/reports/forecast" className="btn-secondary">Reset</Link>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card py-3">
          <p className="text-xs text-gray-500">Forecast Value</p>
          <p className="text-lg font-bold">{peso(grand.fcValue)}</p>
        </div>
        <div className="card py-3">
          <p className="text-xs text-gray-500">Sales Value</p>
          <p className="text-lg font-bold text-emerald-800">{peso(grand.actValue)}</p>
        </div>
        <div className="card py-3">
          <p className="text-xs text-gray-500">% Achieved</p>
          <p className="text-lg"><Achievement t={grand} strong /></p>
        </div>
        <div className="card py-3">
          <p className="text-xs text-gray-500">Variance</p>
          <p className="text-lg font-bold"><Variance t={grand} /></p>
        </div>
      </div>

      {!rows.length ? (
        <div className="card p-10 text-center text-sm text-gray-500">No forecast lines match these filters.</div>
      ) : view === "breakdown" ? (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="border-b-2 border-gray-300 bg-gray-50">
              <tr>
                <th className="table-th">Salesperson / Customer / Product</th>
                {scope.combined && <th className="table-th">Company</th>}
                <th className="table-th text-right">Forecast Qty</th>
                <th className="table-th text-right">Sales Qty</th>
                <th className="table-th text-right">Forecast Value</th>
                <th className="table-th text-right">Sales Value</th>
                <th className="table-th text-right">% Achieved</th>
                <th className="table-th text-right">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {breakdown.map((sp) => (
                <Fragment key={sp.key}>
                  <tr className="bg-emerald-100 font-bold text-emerald-900">
                    <td className="px-3 py-1.5">👤 {sp.label}</td>
                    {scope.combined && <td />}
                    <td className="px-3 py-1.5 text-right"><GroupQty pcs={sp.t.fcPcs} /></td>
                    <td className="px-3 py-1.5 text-right"><GroupQty pcs={sp.t.actPcs} /></td>
                    <td className="px-3 py-1.5 text-right">{peso(sp.t.fcValue)}</td>
                    <td className="px-3 py-1.5 text-right">{peso(sp.t.actValue)}</td>
                    <td className="px-3 py-1.5 text-right"><Achievement t={sp.t} strong /></td>
                    <td className="px-3 py-1.5 text-right"><Variance t={sp.t} /></td>
                  </tr>
                  {sp.customers.map((c) => (
                    <Fragment key={c.key}>
                      <tr className="bg-emerald-50/70 font-semibold text-emerald-800">
                        <td className="px-3 py-1 pl-6">🏢 {c.label}</td>
                        {scope.combined && <td />}
                        <td className="px-3 py-1 text-right"><GroupQty pcs={c.t.fcPcs} /></td>
                        <td className="px-3 py-1 text-right"><GroupQty pcs={c.t.actPcs} /></td>
                        <td className="px-3 py-1 text-right">{peso(c.t.fcValue)}</td>
                        <td className="px-3 py-1 text-right">{peso(c.t.actValue)}</td>
                        <td className="px-3 py-1 text-right"><Achievement t={c.t} /></td>
                        <td className="px-3 py-1 text-right"><Variance t={c.t} /></td>
                      </tr>
                      {c.rows.map((r) => (
                        <tr key={r.customerId + r.productId} className="hover:bg-gray-50">
                          <td className="px-3 py-1 pl-10">
                            {r.productName}
                            <span className="ml-1 text-xs text-gray-400">{r.sku}</span>
                          </td>
                          {scope.combined && (
                            <td className="px-3 py-1"><CompanyTag name={scope.names[r.companyId] ?? ""} /></td>
                          )}
                          <td className="px-3 py-1 text-right"><Qty pcs={r.fcPcs} ppc={r.piecesPerCarton} /></td>
                          <td className="px-3 py-1 text-right"><Qty pcs={r.actPcs} ppc={r.piecesPerCarton} /></td>
                          <td className="px-3 py-1 text-right">{peso(r.fcValue)}</td>
                          <td className="px-3 py-1 text-right">{peso(r.actValue)}</td>
                          <td className="px-3 py-1 text-right"><Achievement t={r} /></td>
                          <td className="px-3 py-1 text-right"><Variance t={r} /></td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <tr>
                <td className="px-3 py-2">GRAND TOTAL</td>
                {scope.combined && <td />}
                <td className="px-3 py-2 text-right"><GroupQty pcs={grand.fcPcs} /></td>
                <td className="px-3 py-2 text-right"><GroupQty pcs={grand.actPcs} /></td>
                <td className="px-3 py-2 text-right">{peso(grand.fcValue)}</td>
                <td className="px-3 py-2 text-right text-emerald-900">{peso(grand.actValue)}</td>
                <td className="px-3 py-2 text-right"><Achievement t={grand} strong /></td>
                <td className="px-3 py-2 text-right"><Variance t={grand} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="border-b-2 border-gray-300 bg-gray-50">
              <tr>
                <th className="table-th">{view === "salesperson" ? "Salesperson" : "Customer"}</th>
                <th className="table-th text-right">Forecast Qty</th>
                <th className="table-th text-right">Sales Qty</th>
                <th className="table-th text-right">Forecast Value</th>
                <th className="table-th text-right">Sales Value</th>
                <th className="table-th text-right">% Achieved</th>
                <th className="table-th text-right">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(view === "salesperson" ? bySalesperson : byCustomer).map((g) => (
                <tr key={g.key} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium">{view === "salesperson" ? "👤 " : "🏢 "}{g.label}</td>
                  <td className="px-3 py-2 text-right"><GroupQty pcs={g.t.fcPcs} /></td>
                  <td className="px-3 py-2 text-right"><GroupQty pcs={g.t.actPcs} /></td>
                  <td className="px-3 py-2 text-right">{peso(g.t.fcValue)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{peso(g.t.actValue)}</td>
                  <td className="px-3 py-2 text-right"><Achievement t={g.t} strong /></td>
                  <td className="px-3 py-2 text-right"><Variance t={g.t} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <tr>
                <td className="px-3 py-2">TOTAL</td>
                <td className="px-3 py-2 text-right"><GroupQty pcs={grand.fcPcs} /></td>
                <td className="px-3 py-2 text-right"><GroupQty pcs={grand.actPcs} /></td>
                <td className="px-3 py-2 text-right">{peso(grand.fcValue)}</td>
                <td className="px-3 py-2 text-right text-emerald-900">{peso(grand.actValue)}</td>
                <td className="px-3 py-2 text-right"><Achievement t={grand} strong /></td>
                <td className="px-3 py-2 text-right"><Variance t={grand} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-gray-500">
        <strong>Sales</strong> are invoiced sales receipts dated inside {period.label} {year}, voided invoices excluded and
        goods only — freight is left out because the forecast carries none. <strong>% Achieved</strong> = Sales Value ÷
        Forecast Value; <strong>Variance</strong> = Sales Value − Forecast Value, so a negative figure is a shortfall.
        Quantities are cartons with the piece count beneath; group rows total in pieces because a group mixes pack sizes.
        A line shown as an <strong>area total</strong> is one combined figure covering several accounts, and is measured
        against the sales of every customer its salesperson owns, excluding any customer that forecasts that product
        separately. The salesperson on each line is the one it was planned under, so reassigning an account later does not
        rewrite past forecasts.
      </p>
      <div className="no-print mt-4 flex gap-2">
        {VIEWS.map(([v, label]) => (
          <Link key={v} href={keep({ view: v })} className={v === view ? "btn-primary" : "btn-secondary"}>{label}</Link>
        ))}
      </div>
    </div>
  );
}
