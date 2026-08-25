import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { fmtDateTime, peso, termLabel } from "@/lib/format";
import { getPage, pageCount } from "@/lib/paginate";
import { PageHeader, Pagination, StatusBadge } from "@/components/ui";

export default async function OrderInboxPage({ searchParams }: { searchParams: { status?: string; page?: string } }) {
  const user = await requirePerm("orders");
  const company = await getActiveCompany(user);
  const { page, skip, take } = getPage(searchParams);
  const status = searchParams.status || "";
  const where: any = { companyId: company.id };
  if (status) where.status = status;

  const [orders, total, pendingCount] = await Promise.all([
    prisma.incomingOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { customer: true, lines: true, salesOrders: true },
    }),
    prisma.incomingOrder.count({ where }),
    prisma.incomingOrder.count({ where: { companyId: company.id, status: "Pending" } }),
  ]);

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  return (
    <div>
      <PageHeader title={`Order Inbox${pendingCount ? ` · ${pendingCount} pending` : ""}`}>
        <Link href="/orders/new" className="btn-primary">+ Encode Order (Messenger/Text)</Link>
      </PageHeader>
      <form method="GET" className="mb-4 flex gap-2">
        <select name="status" defaultValue={status} className="input max-w-[160px]">
          <option value="">All statuses</option>
          <option>Pending</option>
          <option>Converted</option>
          <option>Cancelled</option>
        </select>
        <button className="btn-secondary" type="submit">Filter</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[760px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Received</th>
              <th className="table-th">Customer</th>
              <th className="table-th">Source</th>
              <th className="table-th">Term</th>
              <th className="table-th text-right">Items</th>
              <th className="table-th text-right">Amount</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {orders.map((o) => {
              const amount = o.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
              const stale = o.status === "Pending" && o.createdAt < dayAgo;
              return (
                <tr key={o.id} className={`hover:bg-gray-50 ${stale ? "bg-red-50/60" : ""}`}>
                  <td className="table-td text-sm">
                    <Link href={`/orders/${o.id}`} className="font-medium text-emerald-700 hover:underline">
                      {fmtDateTime(o.createdAt)}
                    </Link>
                    {stale && <p className="text-xs font-semibold text-red-600">⚠ pending &gt; 24h</p>}
                  </td>
                  <td className="table-td">{o.customer.businessName}</td>
                  <td className="table-td text-xs uppercase text-gray-500">{o.source}</td>
                  <td className="table-td text-sm">{termLabel(o.term)}</td>
                  <td className="table-td text-right">{o.lines.length}</td>
                  <td className="table-td text-right">{peso(amount)}</td>
                  <td className="table-td"><StatusBadge status={o.status} /></td>
                </tr>
              );
            })}
            {!orders.length && <tr><td colSpan={7} className="p-8 text-center text-sm text-gray-500">No incoming orders.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={pageCount(total)} baseUrl="/orders" params={status ? { status } : undefined} />
    </div>
  );
}
