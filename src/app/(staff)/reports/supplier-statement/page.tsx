import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { parseRange } from "@/lib/reports";
import { getSupplierStatement } from "@/lib/ap-reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { SearchSelect } from "@/components/search-select";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default async function SupplierStatementPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; company?: string; supplier?: string };
}) {
  const user = await requireReport("supplier-statement");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const supplierId = searchParams.supplier ?? "";
  const supplier = supplierId ? await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true } }) : null;
  const st = supplier ? await getSupplierStatement(supplier.id, scope.ids, range) : null;
  const fromStr = ymd(range.from);
  const toStr = ymd(range.to);
  const qs = new URLSearchParams({ from: fromStr, to: toStr, company: scope.value, supplier: supplierId });

  return (
    <div className="print-page">
      <PageHeader title="Supplier Statement">
        {st && user.canExport && (
          <a href={`/api/export/supplier-statement?${qs.toString()}`} className="btn-secondary no-print">⬇ Excel</a>
        )}
        {user.canPrint && <span className="no-print"><PrintButton /></span>}
      </PageHeader>

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div className="w-72">
          <label className="label">Supplier</label>
          <SearchSelect entity="suppliers" name="supplier" placeholder="Type supplier name…" defaultValue={supplier ? { id: supplier.id, label: supplier.name } : null} submitOnSelect />
        </div>
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      {!st ? (
        <div className="card text-center text-sm text-gray-500">Pick a supplier to see their statement of account.</div>
      ) : (
        <>
          <p className="mb-4 text-sm text-gray-600">
            <span className="text-base font-bold text-gray-900">{st.supplier.name}</span>
            {st.supplier.address && <span className="text-gray-500"> · {st.supplier.address}</span>} ·{" "}
            <span className="font-semibold">{scope.label}</span> · {fmtDate(range.from)} – {fmtDate(range.to)} · Balance{" "}
            <span className={`font-bold ${st.closing > 0 ? "text-red-600" : "text-emerald-700"}`}>{peso(st.closing)}</span>
          </p>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[900px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="table-th">Date</th>
                  <th className="table-th">Bill #</th>
                  {scope.combined && <th className="table-th">Company</th>}
                  <th className="table-th">Reference</th>
                  <th className="table-th">Description</th>
                  <th className="table-th">Due</th>
                  <th className="table-th text-right">Charges</th>
                  <th className="table-th text-right">Payments</th>
                  <th className="table-th text-right">Balance</th>
                  <th className="table-th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr className="bg-gray-50/60">
                  <td className="table-td text-sm">{fmtDate(range.from)}</td>
                  <td className="table-td" colSpan={scope.combined ? 7 : 6}><span className="text-sm font-semibold">Balance brought forward</span></td>
                  <td className="table-td text-right font-semibold">{peso(st.opening)}</td>
                  <td />
                </tr>
                {st.lines.map((l) => (
                  <tr key={l.billId || l.billNo} className="hover:bg-gray-50">
                    <td className="table-td text-sm">{fmtDate(l.date)}</td>
                    <td className="table-td">{l.billId ? <Link href={`/bills/${l.billId}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{l.billNo}</Link> : <span className="font-mono text-xs font-semibold text-gray-700">{l.billNo}</span>}</td>
                    {scope.combined && <td className="table-td"><CompanyTag name={l.company} /></td>}
                    <td className="table-td text-xs text-gray-600">{l.ref || "—"}</td>
                    <td className="table-td text-sm">{l.description}</td>
                    <td className="table-td text-sm">{fmtDate(l.dueDate)}</td>
                    <td className="table-td text-right">{peso(l.charges)}</td>
                    <td className="table-td text-right text-emerald-700">{l.payments ? peso(l.payments) : "—"}</td>
                    <td className="table-td text-right font-semibold">{peso(l.balance)}</td>
                    <td className="table-td">{l.billId ? <StatusBadge status={l.status} /> : <span className="text-xs text-emerald-700">payment</span>}</td>
                  </tr>
                ))}
                {!st.lines.length && <tr><td colSpan={scope.combined ? 10 : 9} className="p-6 text-center text-sm text-gray-500">No bills from this supplier in the period.</td></tr>}
              </tbody>
              <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                <tr>
                  <td className="table-td" colSpan={scope.combined ? 6 : 5}>PERIOD TOTAL · CLOSING BALANCE</td>
                  <td className="table-td text-right">{peso(st.charges)}</td>
                  <td className="table-td text-right text-emerald-700">{peso(st.payments)}</td>
                  <td className="table-td text-right text-red-600">{peso(st.closing)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Charges are posted supplier bills; payments are supplier payments recorded under Pay Bills, by date.
          </p>
        </>
      )}
    </div>
  );
}
