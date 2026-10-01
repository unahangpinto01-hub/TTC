import Link from "next/link";
import { peso, fmtDate } from "@/lib/format";
import { StatusBadge } from "@/components/ui";
import { availableForVoucher, LIVE_DV_STATUSES, dvStatusLabel } from "@/lib/dv";
import { OPEN_BILL_STATUSES } from "@/lib/bills";

type Props = {
  bill: { id: string; total: number; paidAmount: number; status: string; dvBills: { amount: number; dv: { id: string; dvNo: string; status: string; date: Date } }[] };
};

/**
 * VOUCHER INFORMATION on a bill: every voucher that holds part of it, what each authorises,
 * and the totals — vouchered, paid, and what is still available for another voucher.
 */
export async function VoucherInfo({ bill }: Props) {
  const open = OPEN_BILL_STATUSES.includes(bill.status);
  if (!open && !bill.dvBills.length) return null;
  const live = bill.dvBills.filter((d) => LIVE_DV_STATUSES.includes(d.dv.status));
  const vouchered = Math.round(live.reduce((s, d) => s + d.amount, 0) * 100) / 100;
  const a = open ? await availableForVoucher(bill.id) : { outstanding: 0, onOtherVouchers: 0, available: 0 };
  return (
    <div className="card mb-4 text-sm">
      <p className="mb-1 font-semibold">Voucher information</p>
      {bill.dvBills.length > 0 ? (
        <table className="w-full max-w-2xl text-xs">
          <thead className="text-gray-500"><tr><th className="py-1 text-left font-medium">Voucher</th><th className="py-1 text-left font-medium">Voucher date</th><th className="py-1 text-right font-medium">Amount allocated</th><th className="py-1 text-left font-medium">Voucher status</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {bill.dvBills.map((d) => (
              <tr key={d.dv.id} className={LIVE_DV_STATUSES.includes(d.dv.status) || d.dv.status === "Paid" ? "" : "opacity-50"}>
                <td className="py-1"><Link href={`/dv/${d.dv.id}`} className="font-mono font-semibold text-emerald-700 hover:underline">{d.dv.dvNo}</Link></td>
                <td className="py-1">{fmtDate(d.dv.date)}</td>
                <td className="py-1 text-right font-semibold">{peso(d.amount)}</td>
                <td className="py-1"><StatusBadge status={dvStatusLabel(d.dv.status)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="text-xs text-gray-500">No voucher has picked this bill up yet.</p>}
      <p className="mt-2 text-xs text-gray-600">
        Net payable {peso(bill.total)} · Paid {peso(bill.paidAmount)} · Total vouchered (live) {peso(vouchered)} ·{" "}
        <span className={a.available > 0 ? "font-semibold text-amber-700" : "font-semibold"}>Available for Voucher {peso(a.available)}</span>
        {open && a.available > 0 && <> · <Link href="/dv/new" className="text-emerald-700 hover:underline">raise a voucher</Link></>}
      </p>
    </div>
  );
}
