import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { fmtDate, peso, termLabel } from "@/lib/format";
import { getPage, pageCount } from "@/lib/paginate";
import { PageHeader, Pagination, StatusBadge } from "@/components/ui";

export default async function InvoicesPage({ searchParams }: { searchParams: { q?: string; status?: string; page?: string } }) {
  const user = await requirePerm("invoices");
  const company = await getActiveCompany(user);
  const { page, skip, take } = getPage(searchParams);
  const q = searchParams.q?.trim() || "";
  const status = searchParams.status || "";
  const where: any = { companyId: company.id };
  if (status) where.status = status;
  if (q) where.OR = [{ srNumber: { contains: q } }, { customer: { businessName: { contains: q } } }];

  const [srs, total] = await Promise.all([
    prisma.salesReceipt.findMany({
      where,
      orderBy: { invoiceDate: "desc" },
      skip,
      take,
      include: { customer: true, payments: true },
    }),
    prisma.salesReceipt.count({ where }),
  ]);
  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (status) params.status = status;
  const now = new Date();

  return (
    <div>
      <PageHeader title="Invoices / Sales Receipts" />
      <form method="GET" className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search SR # or customer…" className="input max-w-xs" />
        <select name="status" defaultValue={status} className="input max-w-[140px]">
          <option value="">All statuses</option>
          <option>Open</option>
          <option>Partial</option>
          <option>Paid</option>
          <option>Void</option>
        </select>
        <button className="btn-secondary" type="submit">Filter</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[800px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">SR #</th>
              <th className="table-th">Customer</th>
              <th className="table-th">Term</th>
              <th className="table-th">Due Date</th>
              <th className="table-th text-right">Amount</th>
              <th className="table-th text-right">Balance</th>
              <th className="table-th">Aging</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {srs.map((sr) => {
              const paid = sr.payments.reduce((s, p) => s + p.amount, 0);
              const bal = sr.amount - paid;
              const overdueDays = Math.floor((now.getTime() - sr.dueDate.getTime()) / 86400000);
              const aging = sr.status === "Paid" || sr.status === "Void" ? "—" : overdueDays > 0 ? `${overdueDays}d overdue` : overdueDays > -7 ? "Due soon" : "Current";
              return (
                <tr key={sr.id} className="hover:bg-gray-50">
                  <td className="table-td">
                    <Link href={`/invoices/${sr.id}`} className="font-mono text-sm font-medium text-emerald-700 hover:underline">{sr.srNumber}</Link>
                  </td>
                  <td className="table-td">{sr.customer.businessName}</td>
                  <td className="table-td text-sm">{termLabel(sr.term)}</td>
                  <td className="table-td">{fmtDate(sr.dueDate)}</td>
                  <td className="table-td text-right">{peso(sr.amount)}</td>
                  <td className="table-td text-right font-semibold">{peso(bal)}</td>
                  <td className={`table-td text-xs font-semibold ${aging.includes("overdue") ? "text-red-600" : aging === "Due soon" ? "text-amber-600" : "text-gray-500"}`}>{aging}</td>
                  <td className="table-td"><StatusBadge status={sr.status} /></td>
                </tr>
              );
            })}
            {!srs.length && <tr><td colSpan={8} className="p-8 text-center text-sm text-gray-500">No invoices match.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={pageCount(total)} baseUrl="/invoices" params={params} />
    </div>
  );
}
