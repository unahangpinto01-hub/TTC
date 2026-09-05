import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { LiveSearch } from "@/components/live-search";
import { creditDisplayStatus } from "@/lib/refunds-credits";

const STATUSES = ["Draft", "Pending Approval", "Approved", "Posted", "Rejected", "Void"];

export default async function RefundsListPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; type?: string };
}) {
  const user = await requirePerm("refundsCredits");
  const company = await getActiveCompany(user);
  const q = searchParams.q?.trim() || "";
  const status = STATUSES.includes(searchParams.status || "") ? searchParams.status! : "";
  const type = ["Credit", "Refund"].includes(searchParams.type || "") ? searchParams.type! : "";

  const docs = await prisma.refundCredit.findMany({
    where: {
      companyId: company.id,
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
      ...(q
        ? {
            OR: [
              { rcNumber: { contains: q, mode: "insensitive" } },
              { customer: { businessName: { contains: q, mode: "insensitive" } } },
              { reason: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      customer: { select: { businessName: true } },
      applications: { select: { amount: true } },
      refundsDrawn: { where: { status: "Posted" }, select: { amount: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const canEdit = user.perm === "READ_WRITE";

  return (
    <div>
      <PageHeader title={`Refunds & Credits — ${company.companyName}`}>
        {canEdit && <Link href="/refunds/new" className="btn-primary">+ New Credit / Refund</Link>}
      </PageHeader>

      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <LiveSearch placeholder="CM/RF #, customer, reason…" />
        <select name="type" defaultValue={type} className="input max-w-[150px]">
          <option value="">All types</option>
          <option>Credit</option>
          <option>Refund</option>
        </select>
        <select name="status" defaultValue={status} className="input max-w-[180px]">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[860px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">No.</th>
              <th className="table-th">Type</th>
              <th className="table-th">Date</th>
              <th className="table-th">Customer</th>
              <th className="table-th">Reason</th>
              <th className="table-th text-right">Amount</th>
              <th className="table-th text-right">Applied</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {docs.map((d) => {
              const applied = d.applications.reduce((s, a) => s + a.amount, 0);
              return (
                <tr key={d.id} className={`hover:bg-gray-50 ${["Void", "Rejected"].includes(d.status) ? "opacity-50" : ""}`}>
                  <td className="table-td">
                    <Link href={`/refunds/${d.id}`} className="font-mono text-sm font-semibold text-emerald-700 hover:underline">{d.rcNumber}</Link>
                  </td>
                  <td className="table-td text-sm">{d.type}</td>
                  <td className="table-td whitespace-nowrap text-sm">{fmtDate(d.date)}</td>
                  <td className="table-td text-sm">{d.customer.businessName}</td>
                  <td className="table-td text-xs text-gray-500">{d.reason}</td>
                  <td className="table-td text-right font-semibold">{peso(d.amount)}</td>
                  <td className="table-td text-right text-gray-600">{d.type === "Credit" && applied > 0.005 ? peso(applied) : "—"}</td>
                  <td className="table-td"><StatusBadge status={creditDisplayStatus(d)} /></td>
                </tr>
              );
            })}
            {!docs.length && (
              <tr><td colSpan={8} className="p-8 text-center text-sm text-gray-500">No refunds or credits yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Draft → Pending Approval → Approved → Posted (plus Rejected and Void). Only Posted documents change AR,
        customer credit, cash or inventory. A posted credit shows Partially/Fully Applied as it is used up.
      </p>
    </div>
  );
}
