import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { parseRange } from "@/lib/reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { checkRegisterWhere, type CheckRegisterFilters } from "@/lib/check-register";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * The Check Register: every cheque (and every other payment) as its own line — one voucher
 * settled by five cheques is five lines here and one line on the Voucher Register.
 */
export default async function CheckRegisterPage({ searchParams }: { searchParams: CheckRegisterFilters & { from?: string; to?: string; company?: string } }) {
  const user = await requireReport("check-register");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const where = checkRegisterWhere(scope.ids, range, searchParams);
  const [pays, banks] = await Promise.all([
    prisma.supplierPayment.findMany({
      where,
      include: { company: { select: { companyName: true } }, supplier: { select: { name: true } }, cashAccount: { select: { name: true } }, dv: { select: { id: true, dvNo: true, amount: true, paidAmount: true } }, lines: { include: { bill: { select: { id: true, billNo: true } } } }, createdBy: { select: { name: true } }, voidedBy: { select: { name: true } } },
      orderBy: [{ checkDate: "asc" }, { date: "asc" }, { paymentNo: "asc" }],
    }),
    prisma.cashAccount.findMany({ where: { companyId: { in: scope.ids } }, select: { id: true, name: true, type: true }, orderBy: { name: "asc" } }),
  ]);
  const fromStr = ymd(range.from), toStr = ymd(range.to);
  const live = pays.filter((p) => p.status === "Posted");
  const total = live.reduce((s, p) => s + p.amount, 0);
  const voided = pays.filter((p) => p.status === "Void").reduce((s, p) => s + p.amount, 0);
  const byBank = new Map<string, { n: number; amount: number }>();
  for (const p of live) { const b = byBank.get(p.cashAccount.name) ?? { n: 0, amount: 0 }; b.n++; b.amount += p.amount; byBank.set(p.cashAccount.name, b); }
  const q = new URLSearchParams({ from: fromStr, to: toStr, company: scope.value });
  for (const k of ["checkNo", "payee", "dv", "bank", "method", "status", "min", "max"] as const) if (searchParams[k]) q.set(k, String(searchParams[k]));

  return (
    <div className="print-page">
      <PageHeader title="Check Register">
        {user.canExport && <a href={`/api/export/check-register?${q.toString()}`} className="btn-secondary no-print">⬇ Excel</a>}
        {user.canPrint && <span className="no-print"><PrintButton /></span>}
      </PageHeader>
      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <div><label className="label">Cheque No.</label><input name="checkNo" defaultValue={searchParams.checkNo ?? ""} className="input w-32" /></div>
        <div><label className="label">Payee</label><input name="payee" defaultValue={searchParams.payee ?? ""} className="input w-44" /></div>
        <div><label className="label">Voucher</label><input name="dv" defaultValue={searchParams.dv ?? ""} className="input w-40" placeholder="DV no." /></div>
        <div><label className="label">Bank / Cash</label><select name="bank" defaultValue={searchParams.bank ?? ""} className="input"><option value="">All</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        <div><label className="label">Method</label><select name="method" defaultValue={searchParams.method ?? ""} className="input"><option value="">All</option><option>Check</option><option>Cash</option><option>Bank Transfer</option><option>E-Wallet</option></select></div>
        <div><label className="label">Status</label><select name="status" defaultValue={searchParams.status ?? ""} className="input"><option value="">All</option><option value="Posted">Issued</option><option value="Void">Voided</option></select></div>
        <div><label className="label">Amount from</label><input name="min" type="number" step="0.01" defaultValue={searchParams.min ?? ""} className="input w-28" /></div>
        <div><label className="label">to</label><input name="max" type="number" step="0.01" defaultValue={searchParams.max ?? ""} className="input w-28" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>
      <p className="mb-2 text-sm text-gray-600"><span className="font-semibold">{scope.label}</span> · {fmtDate(range.from)} – {fmtDate(range.to)} · {live.length} issued <span className="font-bold text-emerald-800">{peso(total)}</span>{voided > 0 && <> · {pays.length - live.length} voided {peso(voided)}</>}</p>
      {byBank.size > 0 && <p className="mb-4 text-xs text-gray-500">{[...byBank.entries()].map(([b, v]) => `${b}: ${v.n} · ${peso(v.amount)}`).join(" · ")}</p>}
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1100px]">
          <thead className="border-b border-gray-200 bg-gray-50"><tr><th className="table-th">Cheque No.</th><th className="table-th">Cheque date</th><th className="table-th">Payment date</th>{scope.combined && <th className="table-th">Company</th>}<th className="table-th">Payee</th><th className="table-th">Voucher</th><th className="table-th">Bank / Cash</th><th className="table-th">Method</th><th className="table-th">Bills</th><th className="table-th text-right">Amount</th><th className="table-th">Status</th><th className="table-th">Payment</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {pays.map((p) => (
              <tr key={p.id} className={p.status === "Void" ? "opacity-50" : "hover:bg-gray-50"}>
                <td className="table-td font-mono text-sm font-semibold">{p.checkNo ?? (p.refNo ? <span className="font-normal text-gray-500">ref {p.refNo}</span> : "—")}</td>
                <td className="table-td text-sm">{p.checkDate ? fmtDate(p.checkDate) : "—"}</td>
                <td className="table-td text-sm">{fmtDate(p.date)}</td>
                {scope.combined && <td className="table-td"><CompanyTag name={p.company.companyName} /></td>}
                <td className="table-td text-sm">{p.payee || p.supplier?.name}</td>
                <td className="table-td font-mono text-xs">{p.dv ? <Link href={`/dv/${p.dv.id}`} className="text-emerald-700 hover:underline">{p.dv.dvNo}</Link> : "—"}</td>
                <td className="table-td text-xs text-gray-600">{p.cashAccount.name}</td>
                <td className="table-td text-xs text-gray-600">{p.method}</td>
                <td className="table-td text-[11px]">{p.lines.map((l, i) => <span key={l.bill.id}>{i > 0 && ", "}<Link href={`/bills/${l.bill.id}`} className="font-mono text-emerald-700 hover:underline">{l.bill.billNo}</Link></span>)}{!p.lines.length && <span className="text-gray-400">voucher items</span>}</td>
                <td className={`table-td text-right font-semibold ${p.status === "Void" ? "line-through" : ""}`}>{peso(p.amount)}</td>
                <td className="table-td"><StatusBadge status={p.status === "Posted" ? "Issued" : p.status} />{p.status === "Void" && <span className="block text-[10px] text-gray-500">{p.voidedBy?.name} · {p.voidReason}</span>}</td>
                <td className="table-td"><Link href={`/payments/bills/${p.id}`} className="font-mono text-xs text-emerald-700 hover:underline">{p.paymentNo}</Link></td>
              </tr>
            ))}
            {!pays.length && <tr><td colSpan={scope.combined ? 12 : 11} className="p-8 text-center text-sm text-gray-500">No cheques or payments match.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">Every cheque is its own line, under the voucher that authorised it. A voided cheque stays on the register, struck through, with who voided it and why; it no longer counts as paid. Filter by cheque number, date, payee, voucher, bank, method, amount, company or status.</p>
    </div>
  );
}
