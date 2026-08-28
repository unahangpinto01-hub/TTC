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

/** Order Inbox numbers: OR-00001 upward, its own running series per company.
    No year segment — the inbox sequence continues across years, unlike the document numbers above. */
export async function nextOrderNo(companyId: string): Promise<string> {
  const counter = await prisma.documentCounter.upsert({
    where: { docType_year_companyId: { docType: "ORD", year: 0, companyId } },
    create: { docType: "ORD", year: 0, companyId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return `OR-${String(counter.lastNumber).padStart(5, "0")}`;
}
