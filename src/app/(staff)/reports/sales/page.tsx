import { requirePerm } from "@/lib/auth";
import { getSalesReport, parseRange } from "@/lib/reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

export default async function SalesReportPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  await requirePerm("reports");
  const range = parseRange(searchParams);
  const r = await getSalesReport(range);
  const fromStr = range.from.toISOString().slice(0, 10);
  const toStr = range.to.toISOString().slice(0, 10);

  return (
    <div className="print-page">
      <PageHeader title="Sales Report">
        <a href={`/api/export/sales?from=${fromStr}&to=${toStr}`} className="btn-secondary no-print">⬇ Excel</a>
        <span className="no-print"><PrintButton /></span>
      </PageHeader>

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <p className="mb-4 text-sm text-gray-600">
        {fmtDate(range.from)} – {fmtDate(range.to)} · Total invoiced sales:{" "}
        <span className="text-lg font-bold text-emerald-800">{peso(r.total)}</span> · {r.invoices.length} invoice(s)
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 font-semibold">By Customer</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr><th className="table-th">Customer</th><th className="table-th">Region</th><th className="table-th text-right">Inv.</th><th className="table-th text-right">Amount</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {r.byCustomer.map((c) => (
                  <tr key={c.name}><td className="table-td">{c.name}</td><td className="table-td text-sm text-gray-500">{c.region}</td><td className="table-td text-right">{c.count}</td><td className="table-td text-right">{peso(c.amount)}</td></tr>
                ))}
                {!r.byCustomer.length && <tr><td colSpan={4} className="p-6 text-center text-sm text-gray-500">No sales in range.</td></tr>}
              </tbody>
            </table>
          </div>

          <h2 className="mb-2 mt-4 font-semibold">By Region</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr><th className="table-th">Region</th><th className="table-th text-right">Amount</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {r.byRegion.map((x) => (
                  <tr key={x.region}><td className="table-td">{x.region}</td><td className="table-td text-right">{peso(x.amount)}</td></tr>
                ))}
                {!r.byRegion.length && <tr><td colSpan={2} className="p-6 text-center text-sm text-gray-500">No sales in range.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="mb-2 font-semibold">By Product (Top 20)</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr><th className="table-th">Product</th><th className="table-th text-right">Qty</th><th className="table-th text-right">Amount</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {r.byProduct.slice(0, 20).map((p) => (
                  <tr key={p.sku}><td className="table-td text-sm">{p.name}</td><td className="table-td text-right">{p.qty}</td><td className="table-td text-right">{peso(p.amount)}</td></tr>
                ))}
                {!r.byProduct.length && <tr><td colSpan={3} className="p-6 text-center text-sm text-gray-500">No sales in range.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
