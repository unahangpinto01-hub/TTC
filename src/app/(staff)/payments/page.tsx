import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { LiveSearch } from "@/components/live-search";
import { unappliedOf } from "@/lib/receive-payments";

const STATUSES = ["Draft", "Pending Approval", "Posted", "Cancelled", "Void"];

export default async function PaymentsListPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string };
}) {
  const user = await requirePerm("receivePayments");
  const company = await getActiveCompany(user);
  const q = searchParams.q?.trim() || "";
  const status = STATUSES.includes(searchParams.status || "") ? searchParams.status! : "";

  const payments = await prisma.receivePayment.findMany({
    where: {
      companyId: company.id,
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { prNumber: { contains: q, mode: "insensitive" } },
              { refNo: { contains: q, mode: "insensitive" } },
              { checkNo: { contains: q, mode: "insensitive" } },
              { customer: { businessName: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: { customer: { select: { businessName: true } }, applications: { select: { amount: true } }, receivedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const canEdit = user.perm === "READ_WRITE";

  return (
    <div>
      <PageHeader title={`Receive Payments — ${company.companyName}`}>
        {canEdit && <Link href="/payments/new" className="btn-primary">+ Receive Payment</Link>}
      </PageHeader>

      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <LiveSearch placeholder="PR #, reference, check #, customer…" />
        <select name="status" defaultValue={status} className="input max-w-[180px]">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">PR No.</th>
              <th className="table-th">Date</th>
              <th className="table-th">Customer</th>
              <th className="table-th">Method</th>
              <th className="table-th text-right">Amount</th>
              <th className="table-th text-right">Applied</th>
              <th className="table-th text-right">Unapplied</th>
              <th className="table-th">Received By</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {payments.map((p) => {
              const applied = p.applications.reduce((s, a) => s + a.amount, 0);
              const unapplied = unappliedOf(p);
              return (
                <tr key={p.id} className={`hover:bg-gray-50 ${p.status === "Void" || p.status === "Cancelled" ? "opacity-50" : ""}`}>
                  <td className="table-td">
                    <Link href={`/payments/${p.id}`} className="font-mono text-sm font-semibold text-emerald-700 hover:underline">{p.prNumber}</Link>
                  </td>
                  <td className="table-td whitespace-nowrap text-sm">{fmtDate(p.date)}</td>
                  <td className="table-td text-sm">{p.customer.businessName}</td>
                  <td className="table-td text-sm">{p.method}</td>
                  <td className="table-td text-right font-semibold">{peso(p.amount)}</td>
                  <td className="table-td text-right">{peso(applied)}</td>
                  <td className={`table-td text-right ${p.status === "Posted" && unapplied > 0.005 ? "font-semibold text-amber-700" : "text-gray-500"}`}>
                    {unapplied > 0.005 ? peso(unapplied) : "—"}
                  </td>
                  <td className="table-td text-xs text-gray-600">{p.receivedBy?.name ?? "—"}</td>
                  <td className="table-td"><StatusBadge status={p.status} /></td>
                </tr>
              );
            })}
            {!payments.length && (
              <tr><td colSpan={9} className="p-8 text-center text-sm text-gray-500">No payments yet — receive the first one.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Draft → Pending Approval → Posted. Only Posted payments update the invoices, AR aging and the cash/bank
        accounts. Unapplied money is the customer&rsquo;s credit, applied later from the payment&rsquo;s page.
      </p>
    </div>
  );
}
