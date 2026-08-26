import { prisma } from "./db";

export type Category = { name: string; prefix: string };

/** Product categories, shared by both companies, in display order. */
export async function getCategories(): Promise<Category[]> {
  return prisma.productCategory.findMany({
    orderBy: { sortOrder: "asc" },
    select: { name: true, prefix: true },
  });
}

export async function getCategoryNames(): Promise<string[]> {
  return (await getCategories()).map((c) => c.name);
}
