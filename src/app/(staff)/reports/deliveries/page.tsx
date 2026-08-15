import { requireStaff } from "@/lib/auth";
import { getDeliveryPerformance, parseRange } from "@/lib/reports";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

const TARGET = 5;

export default async function DeliveryPerformancePage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  await requireStaff(["SUPER_ADMIN", "ADMIN"]);
  const range = parseRange(searchParams);
  const perf = await getDeliveryPerformance(range);
  const fromStr = range.from.toISOString().slice(0, 10);
  const toStr = range.to.toISOString().slice(0, 10);
  const total = perf.reduce((s, d) => s + d.count, 0);
  const daysMet = perf.filter((d) => d.count >= TARGET).length;

  return (
    <div className="print-page mx-auto max-w-2xl">
      <PageHeader title="Delivery Performance">
        <a href={`/api/export/delivery-performance?from=${fromStr}&to=${toStr}`} className="btn-secondary no-print">⬇ Excel</a>
        <span className="no-print"><PrintButton /></span>
      </PageHeader>

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <p className="mb-4 text-sm text-gray-600">
        {fmtDate(range.from)} – {fmtDate(range.to)} · {total} deliveries · target met on {daysMet}/{perf.length} active day(s)
      </p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr><th className="table-th">Date</th><th className="table-th text-right">Deliveries</th><th className="table-th">vs Target ({TARGET}/day)</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {perf.map((d) => (
              <tr key={d.date}>
                <td className="table-td">{fmtDate(d.date)}</td>
                <td className="table-td text-right font-semibold">{d.count}</td>
                <td className="table-td">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-32 overflow-hidden rounded-full bg-gray-100">
                      <div className={`h-full ${d.count >= TARGET ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${Math.min(100, (d.count / TARGET) * 100)}%` }} />
                    </div>
                    <span className={`text-xs font-semibold ${d.count >= TARGET ? "text-emerald-700" : "text-amber-600"}`}>
                      {d.count >= TARGET ? "Met" : `${TARGET - d.count} short`}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
            {!perf.length && <tr><td colSpan={3} className="p-8 text-center text-sm text-gray-500">No deliveries in range.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
