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

export default async function SupplierPaymentsReport({ searchParams }: { searchParams: { from?: string; to?: string; company?: string } }) {
  const user = await requireReport("supplier-payments");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const pays = await prisma.supplierPayment.findMany({
    where: { companyId: { in: scope.ids }, date: { gte: range.from, lte: range.to } },
    include: { company: { select: { companyName: true } }, supplier: { select: { name: true } }, cashAccount: { select: { name: true } }, dv: { select: { id: true, dvNo: true } }, lines: { include: { bill: { select: { id: true, billNo: true } } } } },
    orderBy: [{ date: "asc" }, { paymentNo: "asc" }],
  });
  const fromStr = ymd(range.from), toStr = ymd(range.to);
  const total = pays.filter((p) => p.status === "Posted").reduce((s, p) => s + p.amount, 0);
  const byAccount = new Map<string, number>();
  for (const p of pays) if (p.status === "Posted") byAccount.set(p.cashAccount.name, (byAccount.get(p.cashAccount.name) ?? 0) + p.amount);

  return (
    <div className="print-page">
      <PageHeader title="Supplier Payments">
        {user.canExport && <a href={`/api/export/supplier-payments?from=${fromStr}&to=${toStr}&company=${scope.value}`} className="btn-secondary no-print">⬇ Excel</a>}
        {user.canPrint && <span className="no-print"><PrintButton /></span>}
      </PageHeader>
      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>
      <p className="mb-2 text-sm text-gray-600"><span className="font-semibold">{scope.label}</span> · {fmtDate(range.from)} – {fmtDate(range.to)} · {pays.length} payment(s) · Paid <span className="font-bold text-emerald-800">{peso(total)}</span></p>
      {byAccount.size > 0 && <p className="mb-4 text-xs text-gray-500">{[...byAccount.entries()].map(([a, v]) => `${a}: ${peso(v)}`).join(" · ")}</p>}
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1000px]">
          <thead className="border-b border-gray-200 bg-gray-50"><tr><th className="table-th">Date</th><th className="table-th">Payment #</th>{scope.combined && <th className="table-th">Company</th>}<th className="table-th">Supplier</th><th className="table-th">Voucher</th><th className="table-th">Account / Method</th><th className="table-th">Cheque / Ref</th><th className="table-th">Bills</th><th className="table-th text-right">Amount</th><th className="table-th">Status</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {pays.map((p) => (
              <tr key={p.id} className={p.status === "Void" ? "opacity-50" : "hover:bg-gray-50"}>
                <td className="table-td text-sm">{fmtDate(p.date)}</td>
                <td className="table-td"><Link href={`/payments/bills/${p.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{p.paymentNo}</Link></td>
                {scope.combined && <td className="table-td"><CompanyTag name={p.company.companyName} /></td>}
                <td className="table-td text-sm">{p.supplier.name}</td>
                <td className="table-td font-mono text-xs">{p.dv ? <Link href={`/dv/${p.dv.id}`} className="text-emerald-700 hover:underline">{p.dv.dvNo}</Link> : "—"}</td>
                <td className="table-td text-xs text-gray-600">{p.cashAccount.name} · {p.method}</td>
                <td className="table-td text-xs text-gray-600">{p.checkNo ? `#${p.checkNo}${p.checkDate ? ` ${fmtDate(p.checkDate)}` : ""}` : p.refNo ?? "—"}</td>
                <td className="table-td text-[11px]">{p.lines.map((l, i) => <span key={l.bill.id}>{i > 0 && ", "}<Link href={`/bills/${l.bill.id}`} className="font-mono text-emerald-700 hover:underline">{l.bill.billNo}</Link></span>)}</td>
                <td className="table-td text-right font-semibold">{peso(p.amount)}</td>
                <td className="table-td"><StatusBadge status={p.status} /></td>
              </tr>
            ))}
            {!pays.length && <tr><td colSpan={scope.combined ? 10 : 9} className="p-8 text-center text-sm text-gray-500">No supplier payments in this range.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
