import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { parseRange } from "@/lib/reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default async function DvRegisterPage({ searchParams }: { searchParams: { from?: string; to?: string; company?: string } }) {
  const user = await requireReport("dv-register");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const dvs = await prisma.disbursementVoucher.findMany({
    where: { companyId: { in: scope.ids }, date: { gte: range.from, lte: range.to } },
    include: { company: { select: { companyName: true } }, bills: { include: { bill: { select: { id: true, billNo: true } } } }, preparedBy: { select: { name: true } }, checkedBy: { select: { name: true } }, approvedBy: { select: { name: true } }, postedBy: { select: { name: true } } },
    orderBy: [{ date: "asc" }, { dvNo: "asc" }],
  });
  const fromStr = ymd(range.from), toStr = ymd(range.to);
  const live = dvs.filter((d) => d.status !== "Void");
  const total = live.reduce((s, d) => s + d.amount, 0);
  const paid = live.reduce((s, d) => s + d.paidAmount, 0);

  return (
    <div className="print-page">
      <PageHeader title="Disbursement Voucher Register">
        {user.canExport && <a href={`/api/export/dv-register?from=${fromStr}&to=${toStr}&company=${scope.value}`} className="btn-secondary no-print">⬇ Excel</a>}
        {user.canPrint && <span className="no-print"><PrintButton /></span>}
      </PageHeader>
      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>
      <p className="mb-4 text-sm text-gray-600"><span className="font-semibold">{scope.label}</span> · {fmtDate(range.from)} – {fmtDate(range.to)} · {dvs.length} voucher(s) · Authorised {peso(total)} · Paid {peso(paid)} · Still to pay <span className="font-bold text-amber-700">{peso(total - paid)}</span></p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1000px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr><th className="table-th">Date</th><th className="table-th">DV #</th>{scope.combined && <th className="table-th">Company</th>}<th className="table-th">Payee</th><th className="table-th">Bills</th><th className="table-th">Particulars</th><th className="table-th text-right">Amount</th><th className="table-th text-right">Paid</th><th className="table-th">Status</th><th className="table-th">Prepared / Checked / Approved / Posted</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {dvs.map((d) => (
              <tr key={d.id} className={d.status === "Void" ? "opacity-50" : "hover:bg-gray-50"}>
                <td className="table-td text-sm">{fmtDate(d.date)}</td>
                <td className="table-td"><Link href={`/dv/${d.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{d.dvNo}</Link>{d.padRef && <span className="block text-[10px] text-gray-400">pad {d.padRef}</span>}</td>
                {scope.combined && <td className="table-td"><CompanyTag name={d.company.companyName} /></td>}
                <td className="table-td text-sm">{d.payee}</td>
                <td className="table-td text-[11px]">{d.bills.map((b, i) => <span key={b.bill.id}>{i > 0 && ", "}<Link href={`/bills/${b.bill.id}`} className="font-mono text-emerald-700 hover:underline">{b.bill.billNo}</Link></span>)}</td>
                <td className="table-td max-w-xs truncate text-xs text-gray-600">{d.particulars}</td>
                <td className="table-td text-right font-semibold">{peso(d.amount)}</td>
                <td className={`table-td text-right ${d.paidAmount ? "text-emerald-700" : "text-gray-400"}`}>{d.paidAmount ? peso(d.paidAmount) : "—"}</td>
                <td className="table-td"><StatusBadge status={d.status} /></td>
                <td className="table-td text-[11px] text-gray-600">{[d.preparedBy?.name, d.checkedBy?.name, d.approvedBy?.name, d.postedBy?.name].map((n) => n ?? "—").join(" / ")}</td>
              </tr>
            ))}
            {!dvs.length && <tr><td colSpan={scope.combined ? 10 : 9} className="p-8 text-center text-sm text-gray-500">No vouchers in this range.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
