import Link from "next/link";
import { requireReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { getManagementAttention } from "@/lib/attention";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";

/** Management Attention: what in the purchase-to-payment chain is waiting on someone right now. */
export default async function AttentionPage({ searchParams }: { searchParams: { company?: string; open?: string } }) {
  const user = await requireReport("attention");
  const scope = await resolveReportScope(user, searchParams.company);
  const sections = await getManagementAttention(scope.ids);
  const now = new Date();
  const openAll = searchParams.open === "all";

  return (
    <div className="print-page">
      <PageHeader title="Management Attention">
        {user.canPrint && <span className="no-print"><PrintButton /></span>}
      </PageHeader>
      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <button className="btn-secondary" type="submit">Apply</button>
        <Link href={`/reports/attention?company=${scope.value}${openAll ? "" : "&open=all"}`} className="btn-secondary">{openAll ? "Collapse all" : "Expand all"}</Link>
      </form>
      <p className="mb-4 text-sm text-gray-600"><span className="font-semibold">{scope.label}</span> · as of {fmtDate(now)} · purchase-to-payment items waiting on someone</p>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {sections.map((s) => (
          <a key={s.key} href={`#${s.key}`} className={`card py-3 ${s.count ? "" : "opacity-60"}`}>
            <p className="text-xs text-gray-500">{s.title}</p>
            <p className={`text-xl font-bold ${s.count ? "text-amber-700" : "text-gray-400"}`}>{s.count}</p>
            <p className="text-xs text-gray-500">{s.count ? peso(s.amount) : "nothing waiting"}</p>
          </a>
        ))}
      </div>

      {sections.map((s) => (
        <details key={s.key} id={s.key} open={openAll || (s.count > 0 && s.count <= 25)} className="card mb-3 p-0">
          <summary className="cursor-pointer px-4 py-3">
            <span className="font-semibold">{s.title}</span> <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${s.count ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-500"}`}>{s.count}</span>
            <span className="ml-2 text-xs text-gray-500">{s.hint}</span>
            {s.count > 0 && <span className="ml-2 text-xs font-semibold text-gray-700">{peso(s.amount)}</span>}
            <Link href={s.href} className="no-print ml-3 text-xs text-emerald-700 hover:underline">open report →</Link>
          </summary>
          {s.count > 0 && (
            <div className="overflow-x-auto border-t border-gray-100">
              <table className="w-full min-w-[800px]">
                <thead className="bg-gray-50"><tr><th className="table-th">Reference</th>{scope.combined && <th className="table-th">Company</th>}<th className="table-th">Who</th><th className="table-th">Date</th><th className="table-th">Detail</th><th className="table-th text-right">Amount</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {s.items.map((i) => (
                    <tr key={i.id} className="hover:bg-gray-50">
                      <td className="table-td"><Link href={i.href} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{i.ref}</Link></td>
                      {scope.combined && <td className="table-td"><CompanyTag name={i.company} /></td>}
                      <td className="table-td text-sm">{i.who}</td>
                      <td className="table-td whitespace-nowrap text-sm">{fmtDate(i.when)}</td>
                      <td className="table-td text-xs text-gray-600">{i.note}</td>
                      <td className={`table-td text-right font-semibold ${i.amount < 0 ? "text-emerald-700" : ""}`}>{peso(i.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      ))}
      <p className="mt-2 text-xs text-gray-500">Outstanding cheques (issued but not yet cleared by the bank) will appear here once bank reconciliation is in place.</p>
    </div>
  );
}
