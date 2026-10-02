import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { parseRange } from "@/lib/reports";
import { getOtherDiscountReport } from "@/lib/discount-reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { SearchSelect } from "@/components/search-select";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Every other (non-PPD) discount granted on a posted receive payment in the period, with its reason and approver. */
export default async function OtherDiscountReportPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; company?: string; customer?: string; reason?: string; approver?: string; q?: string };
}) {
  const user = await requireReport("other-discounts");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const f = { customerId: searchParams.customer || undefined, reasonId: searchParams.reason || undefined, approver: searchParams.approver?.trim() || undefined, q: searchParams.q?.trim() || undefined };
  const [r, customer, reasons] = await Promise.all([
    getOtherDiscountReport(range, scope.ids, f),
    f.customerId ? prisma.customer.findUnique({ where: { id: f.customerId }, select: { id: true, businessName: true, province: true } }) : null,
    prisma.otherDiscountReason.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  const qs = new URLSearchParams({ from: ymd(range.from), to: ymd(range.to), company: scope.value });
  for (const [k, v] of Object.entries({ customer: f.customerId, reason: f.reasonId, approver: f.approver, q: f.q })) if (v) qs.set(k, v);

  return (
    <div className="print-page">
      <PageHeader title="Other Discount Report">
        {user.canExport && <a href={`/api/export/other-discounts?${qs.toString()}`} className="btn-secondary no-print">⬇ Excel</a>}
        {user.canPrint && <span className="no-print"><PrintButton /></span>}
      </PageHeader>

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={ymd(range.from)} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={ymd(range.to)} className="input" /></div>
        <div className="w-60"><label className="label">Customer</label><SearchSelect entity="customers" name="customer" placeholder="All customers" defaultValue={customer ? { id: customer.id, label: customer.businessName, sub: customer.province } : null} /></div>
        <div><label className="label">Reason</label><select name="reason" defaultValue={f.reasonId ?? ""} className="input"><option value="">All reasons</option>{reasons.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
        <div><label className="label">Approved by</label><input name="approver" defaultValue={f.approver ?? ""} placeholder="name" className="input w-36" /></div>
        <div><label className="label">Invoice / Receipt #</label><input name="q" defaultValue={f.q ?? ""} placeholder="SR- or PR-" className="input w-36" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <p className="mb-3 text-sm text-gray-600">
        <span className="font-semibold">{scope.label}</span> · {fmtDate(range.from)} – {fmtDate(range.to)} · {r.rows.length} discount{r.rows.length === 1 ? "" : "s"} · Total Other Discount{" "}
        <span className="font-bold text-red-700">{peso(r.totals.otherDiscount)}</span>
        {r.byReason.length > 1 && <> · {r.byReason.map((x) => `${x.reason} ${peso(x.amount)}`).join(" · ")}</>}
      </p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Date</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Customer</th>
              <th className="table-th">Invoice No.</th>
              <th className="table-th">Receive Payment No.</th>
              <th className="table-th text-right">Payment Amount</th>
              <th className="table-th text-right">Other Discount</th>
              <th className="table-th">Reason</th>
              <th className="table-th">Approved By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {r.rows.map((x) => (
              <tr key={x.id} className="hover:bg-gray-50">
                <td className="table-td whitespace-nowrap">{fmtDate(x.date)}</td>
                {scope.combined && <td className="table-td"><CompanyTag name={x.company} /></td>}
                <td className="table-td"><Link href={`/customers/${x.customerId}`} className="hover:underline">{x.customer}</Link></td>
                <td className="table-td"><Link href={`/invoices/${x.srId}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{x.srNumber}</Link></td>
                <td className="table-td"><Link href={`/payments/${x.rpId}`} className="font-mono text-xs text-emerald-700 hover:underline">{x.prNumber}</Link></td>
                <td className="table-td text-right">{peso(x.payment)}</td>
                <td className="table-td text-right font-semibold text-red-700">{peso(x.otherDiscount)}</td>
                <td className="table-td text-xs">{x.reason}{x.remarks && <span className="block text-gray-500">{x.remarks}</span>}</td>
                <td className="table-td text-xs">{x.approvedBy}</td>
              </tr>
            ))}
            {!r.rows.length && <tr><td colSpan={scope.combined ? 9 : 8} className="p-6 text-center text-sm text-gray-500">No other discounts in this period.</td></tr>}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
            <tr>
              <td className="table-td" colSpan={scope.combined ? 5 : 4}>TOTAL</td>
              <td className="table-td text-right">{peso(r.totals.payments)}</td>
              <td className="table-td text-right text-red-700">{peso(r.totals.otherDiscount)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">Approved by is the user who approved and posted the receive payment, from its audit trail.</p>
    </div>
  );
}
