import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireDealer } from "@/lib/auth";
import { peso } from "@/lib/format";
import { unitDealerPrice, CARTON } from "@/lib/units";
import { getPage, pageCount } from "@/lib/paginate";
import { Pagination, StatusBadge, stockStatus } from "@/components/ui";
import { AddToCartButton } from "./cart-ui";

const CATEGORIES = ["Insecticide", "Herbicide", "Fungicide", "Molluscicide", "Foliar Fertilizer", "Others"];
const CROPS = ["Rice", "Corn", "Vegetables", "Mango", "Pineapple", "Fruit Trees"];

export default async function CatalogPage({ searchParams }: { searchParams: { q?: string; category?: string; crop?: string; page?: string } }) {
  await requireDealer();
  const { page, skip, take } = getPage(searchParams);
  const q = searchParams.q?.trim() || "";
  const category = searchParams.category || "";
  const crop = searchParams.crop || "";
  const where: any = { status: "Active" };
  if (q) where.OR = [{ name: { contains: q } }, { activeIngredient: { contains: q } }];
  if (category) where.category = category;
  if (crop) where.cropTags = { contains: crop };

  const [products, total] = await Promise.all([
    prisma.product.findMany({ where, orderBy: { name: "asc" }, skip, take }),
    prisma.product.count({ where }),
  ]);
  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (category) params.category = category;
  if (crop) params.crop = crop;

  return (
    <div>
      <h1 className="mb-3 text-xl font-bold">Product Catalog</h1>
      <form method="GET" className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search products…" className="input max-w-xs" />
        <select name="category" defaultValue={category} className="input max-w-[170px]">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select name="crop" defaultValue={crop} className="input max-w-[150px]">
          <option value="">All crops</option>
          {CROPS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <button className="btn-secondary" type="submit">Filter</button>
      </form>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => {
          const status = stockStatus(p.stockQty, p.reorderPoint);
          return (
            <div key={p.id} className="card flex flex-col">
              <div className="mb-1 flex items-start justify-between gap-2">
                <Link href={`/portal/product/${p.id}`} className="font-semibold text-emerald-800 hover:underline">
                  {p.name}
                </Link>
                <StatusBadge status={status} />
              </div>
              <p className="text-xs text-gray-500">{p.activeIngredient} · {p.category}</p>
              <p className="mb-2 text-xs text-gray-400">For: {p.cropTags.split(",").join(", ")}</p>
              <div className="mt-auto flex items-end justify-between gap-2">
                <div>
                  <p className="text-lg font-bold text-gray-900">{peso(p.dealerPrice)} <span className="text-xs font-normal text-gray-500">/ pc</span></p>
                  {!!p.piecesPerCarton && (
                    <p className="text-xs text-gray-500">{peso(unitDealerPrice(p, CARTON))} / carton of {p.piecesPerCarton}</p>
                  )}
                </div>
                <AddToCartButton
                  disabled={status === "Out"}
                  item={{
                    id: p.id, sku: p.sku, name: p.name, packSize: p.packSize,
                    price: p.dealerPrice,
                    cartonPrice: p.piecesPerCarton ? unitDealerPrice(p, CARTON) : null,
                    piecesPerCarton: p.piecesPerCarton,
                    stock: p.stockQty,
                  }}
                />
              </div>
            </div>
          );
        })}
        {!products.length && <p className="col-span-full p-8 text-center text-sm text-gray-500">No products match your filters.</p>}
      </div>
      <Pagination page={page} pageCount={pageCount(total)} baseUrl="/portal" params={params} />
    </div>
  );
}
