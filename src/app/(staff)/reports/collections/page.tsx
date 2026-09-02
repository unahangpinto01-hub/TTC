import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { getCollections, parseRange } from "@/lib/reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";

const METHODS = ["Cash", "Check", "Bank Transfer", "GCash"];

export default async function CollectionsReportPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; company?: string; method?: string };
}) {
  const user = await requirePerm("ar");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const method = METHODS.includes(searchParams.method || "") ? searchParams.method! : "";
  const r = await getCollections(range, scope.ids, method ? { method } : undefined);
  const fromStr = range.from.toISOString().slice(0, 10);
  const toStr = range.to.toISOString().slice(0, 10);

  const qs = new URLSearchParams({ from: fromStr, to: toStr, company: scope.value });
  if (method) qs.set("method", method);

  return (
    <div className="print-page">
      <PageHeader title="Collections Report">
        <a href={`/api/export/collections?${qs.toString()}`} className="btn-secondary no-print">⬇ Excel</a>
        <span className="no-print"><PrintButton /></span>
      </PageHeader>

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <div>
          <label className="label">Method</label>
          <select name="method" defaultValue={method} className="input max-w-[150px]">
            <option value="">All methods</option>
            {METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <p className="mb-4 text-sm text-gray-600">
        <span className="font-semibold">{scope.label}</span> · {fmtDate(range.from)} – {fmtDate(range.to)}
        {method ? ` · ${method}` : ""} · Total collected:{" "}
        <span className="text-lg font-bold text-emerald-800">{peso(r.total)}</span> · {r.rows.length} payment(s)
      </p>

      {scope.combined && (
        <div className="card mb-4 overflow-x-auto p-0">
          <table className="w-full">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr><th className="table-th">Company</th><th className="table-th text-right">Payments</th><th className="table-th text-right">Collected</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {r.byCompany.map((c) => (
                <tr key={c.name}>
                  <td className="table-td font-medium">{c.name}</td>
                  <td className="table-td text-right">{c.count}</td>
                  <td className="table-td text-right">{peso(c.amount)}</td>
                </tr>
              ))}
              <tr className="bg-gray-50 font-bold">
                <td className="table-td">COMBINED GRAND TOTAL</td>
                <td className="table-td text-right">{r.rows.length}</td>
                <td className="table-td text-right text-emerald-800">{peso(r.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 font-semibold">By Payment Method</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr><th className="table-th">Method</th><th className="table-th text-right">Count</th><th className="table-th text-right">Amount</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {r.byMethod.map((m) => (
                  <tr key={m.name}><td className="table-td">{m.name}</td><td className="table-td text-right">{m.count}</td><td className="table-td text-right">{peso(m.amount)}</td></tr>
                ))}
                {!r.byMethod.length && <tr><td colSpan={3} className="p-6 text-center text-sm text-gray-500">No collections in range.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">By Customer</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr><th className="table-th">Customer</th><th className="table-th text-right">Payments</th><th className="table-th text-right">Amount</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {r.byCustomer.slice(0, 20).map((c) => (
                  <tr key={c.name}><td className="table-td text-sm">{c.name}</td><td className="table-td text-right">{c.count}</td><td className="table-td text-right">{peso(c.amount)}</td></tr>
                ))}
                {!r.byCustomer.length && <tr><td colSpan={3} className="p-6 text-center text-sm text-gray-500">No collections in range.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <h2 className="mb-2 font-semibold">Payments Received</h2>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Date</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Invoice No.</th>
              <th className="table-th">Customer</th>
              <th className="table-th">Method</th>
              <th className="table-th">Reference</th>
              <th className="table-th text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {r.rows.map((p) => (
              <tr key={p.id}>
                <td className="table-td text-sm">{fmtDate(p.date)}</td>
                {scope.combined && <td className="table-td"><CompanyTag name={p.company} /></td>}
                <td className="table-td font-mono text-sm">{p.srNumber}</td>
                <td className="table-td text-sm">{p.customer}</td>
                <td className="table-td text-sm">{p.method}</td>
                <td className="table-td text-xs text-gray-500">{p.refNo || "—"}</td>
                <td className="table-td text-right">{peso(p.amount)}</td>
              </tr>
            ))}
            {!r.rows.length && (
              <tr><td colSpan={scope.combined ? 7 : 6} className="p-8 text-center text-sm text-gray-500">No payments received in this range.</td></tr>
            )}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50 font-bold">
            <tr>
              <td className="table-td" colSpan={scope.combined ? 6 : 5}>{scope.combined ? "COMBINED GRAND TOTAL" : "TOTAL COLLECTED"}</td>
              <td className="table-td text-right text-emerald-800">{peso(r.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
