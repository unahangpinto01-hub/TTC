import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireDealer } from "@/lib/auth";
import { peso } from "@/lib/format";
import { StatusBadge, stockStatus } from "@/components/ui";
import { AddToCartButton } from "../../cart-ui";

export default async function ProductPage({ params }: { params: { id: string } }) {
  await requireDealer();
  const p = await prisma.product.findUnique({ where: { id: params.id } });
  if (!p) notFound();
  const status = stockStatus(p.stockQty, p.reorderPoint);
  return (
    <div className="mx-auto max-w-xl">
      <div className="card">
        <div className="mb-2 flex items-start justify-between gap-2">
          <h1 className="text-xl font-bold">{p.name}</h1>
          <StatusBadge status={status} />
        </div>
        <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-gray-500">Active Ingredient</dt><dd className="font-medium">{p.activeIngredient}</dd>
          <dt className="text-gray-500">Category</dt><dd className="font-medium">{p.category}</dd>
          <dt className="text-gray-500">Pack Size</dt><dd className="font-medium">{p.packSize}</dd>
          <dt className="text-gray-500">Recommended Crops</dt><dd className="font-medium">{p.cropTags.split(",").join(", ")}</dd>
          <dt className="text-gray-500">SKU</dt><dd className="font-mono text-xs">{p.sku}</dd>
        </dl>
        <div className="flex items-center justify-between border-t border-gray-100 pt-4">
          <div>
            <p className="text-xs text-gray-500">Dealer Price</p>
            <p className="text-2xl font-bold">{peso(p.dealerPrice)}</p>
          </div>
          <AddToCartButton
            disabled={status === "Out"}
            item={{ id: p.id, sku: p.sku, name: p.name, packSize: p.packSize, price: p.dealerPrice, stock: p.stockQty }}
          />
        </div>
      </div>
    </div>
  );
}
