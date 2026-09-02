import { prisma } from "@/lib/db";

export type ForecastProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  companyId: string;
  company: string;
  /** current active SRP — forecast value uses SRP only, never cost or dealer price */
  srp: number;
};

/**
 * Products a forecast may include, across every company the user is allowed to see.
 * Forecasts are shared, but the caller passes the permitted company ids so a user
 * never sees products from a company they cannot access.
 */
export async function getForecastProducts(companyIds: string[]): Promise<ForecastProduct[]> {
  const products = await prisma.product.findMany({
    where: { companyId: { in: companyIds }, status: "Active", itemClass: "INVENTORY" },
    select: {
      id: true, sku: true, name: true, category: true, srp: true,
      companyId: true, company: { select: { companyName: true } },
    },
    orderBy: [{ company: { isPrimary: "desc" } }, { name: "asc" }],
  });
  return products.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    companyId: p.companyId,
    company: p.company.companyName,
    srp: p.srp,
  }));
}
