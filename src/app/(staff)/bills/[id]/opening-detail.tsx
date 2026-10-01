import Link from "next/link";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { getAuditTrail } from "@/lib/salespeople";
import { periodLabel } from "@/lib/vouchers";
import { outstandingOf } from "@/lib/bills";
import { VoucherInfo } from "./voucher-info";

export async function loadOpeningBill(id: string) {
  return prisma.supplierBill.findUnique({
    where: { id },
    include: {
      supplier: true,
      createdBy: { select: { name: true } },
      voidedBy: { select: { name: true } },
      dvBills: { include: { dv: { select: { id: true, dvNo: true, status: true, date: true, amount: true } } } },
      paymentLines: { include: { payment: { select: { id: true, paymentNo: true, date: true, method: true, checkNo: true, status: true } } }, orderBy: { id: "asc" } },
    },
  });
}
type Bill = NonNullable<Awaited<ReturnType<typeof loadOpeningBill>>>;

/**
 * A supplier's opening balance: the amount owed on the day before the BMS started, entered on
 * Finance → Opening Balances. It has no lines, no receipt and no VAT — only a payable, settled
 * through vouchers and cheques like any bill. It is withdrawn from the Opening Balances screen.
 */
export async function OpeningBillDetail({ bill, user, companyName }: { bill: Bill; user: SessionUser & { perm: string }; companyName: string }) {
  const audit = await getAuditTrail("SupplierBill", bill.id, 40);
  const outstanding = outstandingOf(bill);
  const posted = bill.paymentLines.filter((l) => l.payment.status === "Posted");
  return (
    <div>
      <Link href="/finance/opening-balances?side=supplier" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">← Back to Opening Balances</Link>
      <PageHeader title={`Opening balance ${bill.billNo}`}>
        <StatusBadge status={bill.status} />
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Balance brought forward</span>
      </PageHeader>
      {bill.status === "Void" && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Withdrawn by {bill.voidedBy?.name ?? "—"} · {fmtDateTime(bill.voidedAt)}: {bill.voidReason}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div className="card py-3"><p className="text-xs text-gray-500">Owed to</p><Link href={`/suppliers/${bill.supplierId}`} className="font-semibold text-emerald-700 hover:underline">{bill.supplier.name}</Link></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Balance as of</p><p className="font-semibold">{fmtDate(bill.billDate)}</p><p className="text-xs text-gray-500">due {fmtDate(bill.dueDate)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Amount</p><p className="font-semibold">{peso(bill.total)}</p><p className="text-xs text-gray-500">{bill.memo || "no reference"}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Outstanding</p><p className={`font-semibold ${outstanding ? "text-red-600" : "text-emerald-700"}`}>{peso(outstanding)}</p><p className="text-xs text-gray-500">paid {peso(bill.paidAmount)}</p></div>
      </div>

      <VoucherInfo bill={bill} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 font-semibold">Payments</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50"><tr><th className="table-th">Date</th><th className="table-th">Payment</th><th className="table-th">Method</th><th className="table-th text-right">Amount</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {posted.map((l) => (
                  <tr key={l.id}>
                    <td className="table-td text-sm">{fmtDate(l.payment.date)}</td>
                    <td className="table-td"><Link href={`/payments/bills/${l.payment.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{l.payment.paymentNo}</Link></td>
                    <td className="table-td text-sm">{l.payment.method}{l.payment.checkNo ? ` · cheque ${l.payment.checkNo}` : ""}</td>
                    <td className="table-td text-right">{peso(l.amount)}</td>
                  </tr>
                ))}
                {!posted.length && <tr><td colSpan={4} className="p-6 text-center text-sm text-gray-500">Nothing paid against it yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="card mt-4 text-sm">
            <p className="mb-2 font-semibold">Document</p>
            <dl className="space-y-1">
              {([
                ["Company", companyName],
                ["Entered by", `${bill.createdBy?.name ?? "—"} · ${fmtDateTime(bill.createdAt)}`],
                ["Accounting period", periodLabel(bill.accountingYear, bill.accountingMonth)],
                ["Reference / memo", bill.memo ?? "—"],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-dotted border-gray-200 py-1"><dt className="text-gray-500">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
              ))}
            </dl>
            {user.perm === "READ_WRITE" && bill.status === "Posted" && <p className="mt-2 text-xs text-gray-500">To withdraw this balance, use the Opening Balances screen. It can only be withdrawn while nothing has been paid or vouchered against it.</p>}
          </div>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">Audit Trail</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50"><tr><th className="table-th">When</th><th className="table-th">Action</th><th className="table-th">By</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {audit.map((a) => (
                  <tr key={a.id}><td className="table-td whitespace-nowrap text-xs text-gray-600">{fmtDateTime(a.createdAt)}</td><td className="table-td text-sm"><span className="font-medium">{a.action.replaceAll("_", " ")}</span><p className="text-xs text-gray-500">{a.detail}</p></td><td className="table-td text-sm">{a.actorName}</td></tr>
                ))}
                {!audit.length && <tr><td colSpan={3} className="p-6 text-center text-sm text-gray-500">No activity recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
