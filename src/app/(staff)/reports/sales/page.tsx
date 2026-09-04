import { NoConversion } from "@/components/qty";
import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { getSalesReport, getProvinces, parseRange } from "@/lib/reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";

export default async function SalesReportPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; province?: string; company?: string };
}) {
  const user = await requirePerm("reports");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const provinces = await getProvinces();
  const province = provinces.includes(searchParams.province || "") ? searchParams.province! : "";
  const r = await getSalesReport(range, scope.ids, province ? { province } : undefined);
  const fromStr = range.from.toISOString().slice(0, 10);
  const toStr = range.to.toISOString().slice(0, 10);

  const qs = new URLSearchParams({ from: fromStr, to: toStr });
  if (province) qs.set("province", province);
  qs.set("company", scope.value);

  return (
    <div className="print-page">
      <PageHeader title="Sales Report">
        <a href="/reports/sales-monthly" className="btn-secondary no-print">📅 Monthly per Region</a>
        <a href={`/api/export/sales?${qs.toString()}`} className="btn-secondary no-print">⬇ Excel</a>
        <span className="no-print"><PrintButton /></span>
      </PageHeader>

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <div>
          <label className="label">Province</label>
          <select name="province" defaultValue={province} className="input w-48">
            <option value="">All provinces</option>
            {provinces.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <p className="mb-4 text-sm text-gray-600">
        <span className="font-semibold">{scope.label}</span> · {fmtDate(range.from)} – {fmtDate(range.to)}
        {province ? ` · Province: ${province}` : ""} · Total invoiced sales:{" "}
        <span className="text-lg font-bold text-emerald-800">{peso(r.total)}</span>
        {r.freight > 0 && (
          <span className="text-gray-500"> (Goods {peso(r.goods)} + Freight {peso(r.freight)})</span>
        )}{" "}
        · {r.invoices.length} invoice(s)
      </p>

      {/* combined view: each company's own total, then the grand total */}
      {scope.combined && (
        <div className="card mb-4 overflow-x-auto p-0">
          <table className="w-full">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr><th className="table-th">Company</th><th className="table-th text-right">Invoices</th><th className="table-th text-right">Sales Total</th></tr>
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
                <td className="table-td text-right">{r.invoices.length}</td>
                <td className="table-td text-right text-emerald-800">{peso(r.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

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
          <h2 className="mb-2 font-semibold">By Product (Top 20 product lines)</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr><th className="table-th">Product Line</th><th className="table-th text-right">Qty (PCS)</th><th className="table-th text-right">Equivalent (CTN)</th><th className="table-th text-right">Amount</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {r.byProduct.slice(0, 20).map((p) => (
                  <tr key={p.name}>
                    <td className="table-td text-sm">{p.name}</td>
                    <td className="table-td text-right">{p.qty.toLocaleString()}</td>
                    <td className="table-td text-right text-sm">
                      {p.noConversion ? <NoConversion /> : `${p.ctn.toLocaleString("en-PH", { maximumFractionDigits: 2 })} CTN`}
                    </td>
                    <td className="table-td text-right">{peso(p.amount)}</td>
                  </tr>
                ))}
                {!r.byProduct.length && <tr><td colSpan={3} className="p-6 text-center text-sm text-gray-500">No sales in range.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* transaction-level listing: every invoice, tagged with its company */}
      <h2 className="mb-2 mt-6 font-semibold">Invoices</h2>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[640px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Date</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Invoice No.</th>
              <th className="table-th">Customer</th>
              <th className="table-th text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {r.invoices.map((sr) => (
              <tr key={sr.id}>
                <td className="table-td text-sm">{fmtDate(sr.invoiceDate)}</td>
                {scope.combined && <td className="table-td"><CompanyTag name={sr.company.companyName} /></td>}
                <td className="table-td font-mono text-sm">{sr.srNumber}</td>
                <td className="table-td text-sm">{sr.customer.businessName}</td>
                <td className="table-td text-right">{peso(sr.amount)}</td>
              </tr>
            ))}
            {!r.invoices.length && (
              <tr><td colSpan={scope.combined ? 5 : 4} className="p-6 text-center text-sm text-gray-500">No invoices in range.</td></tr>
            )}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50 font-bold">
            <tr>
              <td className="table-td" colSpan={scope.combined ? 4 : 3}>{scope.combined ? "COMBINED GRAND TOTAL" : "TOTAL"}</td>
              <td className="table-td text-right text-emerald-800">{peso(r.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
