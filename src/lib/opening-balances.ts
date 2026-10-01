import { prisma } from "./db";
import { nextSeriesNo, periodOf } from "./vouchers";
import { round2 } from "./bill-math";
import { LIVE_DV_STATUSES } from "./dv";
import { logAudit } from "./salespeople";

/**
 * Opening balances — what customers owed the company, and what the company owed its
 * suppliers, on the day before the BMS took over (31 December 2025 for a system that starts
 * in 2026). Nothing in the system had a place for them: a receivable only ever came from a
 * delivery and a payable only from a bill with lines, so a customer's collections for last
 * year's invoices had nothing to be applied to.
 *
 * A customer balance is stored as an invoice of kind OPENING: it carries no delivery and no
 * lines, so the sales reports, the ledger and the forecast leave it out, while AR Aging, the
 * customer statement and Receive Payments treat it as the open item it is. A supplier balance
 * is a bill of kind OPENING in the same way: AP Aging, the supplier statement, vouchers and
 * cheques settle it; purchases, inventory costing and the ledger never see it.
 *
 * Each one is a single figure per customer or supplier per company as of a date. The office
 * may enter several for one party (one per old invoice, say) — they are simply separate open
 * items. A credit balance (the company owing a customer, or a supplier owing the company)
 * is not an opening balance here; it is handled as a credit when it arises.
 */

export const OPENING = "OPENING";
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The day the balances are normally taken as of: the last day of the year before this one. */
export function defaultAsOf(now = new Date()): Date {
  return new Date(now.getFullYear() - 1, 11, 31);
}

export type OpeningInput = {
  companyId: string;
  partyId: string;
  asOf: Date;
  dueDate?: Date | null;
  amount: number;
  memo?: string | null;
  actor: { id: string; name: string; email: string };
};

export async function createCustomerOpening(i: OpeningInput) {
  const customer = await prisma.customer.findUnique({ where: { id: i.partyId }, select: { id: true, businessName: true } });
  if (!customer) throw new Error("party");
  const amount = round2(i.amount);
  if (!(amount > 0)) throw new Error("amount");
  const srNumber = await nextSeriesNo("OBC", i.companyId, i.asOf);
  const sr = await prisma.salesReceipt.create({
    data: {
      companyId: i.companyId, srNumber, kind: OPENING, customerId: customer.id,
      amount, freightCharge: 0, otherCharges: 0, term: "OPENING", vatApplied: false,
      invoiceDate: i.asOf, dueDate: i.dueDate ?? i.asOf, status: "Open", memo: i.memo?.trim() || null,
    },
  });
  await logAudit({
    entity: "SalesReceipt", entityId: sr.id, action: "CREATED",
    detail: `${srNumber} opening balance — ${customer.businessName} owes ₱${amount.toFixed(2)} as of ${ymd(i.asOf)}${i.memo ? ` · ${i.memo}` : ""}`,
    actorName: i.actor.name, actorEmail: i.actor.email, companyId: i.companyId,
  });
  return sr;
}

export async function createSupplierOpening(i: OpeningInput) {
  const supplier = await prisma.supplier.findUnique({ where: { id: i.partyId }, select: { id: true, name: true } });
  if (!supplier) throw new Error("party");
  const amount = round2(i.amount);
  if (!(amount > 0)) throw new Error("amount");
  const billNo = await nextSeriesNo("OBS", i.companyId, i.asOf);
  const { year, month } = periodOf(i.asOf);
  const now = new Date();
  const bill = await prisma.supplierBill.create({
    data: {
      companyId: i.companyId, billNo, kind: OPENING, supplierId: supplier.id,
      supplierInvoiceNo: null, invoiceUnavailable: true,
      billDate: i.asOf, dueDate: i.dueDate ?? i.asOf, terms: "Opening balance", memo: i.memo?.trim() || null,
      status: "Posted", subtotal: 0, freight: 0, otherCosts: 0, vatRate: 0, vatMode: "NONE", inputVat: 0,
      grossTotal: amount, inventoryTotal: 0, ewtRate: 0, ewtAmount: 0, total: amount, receiptCost: 0,
      matchStatus: "None", paidAmount: 0, accountingYear: year, accountingMonth: month,
      createdById: i.actor.id, postedById: i.actor.id, postedAt: now,
    },
  });
  await logAudit({
    entity: "SupplierBill", entityId: bill.id, action: "CREATED",
    detail: `${billNo} opening balance — ₱${amount.toFixed(2)} owed to ${supplier.name} as of ${ymd(i.asOf)}${i.memo ? ` · ${i.memo}` : ""}`,
    actorName: i.actor.name, actorEmail: i.actor.email, companyId: i.companyId,
  });
  return bill;
}

export type OpeningRow = {
  id: string;
  side: "customer" | "supplier";
  docNo: string;
  partyId: string;
  party: string;
  asOf: Date;
  dueDate: Date;
  memo: string | null;
  amount: number;
  /** collected from the customer, or paid to the supplier */
  settled: number;
  balance: number;
  status: string;
  href: string;
  /** nothing has been applied, paid or vouchered against it, so it may still be withdrawn */
  canVoid: boolean;
  voidReason: string | null;
};

/** Every opening balance of a company, customers and suppliers, oldest first. */
export async function listOpeningBalances(companyId: string): Promise<{ customers: OpeningRow[]; suppliers: OpeningRow[] }> {
  const [srs, bills] = await Promise.all([
    prisma.salesReceipt.findMany({
      where: { companyId, kind: OPENING },
      include: {
        customer: { select: { businessName: true } },
        payments: { select: { amount: true } },
        _count: { select: { paymentApplications: true, creditApplications: true, refundCredits: true } },
      },
      orderBy: [{ invoiceDate: "asc" }, { srNumber: "asc" }],
    }),
    prisma.supplierBill.findMany({
      where: { companyId, kind: OPENING },
      include: {
        supplier: { select: { name: true } },
        dvBills: { where: { dv: { status: { in: LIVE_DV_STATUSES } } }, select: { id: true } },
      },
      orderBy: [{ billDate: "asc" }, { billNo: "asc" }],
    }),
  ]);
  const customers: OpeningRow[] = srs.map((sr) => {
    const settled = round2(sr.payments.reduce((s, p) => s + p.amount, 0));
    const touched = sr.payments.length > 0 || sr._count.paymentApplications > 0 || sr._count.creditApplications > 0 || sr._count.refundCredits > 0;
    return {
      id: sr.id, side: "customer", docNo: sr.srNumber, partyId: sr.customerId, party: sr.customer.businessName,
      asOf: sr.invoiceDate, dueDate: sr.dueDate, memo: sr.memo, amount: sr.amount, settled,
      balance: sr.status === "Void" ? 0 : round2(sr.amount - settled), status: sr.status, href: `/invoices/${sr.id}`,
      canVoid: sr.status !== "Void" && !touched, voidReason: sr.voidReason,
    };
  });
  const suppliers: OpeningRow[] = bills.map((b) => ({
    id: b.id, side: "supplier", docNo: b.billNo, partyId: b.supplierId, party: b.supplier.name,
    asOf: b.billDate, dueDate: b.dueDate, memo: b.memo, amount: b.total, settled: b.paidAmount,
    balance: b.status === "Void" ? 0 : round2(Math.max(0, b.total - b.paidAmount)), status: b.status, href: `/bills/${b.id}`,
    canVoid: b.status === "Posted" && b.paidAmount <= 0 && b.dvBills.length === 0, voidReason: b.voidReason,
  }));
  return { customers, suppliers };
}

/** Withdraw an opening balance nothing has touched. Anything applied to it must be reversed first. */
export async function voidOpening(side: "customer" | "supplier", id: string, companyId: string, reason: string, actor: { id: string; name: string; email: string }) {
  const { customers, suppliers } = await listOpeningBalances(companyId);
  const row = (side === "customer" ? customers : suppliers).find((r) => r.id === id);
  if (!row) throw new Error("missing");
  if (!row.canVoid) throw new Error("touched");
  if (side === "customer") {
    await prisma.salesReceipt.update({ where: { id }, data: { status: "Void", voidReason: reason } });
    await logAudit({ entity: "SalesReceipt", entityId: id, action: "VOIDED", detail: `${row.docNo} opening balance of ${row.party} withdrawn — ${reason}`, actorName: actor.name, actorEmail: actor.email, companyId, reason });
  } else {
    await prisma.supplierBill.update({ where: { id }, data: { status: "Void", voidedAt: new Date(), voidedById: actor.id, voidReason: reason } });
    await logAudit({ entity: "SupplierBill", entityId: id, action: "VOIDED", detail: `${row.docNo} opening balance owed to ${row.party} withdrawn — ${reason}`, actorName: actor.name, actorEmail: actor.email, companyId, reason });
  }
  return row;
}
