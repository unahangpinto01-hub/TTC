import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { createSupplier } from "./actions";

export default async function SuppliersPage() {
  const user = await requireStaff();
  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true, purchaseOrders: true } } },
  });
  const canEdit = ["SUPER_ADMIN", "ADMIN"].includes(user.role);
  return (
    <div>
      <PageHeader title="Suppliers" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[560px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="table-th">Name</th>
                  <th className="table-th">Contact</th>
                  <th className="table-th">Address</th>
                  <th className="table-th text-right">Products</th>
                  <th className="table-th text-right">POs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td className="table-td font-medium">{s.name}</td>
                    <td className="table-td">{s.contact ?? "—"}</td>
                    <td className="table-td text-sm text-gray-600">{s.address ?? "—"}</td>
                    <td className="table-td text-right">{s._count.products}</td>
                    <td className="table-td text-right">{s._count.purchaseOrders}</td>
                  </tr>
                ))}
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
            <button className="btn-primary" type="submit">Add</button>
          </form>
        )}
      </div>
    </div>
  );
}
