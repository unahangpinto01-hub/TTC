import type { Prisma } from "@prisma/client";
import type { Range } from "./reports";

export type CheckRegisterFilters = { checkNo?: string; payee?: string; dv?: string; bank?: string; method?: string; status?: string; min?: string; max?: string };

/** The Check Register's filters as a Prisma where — shared by the page and its export. */
export function checkRegisterWhere(companyIds: string[], range: Range, f: CheckRegisterFilters): Prisma.SupplierPaymentWhereInput {
  const where: Prisma.SupplierPaymentWhereInput = {
    companyId: { in: companyIds },
    // a cheque is listed on its cheque date; anything else on its payment date
    OR: [{ checkDate: { gte: range.from, lte: range.to } }, { checkDate: null, date: { gte: range.from, lte: range.to } }],
  };
  if (f.checkNo) where.checkNo = { contains: f.checkNo.trim(), mode: "insensitive" };
  if (f.payee) where.payee = { contains: f.payee.trim(), mode: "insensitive" };
  if (f.dv) where.dv = { dvNo: { contains: f.dv.trim(), mode: "insensitive" } };
  if (f.bank) where.cashAccountId = f.bank;
  if (f.method) where.method = f.method;
  if (f.status === "Posted" || f.status === "Void") where.status = f.status;
  const min = Number(f.min), max = Number(f.max);
  if (f.min && !Number.isNaN(min)) where.amount = { ...(where.amount as object), gte: min };
  if (f.max && !Number.isNaN(max)) where.amount = { ...(where.amount as object), lte: max };
  return where;
}
