import { prisma } from "./db";

const PREFIX: Record<string, string> = {
  SO: "SO",
  DR: "DR",
  SR: "SR",
  PO: "PO",
};

/** Atomic per-company, per-type, per-year sequential numbering: SO-2026-00001.
    Each company runs its own sequence; the printed letterhead identifies the issuer. */
export async function nextDocNumber(docType: "SO" | "DR" | "SR" | "PO", companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const counter = await prisma.documentCounter.upsert({
    where: { docType_year_companyId: { docType, year, companyId } },
    create: { docType, year, companyId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return `${PREFIX[docType]}-${year}-${String(counter.lastNumber).padStart(5, "0")}`;
}
