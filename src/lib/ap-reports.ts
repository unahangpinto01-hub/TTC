import { prisma } from "./db";
import { LIVE_BILL_STATUSES, OPEN_BILL_STATUSES, outstandingOf, round2 } from "./bills";
import { lineCartonSize, ctnValue } from "./units";

/**
 * Accounts Payable and purchasing, read from supplier bills.
 *
 * Every figure here comes from POSTED bills (Posted, Partially Paid, Paid). A draft is not a
 * purchase and not a debt; a voided bill is neither. What is owed is total − paid on the
 * bills still open, and it ages on the DUE date — a bill inside its terms is Current.
 */

export type Range = { from: Date; to: Date };

/* ------------------------------------------------------------------ AP aging */

export type ApAgingRow = {
  supplierId: string;
  supplier: string;
  company: string;
  bills: number;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  total: number;
};

export type OpenBill = {
  id: string;
  billNo: string;
  company: string;
  supplierId: string;
  supplier: string;
  supplierInvoiceNo: string | null;
  billDate: Date;
  dueDate: Date;
  total: number;
  paid: number;
  outstanding: number;
  daysOverdue: number;
  bucket: "current" | "d1_30" | "d31_60" | "d61_90" | "d90plus";
};

const bucketFor = (daysOverdue: number): OpenBill["bucket"] =>
  daysOverdue <= 0 ? "current" : daysOverdue <= 30 ? "d1_30" : daysOverdue <= 60 ? "d31_60" : daysOverdue <= 90 ? "d61_90" : "d90plus";

export async function getApAging(companyIds: string[], asOf: Date = new Date()) {
  // the as-of DAY: a bill dated this afternoon is owed this morning
  const asOfEnd = new Date(asOf);
  asOfEnd.setHours(23, 59, 59, 999);
  const bills = await prisma.supplierBill.findMany({
    where: { companyId: { in: companyIds }, status: { in: OPEN_BILL_STATUSES }, billDate: { lte: asOfEnd } },
    select: {
      id: true, billNo: true, supplierInvoiceNo: true, billDate: true, dueDate: true, total: true, paidAmount: true, status: true,
      supplier: { select: { id: true, name: true } },
      company: { select: { companyName: true } },
    },
    orderBy: [{ dueDate: "asc" }, { billNo: "asc" }],
  });

  const day = 86400000;
  const open: OpenBill[] = [];
  const bySupplier = new Map<string, ApAgingRow>();
  for (const b of bills) {
    const outstanding = outstandingOf(b);
    if (outstanding <= 0) continue;
    const daysOverdue = Math.floor((asOf.getTime() - b.dueDate.getTime()) / day);
    const bucket = bucketFor(daysOverdue);
    open.push({
      id: b.id, billNo: b.billNo, company: b.company.companyName, supplierId: b.supplier.id, supplier: b.supplier.name,
      supplierInvoiceNo: b.supplierInvoiceNo, billDate: b.billDate, dueDate: b.dueDate,
      total: b.total, paid: b.paidAmount, outstanding, daysOverdue, bucket,
    });
    const key = `${b.company.companyName}:${b.supplier.id}`;
    const row = bySupplier.get(key) ?? {
      supplierId: b.supplier.id, supplier: b.supplier.name, company: b.company.companyName, bills: 0,
      current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0,
    };
    row.bills++;
    row[bucket] = round2(row[bucket] + outstanding);
    row.total = round2(row.total + outstanding);
    bySupplier.set(key, row);
  }

  const rows = [...bySupplier.values()].sort((a, b) => b.total - a.total);
  const totals = rows.reduce(
    (t, r) => ({
      bills: t.bills + r.bills,
      current: round2(t.current + r.current), d1_30: round2(t.d1_30 + r.d1_30), d31_60: round2(t.d31_60 + r.d31_60),
      d61_90: round2(t.d61_90 + r.d61_90), d90plus: round2(t.d90plus + r.d90plus), total: round2(t.total + r.total),
    }),
    { bills: 0, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 }
  );
  return { rows, open, totals, asOf };
}

/* ------------------------------------------------------------------ supplier statement */

export type StatementLine = {
  date: Date;
  billId: string;
  billNo: string;
  company: string;
  ref: string;
  description: string;
  charges: number;
  payments: number;
  balance: number;
  status: string;
  dueDate: Date;
};

/** Statement of account for one supplier: the balance brought forward, then every bill in the period. */
export async function getSupplierStatement(supplierId: string, companyIds: string[], range: Range) {
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true, contact: true, address: true } });
  if (!supplier) return null;

  const bills = await prisma.supplierBill.findMany({
    where: { companyId: { in: companyIds }, supplierId, status: { in: LIVE_BILL_STATUSES }, billDate: { lte: range.to } },
    select: {
      id: true, billNo: true, supplierInvoiceNo: true, billDate: true, dueDate: true, total: true, paidAmount: true, status: true, memo: true,
      company: { select: { companyName: true } },
      purchaseOrder: { select: { poNumber: true } },
      goodsReceipt: { select: { grnNumber: true } },
    },
    orderBy: [{ billDate: "asc" }, { billNo: "asc" }],
  });

  // payments carry no date of their own yet (Pay Bills is the next module), so what has
  // been paid on an earlier bill is netted into the balance brought forward
  let opening = 0;
  const lines: StatementLine[] = [];
  for (const b of bills) {
    const net = round2(b.total - b.paidAmount);
    if (b.billDate < range.from) { opening = round2(opening + net); continue; }
  }
  let balance = opening;
  let charges = 0, payments = 0;
  for (const b of bills) {
    if (b.billDate < range.from) continue;
    balance = round2(balance + b.total - b.paidAmount);
    charges = round2(charges + b.total);
    payments = round2(payments + b.paidAmount);
    lines.push({
      date: b.billDate, billId: b.id, billNo: b.billNo, company: b.company.companyName,
      ref: [b.supplierInvoiceNo ? `Inv ${b.supplierInvoiceNo}` : "", b.purchaseOrder?.poNumber, b.goodsReceipt?.grnNumber].filter(Boolean).join(" · "),
      description: b.memo ?? "Inventory purchase",
      charges: b.total, payments: b.paidAmount, balance, status: b.status, dueDate: b.dueDate,
    });
  }
  return { supplier, opening, lines, charges, payments, closing: balance };
}

/* ------------------------------------------------------------------ purchase reports */

export type PurchaseFilters = { supplierId?: string; status?: string; q?: string };

async function liveBills(range: Range, companyIds: string[], f: PurchaseFilters) {
  const where: any = {
    companyId: { in: companyIds },
    billDate: { gte: range.from, lte: range.to },
    status: { in: f.status && LIVE_BILL_STATUSES.includes(f.status) ? [f.status] : LIVE_BILL_STATUSES },
  };
  if (f.supplierId) where.supplierId = f.supplierId;
  if (f.q) {
    where.OR = [
      { billNo: { contains: f.q, mode: "insensitive" } },
      { supplierInvoiceNo: { contains: f.q, mode: "insensitive" } },
      { supplier: { name: { contains: f.q, mode: "insensitive" } } },
    ];
  }
  return prisma.supplierBill.findMany({
    where,
    include: {
      supplier: { select: { id: true, name: true } },
      company: { select: { companyName: true } },
      purchaseOrder: { select: { poNumber: true } },
      goodsReceipt: { select: { grnNumber: true } },
      lines: { include: { product: { select: { id: true, sku: true, name: true, packSize: true, category: true, piecesPerCarton: true } } }, orderBy: { id: "asc" } },
    },
    orderBy: [{ billDate: "desc" }, { billNo: "desc" }],
  });
}

/** Purchase Report: every posted bill in the period, with its lines and the money split out. */
export async function getPurchaseReport(range: Range, companyIds: string[], f: PurchaseFilters = {}) {
  const bills = await liveBills(range, companyIds, f);
  const rows = bills.map((b) => ({
    bill: b,
    pcs: b.lines.reduce((s, l) => s + l.baseQty, 0),
    ctn: b.lines.reduce((s, l) => s + (ctnValue(l.baseQty, lineCartonSize(l, l.product)) ?? 0), 0),
    outstanding: outstandingOf(b),
  }));
  const totals = rows.reduce(
    (t, r) => ({
      bills: t.bills + 1,
      pcs: t.pcs + r.pcs,
      ctn: t.ctn + r.ctn,
      subtotal: round2(t.subtotal + r.bill.subtotal),
      freight: round2(t.freight + r.bill.freight + r.bill.otherCosts),
      inputVat: round2(t.inputVat + r.bill.inputVat),
      total: round2(t.total + r.bill.total),
      paid: round2(t.paid + r.bill.paidAmount),
      outstanding: round2(t.outstanding + r.outstanding),
    }),
    { bills: 0, pcs: 0, ctn: 0, subtotal: 0, freight: 0, inputVat: 0, total: 0, paid: 0, outstanding: 0 }
  );
  return { rows, totals };
}

export type PurchaseByProductRow = {
  productId: string; sku: string; name: string; packSize: string; category: string; company: string;
  bills: number; pcs: number; ctn: number | null; productCost: number; freight: number; inventoryCost: number;
  avgCostPerPcs: number; lastCostPerPcs: number; lastDate: Date | null; suppliers: string[];
};

/** Purchase by Product: what was bought of each product, at what landed cost. */
export async function getPurchaseByProduct(range: Range, companyIds: string[], f: PurchaseFilters = {}) {
  const bills = await liveBills(range, companyIds, f);
  const map = new Map<string, PurchaseByProductRow & { billIds: Set<string>; supplierSet: Set<string>; noConv: boolean }>();
  // oldest first so "last cost" really is the latest
  const ordered = [...bills].sort((a, b) => a.billDate.getTime() - b.billDate.getTime());
  for (const b of ordered) {
    for (const l of b.lines) {
      const p = l.product;
      const cur = map.get(p.id) ?? {
        productId: p.id, sku: p.sku, name: p.name, packSize: p.packSize, category: p.category, company: b.company.companyName,
        bills: 0, pcs: 0, ctn: 0, productCost: 0, freight: 0, inventoryCost: 0, avgCostPerPcs: 0, lastCostPerPcs: 0, lastDate: null,
        suppliers: [], billIds: new Set<string>(), supplierSet: new Set<string>(), noConv: false,
      };
      cur.billIds.add(b.id);
      cur.supplierSet.add(b.supplier.name);
      cur.pcs += l.baseQty;
      const c = ctnValue(l.baseQty, lineCartonSize(l, p));
      if (c === null) cur.noConv = true; else cur.ctn = (cur.ctn ?? 0) + c;
      cur.productCost = round2(cur.productCost + l.amount);
      cur.freight = round2(cur.freight + l.freightAlloc);
      cur.inventoryCost = round2(cur.inventoryCost + l.inventoryCost);
      if (l.baseQty > 0) cur.lastCostPerPcs = l.inventoryCost / l.baseQty;
      cur.lastDate = b.billDate;
      map.set(p.id, cur);
    }
  }
  const rows: PurchaseByProductRow[] = [...map.values()].map((r) => ({
    ...r,
    bills: r.billIds.size,
    suppliers: [...r.supplierSet],
    ctn: r.noConv ? null : round2(r.ctn ?? 0),
    avgCostPerPcs: r.pcs > 0 ? r.inventoryCost / r.pcs : 0,
  })).sort((a, b) => b.inventoryCost - a.inventoryCost);
  const totals = rows.reduce(
    (t, r) => ({ pcs: t.pcs + r.pcs, productCost: round2(t.productCost + r.productCost), freight: round2(t.freight + r.freight), inventoryCost: round2(t.inventoryCost + r.inventoryCost) }),
    { pcs: 0, productCost: 0, freight: 0, inventoryCost: 0 }
  );
  return { rows, totals };
}

export type PurchaseBySupplierRow = {
  supplierId: string; supplier: string; company: string;
  bills: number; pcs: number; subtotal: number; freight: number; inputVat: number; total: number; paid: number; outstanding: number;
  last: Date | null;
};

/** Purchase by Supplier: how much was bought from each supplier and what is still owed on it. */
export async function getPurchaseBySupplier(range: Range, companyIds: string[], f: PurchaseFilters = {}) {
  const bills = await liveBills(range, companyIds, f);
  const map = new Map<string, PurchaseBySupplierRow>();
  for (const b of bills) {
    const key = `${b.company.companyName}:${b.supplier.id}`;
    const cur = map.get(key) ?? {
      supplierId: b.supplier.id, supplier: b.supplier.name, company: b.company.companyName,
      bills: 0, pcs: 0, subtotal: 0, freight: 0, inputVat: 0, total: 0, paid: 0, outstanding: 0, last: null,
    };
    cur.bills++;
    cur.pcs += b.lines.reduce((s, l) => s + l.baseQty, 0);
    cur.subtotal = round2(cur.subtotal + b.subtotal);
    cur.freight = round2(cur.freight + b.freight + b.otherCosts);
    cur.inputVat = round2(cur.inputVat + b.inputVat);
    cur.total = round2(cur.total + b.total);
    cur.paid = round2(cur.paid + b.paidAmount);
    cur.outstanding = round2(cur.outstanding + outstandingOf(b));
    if (!cur.last || b.billDate > cur.last) cur.last = b.billDate;
    map.set(key, cur);
  }
  const rows = [...map.values()].sort((a, b) => b.total - a.total);
  const totals = rows.reduce(
    (t, r) => ({
      bills: t.bills + r.bills, pcs: t.pcs + r.pcs, subtotal: round2(t.subtotal + r.subtotal), freight: round2(t.freight + r.freight),
      inputVat: round2(t.inputVat + r.inputVat), total: round2(t.total + r.total), paid: round2(t.paid + r.paid), outstanding: round2(t.outstanding + r.outstanding),
    }),
    { bills: 0, pcs: 0, subtotal: 0, freight: 0, inputVat: 0, total: 0, paid: 0, outstanding: 0 }
  );
  return { rows, totals };
}

/* ------------------------------------------------------------------ executive */

export type PayablesMetrics = {
  /** goods in stock with no posted supplier invoice — receipts, PCS and value at receiving cost */
  unbilled: { receipts: number; pcs: number; value: number; over30: number };
  /** live bills whose quantities disagree with their receipt */
  discrepancies: { over: number; partial: number };
  outstanding: number;
  overdue: number;
  dueSoon: number; // due within 7 days, not yet overdue
  openBills: number;
  overdueBills: number;
  billedInPeriod: number;
  bySupplier: { id: string; name: string; outstanding: number; overdue: number }[];
};

/** The payables tile for the Executive Dashboard. */
export async function getPayablesMetrics(companyIds: string[], range: Range): Promise<PayablesMetrics> {
  const [aging, billed, unbilled, discrepancies] = await Promise.all([
    getApAging(companyIds),
    prisma.supplierBill.aggregate({
      where: { companyId: { in: companyIds }, status: { in: LIVE_BILL_STATUSES }, billDate: { gte: range.from, lte: range.to } },
      _sum: { total: true },
    }),
    prisma.goodsReceipt.count({ where: { companyId: { in: companyIds }, status: "Posted", invoiceStatus: { not: "Billed" } } })
      .then(async (n) => {
        if (!n) return { receipts: 0, pcs: 0, value: 0, over30: 0 };
        const { getUnbilledReceipts } = await import("./purchasing-reports");
        const u = await getUnbilledReceipts(companyIds);
        return { receipts: u.totals.receipts, pcs: u.totals.pcs, value: u.totals.value, over30: u.totals.over30 };
      }),
    prisma.supplierBill.groupBy({ by: ["matchStatus"], where: { companyId: { in: companyIds }, status: { not: "Void" }, matchStatus: { in: ["Over", "Partial"] } }, _count: true })
      .then((g) => ({ over: g.find((x) => x.matchStatus === "Over")?._count ?? 0, partial: g.find((x) => x.matchStatus === "Partial")?._count ?? 0 })),
  ]);
  const soon = Date.now() + 7 * 86400000;
  let overdue = 0, dueSoon = 0, overdueBills = 0;
  const bySupplier = new Map<string, { id: string; name: string; outstanding: number; overdue: number }>();
  for (const b of aging.open) {
    if (b.daysOverdue > 0) { overdue = round2(overdue + b.outstanding); overdueBills++; }
    else if (b.dueDate.getTime() <= soon) dueSoon = round2(dueSoon + b.outstanding);
    const s = bySupplier.get(b.supplierId) ?? { id: b.supplierId, name: b.supplier, outstanding: 0, overdue: 0 };
    s.outstanding = round2(s.outstanding + b.outstanding);
    if (b.daysOverdue > 0) s.overdue = round2(s.overdue + b.outstanding);
    bySupplier.set(b.supplierId, s);
  }
  return {
    unbilled,
    discrepancies,
    outstanding: aging.totals.total,
    overdue,
    dueSoon,
    openBills: aging.open.length,
    overdueBills,
    billedInPeriod: round2(billed._sum.total ?? 0),
    bySupplier: [...bySupplier.values()].sort((a, b) => b.outstanding - a.outstanding),
  };
}
