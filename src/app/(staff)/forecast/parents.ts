import { prisma } from "@/lib/db";

export type ParentInfo = {
  name: string;
  category: string;
  price: number; // average dealer price across the parent's pack sizes
  packs: number;
};

/** Product-line options for forecasting: every distinct parent item of ONE company
    (standalone products appear under their own name), with category and average dealer price. */
export async function getParentInfos(companyId: string): Promise<Map<string, ParentInfo>> {
  const products = await prisma.product.findMany({
    where: { companyId, status: "Active" },
    select: { name: true, parentItem: true, category: true, dealerPrice: true },
  });
  const map = new Map<string, ParentInfo>();
  for (const p of products) {
    const key = p.parentItem?.trim() || p.name;
    const existing = map.get(key);
    if (existing) {
      existing.price = (existing.price * existing.packs + p.dealerPrice) / (existing.packs + 1);
      existing.packs += 1;
    } else {
      map.set(key, { name: key, category: p.category, price: p.dealerPrice, packs: 1 });
    }
  }
  return map;
}
