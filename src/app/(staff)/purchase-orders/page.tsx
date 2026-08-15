import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { fmtDate, peso } from "@/lib/format";
import { getPage, pageCount } from "@/lib/paginate";
import { PageHeader, Pagination, StatusBadge } from "@/components/ui";

export default async function POListPage({ searchParams }: { searchParams: { page?: string } }) {
  const user = await requireStaff();
  const { page, skip, take } = getPage(searchParams);
  const [pos, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      orderBy: { date: "desc" },
      skip,
      take,
      include: { supplier: true, lines: true },
    }),
    prisma.purchaseOrder.count(),
  ]);
  const canEdit = ["SUPER_ADMIN", "ADMIN"].includes(user.role);
  return (
    <div>
      <PageHeader title="Purchase Orders">
        {canEdit && <Link href="/purchase-orders/new" className="btn-primary">+ New PO</Link>}
      </PageHeader>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[640px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">PO #</th>
              <th className="table-th">Date</th>
              <th className="table-th">Supplier</th>
              <th className="table-th text-right">Lines</th>
              <th className="table-th text-right">Total Cost</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {pos.map((po) => {
              const totalCost = po.lines.reduce((s, l) => s + l.qty * l.unitCost, 0);
              return (
                <tr key={po.id} className="hover:bg-gray-50">
                  <td className="table-td">
                    <Link href={`/purchase-orders/${po.id}`} className="font-mono text-sm font-medium text-emerald-700 hover:underline">
                      {po.poNumber}
                    </Link>
                  </td>
                  <td className="table-td">{fmtDate(po.date)}</td>
                  <td className="table-td">{po.supplier.name}</td>
                  <td className="table-td text-right">{po.lines.length}</td>
                  <td className="table-td text-right">{peso(totalCost)}</td>
                  <td className="table-td"><StatusBadge status={po.status} /></td>
                </tr>
              );
            })}
            {!pos.length && <tr><td colSpan={6} className="p-8 text-center text-sm text-gray-500">No purchase orders yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={pageCount(total)} baseUrl="/purchase-orders" />
    </div>
  );
}
