import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { fmtDate, peso, termLabel } from "@/lib/format";
import { getPage, pageCount } from "@/lib/paginate";
import { PageHeader, Pagination, StatusBadge } from "@/components/ui";

const STATUSES = ["Draft", "Confirmed", "Scheduled", "Delivered", "Invoiced", "Closed", "Cancelled"];

export default async function SalesOrdersPage({ searchParams }: { searchParams: { q?: string; status?: string; page?: string } }) {
  await requireStaff();
  const { page, skip, take } = getPage(searchParams);
  const q = searchParams.q?.trim() || "";
  const status = searchParams.status || "";
  const where: any = {};
  if (status) where.status = status;
  if (q) where.OR = [{ soNumber: { contains: q } }, { customer: { businessName: { contains: q } } }];

  const [orders, total] = await Promise.all([
    prisma.salesOrder.findMany({
      where,
      orderBy: { orderDate: "desc" },
      skip,
      take,
      include: { customer: true, lines: true },
    }),
    prisma.salesOrder.count({ where }),
  ]);
  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (status) params.status = status;

  return (
    <div>
      <PageHeader title="Sales Orders" />
      <form method="GET" className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search SO # or customer…" className="input max-w-xs" />
        <select name="status" defaultValue={status} className="input max-w-[150px]">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn-secondary" type="submit">Filter</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">SO #</th>
              <th className="table-th">Date</th>
              <th className="table-th">Customer</th>
              <th className="table-th">Term</th>
              <th className="table-th text-right">Amount</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {orders.map((so) => (
              <tr key={so.id} className="hover:bg-gray-50">
                <td className="table-td">
                  <Link href={`/sales-orders/${so.id}`} className="font-mono text-sm font-medium text-emerald-700 hover:underline">{so.soNumber}</Link>
                </td>
                <td className="table-td">{fmtDate(so.orderDate)}</td>
                <td className="table-td">{so.customer.businessName}</td>
                <td className="table-td text-sm">{termLabel(so.term)}</td>
                <td className="table-td text-right">{peso(so.lines.reduce((s, l) => s + l.lineTotal, 0))}</td>
                <td className="table-td"><StatusBadge status={so.status} /></td>
              </tr>
            ))}
            {!orders.length && <tr><td colSpan={6} className="p-8 text-center text-sm text-gray-500">No sales orders match.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={pageCount(total)} baseUrl="/sales-orders" params={params} />
    </div>
  );
}
