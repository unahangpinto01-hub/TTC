import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { createProduct } from "../actions";

const CATEGORIES = ["Insecticide", "Herbicide", "Fungicide", "Molluscicide", "Foliar Fertilizer", "Others"];

export default async function NewProductPage() {
  await requireStaff(["SUPER_ADMIN", "ADMIN"]);
  const suppliers = await prisma.supplier.findMany({ where: { status: "Active" }, orderBy: { name: "asc" } });
  return (
    <div className="max-w-2xl">
      <PageHeader title="New Product" />
      <form action={createProduct} className="card space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label className="label">SKU</label><input name="sku" required className="input" placeholder="INS-101" /></div>
          <div><label className="label">Product Name</label><input name="name" required className="input" /></div>
          <div><label className="label">Active Ingredient</label><input name="activeIngredient" required className="input" /></div>
          <div>
            <label className="label">Category</label>
            <select name="category" className="input">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
          <div><label className="label">Crop Tags (comma-separated)</label><input name="cropTags" className="input" placeholder="Rice,Corn" /></div>
          <div><label className="label">Pack Size</label><input name="packSize" required className="input" placeholder="500ml" /></div>
          <div><label className="label">Unit Cost (₱)</label><input name="unitCost" type="number" step="0.01" required className="input" /></div>
          <div><label className="label">Dealer Price (₱)</label><input name="dealerPrice" type="number" step="0.01" required className="input" /></div>
          <div><label className="label">SRP (₱)</label><input name="srp" type="number" step="0.01" required className="input" /></div>
          <div><label className="label">Reorder Point</label><input name="reorderPoint" type="number" defaultValue={10} className="input" /></div>
          <div><label className="label">Opening Stock</label><input name="openingStock" type="number" defaultValue={0} className="input" /></div>
          <div><label className="label">Batch Number</label><input name="batchNo" className="input" placeholder="B26-0001" /></div>
          <div><label className="label">Manufacturing Date</label><input name="mfgDate" type="date" className="input" /></div>
          <div><label className="label">Expiration Date</label><input name="expDate" type="date" className="input" /></div>
          <div>
            <label className="label">Supplier</label>
            <select name="supplierId" className="input">
              <option value="">—</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <button className="btn-primary" type="submit">Create Product</button>
      </form>
    </div>
  );
}
