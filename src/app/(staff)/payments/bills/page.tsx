import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { LiveSearch } from "@/components/live-search";

export default async function PayBillsPage({ searchParams }: { searchParams: { q?: string; status?: string } }) {
  const user = await requirePerm("payBills");
  const company = await getActiveCompany(user);
  const where: any = { companyId: company.id };
  if (["Posted", "Void"].includes(searchParams.status ?? "")) where.status = searchParams.status;
  const q = searchParams.q?.trim();
  if (q) where.OR = [{ paymentNo: { contains: q, mode: "insensitive" } }, { checkNo: { contains: q, mode: "insensitive" } }, { refNo: { contains: q, mode: "insensitive" } }, { supplier: { name: { contains: q, mode: "insensitive" } } }, { dv: { dvNo: { contains: q, mode: "insensitive" } } }, { lines: { some: { bill: { billNo: { contains: q, mode: "insensitive" } } } } }];
  const [payments, openDvs] = await Promise.all([
    prisma.supplierPayment.findMany({ where, orderBy: [{ date: "desc" }, { paymentNo: "desc" }], take: 150, include: { supplier: { select: { name: true } }, cashAccount: { select: { name: true } }, dv: { select: { id: true, dvNo: true } }, lines: { include: { bill: { select: { billNo: true } } } } } }),
    prisma.disbursementVoucher.findMany({ where: { companyId: company.id, status: { in: ["Posted", "Partially Paid"] } }, select: { id: true, dvNo: true, payee: true, amount: true, paidAmount: true }, orderBy: { date: "asc" } }),
  ]);

  return (
    <div>
      <PageHeader title="Pay Bills — Supplier Payments">
        {user.perm === "READ_WRITE" && <Link href="/payments/bills/new" className="btn-primary">+ Record Payment</Link>}
      </PageHeader>
      {openDvs.length > 0 && (
        <div className="card mb-4">
          <p className="mb-1 text-sm font-semibold">Vouchers waiting to be paid</p>
          <div className="flex flex-wrap gap-2 text-xs">
            {openDvs.map((d) => <Link key={d.id} href={`/payments/bills/new?dv=${d.id}`} className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800 hover:bg-amber-100"><span className="font-mono font-semibold">{d.dvNo}</span> · {d.payee} · {peso(d.amount - d.paidAmount)}</Link>)}
          </div>
        </div>
      )}
      <form method="GET" className="mb-4 flex flex-wrap gap-2">
        <LiveSearch placeholder="Payment no., cheque, reference, supplier, DV or bill…" />
        <select name="status" defaultValue={searchParams.status ?? ""} className="input max-w-[160px]"><option value="">All</option><option>Posted</option><option>Void</option></select>
        <button className="btn-secondary" type="submit">Filter</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-gray-200 bg-gray-50"><tr><th className="table-th">Payment #</th><th className="table-th">Date</th><th className="table-th">Supplier</th><th className="table-th">Voucher</th><th className="table-th">Bills</th><th className="table-th">From / Method</th><th className="table-th text-right">Amount</th><th className="table-th">Status</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {payments.map((p) => (
              <tr key={p.id} className={p.status === "Void" ? "opacity-50" : "hover:bg-gray-50"}>
                <td className="table-td"><Link href={`/payments/bills/${p.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{p.paymentNo}</Link></td>
                <td className="table-td text-sm">{fmtDate(p.date)}</td>
                <td className="table-td text-sm">{p.supplier.name}</td>
                <td className="table-td font-mono text-xs">{p.dv ? <Link href={`/dv/${p.dv.id}`} className="text-emerald-700 hover:underline">{p.dv.dvNo}</Link> : <span className="text-gray-400">—</span>}</td>
                <td className="table-td font-mono text-[11px] text-gray-600">{p.lines.map((l) => l.bill.billNo).join(", ")}</td>
                <td className="table-td text-xs text-gray-600">{p.cashAccount.name} · {p.method}{p.checkNo ? ` #${p.checkNo}` : ""}</td>
                <td className="table-td text-right font-semibold">{peso(p.amount)}</td>
                <td className="table-td"><StatusBadge status={p.status} /></td>
              </tr>
            ))}
            {!payments.length && <tr><td colSpan={8} className="p-8 text-center text-sm text-gray-500">No supplier payments yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">A payment settles posted bills — Dr Accounts Payable, Cr the cash or bank account — normally under a posted Disbursement Voucher. Bills and vouchers move to Partially Paid or Paid as payments come in.</p>
    </div>
  );
}
