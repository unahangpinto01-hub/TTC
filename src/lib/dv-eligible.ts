import { prisma } from "./db";
import { OPEN_BILL_STATUSES, round2 } from "./bills";
import { availableForVoucher } from "./dv";

/**
 * The bills a new voucher may pick from: posted or partially paid, in the company, not void,
 * not fully paid, and with an UNVOUCHERED BALANCE — the outstanding amount less what other
 * live vouchers already hold. A bill partly covered by one voucher stays here for the rest.
 */

export type EligibleFilters = {
  supplier?: string; billNo?: string; invoice?: string; from?: string; to?: string; dueFrom?: string; dueTo?: string;
  kind?: string; min?: string; max?: string; po?: string; grn?: string;
};

export type EligibleBill = {
  id: string; billNo: string; kind: string; supplierId: string; supplierName: string; supplierInvoiceNo: string | null;
  billDate: string; dueDate: string; particulars: string; grossTotal: number; total: number; paid: number;
  outstanding: number; onOtherVouchers: number; available: number; status: string; poNumber: string | null; grnNumber: string | null;
};

const day = (s?: string, end = false) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  return new Date(`${s}T${end ? "23:59:59.999" : "00:00:00"}`);
};
const fmt = (d: Date) => d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });

export async function eligibleBills(companyId: string, f: EligibleFilters, excludeDvId?: string): Promise<EligibleBill[]> {
  const where: any = { companyId, status: { in: OPEN_BILL_STATUSES } };
  if (f.supplier) where.supplierId = f.supplier;
  if (f.billNo) where.billNo = { contains: f.billNo.trim(), mode: "insensitive" };
  if (f.invoice) where.supplierInvoiceNo = { contains: f.invoice.trim(), mode: "insensitive" };
  if (f.kind === "INVENTORY" || f.kind === "EXPENSE" || f.kind === "OPENING") where.kind = f.kind;
  const from = day(f.from), to = day(f.to, true), dueFrom = day(f.dueFrom), dueTo = day(f.dueTo, true);
  if (from || to) where.billDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  if (dueFrom || dueTo) where.dueDate = { ...(dueFrom ? { gte: dueFrom } : {}), ...(dueTo ? { lte: dueTo } : {}) };
  if (f.po) where.purchaseOrder = { poNumber: { contains: f.po.trim(), mode: "insensitive" } };
  if (f.grn) where.goodsReceipt = { grnNumber: { contains: f.grn.trim(), mode: "insensitive" } };
  const min = Number(f.min), max = Number(f.max);
  if (f.min && !Number.isNaN(min)) where.total = { ...(where.total ?? {}), gte: min };
  if (f.max && !Number.isNaN(max)) where.total = { ...(where.total ?? {}), lte: max };

  const bills = await prisma.supplierBill.findMany({
    where,
    select: {
      id: true, billNo: true, kind: true, supplierId: true, supplierInvoiceNo: true, billDate: true, dueDate: true, memo: true, grossTotal: true, total: true, paidAmount: true, status: true,
      supplier: { select: { name: true } }, purchaseOrder: { select: { poNumber: true } }, goodsReceipt: { select: { grnNumber: true } },
      expenseLines: { select: { description: true, glAccount: { select: { description: true } } }, take: 3 },
    },
    orderBy: [{ supplier: { name: "asc" } }, { dueDate: "asc" }, { billNo: "asc" }],
    take: 500,
  });
  const out: EligibleBill[] = [];
  for (const b of bills) {
    const a = await availableForVoucher(b.id, excludeDvId);
    if (a.available <= 0) continue;
    const particulars = b.kind === "OPENING" ? `Opening balance brought forward${b.memo ? ` · ${b.memo}` : ""}` : b.memo || (b.kind === "EXPENSE" ? b.expenseLines.map((l) => l.description || l.glAccount.description).filter(Boolean).join(", ") || "Non-inventory bill" : b.goodsReceipt ? `Inventory purchase · ${b.goodsReceipt.grnNumber}` : "Inventory purchase");
    out.push({
      id: b.id, billNo: b.billNo, kind: b.kind, supplierId: b.supplierId, supplierName: b.supplier.name, supplierInvoiceNo: b.supplierInvoiceNo,
      billDate: fmt(b.billDate), dueDate: fmt(b.dueDate), particulars, grossTotal: b.grossTotal || b.total, total: b.total, paid: b.paidAmount,
      outstanding: a.outstanding, onOtherVouchers: round2(a.onOtherVouchers + b.paidAmount), available: a.available, status: b.status,
      poNumber: b.purchaseOrder?.poNumber ?? null, grnNumber: b.goodsReceipt?.grnNumber ?? null,
    });
  }
  return out;
}
