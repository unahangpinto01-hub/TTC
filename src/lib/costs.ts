import { prisma } from "./db";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma;

/**
 * The unit cost in force for each product on a date: the latest ProductCost row dated on or before
 * it. Products with no row by that date are absent from the map (callers fall back to the current
 * product cost).
 */
export async function costsAt(productIds: string[], asOf: Date): Promise<Map<string, number>> {
  if (!productIds.length) return new Map();
  const rows = await prisma.$queryRaw<{ productId: string; unitCost: number }[]>`
    SELECT DISTINCT ON ("productId") "productId", "unitCost"
    FROM "ProductCost"
    WHERE "productId" = ANY(${productIds}) AND "effectiveFrom" <= ${asOf}
    ORDER BY "productId", "effectiveFrom" DESC, "createdAt" DESC`;
  const map = new Map(rows.map((r) => [r.productId, r.unitCost]));
  // before a product's first recorded cost, use that first cost: the books carried it into the year at the price of its earliest month
  const missing = productIds.filter((id) => !map.has(id));
  if (missing.length) {
    const first = await prisma.$queryRaw<{ productId: string; unitCost: number }[]>`
      SELECT DISTINCT ON ("productId") "productId", "unitCost"
      FROM "ProductCost"
      WHERE "productId" = ANY(${missing})
      ORDER BY "productId", "effectiveFrom" ASC, "createdAt" ASC`;
    for (const r of first) map.set(r.productId, r.unitCost);
  }
  return map;
}

/**
 * Record a product's unit cost from a date. One row per product and date: a second re-costing on
 * the same day replaces the first (the later one is what the day ends with).
 */
export async function recordCost(tx: Tx, input: { productId: string; unitCost: number; effectiveFrom: Date; source: "IMPORT" | "BILL" | "RECEIPT" | "EDIT"; note?: string }) {
  const effectiveFrom = new Date(input.effectiveFrom);
  effectiveFrom.setHours(0, 0, 0, 0);
  await tx.productCost.upsert({
    where: { productId_effectiveFrom: { productId: input.productId, effectiveFrom } },
    create: { productId: input.productId, effectiveFrom, unitCost: input.unitCost, source: input.source, note: input.note ?? null },
    update: { unitCost: input.unitCost, source: input.source, note: input.note ?? null },
  });
}
