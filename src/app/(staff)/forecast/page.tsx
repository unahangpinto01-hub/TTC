import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { createForecast, deleteForecast } from "./actions";
import { allowedCompanies } from "@/lib/company";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";

export default async function ForecastListPage({ searchParams }: { searchParams: { company?: string } }) {
  const user = await requirePerm("forecast");
  // a forecast is shared — it belongs to no single company. The filter chooses which
  // company's product lines are counted; a user only ever sees companies they are granted.
  const scope = await resolveReportScope(user, searchParams.company);
  const companies = await allowedCompanies(user);
  const names = Object.fromEntries(companies.map((c) => [c.id, c.companyName]));

  const forecasts = await prisma.forecast.findMany({
    orderBy: [{ year: "desc" }, { createdAt: "desc" }],
    include: {
      lines: { include: { product: { select: { srp: true, companyId: true } } } },
    },
  });
  const canEdit = user.perm === "READ_WRITE";
  const thisYear = new Date().getFullYear();

  return (
    <div>
      <PageHeader title="Sales Forecast" />
      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        {scope.options.length > 1 && <button className="btn-secondary" type="submit">Apply</button>}
      </form>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="table-th">Title</th>
                  {companies.length > 1 && <th className="table-th">Companies</th>}
                  <th className="table-th">Year</th>
                  <th className="table-th">Area</th>
                  <th className="table-th text-right">Products</th>
                  <th className="table-th text-right">Total Qty</th>
                  <th className="table-th text-right">Forecast Value</th>
                  {canEdit && <th className="table-th" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {forecasts.map((f) => {
                  const lines = f.lines.filter((l) => scope.ids.includes(l.product.companyId));
                  const qty = (l: (typeof lines)[number]) =>
                    l.m1 + l.m2 + l.m3 + l.m4 + l.m5 + l.m6 + l.m7 + l.m8 + l.m9 + l.m10 + l.m11 + l.m12;
                  const totalQty = lines.reduce((s, l) => s + qty(l), 0);
                  // a line priced by hand is valued at that price; the rest follow the product SRP
                  const totalValue = lines.reduce((s, l) => s + qty(l) * (l.unitPrice ?? l.product.srp), 0);
                  const inThis = Array.from(new Set(lines.map((l) => l.product.companyId)));
                  return (
                    <tr key={f.id} className="hover:bg-gray-50">
                      <td className="table-td">
                        <Link href={`/forecast/${f.id}`} className="font-medium text-emerald-700 hover:underline">{f.title}</Link>
                        <p className="text-xs text-gray-400">created {fmtDate(f.createdAt)}</p>
                      </td>
                      {companies.length > 1 && (
                        <td className="table-td">
                          <span className="flex flex-wrap gap-1">
                            {inThis.map((id) => <CompanyTag key={id} name={names[id] ?? ""} />)}
                            {!inThis.length && <span className="text-xs text-gray-400">—</span>}
                          </span>
                        </td>
                      )}
                      <td className="table-td">{f.year}</td>
                      <td className="table-td">{f.area}</td>
                      <td className="table-td text-right">{lines.length}</td>
                      <td className="table-td text-right font-semibold">{totalQty.toLocaleString()}</td>
                      <td className="table-td text-right font-semibold">{peso(totalValue)}</td>
                      {canEdit && (
                        <td className="table-td text-right">
                          <form action={deleteForecast}>
                            <input type="hidden" name="id" value={f.id} />
                            <button className="text-xs text-red-500 hover:underline" type="submit">delete</button>
                          </form>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {!forecasts.length && (
                  <tr><td colSpan={companies.length > 1 ? 8 : 7} className="p-8 text-center text-sm text-gray-500">No forecasts yet — create your first one.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            A forecast is shared: it can hold products from any company. Forecast Value = quantity × unit price, which
            follows the product&rsquo;s current active SRP unless a planning price was typed on that row.
          </p>
        </div>
        {canEdit && (
          <form action={createForecast} className="card h-fit space-y-3">
            <h2 className="font-semibold">New Forecast</h2>
            <div>
              <label className="label">Title</label>
              <input name="title" required className="input" placeholder={`MONTHLY FORECAST FOR CY${thisYear} - LUZVIMIN`} />
            </div>
            <div><label className="label">Year</label><input name="year" type="number" defaultValue={thisYear} required className="input" /></div>
            <div><label className="label">Area</label><input name="area" required className="input" placeholder="LUZVIMIN / Luzon / Visayas / Mindanao" /></div>
            <button className="btn-primary" type="submit">Create Forecast</button>
          </form>
        )}
      </div>
    </div>
  );
}
