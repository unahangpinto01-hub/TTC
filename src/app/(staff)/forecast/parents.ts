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

export type ForecastCustomer = {
  id: string;
  name: string;
  /** the salesperson who owns the account TODAY — only used to stamp new lines */
  salespersonId: string | null;
  salesperson: string | null;
};

/** Customers a forecast may plan for, each carrying the salesperson who currently owns it. */
export async function getForecastCustomers(): Promise<ForecastCustomer[]> {
  const rows = await prisma.customer.findMany({
    where: { status: "Active" },
    select: { id: true, businessName: true, salespersonId: true, salesperson: { select: { name: true } } },
    orderBy: { businessName: "asc" },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.businessName,
    salespersonId: c.salespersonId,
    salesperson: c.salesperson?.name ?? null,
  }));
}
