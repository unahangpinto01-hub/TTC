import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { createProduct } from "../actions";
import { ParentItemField } from "../parent-item-field";

const CATEGORIES = ["Insecticide", "Herbicide", "Fungicide", "Molluscicide", "Foliar Fertilizer", "Others"];

export default async function NewProductPage() {
  await requirePerm("inventory");
  const suppliers = await prisma.supplier.findMany({ where: { status: "Active" }, orderBy: { name: "asc" } });
  const parentOptions = (
    await prisma.product.findMany({
      where: { parentItem: { not: null } },
      select: { parentItem: true },
      distinct: ["parentItem"],
      orderBy: { parentItem: "asc" },
    })
  ).map((p) => p.parentItem!);
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
          <div><label className="label">Unit Cost per PCS (₱)</label><input name="unitCost" type="number" step="any" required className="input" /></div>
          <div><label className="label">…or Cost per Carton (₱)</label><input name="costPerCarton" type="number" step="any" min={0} className="input" placeholder="auto ÷ pieces per carton" /></div>
          <div><label className="label">Dealer Price (₱)</label><input name="dealerPrice" type="number" step="0.01" required className="input" /></div>
          <div><label className="label">SRP (₱)</label><input name="srp" type="number" step="0.01" required className="input" /></div>
          <div><label className="label">Reorder Point (PCS)</label><input name="reorderPoint" type="number" defaultValue={10} className="input" /></div>
          <div><label className="label">Opening Stock (PCS)</label><input name="openingStock" type="number" defaultValue={0} className="input" /></div>
          <div><label className="label">Pieces per Carton</label><input name="piecesPerCarton" type="number" min={0} className="input" placeholder="blank = no carton" /></div>
          <div><label className="label">Carton Dealer Price (₱)</label><input name="cartonDealerPrice" type="number" step="0.01" min={0} className="input" placeholder="blank = auto" /></div>
          <div><label className="label">Batch Number</label><input name="batchNo" className="input" placeholder="B26-0001" /></div>
          <div><label className="label">Manufacturing Date</label><input name="mfgDate" type="date" className="input" /></div>
          <div><label className="label">Expiration Date</label><input name="expDate" type="date" className="input" /></div>
          <div>
            <label className="label">Parent Item (grouping, optional)</label>
            <ParentItemField options={parentOptions} />
          </div>
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
