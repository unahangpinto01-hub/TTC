import { prisma } from "./db";
import { LIVE_BILL_STATUSES, round2 } from "./bills";
import { lineCartonSize, ctnValue } from "./units";

/**
 * The reports that sit between the warehouse and accounting: what has been received but not
 * yet billed, which supplier invoices disagree with what arrived, how each purchase order
 * line was ordered / received / invoiced, and what each supplier has charged over time.
 */

export type Range = { from: Date; to: Date };

/* ------------------------------------------------------------------ received, not yet billed */

export type UnbilledLine = {
  productId: string; sku: string; name: string; packSize: string;
  accepted: number; billed: number; remaining: number; unit: string; remainingPcs: number; remainingCtn: number | null;
  unitCost: number; remainingValue: number;
};
export type UnbilledReceipt = {
  id: string; grnNumber: string; receivedDate: Date; days: number; company: string; companyId: string;
  supplierId: string; supplier: string; poId: string; poNumber: string; deliveryRefNo: string | null; invoiceStatus: string;
  lines: UnbilledLine[]; remainingPcs: number; remainingValue: number;
  drafts: { id: string; billNo: string; matchStatus: string }[];
};

/** Posted receipts with accepted quantity that no posted bill has covered yet, valued at the receiving cost. */
export async function getUnbilledReceipts(companyIds: string[], asOf: Date = new Date()) {
  const receipts = await prisma.goodsReceipt.findMany({
    where: { companyId: { in: companyIds }, status: "Posted", invoiceStatus: { not: "Billed" }, receivedDate: { lte: asOf } },
    include: {
      company: { select: { companyName: true } },
      purchaseOrder: { select: { id: true, poNumber: true, supplierId: true, supplier: { select: { name: true } } } },
      lines: { include: { product: { select: { id: true, sku: true, name: true, packSize: true, piecesPerCarton: true } } } },
      bills: { where: { status: { not: "Void" } }, select: { id: true, billNo: true, status: true, matchStatus: true, lines: { select: { grnLineId: true, qty: true } } } },
    },
    orderBy: [{ receivedDate: "asc" }],
  });
  const day = 86400000;
  const rows: UnbilledReceipt[] = [];
  for (const g of receipts) {
    const billed = new Map<string, number>();
    for (const b of g.bills) {
      if (!LIVE_BILL_STATUSES.includes(b.status)) continue;
      for (const l of b.lines) if (l.grnLineId) billed.set(l.grnLineId, (billed.get(l.grnLineId) ?? 0) + l.qty);
    }
    const lines: UnbilledLine[] = [];
    for (const l of g.lines) {
      const b = Math.min(l.acceptedQty, billed.get(l.id) ?? 0);
      const remaining = l.acceptedQty - b;
      if (remaining <= 0) continue;
      const factor = l.acceptedQty > 0 ? l.acceptedBaseQty / l.acceptedQty : 1;
      const remainingPcs = Math.round(remaining * factor);
      lines.push({
        productId: l.product.id, sku: l.product.sku, name: l.product.name, packSize: l.product.packSize,
        accepted: l.acceptedQty, billed: b, remaining, unit: l.unit, remainingPcs,
        remainingCtn: ctnValue(remainingPcs, lineCartonSize(l, l.product)),
        unitCost: l.unitCost, remainingValue: round2(remaining * l.unitCost),
      });
    }
    if (!lines.length) continue;
    rows.push({
      id: g.id, grnNumber: g.grnNumber, receivedDate: g.receivedDate, days: Math.floor((asOf.getTime() - g.receivedDate.getTime()) / day),
      company: g.company.companyName, companyId: g.companyId,
      supplierId: g.purchaseOrder.supplierId, supplier: g.purchaseOrder.supplier.name, poId: g.purchaseOrder.id, poNumber: g.purchaseOrder.poNumber,
      deliveryRefNo: g.deliveryRefNo, invoiceStatus: g.invoiceStatus,
      lines, remainingPcs: lines.reduce((s, l) => s + l.remainingPcs, 0), remainingValue: round2(lines.reduce((s, l) => s + l.remainingValue, 0)),
      drafts: g.bills.filter((b) => b.status === "Draft").map((b) => ({ id: b.id, billNo: b.billNo, matchStatus: b.matchStatus })),
    });
  }
  const bySupplier = new Map<string, { supplierId: string; supplier: string; receipts: number; value: number; oldest: number }>();
  for (const r of rows) {
    const s = bySupplier.get(r.supplierId) ?? { supplierId: r.supplierId, supplier: r.supplier, receipts: 0, value: 0, oldest: 0 };
    s.receipts++; s.value = round2(s.value + r.remainingValue); s.oldest = Math.max(s.oldest, r.days);
    bySupplier.set(r.supplierId, s);
  }
  return {
    rows,
    bySupplier: [...bySupplier.values()].sort((a, b) => b.value - a.value),
    totals: { receipts: rows.length, pcs: rows.reduce((s, r) => s + r.remainingPcs, 0), value: round2(rows.reduce((s, r) => s + r.remainingValue, 0)), over30: rows.filter((r) => r.days > 30).length },
    asOf,
  };
}

/* ------------------------------------------------------------------ invoice discrepancies */

export type DiscrepancyRow = {
  billId: string; billNo: string; status: string; matchStatus: string; billDate: Date; company: string;
  supplier: string; supplierInvoiceNo: string | null; grnId: string; grnNumber: string; receivedDate: Date;
  discrepancyNote: string | null; overrideReason: string | null;
  lines: { product: string; unit: string; invoiceQty: number; receivedQty: number; billedElsewhere: number; difference: number }[];
  total: number;
};

/** Every non-void bill whose quantities disagree with its receipt — over (flagged) or short (partial), with what was noted. */
export async function getInvoiceDiscrepancies(range: Range, companyIds: string[]) {
  const bills = await prisma.supplierBill.findMany({
    where: { companyId: { in: companyIds }, status: { not: "Void" }, goodsReceiptId: { not: null }, matchStatus: { in: ["Over", "Partial"] }, billDate: { gte: range.from, lte: range.to } },
    include: {
      company: { select: { companyName: true } },
      supplier: { select: { name: true } },
      goodsReceipt: { select: { id: true, grnNumber: true, receivedDate: true, lines: { select: { id: true, acceptedQty: true, unit: true, product: { select: { name: true } } } } } },
      lines: { select: { grnLineId: true, qty: true, unit: true, product: { select: { name: true } } } },
    },
    orderBy: [{ billDate: "desc" }],
  });
  const rows: DiscrepancyRow[] = [];
  for (const b of bills) {
    const grn = b.goodsReceipt!;
    // what earlier live bills had already covered on the same receipt when this one was entered
    const others = await prisma.supplierBillLine.findMany({
      where: { bill: { goodsReceiptId: grn.id, status: { in: LIVE_BILL_STATUSES }, id: { not: b.id }, createdAt: { lt: b.createdAt } }, grnLineId: { not: null } },
      select: { grnLineId: true, qty: true },
    });
    const elsewhere = new Map<string, number>();
    for (const l of others) elsewhere.set(l.grnLineId!, (elsewhere.get(l.grnLineId!) ?? 0) + l.qty);
    const lines = grn.lines.map((g) => {
      const invoiceQty = b.lines.filter((l) => l.grnLineId === g.id).reduce((s, l) => s + l.qty, 0);
      const billedElsewhere = elsewhere.get(g.id) ?? 0;
      return { product: g.product.name, unit: g.unit, invoiceQty, receivedQty: g.acceptedQty, billedElsewhere, difference: invoiceQty - (g.acceptedQty - billedElsewhere) };
    }).filter((l) => l.difference !== 0);
    rows.push({
      billId: b.id, billNo: b.billNo, status: b.status, matchStatus: b.matchStatus, billDate: b.billDate, company: b.company.companyName,
      supplier: b.supplier.name, supplierInvoiceNo: b.supplierInvoiceNo, grnId: grn.id, grnNumber: grn.grnNumber, receivedDate: grn.receivedDate,
      discrepancyNote: b.discrepancyNote, overrideReason: b.overrideReason, lines, total: b.total,
    });
  }
  return { rows, over: rows.filter((r) => r.matchStatus === "Over").length, partial: rows.filter((r) => r.matchStatus === "Partial").length };
}

/* ------------------------------------------------------------------ PO vs receiving vs invoice */

export type ThreeWayRow = {
  poId: string; poNumber: string; poDate: Date; poStatus: string; company: string; supplier: string;
  productId: string; sku: string; product: string; unit: string;
  orderedQty: number; orderedCost: number; orderedValue: number;
  receivedQty: number; receivedValue: number; receipts: string[];
  billedQty: number; billedValue: number; billedLanded: number; bills: string[];
  qtyVariance: number; costVariance: number; status: "Not received" | "Partly received" | "Received, unbilled" | "Partly billed" | "Billed" | "Over-billed";
};

/** Every purchase order line in the period against what was received and what was invoiced. */
export async function getThreeWayMatch(range: Range, companyIds: string[], f: { supplierId?: string; onlyOpen?: boolean } = {}) {
  const pos = await prisma.purchaseOrder.findMany({
    where: { companyId: { in: companyIds }, status: { notIn: ["Draft", "Cancelled"] }, date: { gte: range.from, lte: range.to }, ...(f.supplierId ? { supplierId: f.supplierId } : {}) },
    include: {
      company: { select: { companyName: true } },
      supplier: { select: { name: true } },
      lines: {
        include: {
          product: { select: { id: true, sku: true, name: true } },
          grnLines: { where: { goodsReceipt: { status: "Posted" } }, select: { acceptedQty: true, unitCost: true, goodsReceipt: { select: { grnNumber: true } } } },
        },
      },
      bills: { where: { status: { in: LIVE_BILL_STATUSES } }, select: { billNo: true, lines: { select: { poLineId: true, qty: true, amount: true, inventoryCost: true } } } },
    },
    orderBy: [{ date: "desc" }],
  });
  const rows: ThreeWayRow[] = [];
  for (const po of pos) {
    for (const l of po.lines) {
      const receivedQty = l.grnLines.reduce((s, g) => s + g.acceptedQty, 0);
      const receivedValue = round2(l.grnLines.reduce((s, g) => s + g.acceptedQty * g.unitCost, 0));
      const billLines = po.bills.flatMap((b) => b.lines.filter((x) => x.poLineId === l.id).map((x) => ({ ...x, billNo: b.billNo })));
      const billedQty = billLines.reduce((s, x) => s + x.qty, 0);
      const billedValue = round2(billLines.reduce((s, x) => s + x.amount, 0));
      const billedLanded = round2(billLines.reduce((s, x) => s + x.inventoryCost, 0));
      const status: ThreeWayRow["status"] =
        receivedQty === 0 ? "Not received"
        : billedQty > receivedQty ? "Over-billed"
        : billedQty === 0 ? (receivedQty < l.qty ? "Partly received" : "Received, unbilled")
        : billedQty < receivedQty ? "Partly billed"
        : "Billed";
      if (f.onlyOpen && status === "Billed") continue;
      rows.push({
        poId: po.id, poNumber: po.poNumber, poDate: po.date, poStatus: po.status, company: po.company.companyName, supplier: po.supplier.name,
        productId: l.product.id, sku: l.product.sku, product: l.product.name, unit: l.unit,
        orderedQty: l.qty, orderedCost: l.unitCost, orderedValue: round2(l.qty * l.unitCost),
        receivedQty, receivedValue, receipts: [...new Set(l.grnLines.map((g) => g.goodsReceipt.grnNumber))],
        billedQty, billedValue, billedLanded, bills: [...new Set(billLines.map((x) => x.billNo))],
        qtyVariance: billedQty - receivedQty,
        costVariance: round2(billedValue - round2(billedQty * l.unitCost)),
        status,
      });
    }
  }
  const totals = rows.reduce(
    (t, r) => ({ ordered: round2(t.ordered + r.orderedValue), received: round2(t.received + r.receivedValue), billed: round2(t.billed + r.billedValue), landed: round2(t.landed + r.billedLanded) }),
    { ordered: 0, received: 0, billed: 0, landed: 0 }
  );
  return { rows, totals };
}

/* ------------------------------------------------------------------ supplier price history */

export type PriceEvent = { date: Date; kind: "PO" | "Receipt" | "Bill"; ref: string; qty: number; unit: string; costPerPcs: number; landedPerPcs: number | null };
export type PriceRow = {
  supplierId: string; supplier: string; productId: string; sku: string; product: string; packSize: string; company: string;
  events: PriceEvent[]; first: number; last: number; lowest: number; highest: number; lastDate: Date; changePct: number | null;
};

/** What each supplier has charged for each product, per piece, over the period — order, receipt and invoice prices. */
export async function getSupplierPriceHistory(range: Range, companyIds: string[], f: { supplierId?: string; productId?: string } = {}) {
  const [poLines, grnLines, billLines] = await Promise.all([
    prisma.pOLine.findMany({
      where: { purchaseOrder: { companyId: { in: companyIds }, status: { notIn: ["Draft", "Cancelled"] }, date: { gte: range.from, lte: range.to }, ...(f.supplierId ? { supplierId: f.supplierId } : {}) }, ...(f.productId ? { productId: f.productId } : {}) },
      select: { qty: true, baseQty: true, unit: true, unitCost: true, product: { select: { id: true, sku: true, name: true, packSize: true, company: { select: { companyName: true } } } }, purchaseOrder: { select: { poNumber: true, date: true, supplier: { select: { id: true, name: true } } } } },
    }),
    prisma.gRNLine.findMany({
      where: { acceptedQty: { gt: 0 }, goodsReceipt: { companyId: { in: companyIds }, status: "Posted", receivedDate: { gte: range.from, lte: range.to }, ...(f.supplierId ? { purchaseOrder: { supplierId: f.supplierId } } : {}) }, ...(f.productId ? { productId: f.productId } : {}) },
      select: { acceptedQty: true, acceptedBaseQty: true, unit: true, unitCost: true, product: { select: { id: true, sku: true, name: true, packSize: true, company: { select: { companyName: true } } } }, goodsReceipt: { select: { grnNumber: true, receivedDate: true, purchaseOrder: { select: { supplier: { select: { id: true, name: true } } } } } } },
    }),
    prisma.supplierBillLine.findMany({
      where: { bill: { companyId: { in: companyIds }, status: { in: LIVE_BILL_STATUSES }, billDate: { gte: range.from, lte: range.to }, ...(f.supplierId ? { supplierId: f.supplierId } : {}) }, ...(f.productId ? { productId: f.productId } : {}) },
      select: { qty: true, baseQty: true, unit: true, amount: true, inventoryCost: true, product: { select: { id: true, sku: true, name: true, packSize: true, company: { select: { companyName: true } } } }, bill: { select: { billNo: true, billDate: true, supplier: { select: { id: true, name: true } } } } },
    }),
  ]);
  const map = new Map<string, PriceRow>();
  const key = (s: { id: string }, p: { id: string }) => `${s.id}:${p.id}`;
  const start = (s: { id: string; name: string }, p: { id: string; sku: string; name: string; packSize: string; company: { companyName: string } }): PriceRow => ({
    supplierId: s.id, supplier: s.name, productId: p.id, sku: p.sku, product: p.name, packSize: p.packSize, company: p.company.companyName,
    events: [], first: 0, last: 0, lowest: 0, highest: 0, lastDate: new Date(0), changePct: null,
  });
  for (const l of poLines) {
    const s = l.purchaseOrder.supplier; const r = map.get(key(s, l.product)) ?? start(s, l.product);
    if (l.baseQty > 0) r.events.push({ date: l.purchaseOrder.date, kind: "PO", ref: l.purchaseOrder.poNumber, qty: l.qty, unit: l.unit, costPerPcs: (l.unitCost * l.qty) / l.baseQty, landedPerPcs: null });
    map.set(key(s, l.product), r);
  }
  for (const l of grnLines) {
    const s = l.goodsReceipt.purchaseOrder.supplier; const r = map.get(key(s, l.product)) ?? start(s, l.product);
    if (l.acceptedBaseQty > 0) r.events.push({ date: l.goodsReceipt.receivedDate, kind: "Receipt", ref: l.goodsReceipt.grnNumber, qty: l.acceptedQty, unit: l.unit, costPerPcs: (l.unitCost * l.acceptedQty) / l.acceptedBaseQty, landedPerPcs: null });
    map.set(key(s, l.product), r);
  }
  for (const l of billLines) {
    const s = l.bill.supplier; const r = map.get(key(s, l.product)) ?? start(s, l.product);
    if (l.baseQty > 0) r.events.push({ date: l.bill.billDate, kind: "Bill", ref: l.bill.billNo, qty: l.qty, unit: l.unit, costPerPcs: l.amount / l.baseQty, landedPerPcs: l.inventoryCost / l.baseQty });
    map.set(key(s, l.product), r);
  }
  const rows = [...map.values()].map((r) => {
    r.events.sort((a, b) => a.date.getTime() - b.date.getTime());
    // the invoiced price is the truth where there is one; otherwise the receipt, otherwise the order
    const priced = r.events.filter((e) => e.kind === "Bill").length ? r.events.filter((e) => e.kind === "Bill") : r.events.filter((e) => e.kind === "Receipt").length ? r.events.filter((e) => e.kind === "Receipt") : r.events;
    const costs = priced.map((e) => e.costPerPcs);
    r.first = costs[0] ?? 0; r.last = costs[costs.length - 1] ?? 0; r.lowest = costs.length ? Math.min(...costs) : 0; r.highest = costs.length ? Math.max(...costs) : 0;
    r.lastDate = priced[priced.length - 1]?.date ?? new Date(0);
    r.changePct = r.first > 0 && costs.length > 1 ? round2(((r.last - r.first) / r.first) * 100) : null;
    return r;
  }).sort((a, b) => a.product.localeCompare(b.product) || a.supplier.localeCompare(b.supplier));
  return { rows };
}
