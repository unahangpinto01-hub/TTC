import { Fragment } from "react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { peso, fmtDateTime } from "@/lib/format";
import { PrintButton, BackButton } from "@/components/print-button";
import { getSalespeople, NO_SALESPERSON } from "@/lib/salespeople";

type SP = {
  company?: string;
  forecast?: string;
  salesperson?: string;
  customer?: string;
  product?: string;
  view?: string;
};

const VIEWS = [
  ["breakdown", "Salesperson → Customer → Product"],
  ["salesperson", "By Salesperson"],
  ["customer", "By Customer"],
] as const;

type Row = {
  spId: string;
  spName: string;
  customerId: string;
  customerName: string;
  productId: string;
  productName: string;
  sku: string;
  companyId: string;
  qty: number;
  price: number;
  value: number;
};

export default async function ForecastReportPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePerm("reports");
  const scope = await resolveReportScope(user, searchParams.company);
  const view = VIEWS.some(([v]) => v === searchParams.view) ? searchParams.view! : "breakdown";

  const [forecasts, salespeople, customers] = await Promise.all([
    prisma.forecast.findMany({ orderBy: [{ year: "desc" }, { createdAt: "desc" }], select: { id: true, title: true, year: true, area: true } }),
    getSalespeople(),
    prisma.customer.findMany({ where: { status: "Active" }, select: { id: true, businessName: true }, orderBy: { businessName: "asc" } }),
  ]);
  const forecastId = forecasts.some((f) => f.id === searchParams.forecast) ? searchParams.forecast! : "";

  const where: any = { product: { companyId: { in: scope.ids } } };
  if (forecastId) where.forecastId = forecastId;
  if (searchParams.salesperson === "none") where.salespersonId = null;
  else if (searchParams.salesperson) where.salespersonId = searchParams.salesperson;
  if (searchParams.customer) where.customerId = searchParams.customer;

  const lines = await prisma.forecastLine.findMany({
    where,
    include: {
      product: { select: { id: true, sku: true, name: true, srp: true, companyId: true } },
      customer: { select: { id: true, businessName: true } },
      salesperson: { select: { id: true, name: true } },
      forecast: { select: { title: true, year: true } },
    },
  });

  const q = (searchParams.product || "").trim().toLowerCase();
  const rows: Row[] = lines
    .filter((l) => !q || l.product.name.toLowerCase().includes(q) || l.product.sku.toLowerCase().includes(q))
    .map((l) => {
      const qty = l.m1 + l.m2 + l.m3 + l.m4 + l.m5 + l.m6 + l.m7 + l.m8 + l.m9 + l.m10 + l.m11 + l.m12;
      const price = l.unitPrice ?? l.product.srp;
      return {
        spId: l.salespersonId ?? "none",
        spName: l.salesperson?.name ?? NO_SALESPERSON,
        customerId: l.customerId,
        customerName: l.customer.businessName,
        productId: l.productId,
        productName: l.product.name,
        sku: l.product.sku,
        companyId: l.product.companyId,
        qty,
        price,
        value: qty * price,
      };
    })
    .sort(
      (a, b) =>
        (a.spName === NO_SALESPERSON ? 1 : 0) - (b.spName === NO_SALESPERSON ? 1 : 0) ||
        a.spName.localeCompare(b.spName) ||
        a.customerName.localeCompare(b.customerName) ||
        a.productName.localeCompare(b.productName)
    );

  const grandQty = rows.reduce((s, r) => s + r.qty, 0);
  const grandValue = rows.reduce((s, r) => s + r.value, 0);

  /** roll the rows up by any key, keeping insertion order */
  const rollup = <K extends keyof Row>(keyField: K, labelField: keyof Row) => {
    const out: { key: string; label: string; qty: number; value: number; rows: Row[] }[] = [];
    for (const r of rows) {
      const key = String(r[keyField]);
      let g = out.find((x) => x.key === key);
      if (!g) {
        g = { key, label: String(r[labelField]), qty: 0, value: 0, rows: [] };
        out.push(g);
      }
      g.qty += r.qty;
      g.value += r.value;
      g.rows.push(r);
    }
    return out.sort((a, b) => b.value - a.value);
  };

  const bySalesperson = rollup("spId", "spName");
  const byCustomer = rollup("customerId", "customerName");

  // nested Salesperson → Customer → Product for the breakdown view
  const breakdown = bySalesperson.map((sp) => {
    const custs: { key: string; label: string; qty: number; value: number; rows: Row[] }[] = [];
    for (const r of sp.rows) {
      let c = custs.find((x) => x.key === r.customerId);
      if (!c) {
        c = { key: r.customerId, label: r.customerName, qty: 0, value: 0, rows: [] };
        custs.push(c);
      }
      c.qty += r.qty;
      c.value += r.value;
      c.rows.push(r);
    }
    return { ...sp, customers: custs.sort((a, b) => b.value - a.value) };
  });

  const share = (v: number) => (grandValue > 0 ? ((v / grandValue) * 100).toFixed(1) + "%" : "—");
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
          Sales Forecast Report — {VIEWS.find(([v]) => v === view)![1]}
          {scope.combined && " · Combined (All Companies)"}
        </p>
        <p className="text-xs text-gray-500">
          {forecastId ? forecasts.find((f) => f.id === forecastId)!.title : "All forecasts"} · generated {fmtDateTime(new Date())}
        </p>
      </div>

      <form method="GET" className="no-print card mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div className="w-56">
          <label className="label">Forecast</label>
          <select name="forecast" defaultValue={forecastId} className="input">
            <option value="">All forecasts</option>
            {forecasts.map((f) => (
              <option key={f.id} value={f.id}>{f.title} ({f.year})</option>
            ))}
          </select>
        </div>
        <div className="w-48">
          <label className="label">Salesperson</label>
          <select name="salesperson" defaultValue={searchParams.salesperson ?? ""} className="input">
            <option value="">All salespeople</option>
            <option value="none">{NO_SALESPERSON}</option>
            {salespeople.map((sp) => (
              <option key={sp.id} value={sp.id}>{sp.name}</option>
            ))}
          </select>
        </div>
        <div className="w-52">
          <label className="label">Customer</label>
          <select name="customer" defaultValue={searchParams.customer ?? ""} className="input">
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.businessName}</option>
            ))}
          </select>
        </div>
        <div className="w-44">
          <label className="label">Product</label>
          <input name="product" defaultValue={searchParams.product ?? ""} placeholder="name or SKU" className="input" />
        </div>
        <div className="w-56">
          <label className="label">View</label>
          <select name="view" defaultValue={view} className="input">
            {VIEWS.map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </div>
        <button className="btn-primary" type="submit">Apply</button>
        <Link href="/reports/forecast" className="btn-secondary">Reset</Link>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card py-3"><p className="text-xs text-gray-500">Salespeople</p><p className="text-lg font-bold">{bySalesperson.length}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Customers</p><p className="text-lg font-bold">{byCustomer.length}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Total Forecast Qty</p><p className="text-lg font-bold">{grandQty.toLocaleString()}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Total Forecast Value</p><p className="text-lg font-bold text-emerald-800">{peso(grandValue)}</p></div>
      </div>

      {!rows.length ? (
        <div className="card p-10 text-center text-sm text-gray-500">
          No forecast lines match these filters.
        </div>
      ) : view === "breakdown" ? (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b-2 border-gray-300 bg-gray-50">
              <tr>
                <th className="table-th">Salesperson / Customer / Product</th>
                {scope.combined && <th className="table-th">Company</th>}
                <th className="table-th text-right">Forecast Qty</th>
                <th className="table-th text-right">Unit Price</th>
                <th className="table-th text-right">Forecast Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {breakdown.map((sp) => (
                <Fragment key={sp.key}>
                  <tr className="bg-emerald-100 font-bold text-emerald-900">
                    <td className="px-3 py-1.5">👤 {sp.label}</td>
                    {scope.combined && <td />}
                    <td className="px-3 py-1.5 text-right">{sp.qty.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right text-xs font-normal">{share(sp.value)} of total</td>
                    <td className="px-3 py-1.5 text-right">{peso(sp.value)}</td>
                  </tr>
                  {sp.customers.map((c) => (
                    <Fragment key={c.key}>
                      <tr className="bg-emerald-50/70 font-semibold text-emerald-800">
                        <td className="px-3 py-1 pl-6">🏢 {c.label}</td>
                        {scope.combined && <td />}
                        <td className="px-3 py-1 text-right">{c.qty.toLocaleString()}</td>
                        <td />
                        <td className="px-3 py-1 text-right">{peso(c.value)}</td>
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
                          <td className="px-3 py-1 text-right">{r.qty.toLocaleString()}</td>
                          <td className="px-3 py-1 text-right text-gray-600">{peso(r.price)}</td>
                          <td className="px-3 py-1 text-right font-medium">{peso(r.value)}</td>
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
                <td className="px-3 py-2 text-right">{grandQty.toLocaleString()}</td>
                <td />
                <td className="px-3 py-2 text-right text-emerald-900">{peso(grandValue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="border-b-2 border-gray-300 bg-gray-50">
              <tr>
                <th className="table-th">{view === "salesperson" ? "Salesperson" : "Customer"}</th>
                <th className="table-th text-right">{view === "salesperson" ? "Customers" : "Products"}</th>
                <th className="table-th text-right">Lines</th>
                <th className="table-th text-right">Forecast Qty</th>
                <th className="table-th text-right">Forecast Value</th>
                <th className="table-th text-right">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(view === "salesperson" ? bySalesperson : byCustomer).map((g) => (
                <tr key={g.key} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium">
                    {view === "salesperson" ? "👤 " : "🏢 "}
                    {g.label}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {view === "salesperson"
                      ? new Set(g.rows.map((r) => r.customerId)).size.toLocaleString()
                      : new Set(g.rows.map((r) => r.productId)).size.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right">{g.rows.length.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">{g.qty.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-semibold">{peso(g.value)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{share(g.value)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <tr>
                <td className="px-3 py-2">TOTAL</td>
                <td />
                <td className="px-3 py-2 text-right">{rows.length.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">{grandQty.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-emerald-900">{peso(grandValue)}</td>
                <td className="px-3 py-2 text-right">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-gray-500">
        The salesperson on each line is the one it was planned under, stored on the forecast itself — reassigning an account
        later does not rewrite past forecasts. Forecast Value = quantity × unit price (the product&rsquo;s current SRP unless a
        planning price was set on that line).
      </p>
      <div className="no-print mt-4 flex gap-2">
        {VIEWS.map(([v, label]) => (
          <Link key={v} href={keep({ view: v })} className={v === view ? "btn-primary" : "btn-secondary"}>{label}</Link>
        ))}
      </div>
    </div>
  );
}
