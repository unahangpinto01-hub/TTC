import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate } from "@/lib/format";
import { DV_STATUSES } from "@/lib/dv";
import { PageHeader, StatusBadge } from "@/components/ui";
import { LiveSearch } from "@/components/live-search";

export default async function DvListPage({ searchParams }: { searchParams: { status?: string; q?: string } }) {
  const user = await requirePerm("dv");
  const company = await getActiveCompany(user);
  const canEdit = user.perm === "READ_WRITE";
  const where: any = { companyId: company.id };
  if ((DV_STATUSES as readonly string[]).includes(searchParams.status ?? "")) where.status = searchParams.status;
  const q = searchParams.q?.trim();
  if (q) where.OR = [{ dvNo: { contains: q, mode: "insensitive" } }, { padRef: { contains: q, mode: "insensitive" } }, { payee: { contains: q, mode: "insensitive" } }, { particulars: { contains: q, mode: "insensitive" } }, { bills: { some: { bill: { billNo: { contains: q, mode: "insensitive" } } } } }];
  const dvs = await prisma.disbursementVoucher.findMany({
    where, orderBy: [{ date: "desc" }, { dvNo: "desc" }], take: 150,
    include: { bills: { select: { bill: { select: { billNo: true } } } } },
  });
  const open = dvs.filter((d) => ["Posted", "Partially Paid"].includes(d.status)).reduce((s, d) => s + d.amount - d.paidAmount, 0);

  return (
    <div>
      <PageHeader title="Disbursement Vouchers">
        {canEdit && <Link href="/dv/new" className="btn-primary">+ New Voucher</Link>}
      </PageHeader>
      <form method="GET" className="mb-4 flex flex-wrap gap-2">
        <LiveSearch placeholder="DV no., pad DVN, payee, particulars or bill no…" />
        <select name="status" defaultValue={searchParams.status ?? ""} className="input max-w-[190px]"><option value="">All statuses</option>{DV_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <button className="btn-secondary" type="submit">Filter</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr><th className="table-th">DV #</th><th className="table-th">Date</th><th className="table-th">Payee</th><th className="table-th">Bills</th><th className="table-th">Particulars</th><th className="table-th text-right">Amount</th><th className="table-th text-right">Paid</th><th className="table-th">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {dvs.map((d) => (
              <tr key={d.id} className={d.status === "Void" ? "opacity-50" : "hover:bg-gray-50"}>
                <td className="table-td"><Link href={`/dv/${d.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{d.dvNo}</Link>{d.padRef && <span className="block text-[10px] text-gray-400">pad {d.padRef}</span>}</td>
                <td className="table-td text-sm">{fmtDate(d.date)}</td>
                <td className="table-td text-sm">{d.payee}</td>
                <td className="table-td font-mono text-[11px] text-gray-600">{d.bills.map((b) => b.bill.billNo).join(", ") || "—"}</td>
                <td className="table-td max-w-xs truncate text-xs text-gray-600">{d.particulars || "—"}</td>
                <td className="table-td text-right font-semibold">{peso(d.amount)}</td>
                <td className={`table-td text-right ${d.paidAmount ? "text-emerald-700" : "text-gray-400"}`}>{d.paidAmount ? peso(d.paidAmount) : "—"}</td>
                <td className="table-td"><StatusBadge status={d.status} /></td>
              </tr>
            ))}
            {!dvs.length && <tr><td colSpan={8} className="p-8 text-center text-sm text-gray-500">No disbursement vouchers yet.</td></tr>}
          </tbody>
          {dvs.length > 0 && <tfoot className="border-t border-gray-200 bg-gray-50 font-bold"><tr><td className="table-td" colSpan={5}>AUTHORISED, NOT YET PAID</td><td className="table-td text-right text-amber-700">{peso(open)}</td><td colSpan={2} /></tr></tfoot>}
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">A voucher authorises paying posted supplier bills; it creates no accounting entry of its own. Draft → Prepared → Checked → Approved → Posted, then a Payment settles it.</p>
    </div>
  );
}
