import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { createForecast, deleteForecast } from "./actions";
import { getParentInfos } from "./parents";

export default async function ForecastListPage() {
  const user = await requirePerm("forecast");
  const [forecasts, parentMap] = await Promise.all([
    prisma.forecast.findMany({
      orderBy: [{ year: "desc" }, { createdAt: "desc" }],
      include: { lines: true },
    }),
    getParentInfos(),
  ]);
  const canEdit = user.perm === "READ_WRITE";
  const thisYear = new Date().getFullYear();

  return (
    <div>
      <PageHeader title="Sales Forecast" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[640px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="table-th">Title</th>
                  <th className="table-th">Year</th>
                  <th className="table-th">Area</th>
                  <th className="table-th text-right">Products</th>
                  <th className="table-th text-right">Total Qty</th>
                  <th className="table-th text-right">Total Amount</th>
                  {canEdit && <th className="table-th" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {forecasts.map((f) => {
                  const totalQty = f.lines.reduce(
                    (s, l) => s + l.m1 + l.m2 + l.m3 + l.m4 + l.m5 + l.m6 + l.m7 + l.m8 + l.m9 + l.m10 + l.m11 + l.m12,
                    0
                  );
                  const totalAmount = f.lines.reduce(
                    (s, l) =>
                      s +
                      (l.m1 + l.m2 + l.m3 + l.m4 + l.m5 + l.m6 + l.m7 + l.m8 + l.m9 + l.m10 + l.m11 + l.m12) *
                        (parentMap.get(l.parentItem)?.price ?? 0),
                    0
                  );
                  return (
                    <tr key={f.id} className="hover:bg-gray-50">
                      <td className="table-td">
                        <Link href={`/forecast/${f.id}`} className="font-medium text-emerald-700 hover:underline">{f.title}</Link>
                        <p className="text-xs text-gray-400">created {fmtDate(f.createdAt)}</p>
                      </td>
                      <td className="table-td">{f.year}</td>
                      <td className="table-td">{f.area}</td>
                      <td className="table-td text-right">{f.lines.length}</td>
                      <td className="table-td text-right font-semibold">{totalQty.toLocaleString()}</td>
                      <td className="table-td text-right font-semibold">{peso(totalAmount)}</td>
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
                  <tr><td colSpan={7} className="p-8 text-center text-sm text-gray-500">No forecasts yet — create your first one.</td></tr>
                )}
              </tbody>
            </table>
          </div>
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
