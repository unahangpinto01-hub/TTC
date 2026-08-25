import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { createProduct } from "../actions";
import { ParentItemField } from "../parent-item-field";
import { SkuCategoryFields } from "./sku-category-fields";
import { getActiveCompany } from "@/lib/company";

const PREFIXES = ["INS", "HER", "FNG", "MOL", "FOL", "OTH"];

export default async function NewProductPage({ searchParams }: { searchParams: { error?: string } }) {
  const user = await requirePerm("inventory");
  const company = await getActiveCompany(user);
  const [suppliers, skus, parentRows] = await Promise.all([
    prisma.supplier.findMany({ where: { status: "Active" }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { companyId: company.id }, select: { sku: true } }),
    prisma.product.findMany({
      where: { companyId: company.id, parentItem: { not: null } },
      select: { parentItem: true },
      distinct: ["parentItem"],
      orderBy: { parentItem: "asc" },
    }),
  ]);
  const parentOptions = parentRows.map((p) => p.parentItem!);

  // next SKU per category prefix, following the existing PREFIX-### numbering
  const nextSku: Record<string, string> = {};
  for (const pre of PREFIXES) {
    const re = new RegExp(`^${pre}-(\\d+)$`);
    const max = skus.reduce((m, p) => {
      const match = p.sku.match(re);
      return match ? Math.max(m, Number(match[1])) : m;
    }, 0);
    nextSku[pre] = `${pre}-${String(max + 1).padStart(3, "0")}`;
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="New Product" />
      {searchParams.error === "sku" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">⚠ That SKU is already taken — it has been renumbered; please try again.</p>
      )}
      {searchParams.error === "required" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">⚠ SKU and Product Name are required.</p>
      )}
      <form action={createProduct} className="card space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SkuCategoryFields nextSku={nextSku} />
          <div><label className="label">Product Name</label><input name="name" required className="input" /></div>
          <div><label className="label">Active Ingredient</label><input name="activeIngredient" className="input" /></div>
          <div><label className="label">Crop Tags (comma-separated)</label><input name="cropTags" className="input" placeholder="Rice,Corn" /></div>
          <div><label className="label">Pack Size</label><input name="packSize" className="input" placeholder="500ml" /></div>
          <div><label className="label">Unit Cost per PCS (₱)</label><input name="unitCost" type="number" step="any" min={0} className="input" /></div>
          <div><label className="label">…or Cost per Carton (₱)</label><input name="costPerCarton" type="number" step="any" min={0} className="input" placeholder="auto ÷ pieces per carton" /></div>
          <div><label className="label">Dealer Price (₱)</label><input name="dealerPrice" type="number" step="0.01" min={0} className="input" /></div>
          <div><label className="label">SRP (₱)</label><input name="srp" type="number" step="0.01" min={0} className="input" /></div>
          <div><label className="label">Reorder Point (PCS)</label><input name="reorderPoint" type="number" defaultValue={10} className="input" /></div>
          <div><label className="label">Opening Stock (PCS)</label><input name="openingStock" type="number" defaultValue={0} className="input" /></div>
          <div><label className="label">Pieces per Carton</label><input name="piecesPerCarton" type="number" min={0} className="input" placeholder="blank = no carton" /></div>
          <div><label className="label">Carton Dealer Price (₱)</label><input name="cartonDealerPrice" type="number" step="0.01" min={0} className="input" placeholder="blank = auto" /></div>
          <div><label className="label">Gross Weight per Pack (kg)</label><input name="packGrossWeightKg" type="number" step="any" min={0} className="input" placeholder="e.g. 13.50" /></div>
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
