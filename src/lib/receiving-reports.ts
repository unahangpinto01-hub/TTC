import { prisma } from "./db";

export type Range = { from: Date; to: Date };

/** Only these count as real receiving activity — a draft or a voided note is not a receipt. */
export const LIVE_GRN = ["Pending Inspection", "Received", "Posted"];

export type ReceivingFilters = {
  supplierId?: string;
  status?: string;
  poId?: string;
  q?: string;
};

/** Receiving Report: every goods received note in the period, with its lines. */
export async function getReceivingReport(range: Range, companyIds: string[], f: ReceivingFilters = {}) {
  const where: any = {
    companyId: { in: companyIds },
    receivedDate: { gte: range.from, lte: range.to },
  };
  if (f.status) where.status = f.status;
  if (f.poId) where.purchaseOrderId = f.poId;
  if (f.supplierId) where.purchaseOrder = { supplierId: f.supplierId };
  if (f.q) {
    where.OR = [
      { grnNumber: { contains: f.q, mode: "insensitive" } },
      { deliveryRefNo: { contains: f.q, mode: "insensitive" } },
      { supplierInvoiceNo: { contains: f.q, mode: "insensitive" } },
      { purchaseOrder: { poNumber: { contains: f.q, mode: "insensitive" } } },
    ];
  }

  const receipts = await prisma.goodsReceipt.findMany({
    where,
    orderBy: [{ receivedDate: "asc" }, { grnNumber: "asc" }],
    include: {
      company: { select: { companyName: true } },
      purchaseOrder: { include: { supplier: { select: { id: true, name: true } } } },
      lines: { include: { product: { select: { sku: true, name: true, packSize: true } } } },
    },
  });

  const rows = receipts.map((g) => {
    const received = g.lines.reduce((s, l) => s + l.qty, 0);
    const accepted = g.lines.reduce((s, l) => s + l.acceptedQty, 0);
    const rejected = g.lines.reduce((s, l) => s + l.rejectedQty, 0);
    const value = g.lines.reduce((s, l) => s + l.acceptedQty * l.unitCost, 0);
    // a cost that moved away from the purchase order is worth surfacing
    const costVariance = g.lines.reduce((s, l) => s + l.acceptedQty * (l.unitCost - l.poUnitCost), 0);
    return { grn: g, received, accepted, rejected, value, costVariance };
  });

  const posted = rows.filter((r) => r.grn.status === "Posted");
  return {
    rows,
    totals: {
      receipts: rows.length,
      received: rows.reduce((s, r) => s + r.received, 0),
      accepted: rows.reduce((s, r) => s + r.accepted, 0),
      rejected: rows.reduce((s, r) => s + r.rejected, 0),
      value: rows.reduce((s, r) => s + r.value, 0),
      costVariance: rows.reduce((s, r) => s + r.costVariance, 0),
      postedValue: posted.reduce((s, r) => s + r.value, 0),
    },
  };
}

/**
 * Purchase Order Receiving Status. `outstandingOnly` narrows it to orders with quantities
 * still to come, which is the Partial Receiving Report.
 */
export async function getPOReceivingStatus(
  companyIds: string[],
  opts: { outstandingOnly?: boolean; supplierId?: string; range?: Range } = {}
) {
  const where: any = { companyId: { in: companyIds }, status: { not: "Draft" } };
  if (opts.supplierId) where.supplierId = opts.supplierId;
  if (opts.range) where.date = { gte: opts.range.from, lte: opts.range.to };

  const pos = await prisma.purchaseOrder.findMany({
    where,
    orderBy: [{ date: "desc" }, { poNumber: "desc" }],
    include: {
      company: { select: { companyName: true } },
      supplier: { select: { id: true, name: true } },
      lines: { include: { product: { select: { sku: true, name: true, packSize: true } } } },
      goodsReceipts: { select: { grnNumber: true, status: true, receivedDate: true } },
    },
  });

  const rows = pos
    .map((po) => {
      const ordered = po.lines.reduce((s, l) => s + l.qty, 0);
      const received = po.lines.reduce((s, l) => s + l.receivedQty, 0);
      const remaining = po.lines.reduce((s, l) => s + Math.max(0, l.qty - l.receivedQty), 0);
      const orderedValue = po.lines.reduce((s, l) => s + l.qty * l.unitCost, 0);
      const receivedValue = po.lines.reduce((s, l) => s + l.receivedQty * l.unitCost, 0);
      const pct = ordered > 0 ? (received / ordered) * 100 : 0;
      const live = po.goodsReceipts.filter((g) => LIVE_GRN.includes(g.status));
      return { po, ordered, received, remaining, orderedValue, receivedValue, pct, receipts: live.length };
    })
    .filter((r) => (opts.outstandingOnly ? r.remaining > 0 && !["Cancelled", "Closed"].includes(r.po.status) : true));

  return {
    rows,
    totals: {
      orders: rows.length,
      ordered: rows.reduce((s, r) => s + r.ordered, 0),
      received: rows.reduce((s, r) => s + r.received, 0),
      remaining: rows.reduce((s, r) => s + r.remaining, 0),
      orderedValue: rows.reduce((s, r) => s + r.orderedValue, 0),
      receivedValue: rows.reduce((s, r) => s + r.receivedValue, 0),
    },
  };
}

/** Supplier Receiving History: what each supplier delivered in the period, and how well. */
export async function getSupplierReceivingHistory(range: Range, companyIds: string[]) {
  const receipts = await prisma.goodsReceipt.findMany({
    where: {
      companyId: { in: companyIds },
      receivedDate: { gte: range.from, lte: range.to },
      status: { in: LIVE_GRN },
    },
    include: {
      purchaseOrder: { include: { supplier: { select: { id: true, name: true } } } },
      lines: true,
    },
  });

  const bySupplier = new Map<
    string,
    { id: string; name: string; receipts: number; received: number; accepted: number; rejected: number; value: number; costVariance: number; last: Date | null }
  >();
  for (const g of receipts) {
    const s = g.purchaseOrder.supplier;
    const cur =
      bySupplier.get(s.id) ??
      { id: s.id, name: s.name, receipts: 0, received: 0, accepted: 0, rejected: 0, value: 0, costVariance: 0, last: null as Date | null };
    cur.receipts += 1;
    for (const l of g.lines) {
      cur.received += l.qty;
      cur.accepted += l.acceptedQty;
      cur.rejected += l.rejectedQty;
      cur.value += l.acceptedQty * l.unitCost;
      cur.costVariance += l.acceptedQty * (l.unitCost - l.poUnitCost);
    }
    if (!cur.last || g.receivedDate > cur.last) cur.last = g.receivedDate;
    bySupplier.set(s.id, cur);
  }

  const rows = [...bySupplier.values()]
    .map((r) => ({ ...r, rejectRate: r.received > 0 ? (r.rejected / r.received) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  return {
    rows,
    totals: {
      suppliers: rows.length,
      receipts: rows.reduce((s, r) => s + r.receipts, 0),
      received: rows.reduce((s, r) => s + r.received, 0),
      accepted: rows.reduce((s, r) => s + r.accepted, 0),
      rejected: rows.reduce((s, r) => s + r.rejected, 0),
      value: rows.reduce((s, r) => s + r.value, 0),
      costVariance: rows.reduce((s, r) => s + r.costVariance, 0),
    },
  };
}
