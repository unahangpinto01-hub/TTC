import Link from "next/link";
import { Fragment } from "react";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { allowedCompanies } from "@/lib/company";
import { getCategoryNames } from "@/lib/categories";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function fmtPeso(n: number) {
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type CombinedRow = {
  productId: string;
  sku: string;
  name: string;
  category: string;
  companyId: string;
  company: string;
  monthsQty: number[];
  monthsVal: number[];
  /** every effective price seen for this product across the areas — usually just one */
  prices: Set<number>;
  qty: number;
  value: number;
};

/** Live roll-up of every forecast in a year: one row per product, quantities and
    values added across all areas. Always current — edit an area and this follows. */
export default async function CombinedForecastPage({ searchParams }: { searchParams: { year?: string } }) {
  const user = await requirePerm("forecast");
  const companies = await allowedCompanies(user);
  const companyIds = companies.map((c) => c.id);
  const names = Object.fromEntries(companies.map((c) => [c.id, c.companyName]));
  const categoryOrder = await getCategoryNames();

  const years = (await prisma.forecast.findMany({ select: { year: true }, distinct: ["year"], orderBy: { year: "desc" } })).map((f) => f.year);
  const year = years.includes(Number(searchParams.year)) ? Number(searchParams.year) : years[0] ?? new Date().getFullYear();

  const forecasts = await prisma.forecast.findMany({
    where: { year },
    orderBy: { area: "asc" },
    include: {
      lines: {
        include: { product: { select: { id: true, sku: true, name: true, category: true, srp: true, companyId: true } } },
      },
    },
  });

  // add every visible line into its product's combined row
  const byProduct = new Map<string, CombinedRow>();
  const areas: { id: string; title: string; area: string; qty: number; value: number; products: number }[] = [];
  for (const f of forecasts) {
    const lines = f.lines.filter((l) => companyIds.includes(l.product.companyId));
    let aQty = 0, aVal = 0;
    for (const l of lines) {
      const months = [l.m1, l.m2, l.m3, l.m4, l.m5, l.m6, l.m7, l.m8, l.m9, l.m10, l.m11, l.m12];
      const price = l.unitPrice ?? l.product.srp;
      let row = byProduct.get(l.productId);
      if (!row) {
        row = {
          productId: l.productId, sku: l.product.sku, name: l.product.name, category: l.product.category,
          companyId: l.product.companyId, company: names[l.product.companyId] ?? "",
          monthsQty: Array(12).fill(0), monthsVal: Array(12).fill(0), prices: new Set(), qty: 0, value: 0,
        };
        byProduct.set(l.productId, row);
      }
      row.prices.add(price);
      for (let mi = 0; mi < 12; mi++) {
        row.monthsQty[mi] += months[mi];
        row.monthsVal[mi] += months[mi] * price;
      }
      const lineQty = months.reduce((a, b) => a + b, 0);
      row.qty += lineQty;
      row.value += lineQty * price;
      aQty += lineQty;
      aVal += lineQty * price;
    }
    areas.push({ id: f.id, title: f.title, area: f.area, qty: aQty, value: aVal, products: lines.length });
  }

  const companyRank = Object.fromEntries(companies.map((c, i) => [c.id, i])) as Record<string, number>;
  const rows = [...byProduct.values()].sort((a, b) => {
    const ra = companyRank[a.companyId] ?? 99;
    const rb = companyRank[b.companyId] ?? 99;
    if (ra !== rb) return ra - rb;
    const ca = categoryOrder.indexOf(a.category);
    const cb = categoryOrder.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    return a.name.localeCompare(b.name);
  });

  const showCompanyColumn = companies.length > 1;
  const colCount = 1 + (showCompanyColumn ? 1 : 0) + 12 + 3;
  const monthQty = (rs: CombinedRow[], mi: number) => rs.reduce((s, r) => s + r.monthsQty[mi], 0);
  const monthValue = (rs: CombinedRow[], mi: number) => rs.reduce((s, r) => s + r.monthsVal[mi], 0);
  const totalQty = (rs: CombinedRow[]) => rs.reduce((s, r) => s + r.qty, 0);
  const totalValue = (rs: CombinedRow[]) => rs.reduce((s, r) => s + r.value, 0);
  const perCompany = companies
    .map((c) => ({ ...c, rows: rows.filter((r) => r.companyId === c.id) }))
    .filter((c) => c.rows.length > 0);

  let lastGroup = "";

  return (
    <div className="print-page">
      <div className="no-print mb-3 flex items-center justify-between">
        <Link href="/forecast" className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
          ← Back to Forecasts
        </Link>
        <PrintButton />
      </div>
      <PageHeader title={`Combined Forecast — All Areas ${year}`} />
      <p className="mb-3 hidden text-sm text-gray-600 print:block">
        Year {year} · {areas.map((a) => a.area).join(" + ")}
      </p>

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="label">Year</label>
          <select name="year" defaultValue={year} className="input w-32">
            {years.map((y) => <option key={y}>{y}</option>)}
          </select>
        </div>
        <button className="btn-secondary" type="submit">Apply</button>
        <span className="pb-2 text-xs text-gray-500">
          Live view — combines all {areas.length} forecast(s) for {year}; edits to any area show here automatically.
        </span>
      </form>

      <div className="card mb-4 overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Forecast Included</th>
              <th className="table-th">Area</th>
              <th className="table-th text-right">Products</th>
              <th className="table-th text-right">Total Qty</th>
              <th className="table-th text-right">Forecast Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {areas.map((a) => (
              <tr key={a.id}>
                <td className="table-td"><Link href={`/forecast/${a.id}`} className="text-emerald-700 hover:underline">{a.title}</Link></td>
                <td className="table-td">{a.area}</td>
                <td className="table-td text-right">{a.products}</td>
                <td className="table-td text-right">{a.qty.toLocaleString()}</td>
                <td className="table-td text-right">{fmtPeso(a.value)}</td>
              </tr>
            ))}
            {!areas.length && (
              <tr><td colSpan={5} className="p-8 text-center text-sm text-gray-500">No forecasts for {year} yet.</td></tr>
            )}
            {areas.length > 0 && (
              <tr className="bg-gray-50 font-bold">
                <td className="table-td">COMBINED TOTAL</td>
                <td className="table-td" />
                <td className="table-td text-right">{rows.length}</td>
                <td className="table-td text-right">{totalQty(rows).toLocaleString()}</td>
                <td className="table-td text-right text-emerald-800">{fmtPeso(totalValue(rows))}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[1250px] text-xs">
            <thead className="border-b-2 border-gray-300 bg-gray-50">
              <tr>
                <th className="sticky left-0 z-10 bg-gray-50 px-2 py-2 text-left font-semibold">PRODUCT</th>
                {showCompanyColumn && <th className="px-2 py-2 text-left font-semibold">COMPANY</th>}
                {MONTHS.map((m) => (
                  <th key={m} className="px-1 py-2 text-right font-semibold">{m}</th>
                ))}
                <th className="px-2 py-2 text-right font-bold text-red-600">FORECAST QTY</th>
                <th className="px-2 py-2 text-right font-semibold">UNIT PRICE</th>
                <th className="px-2 py-2 text-right font-bold">FORECAST VALUE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const group = showCompanyColumn ? `${r.company} — ${r.category}` : r.category;
                const showGroup = group !== lastGroup;
                lastGroup = group;
                const uniform = r.prices.size === 1 ? [...r.prices][0] : null;
                return (
                  <Fragment key={r.productId}>
                    {showGroup && (
                      <tr className="bg-emerald-50/80">
                        <td colSpan={colCount} className="sticky left-0 px-2 py-1 font-bold uppercase tracking-wide text-emerald-900">{group}</td>
                      </tr>
                    )}
                    <tr className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="sticky left-0 z-10 max-w-[240px] truncate bg-white px-2 py-1 font-medium" title={`${r.sku} · ${r.name}`}>
                        {r.name}
                        <span className="ml-1 text-[10px] font-normal text-gray-400">{r.sku}</span>
                      </td>
                      {showCompanyColumn && <td className="whitespace-nowrap px-2 py-1 text-[11px] text-gray-500">{r.company}</td>}
                      {r.monthsQty.map((m, mi) => (
                        <td key={mi} className="px-0.5 py-0.5 text-right"><span className="pr-1">{m ? m.toLocaleString() : "-"}</span></td>
                      ))}
                      <td className="px-2 py-1 text-right font-semibold text-red-600">{r.qty.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right text-gray-600">
                        {uniform !== null ? fmtPeso(uniform) : <span title="Priced differently per area — the value column adds each area at its own price">varies</span>}
                      </td>
                      <td className="px-2 py-1 text-right font-semibold">{fmtPeso(r.value)}</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-gray-300 bg-gray-50">
              {perCompany.length > 1 &&
                perCompany.map((c) => (
                  <tr key={c.id} className="border-b border-gray-200 text-gray-700">
                    <td className="sticky left-0 bg-gray-50 px-2 py-1.5 font-semibold">SUBTOTAL — {c.companyName}</td>
                    {showCompanyColumn && <td />}
                    {MONTHS.map((_, mi) => (
                      <td key={mi} className="px-1 py-1.5 text-right">{monthQty(c.rows, mi).toLocaleString()}</td>
                    ))}
                    <td className="px-2 py-1.5 text-right font-semibold">{totalQty(c.rows).toLocaleString()}</td>
                    <td />
                    <td className="px-2 py-1.5 text-right font-semibold">{fmtPeso(totalValue(c.rows))}</td>
                  </tr>
                ))}
              <tr className="font-bold">
                <td className="sticky left-0 bg-gray-50 px-2 py-1.5">TOTAL QTY</td>
                {showCompanyColumn && <td />}
                {MONTHS.map((_, mi) => (
                  <td key={mi} className="px-1 py-1.5 text-right">{monthQty(rows, mi).toLocaleString()}</td>
                ))}
                <td className="bg-yellow-100 px-2 py-1.5 text-right text-red-600">{totalQty(rows).toLocaleString()}</td>
                <td />
                <td className="px-2 py-1.5" />
              </tr>
              <tr className="font-semibold text-emerald-900">
                <td className="sticky left-0 bg-gray-50 px-2 py-1.5">FORECAST VALUE (₱)</td>
                {showCompanyColumn && <td />}
                {MONTHS.map((_, mi) => (
                  <td key={mi} className="px-1 py-1.5 text-right">{monthValue(rows, mi).toLocaleString("en-PH", { maximumFractionDigits: 0 })}</td>
                ))}
                <td className="px-2 py-1.5" />
                <td />
                <td className="bg-yellow-100 px-2 py-1.5 text-right font-bold">{fmtPeso(totalValue(rows))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-gray-500">
        One row per product, added up across every area forecast of the year. A product priced differently in
        different areas shows &ldquo;varies&rdquo; — its value still adds each area at that area&rsquo;s own price.
        This page is read-only; open an area forecast to make changes.
      </p>
    </div>
  );
}
