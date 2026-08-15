import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { peso } from "@/lib/format";
import { getPage, pageCount, PAGE_SIZE } from "@/lib/paginate";
import { PageHeader, Pagination, StatusBadge, stockStatus } from "@/components/ui";

const CATEGORIES = ["Insecticide", "Herbicide", "Fungicide", "Molluscicide", "Foliar Fertilizer", "Others"];

export default async function InventoryPage({ searchParams }: { searchParams: { q?: string; category?: string; stock?: string; page?: string } }) {
  const user = await requireStaff();
  const { page, skip, take } = getPage(searchParams);
  const q = searchParams.q?.trim() || "";
  const category = searchParams.category || "";
  const stockFilter = searchParams.stock || "";

  const where: any = {};
  if (q) where.OR = [{ name: { contains: q } }, { sku: { contains: q } }, { activeIngredient: { contains: q } }];
  if (category) where.category = category;
  if (stockFilter === "out") where.stockQty = { lte: 0 };

  let products, total;
  if (stockFilter === "low") {
    // low = qty > 0 and qty <= reorderPoint; needs raw comparison across columns
    const all = await prisma.product.findMany({ where, orderBy: { sku: "asc" }, include: { supplier: true } });
    const low = all.filter((p) => p.stockQty > 0 && p.stockQty <= p.reorderPoint);
    total = low.length;
    products = low.slice(skip, skip + take);
  } else {
    [products, total] = await Promise.all([
      prisma.product.findMany({ where, orderBy: { sku: "asc" }, skip, take, include: { supplier: true } }),
      prisma.product.count({ where }),
    ]);
  }

  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (category) params.category = category;
  if (stockFilter) params.stock = stockFilter;

  const canEdit = ["SUPER_ADMIN", "ADMIN"].includes(user.role);

  return (
    <div>
      <PageHeader title="Products / Inventory">
        {canEdit && (
          <>
            <Link href="/inventory/import" className="btn-secondary">⬆ Bulk Import</Link>
            <Link href="/inventory/new" className="btn-primary">+ New Product</Link>
          </>
        )}
      </PageHeader>

      <form method="GET" className="mb-4 flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q} placeholder="Search name, SKU, ingredient…" className="input max-w-xs" />
        <select name="category" defaultValue={category} className="input max-w-[180px]">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select name="stock" defaultValue={stockFilter} className="input max-w-[140px]">
          <option value="">All stock</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
        </select>
        <button className="btn-secondary" type="submit">Filter</button>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[800px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">SKU</th>
              <th className="table-th">Product</th>
              <th className="table-th">Category</th>
              <th className="table-th">Pack</th>
              <th className="table-th text-right">Dealer Price</th>
              <th className="table-th text-right">Stock</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {products.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="table-td font-mono text-xs">{p.sku}</td>
                <td className="table-td">
                  <Link href={`/inventory/${p.id}`} className="font-medium text-emerald-700 hover:underline">{p.name}</Link>
                  <p className="text-xs text-gray-500">{p.activeIngredient}</p>
                </td>
                <td className="table-td text-sm text-gray-600">{p.category}</td>
                <td className="table-td">{p.packSize}</td>
                <td className="table-td text-right">{peso(p.dealerPrice)}</td>
                <td className="table-td text-right font-semibold">{p.stockQty}</td>
                <td className="table-td"><StatusBadge status={stockStatus(p.stockQty, p.reorderPoint)} /></td>
              </tr>
            ))}
            {!products.length && (
              <tr><td colSpan={7} className="p-8 text-center text-sm text-gray-500">No products match your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={pageCount(total)} baseUrl="/inventory" params={params} />
      <p className="mt-2 text-xs text-gray-500">{total} products · showing {PAGE_SIZE} per page</p>
    </div>
  );
}
