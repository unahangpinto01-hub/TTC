import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { PageHeader, StatusBadge } from "@/components/ui";
import { createSupplier, updateSupplier } from "./actions";

export default async function SuppliersPage({ searchParams }: { searchParams: { edit?: string } }) {
  const user = await requireStaff();
  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true, purchaseOrders: true } } },
  });
  const canEdit = ["SUPER_ADMIN", "ADMIN"].includes(user.role);
  const editingId = canEdit ? searchParams.edit : undefined;

  return (
    <div>
      <PageHeader title="Suppliers" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[680px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="table-th">Name</th>
                  <th className="table-th">Contact</th>
                  <th className="table-th">Address</th>
                  <th className="table-th">Status</th>
                  <th className="table-th text-right">Products</th>
                  <th className="table-th text-right">POs</th>
                  {canEdit && <th className="table-th" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {suppliers.map((s) =>
                  editingId === s.id ? (
                    <tr key={s.id} className="bg-emerald-50/50">
                      <td colSpan={7} className="p-3">
                        <form action={updateSupplier} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="id" value={s.id} />
                          <div className="min-w-[180px] flex-1">
                            <label className="label">Name</label>
                            <input name="name" defaultValue={s.name} required className="input" />
                          </div>
                          <div className="w-36">
                            <label className="label">Contact</label>
                            <input name="contact" defaultValue={s.contact ?? ""} className="input" />
                          </div>
                          <div className="min-w-[160px] flex-1">
                            <label className="label">Address</label>
                            <input name="address" defaultValue={s.address ?? ""} className="input" />
                          </div>
                          <div className="w-28">
                            <label className="label">Status</label>
                            <select name="status" defaultValue={s.status} className="input">
                              <option>Active</option>
                              <option>Inactive</option>
                            </select>
                          </div>
                          <button className="btn-primary" type="submit">Save</button>
                          <Link href="/suppliers" className="btn-secondary">Cancel</Link>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={s.id} className={s.status === "Inactive" ? "opacity-60" : ""}>
                      <td className="table-td font-medium">{s.name}</td>
                      <td className="table-td">{s.contact ?? "—"}</td>
                      <td className="table-td text-sm text-gray-600">{s.address ?? "—"}</td>
                      <td className="table-td"><StatusBadge status={s.status} /></td>
                      <td className="table-td text-right">{s._count.products}</td>
                      <td className="table-td text-right">{s._count.purchaseOrders}</td>
                      {canEdit && (
                        <td className="table-td text-right">
                          <Link href={`/suppliers?edit=${s.id}`} className="text-sm font-medium text-emerald-700 hover:underline">
                            Edit
                          </Link>
                        </td>
                      )}
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
        {canEdit && (
          <form action={createSupplier} className="card h-fit space-y-3">
            <h2 className="font-semibold">Add Supplier</h2>
            <div><label className="label">Name</label><input name="name" required className="input" /></div>
            <div><label className="label">Contact</label><input name="contact" className="input" /></div>
            <div><label className="label">Address</label><input name="address" className="input" /></div>
            <div>
              <label className="label">Status</label>
              <select name="status" className="input"><option>Active</option><option>Inactive</option></select>
            </div>
            <button className="btn-primary" type="submit">Add</button>
          </form>
        )}
      </div>
    </div>
  );
}
