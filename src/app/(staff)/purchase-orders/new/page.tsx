import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { createPO } from "../actions";
import { POLinePicker } from "./line-picker";

export default async function NewPOPage() {
  await requirePerm("purchaseOrders");
  const [suppliers, products] = await Promise.all([
    prisma.supplier.findMany({ where: { status: "Active" }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ orderBy: { sku: "asc" }, select: { id: true, sku: true, name: true, unitCost: true, stockQty: true } }),
  ]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="New Purchase Order" />
      <form action={createPO} className="card space-y-4">
        <div>
          <label className="label">Supplier</label>
          <select name="supplierId" required className="input max-w-sm">
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <POLinePicker products={products} />
        <button className="btn-primary" type="submit">Create PO (Draft)</button>
      </form>
    </div>
  );
}
