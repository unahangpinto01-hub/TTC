import { prisma } from "./db";

/** The company details singleton — created with defaults on first access. */
export async function getCompany() {
  const existing = await prisma.companySetting.findUnique({ where: { id: "company" } });
  if (existing) return existing;
  return prisma.companySetting.create({ data: { id: "company" } });
}
