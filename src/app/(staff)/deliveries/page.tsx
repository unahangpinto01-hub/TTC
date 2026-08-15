import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { fmtDate, peso } from "@/lib/format";
import { getPage, pageCount } from "@/lib/paginate";
import { PageHeader, Pagination, StatusBadge } from "@/components/ui";

export default async function DRListPage({ searchParams }: { searchParams: { q?: string; status?: string; page?: string } }) {
  await requireStaff();
  const { page, skip, take } = getPage(searchParams);
  const q = searchParams.q?.trim() || "";
  const status = searchParams.status || "";
  const where: any = {};
  if (status) where.status = status;
  if (q) where.OR = [{ drNumber: { contains: q } }, { salesOrder: { customer: { businessName: { contains: q } } } }];

  const [drs, total] = await Promise.all([
    prisma.deliveryReceipt.findMany({
      where,
      orderBy: { date: "desc" },
      skip,
      take,
      include: { salesOrder: { include: { customer: true } }, lines: true },
    }),
    prisma.deliveryReceipt.count({ where }),
  ]);
  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (status) params.status = status;

  return (
    <div>
      <PageHeader title="Delivery Receipts" />
      <form method="GET" className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search DR # or customer…" className="input max-w-xs" />
        <select name="status" defaultValue={status} className="input max-w-[150px]">
          <option value="">All statuses</option>
          <option>Draft</option>
          <option>Delivered</option>
          <option>Invoiced</option>
          <option>Void</option>
        </select>
        <button className="btn-secondary" type="submit">Filter</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[680px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">DR #</th>
              <th className="table-th">Date</th>
              <th className="table-th">SO #</th>
              <th className="table-th">Customer</th>
              <th className="table-th text-right">Amount</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {drs.map((dr) => (
              <tr key={dr.id} className="hover:bg-gray-50">
                <td className="table-td">
                  <Link href={`/deliveries/${dr.id}`} className="font-mono text-sm font-medium text-emerald-700 hover:underline">{dr.drNumber}</Link>
                </td>
                <td className="table-td">{fmtDate(dr.date)}</td>
                <td className="table-td font-mono text-xs">{dr.salesOrder.soNumber}</td>
                <td className="table-td">{dr.salesOrder.customer.businessName}</td>
                <td className="table-td text-right">{peso(dr.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0))}</td>
                <td className="table-td"><StatusBadge status={dr.status} /></td>
              </tr>
            ))}
            {!drs.length && <tr><td colSpan={6} className="p-8 text-center text-sm text-gray-500">No delivery receipts.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={pageCount(total)} baseUrl="/deliveries" params={params} />
    </div>
  );
}
