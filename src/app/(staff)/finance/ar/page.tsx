import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { getArAging } from "@/lib/reports";
import { peso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

export default async function ArAgingPage() {
  await requirePerm("ar");
  const company = await getActiveCompany();
  const { rows, totals } = await getArAging(company.id);

  return (
    <div className="print-page">
      <PageHeader title="AR Aging Report">
        <a href="/api/export/ar-aging" className="btn-secondary no-print">⬇ Excel</a>
        <span className="no-print"><PrintButton /></span>
      </PageHeader>
      <p className="mb-4 text-sm text-gray-500">
        Outstanding receivables by days past due. Total outstanding: <span className="font-bold text-red-600">{peso(totals.total)}</span>
      </p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[820px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Customer</th>
              <th className="table-th">Region</th>
              <th className="table-th text-right">Current</th>
              <th className="table-th text-right">1–30</th>
              <th className="table-th text-right">31–60</th>
              <th className="table-th text-right">61–90</th>
              <th className="table-th text-right">90+</th>
              <th className="table-th text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.customerId} className="hover:bg-gray-50">
                <td className="table-td">
                  <Link href={`/customers/${r.customerId}`} className="font-medium text-emerald-700 hover:underline">{r.customer}</Link>
                </td>
                <td className="table-td text-sm text-gray-600">{r.region}</td>
                <td className="table-td text-right">{r.current ? peso(r.current) : "—"}</td>
                <td className="table-td text-right">{r.d1_30 ? peso(r.d1_30) : "—"}</td>
                <td className="table-td text-right">{r.d31_60 ? peso(r.d31_60) : "—"}</td>
                <td className="table-td text-right text-amber-700">{r.d61_90 ? peso(r.d61_90) : "—"}</td>
                <td className="table-td text-right font-semibold text-red-600">{r.d90plus ? peso(r.d90plus) : "—"}</td>
                <td className="table-td text-right font-bold">{peso(r.total)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="p-8 text-center text-sm text-gray-500">No outstanding receivables. 🎉</td></tr>}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
            <tr>
              <td className="table-td" colSpan={2}>TOTAL</td>
              <td className="table-td text-right">{peso(totals.current)}</td>
              <td className="table-td text-right">{peso(totals.d1_30)}</td>
              <td className="table-td text-right">{peso(totals.d31_60)}</td>
              <td className="table-td text-right">{peso(totals.d61_90)}</td>
              <td className="table-td text-right text-red-600">{peso(totals.d90plus)}</td>
              <td className="table-td text-right">{peso(totals.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
