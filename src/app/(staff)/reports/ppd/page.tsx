import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { parseRange } from "@/lib/reports";
import { getPpdReport } from "@/lib/discount-reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { SearchSelect } from "@/components/search-select";

const REGIONS = ["Luzon", "Visayas", "Mindanao"];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Every prompt payment discount granted on a posted receive payment in the period. */
export default async function PpdReportPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; company?: string; customer?: string; salesperson?: string; region?: string; q?: string };
}) {
  const user = await requireReport("ppd");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const f = {
    customerId: searchParams.customer || undefined, salespersonId: searchParams.salesperson || undefined,
    region: REGIONS.includes(searchParams.region || "") ? searchParams.region : undefined, q: searchParams.q?.trim() || undefined,
  };
  const [r, customer, salesperson] = await Promise.all([
    getPpdReport(range, scope.ids, f),
    f.customerId ? prisma.customer.findUnique({ where: { id: f.customerId }, select: { id: true, businessName: true, province: true } }) : null,
    f.salespersonId ? prisma.employee.findUnique({ where: { id: f.salespersonId }, select: { id: true, name: true } }) : null,
  ]);
  const qs = new URLSearchParams({ from: ymd(range.from), to: ymd(range.to), company: scope.value });
  for (const [k, v] of Object.entries({ customer: f.customerId, salesperson: f.salespersonId, region: f.region, q: f.q })) if (v) qs.set(k, v);

  return (
    <div className="print-page">
      <PageHeader title="Prompt Payment Discount Report">
        {user.canExport && <a href={`/api/export/ppd?${qs.toString()}`} className="btn-secondary no-print">⬇ Excel</a>}
        {user.canPrint && <span className="no-print"><PrintButton /></span>}
      </PageHeader>

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={ymd(range.from)} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={ymd(range.to)} className="input" /></div>
        <div className="w-60"><label className="label">Customer</label><SearchSelect entity="customers" name="customer" placeholder="All customers" defaultValue={customer ? { id: customer.id, label: customer.businessName, sub: customer.province } : null} /></div>
        <div className="w-52"><label className="label">Salesperson</label><SearchSelect entity="salespeople" name="salesperson" placeholder="All" defaultValue={salesperson ? { id: salesperson.id, label: salesperson.name } : null} /></div>
        <div><label className="label">Area</label><select name="region" defaultValue={f.region ?? ""} className="input"><option value="">All</option>{REGIONS.map((x) => <option key={x}>{x}</option>)}</select></div>
        <div><label className="label">Invoice / Receipt #</label><input name="q" defaultValue={f.q ?? ""} placeholder="SR- or PR-" className="input w-36" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <p className="mb-3 text-sm text-gray-600">
        <span className="font-semibold">{scope.label}</span> · {fmtDate(range.from)} – {fmtDate(range.to)} · {r.rows.length} discount{r.rows.length === 1 ? "" : "s"} · Total PPD{" "}
        <span className="font-bold text-red-700">{peso(r.totals.ppd)}</span>{r.totals.overrides ? <> · {r.totals.overrides} granted by override</> : null}
      </p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Payment Date</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Customer</th>
              <th className="table-th">Invoice No.</th>
              <th className="table-th text-right">Invoice Amount</th>
              <th className="table-th text-right">Payment Amount</th>
              <th className="table-th text-right">PPD Rate</th>
              <th className="table-th text-right">PPD Amount</th>
              <th className="table-th">Receive Payment No.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {r.rows.map((x) => (
              <tr key={x.id} className="hover:bg-gray-50">
                <td className="table-td whitespace-nowrap">{fmtDate(x.date)}</td>
                {scope.combined && <td className="table-td"><CompanyTag name={x.company} /></td>}
                <td className="table-td"><Link href={`/customers/${x.customerId}`} className="hover:underline">{x.customer}</Link>{x.salesperson && <span className="block text-[11px] text-gray-500">{x.salesperson} · {x.region}</span>}</td>
                <td className="table-td"><Link href={`/invoices/${x.srId}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{x.srNumber}</Link></td>
                <td className="table-td text-right">{peso(x.invoiceAmount)}</td>
                <td className="table-td text-right">{peso(x.payment)}</td>
                <td className="table-td text-right">{x.ppdRate ? `${(x.ppdRate * 100).toFixed(2)}%` : "manual"}</td>
                <td className="table-td text-right font-semibold text-red-700">{peso(x.ppdAmount)}{x.overridden && <span className="block text-[10px] font-normal text-amber-700" title={x.overrideReason ?? ""}>override: {x.overrideReason}</span>}</td>
                <td className="table-td"><Link href={`/payments/${x.rpId}`} className="font-mono text-xs text-emerald-700 hover:underline">{x.prNumber}</Link></td>
              </tr>
            ))}
            {!r.rows.length && <tr><td colSpan={scope.combined ? 9 : 8} className="p-6 text-center text-sm text-gray-500">No prompt payment discounts in this period.</td></tr>}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
            <tr>
              <td className="table-td" colSpan={scope.combined ? 4 : 3}>TOTAL</td>
              <td className="table-td text-right">{peso(r.totals.invoiceAmount)}</td>
              <td className="table-td text-right">{peso(r.totals.payments)}</td>
              <td />
              <td className="table-td text-right text-red-700">{peso(r.totals.ppd)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">Totals: invoice amount, collections (the money actually received on these invoices) and PPD. A discount granted outside the company PPD window shows the override reason recorded with it.</p>
    </div>
  );
}
