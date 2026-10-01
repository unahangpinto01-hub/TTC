import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { parseRange } from "@/lib/reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { DV_FILTERS, dvStatusLabel } from "@/lib/dv";
import { voucherAccountTotals } from "@/lib/dv-account-totals";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default async function DvRegisterPage({ searchParams }: { searchParams: { from?: string; to?: string; company?: string; status?: string; q?: string; amount?: string } }) {
  const user = await requireReport("dv-register");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const q = searchParams.q?.trim();
  const amount = Number(searchParams.amount);
  const dvs = await prisma.disbursementVoucher.findMany({
    where: {
      companyId: { in: scope.ids }, date: { gte: range.from, lte: range.to },
      ...(searchParams.status && DV_FILTERS[searchParams.status] ? { status: { in: DV_FILTERS[searchParams.status].statuses } } : {}),
      ...(searchParams.amount && !Number.isNaN(amount) ? { amount: { gte: amount - 0.005, lte: amount + 0.005 } } : {}),
      ...(q ? { OR: [{ dvNo: { contains: q, mode: "insensitive" } }, { padRef: { contains: q, mode: "insensitive" } }, { payee: { contains: q, mode: "insensitive" } }, { particulars: { contains: q, mode: "insensitive" } }, { bills: { some: { bill: { billNo: { contains: q, mode: "insensitive" } } } } }, { bills: { some: { bill: { supplierInvoiceNo: { contains: q, mode: "insensitive" } } } } }, { payments: { some: { checkNo: { contains: q, mode: "insensitive" } } } }] } : {}),
    },
    include: { company: { select: { companyName: true, glInventory: { select: { code: true, description: true } }, glInputVat: { select: { code: true, description: true } }, glEwtPayable: { select: { code: true, description: true } }, glPayables: { select: { code: true, description: true } } } }, bills: { include: { bill: { select: { id: true, billNo: true, kind: true, total: true, inventoryTotal: true, subtotal: true, freight: true, otherCosts: true, inputVat: true, ewtAmount: true, expenseLines: { select: { amount: true, glAccount: { select: { code: true, description: true } } } } } } } }, items: { select: { amount: true, glAccountId: true, description: true, glAccount: { select: { code: true, description: true } } } }, _count: { select: { payments: { where: { status: "Posted" } }, bills: true } }, preparedBy: { select: { name: true } }, checkedBy: { select: { name: true } }, approvedBy: { select: { name: true } }, postedBy: { select: { name: true } } },
    orderBy: [{ date: "asc" }, { dvNo: "asc" }],
  });
  const fromStr = ymd(range.from), toStr = ymd(range.to);
  const live = dvs.filter((d) => d.status !== "Void");
  const total = live.reduce((s, d) => s + d.amount, 0);
  const paid = live.reduce((s, d) => s + d.paidAmount, 0);
  const cheques = live.reduce((s, d) => s + d._count.payments, 0);
  // the register's column totals: every account the period's vouchers charged or credited
  const totals = voucherAccountTotals(dvs, dvs[0]?.company ?? {});
  const statusQ = `${searchParams.status ? `&status=${searchParams.status}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}${searchParams.amount ? `&amount=${searchParams.amount}` : ""}`;

  return (
    <div className="print-page">
      <PageHeader title="Disbursement Voucher Register">
        {user.canExport && <a href={`/api/export/dv-register?from=${fromStr}&to=${toStr}&company=${scope.value}${statusQ}`} className="btn-secondary no-print">⬇ Excel</a>}
        {user.canPrint && <span className="no-print"><PrintButton /></span>}
      </PageHeader>
      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <div><label className="label">Status</label><select name="status" defaultValue={searchParams.status ?? ""} className="input"><option value="">All</option>{Object.entries(DV_FILTERS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}</select></div>
        <div><label className="label">Search</label><input name="q" defaultValue={q ?? ""} placeholder="DV, payee, bill, invoice or cheque no." className="input w-64" /></div>
        <div><label className="label">Amount</label><input name="amount" type="number" step="0.01" defaultValue={searchParams.amount ?? ""} className="input w-32" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>
      <p className="mb-4 text-sm text-gray-600"><span className="font-semibold">{scope.label}</span> · {fmtDate(range.from)} – {fmtDate(range.to)} · {dvs.length} voucher(s) · {cheques} cheque(s) · Authorised {peso(total)} · Paid {peso(paid)} · Remaining <span className="font-bold text-amber-700">{peso(total - paid)}</span></p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1000px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr><th className="table-th">Date</th><th className="table-th">DV #</th>{scope.combined && <th className="table-th">Company</th>}<th className="table-th">Payee</th><th className="table-th text-right">Bills</th><th className="table-th">Bill Nos.</th><th className="table-th">Particulars</th><th className="table-th text-right">Amount</th><th className="table-th text-right">Cheques</th><th className="table-th text-right">Paid</th><th className="table-th text-right">Remaining</th><th className="table-th">Status</th><th className="table-th">Prepared / Checked / Approved / Posted</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {dvs.map((d) => (
              <tr key={d.id} className={d.status === "Void" ? "opacity-50" : "hover:bg-gray-50"}>
                <td className="table-td text-sm">{fmtDate(d.date)}</td>
                <td className="table-td"><Link href={`/dv/${d.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{d.dvNo}</Link>{d.padRef && <span className="block text-[10px] text-gray-400">pad {d.padRef}</span>}</td>
                {scope.combined && <td className="table-td"><CompanyTag name={d.company.companyName} /></td>}
                <td className="table-td text-sm">{d.payee}</td>
                <td className="table-td text-right text-sm text-gray-600">{d._count.bills || "—"}</td>
                <td className="table-td text-[11px]">{d.bills.map((b, i) => <span key={b.bill.id}>{i > 0 && ", "}<Link href={`/bills/${b.bill.id}`} className="font-mono text-emerald-700 hover:underline">{b.bill.billNo}</Link></span>)}{d.directAmount > 0 && <span className="text-gray-500">{d.bills.length ? " + " : ""}own items {peso(d.directAmount)}</span>}</td>
                <td className="table-td max-w-xs truncate text-xs text-gray-600">{d.particulars}</td>
                <td className="table-td text-right font-semibold">{peso(d.amount)}</td>
                <td className="table-td text-right text-sm text-gray-600">{d._count.payments || "—"}</td>
                <td className={`table-td text-right ${d.paidAmount ? "text-emerald-700" : "text-gray-400"}`}>{d.paidAmount ? peso(d.paidAmount) : "—"}</td>
                <td className={`table-td text-right ${d.status === "Void" ? "text-gray-400" : d.amount - d.paidAmount > 0.005 ? "font-semibold text-amber-700" : "text-gray-400"}`}>{d.status === "Void" ? "—" : peso(Math.max(0, d.amount - d.paidAmount))}</td>
                <td className="table-td"><StatusBadge status={dvStatusLabel(d.status)} /></td>
                <td className="table-td text-[11px] text-gray-600">{[d.preparedBy?.name, d.checkedBy?.name, d.approvedBy?.name, d.postedBy?.name].map((n) => n ?? "—").join(" / ")}</td>
              </tr>
            ))}
            {!dvs.length && <tr><td colSpan={scope.combined ? 13 : 12} className="p-8 text-center text-sm text-gray-500">No vouchers in this range.</td></tr>}
          </tbody>
        </table>
      </div>

      {totals.rows.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 font-semibold">Totals by account <span className="text-sm font-normal text-gray-500">— what the period&rsquo;s vouchers charged and credited, like the register&rsquo;s column totals</span></h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-gray-200 bg-gray-50"><tr><th className="table-th">Account</th><th className="table-th text-right">Vouchers</th><th className="table-th text-right">Debit</th><th className="table-th text-right">Credit</th><th className="table-th text-right">Net</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {totals.rows.map((r) => (
                  <tr key={`${r.code}|${r.name}`} className="hover:bg-gray-50">
                    <td className="table-td text-sm"><span className="font-mono text-xs text-gray-500">{r.code}</span> {r.name}</td>
                    <td className="table-td text-right text-sm text-gray-600">{r.vouchers}</td>
                    <td className={`table-td text-right ${r.debit ? "font-semibold" : "text-gray-300"}`}>{r.debit ? peso(r.debit) : "—"}</td>
                    <td className={`table-td text-right ${r.credit ? "font-semibold text-red-700" : "text-gray-300"}`}>{r.credit ? `(${peso(r.credit)})` : "—"}</td>
                    <td className="table-td text-right">{peso(r.net)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                <tr><td className="table-td">TOTAL</td><td /><td className="table-td text-right">{peso(totals.debits)}</td><td className="table-td text-right text-red-700">({peso(totals.credits)})</td><td className="table-td text-right">{peso(totals.debits - totals.credits)}</td></tr>
                <tr className="font-normal text-gray-600"><td className="table-td" colSpan={4}>Cheques issued on these vouchers (Accounts Payable settled)</td><td className="table-td text-right font-semibold">{peso(totals.cheques)}</td></tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">A voucher with its own items is counted as booked; a voucher paying bills is counted by what those bills booked, in proportion to the amount it covers. Debits less credits equal the cheques when every voucher in the range is fully paid.</p>
        </div>
      )}
    </div>
  );
}
