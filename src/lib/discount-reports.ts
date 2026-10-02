import { prisma } from "./db";
import { PAYMENT_KINDS } from "./receive-payments";
import { productSalesOf } from "./sales-components";

/**
 * The discount reports: what prompt payment discounts and other discounts were granted on
 * posted receive payments, and what they cost per customer against their sales. Every figure
 * comes from Posted payments only — a draft grants nothing.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
export type Range = { from: Date; to: Date };

export type DiscountFilters = {
  customerId?: string;
  salespersonId?: string;
  region?: string;
  /** invoice number or receipt number, partial */
  q?: string;
  reasonId?: string;
  /** who approved and posted, partial name */
  approver?: string;
};

function appWhere(range: Range, companyIds: string[], f: DiscountFilters) {
  const customer: any = {};
  if (f.salespersonId) customer.salespersonId = f.salespersonId;
  if (f.region) customer.region = f.region;
  return {
    receivePayment: {
      status: "Posted",
      companyId: { in: companyIds },
      date: { gte: range.from, lte: range.to },
      ...(f.customerId ? { customerId: f.customerId } : {}),
      ...(Object.keys(customer).length ? { customer } : {}),
      ...(f.q ? { prNumber: { contains: f.q, mode: "insensitive" as const } } : {}),
    },
  };
}

const APP_INCLUDE = {
  salesReceipt: { select: { id: true, srNumber: true, amount: true, invoiceDate: true } },
  receivePayment: {
    select: {
      id: true, prNumber: true, date: true, method: true,
      customer: { select: { id: true, businessName: true, region: true, province: true, salesperson: { select: { name: true } } } },
      company: { select: { companyName: true } },
    },
  },
} as const;

/* ------------------------------------------------------------------ PPD report */

export type PpdRow = {
  id: string; date: Date; company: string; customerId: string; customer: string; salesperson: string; region: string;
  srId: string; srNumber: string; invoiceAmount: number; payment: number; ppdRate: number; ppdAmount: number;
  rpId: string; prNumber: string; overridden: boolean; overrideReason: string | null;
};

export async function getPpdReport(range: Range, companyIds: string[], f: DiscountFilters = {}) {
  const apps = await prisma.paymentApplication.findMany({
    where: { ...appWhere(range, companyIds, f), ppdAmount: { gt: 0 } },
    include: APP_INCLUDE,
    orderBy: [{ receivePayment: { date: "asc" } }, { createdAt: "asc" }],
  });
  const q = f.q?.trim().toLowerCase();
  const rows: PpdRow[] = apps
    .filter((a) => !q || a.salesReceipt.srNumber.toLowerCase().includes(q) || a.receivePayment.prNumber.toLowerCase().includes(q))
    .map((a) => ({
      id: a.id, date: a.receivePayment.date, company: a.receivePayment.company.companyName,
      customerId: a.receivePayment.customer.id, customer: a.receivePayment.customer.businessName,
      salesperson: a.receivePayment.customer.salesperson?.name ?? "", region: a.receivePayment.customer.region,
      srId: a.salesReceipt.id, srNumber: a.salesReceipt.srNumber, invoiceAmount: a.salesReceipt.amount, payment: a.amount,
      ppdRate: a.ppdRate, ppdAmount: a.ppdAmount, rpId: a.receivePayment.id, prNumber: a.receivePayment.prNumber,
      overridden: !!a.ppdOverrideReason, overrideReason: a.ppdOverrideReason,
    }));
  return {
    rows,
    totals: {
      invoiceAmount: round2(rows.reduce((s, r) => s + r.invoiceAmount, 0)),
      payments: round2(rows.reduce((s, r) => s + r.payment, 0)),
      ppd: round2(rows.reduce((s, r) => s + r.ppdAmount, 0)),
      overrides: rows.filter((r) => r.overridden).length,
    },
  };
}

/* ------------------------------------------------------------------ other discount report */

export type OtherDiscountRow = {
  id: string; date: Date; company: string; customerId: string; customer: string;
  srId: string; srNumber: string; rpId: string; prNumber: string; payment: number; otherDiscount: number;
  reason: string; remarks: string | null; approvedBy: string;
};

/** The approver is whoever approved and posted the receipt — read from the audit trail. */
async function postersOf(receivePaymentIds: string[]): Promise<Map<string, string>> {
  if (!receivePaymentIds.length) return new Map();
  const logs = await prisma.auditLog.findMany({
    where: { entity: "ReceivePayment", action: "POSTED", entityId: { in: receivePaymentIds } },
    select: { entityId: true, actorName: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const m = new Map<string, string>();
  for (const l of logs) if (!m.has(l.entityId)) m.set(l.entityId, l.actorName);
  return m;
}

export async function getOtherDiscountReport(range: Range, companyIds: string[], f: DiscountFilters = {}) {
  const apps = await prisma.paymentApplication.findMany({
    where: { ...appWhere(range, companyIds, f), otherDiscount: { gt: 0 }, ...(f.reasonId ? { otherDiscountReasonId: f.reasonId } : {}) },
    include: { ...APP_INCLUDE, otherDiscountReason: { select: { name: true } } },
    orderBy: [{ receivePayment: { date: "asc" } }, { createdAt: "asc" }],
  });
  const posters = await postersOf([...new Set(apps.map((a) => a.receivePayment.id))]);
  const q = f.q?.trim().toLowerCase();
  const approver = f.approver?.trim().toLowerCase();
  const rows: OtherDiscountRow[] = apps
    .map((a) => ({
      id: a.id, date: a.receivePayment.date, company: a.receivePayment.company.companyName,
      customerId: a.receivePayment.customer.id, customer: a.receivePayment.customer.businessName,
      srId: a.salesReceipt.id, srNumber: a.salesReceipt.srNumber, rpId: a.receivePayment.id, prNumber: a.receivePayment.prNumber,
      payment: a.amount, otherDiscount: a.otherDiscount, reason: a.otherDiscountReason?.name ?? "—", remarks: a.otherDiscountRemarks,
      approvedBy: posters.get(a.receivePayment.id) ?? "—",
    }))
    .filter((r) => (!q || r.srNumber.toLowerCase().includes(q) || r.prNumber.toLowerCase().includes(q)) && (!approver || r.approvedBy.toLowerCase().includes(approver)));
  const byReason = new Map<string, { reason: string; count: number; amount: number }>();
  for (const r of rows) {
    const cur = byReason.get(r.reason) ?? { reason: r.reason, count: 0, amount: 0 };
    cur.count++; cur.amount = round2(cur.amount + r.otherDiscount);
    byReason.set(r.reason, cur);
  }
  return {
    rows,
    byReason: [...byReason.values()].sort((a, b) => b.amount - a.amount),
    totals: { payments: round2(rows.reduce((s, r) => s + r.payment, 0)), otherDiscount: round2(rows.reduce((s, r) => s + r.otherDiscount, 0)) },
  };
}

/* ------------------------------------------------------------------ customer discounts */

export type CustomerDiscountRow = {
  key: string; customerId: string; customer: string; company: string; region: string;
  sales: number; ppd: number; otherDiscount: number; totalDiscounts: number; /** discounts as a share of sales, % */ rate: number | null;
};

/** Per customer: product sales invoiced in the period against the discounts granted on payments posted in it. */
export async function getCustomerDiscounts(range: Range, companyIds: string[]) {
  const [srs, discounts] = await Promise.all([
    prisma.salesReceipt.findMany({
      where: { companyId: { in: companyIds }, kind: "SALE", status: { not: "Void" }, invoiceDate: { gte: range.from, lte: range.to } },
      select: {
        companyId: true, customerId: true, freightCharge: true, otherCharges: true,
        customer: { select: { businessName: true, region: true } }, company: { select: { companyName: true } },
        deliveryReceipt: { select: { lines: { select: { qty: true, unitPrice: true } } } },
      },
    }),
    prisma.payment.findMany({
      where: { kind: { in: [PAYMENT_KINDS.ppd, PAYMENT_KINDS.discount] }, date: { gte: range.from, lte: range.to }, salesReceipt: { companyId: { in: companyIds }, status: { not: "Void" } } },
      select: { kind: true, amount: true, salesReceipt: { select: { companyId: true, customerId: true, customer: { select: { businessName: true, region: true } }, company: { select: { companyName: true } } } } },
    }),
  ]);
  const map = new Map<string, CustomerDiscountRow>();
  const rowFor = (companyId: string, customerId: string, customer: { businessName: string; region: string }, company: string) => {
    const key = `${companyId}:${customerId}`;
    const row = map.get(key) ?? { key, customerId, customer: customer.businessName, company, region: customer.region, sales: 0, ppd: 0, otherDiscount: 0, totalDiscounts: 0, rate: null };
    map.set(key, row);
    return row;
  };
  for (const sr of srs) {
    const row = rowFor(sr.companyId, sr.customerId, sr.customer, sr.company.companyName);
    row.sales = round2(row.sales + productSalesOf(sr));
  }
  for (const p of discounts) {
    const row = rowFor(p.salesReceipt.companyId, p.salesReceipt.customerId, p.salesReceipt.customer, p.salesReceipt.company.companyName);
    if (p.kind === PAYMENT_KINDS.ppd) row.ppd = round2(row.ppd + p.amount); else row.otherDiscount = round2(row.otherDiscount + p.amount);
  }
  const rows = [...map.values()].map((r) => ({ ...r, totalDiscounts: round2(r.ppd + r.otherDiscount), rate: r.sales > 0 ? round2(((r.ppd + r.otherDiscount) / r.sales) * 100) : null }))
    .filter((r) => r.totalDiscounts > 0 || r.sales > 0)
    .sort((a, b) => b.totalDiscounts - a.totalDiscounts || b.sales - a.sales);
  const totals = {
    sales: round2(rows.reduce((s, r) => s + r.sales, 0)),
    ppd: round2(rows.reduce((s, r) => s + r.ppd, 0)),
    otherDiscount: round2(rows.reduce((s, r) => s + r.otherDiscount, 0)),
    totalDiscounts: round2(rows.reduce((s, r) => s + r.totalDiscounts, 0)),
  };
  return { rows, totals, rate: totals.sales > 0 ? round2((totals.totalDiscounts / totals.sales) * 100) : null };
}
