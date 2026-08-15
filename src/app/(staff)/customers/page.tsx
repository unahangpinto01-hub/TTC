import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { peso, termLabel } from "@/lib/format";
import { getPage, pageCount } from "@/lib/paginate";
import { PageHeader, Pagination, StatusBadge } from "@/components/ui";

export default async function CustomersPage({ searchParams }: { searchParams: { q?: string; region?: string; page?: string } }) {
  const user = await requireStaff();
  const { page, skip, take } = getPage(searchParams);
  const q = searchParams.q?.trim() || "";
  const region = searchParams.region || "";
  const where: any = {};
  if (q) where.OR = [{ businessName: { contains: q } }, { contactPerson: { contains: q } }, { province: { contains: q } }];
  if (region) where.region = region;

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({ where, orderBy: { businessName: "asc" }, skip, take }),
    prisma.customer.count({ where }),
  ]);
  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (region) params.region = region;
  const canEdit = ["SUPER_ADMIN", "ADMIN"].includes(user.role);

  return (
    <div>
      <PageHeader title="Customers (Dealers)">
        {canEdit && <Link href="/customers/import" className="btn-secondary">⬆ Bulk Import</Link>}
        <Link href="/customers/new" className="btn-primary">+ New Customer</Link>
      </PageHeader>
      <form method="GET" className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search name, contact, province…" className="input max-w-xs" />
        <select name="region" defaultValue={region} className="input max-w-[150px]">
          <option value="">All regions</option>
          <option>Luzon</option>
          <option>Visayas</option>
          <option>Mindanao</option>
        </select>
        <button className="btn-secondary" type="submit">Filter</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[760px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Business Name</th>
              <th className="table-th">Contact</th>
              <th className="table-th">Region / Province</th>
              <th className="table-th">Terms</th>
              <th className="table-th text-right">Credit Limit</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {customers.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="table-td">
                  <Link href={`/customers/${c.id}`} className="font-medium text-emerald-700 hover:underline">{c.businessName}</Link>
                </td>
                <td className="table-td text-sm">{c.contactPerson}<p className="text-xs text-gray-500">{c.mobile}</p></td>
                <td className="table-td text-sm">{c.region} · {c.province}</td>
                <td className="table-td text-xs">{c.allowedTerms.split(",").map(termLabel).join(", ")}</td>
                <td className="table-td text-right">{peso(c.creditLimit)}</td>
                <td className="table-td"><StatusBadge status={c.status} /></td>
              </tr>
            ))}
            {!customers.length && <tr><td colSpan={6} className="p-8 text-center text-sm text-gray-500">No customers match.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={pageCount(total)} baseUrl="/customers" params={params} />
    </div>
  );
}
