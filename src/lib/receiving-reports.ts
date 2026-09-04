import { prisma } from "./db";
import { lineCartonSize } from "./units";

/**
 * A receiving line in PCS and in cartons.
 *
 * The stored qty/acceptedQty/rejectedQty are in the line's ENTERED unit, so summing them
 * across a mixed receipt adds cartons to pieces. These convert everything to PCS first and
 * then to cartons at the line's own conversion, which also keeps an old receipt reading in
 * the packaging that applied when it was posted.
 */
function grnLineUnits(l: {
  qty: number;
  unit: string;
  baseQty: number;
  acceptedQty: number;
  acceptedBaseQty: number;
  rejectedQty: number;
  product?: { piecesPerCarton: number | null } | null;
}) {
  const factor = l.qty > 0 ? l.baseQty / l.qty : 1;
  const ppc = lineCartonSize(l, l.product ?? null);
  const receivedPcs = l.baseQty;
  const acceptedPcs = l.acceptedBaseQty;
  const rejectedPcs = Math.round(l.rejectedQty * factor);
  return {
    receivedPcs,
    acceptedPcs,
    rejectedPcs,
    receivedCtn: ppc ? receivedPcs / ppc : 0,
    acceptedCtn: ppc ? acceptedPcs / ppc : 0,
    rejectedCtn: ppc ? rejectedPcs / ppc : 0,
    hasConversion: !!ppc,
  };
}

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
      lines: { include: { product: { select: { sku: true, name: true, packSize: true, piecesPerCarton: true } } } },
    },
  });

  const rows = receipts.map((g) => {
    const received = g.lines.reduce((s, l) => s + l.qty, 0);
    const accepted = g.lines.reduce((s, l) => s + l.acceptedQty, 0);
    const rejected = g.lines.reduce((s, l) => s + l.rejectedQty, 0);
    const value = g.lines.reduce((s, l) => s + l.acceptedQty * l.unitCost, 0);
    // a cost that moved away from the purchase order is worth surfacing
    const costVariance = g.lines.reduce((s, l) => s + l.acceptedQty * (l.unitCost - l.poUnitCost), 0);
    const u = g.lines.map(grnLineUnits);
    const sum = (pick: (x: (typeof u)[number]) => number) => u.reduce((s, x) => s + pick(x), 0);
    return {
      grn: g,
      received,
      accepted,
      rejected,
      value,
      costVariance,
      receivedPcs: sum((x) => x.receivedPcs),
      acceptedPcs: sum((x) => x.acceptedPcs),
      rejectedPcs: sum((x) => x.rejectedPcs),
      receivedCtn: sum((x) => x.receivedCtn),
      acceptedCtn: sum((x) => x.acceptedCtn),
      rejectedCtn: sum((x) => x.rejectedCtn),
      noConversion: u.some((x) => !x.hasConversion),
    };
  });

  const posted = rows.filter((r) => r.grn.status === "Posted");
  return {
    rows,
    totals: {
      receipts: rows.length,
      received: rows.reduce((s, r) => s + r.received, 0),
      accepted: rows.reduce((s, r) => s + r.accepted, 0),
      rejected: rows.reduce((s, r) => s + r.rejected, 0),
      receivedPcs: rows.reduce((s, r) => s + r.receivedPcs, 0),
      acceptedPcs: rows.reduce((s, r) => s + r.acceptedPcs, 0),
      rejectedPcs: rows.reduce((s, r) => s + r.rejectedPcs, 0),
      receivedCtn: rows.reduce((s, r) => s + r.receivedCtn, 0),
      acceptedCtn: rows.reduce((s, r) => s + r.acceptedCtn, 0),
      rejectedCtn: rows.reduce((s, r) => s + r.rejectedCtn, 0),
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
      lines: { include: { product: { select: { sku: true, name: true, packSize: true, piecesPerCarton: true } } } },
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
      const live = po.goodsReceipts.filter((g) => LIVE_GRN.includes(g.status));
      // ordered/received/remaining above are in each line's entered unit; these are the
      // unambiguous PCS figures and their carton equivalents
      let orderedPcs = 0, receivedPcs = 0, remainingPcs = 0;
      let orderedCtn = 0, receivedCtn = 0, remainingCtn = 0, noConversion = false;
      for (const l of po.lines) {
        const factor = l.qty > 0 ? l.baseQty / l.qty : 1;
        const rec = Math.round(l.receivedQty * factor);
        const rem = Math.max(0, l.baseQty - rec);
        orderedPcs += l.baseQty;
        receivedPcs += rec;
        remainingPcs += rem;
        const ppc = lineCartonSize(l, l.product);
        if (ppc) {
          orderedCtn += l.baseQty / ppc;
          receivedCtn += rec / ppc;
          remainingCtn += rem / ppc;
        } else noConversion = true;
      }
      return {
        po, ordered, received, remaining, orderedValue, receivedValue, receipts: live.length,
        // measured on PCS: an order mixing carton and piece lines cannot be judged by
        // adding the two together
        pct: orderedPcs > 0 ? (receivedPcs / orderedPcs) * 100 : 0,
        orderedPcs, receivedPcs, remainingPcs, orderedCtn, receivedCtn, remainingCtn, noConversion,
      };
    })
    .filter((r) => (opts.outstandingOnly ? r.remaining > 0 && !["Cancelled", "Closed"].includes(r.po.status) : true));

  return {
    rows,
    totals: {
      orders: rows.length,
      ordered: rows.reduce((s, r) => s + r.ordered, 0),
      received: rows.reduce((s, r) => s + r.received, 0),
      remaining: rows.reduce((s, r) => s + r.remaining, 0),
      orderedPcs: rows.reduce((s, r) => s + r.orderedPcs, 0),
      receivedPcs: rows.reduce((s, r) => s + r.receivedPcs, 0),
      remainingPcs: rows.reduce((s, r) => s + r.remainingPcs, 0),
      orderedCtn: rows.reduce((s, r) => s + r.orderedCtn, 0),
      receivedCtn: rows.reduce((s, r) => s + r.receivedCtn, 0),
      remainingCtn: rows.reduce((s, r) => s + r.remainingCtn, 0),
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
      lines: { include: { product: { select: { piecesPerCarton: true } } } },
    },
  });

  const bySupplier = new Map<
    string,
    {
      id: string; name: string; receipts: number; received: number; accepted: number; rejected: number;
      value: number; costVariance: number; last: Date | null;
      receivedPcs: number; acceptedPcs: number; rejectedPcs: number;
      receivedCtn: number; acceptedCtn: number; rejectedCtn: number; noConversion: boolean;
    }
  >();
  for (const g of receipts) {
    const s = g.purchaseOrder.supplier;
    const cur =
      bySupplier.get(s.id) ??
      {
        id: s.id, name: s.name, receipts: 0, received: 0, accepted: 0, rejected: 0, value: 0, costVariance: 0,
        last: null as Date | null,
        receivedPcs: 0, acceptedPcs: 0, rejectedPcs: 0, receivedCtn: 0, acceptedCtn: 0, rejectedCtn: 0, noConversion: false,
      };
    cur.receipts += 1;
    for (const l of g.lines) {
      cur.received += l.qty;
      cur.accepted += l.acceptedQty;
      cur.rejected += l.rejectedQty;
      cur.value += l.acceptedQty * l.unitCost;
      cur.costVariance += l.acceptedQty * (l.unitCost - l.poUnitCost);
      const u = grnLineUnits(l);
      cur.receivedPcs += u.receivedPcs;
      cur.acceptedPcs += u.acceptedPcs;
      cur.rejectedPcs += u.rejectedPcs;
      cur.receivedCtn += u.receivedCtn;
      cur.acceptedCtn += u.acceptedCtn;
      cur.rejectedCtn += u.rejectedCtn;
      if (!u.hasConversion) cur.noConversion = true;
    }
    if (!cur.last || g.receivedDate > cur.last) cur.last = g.receivedDate;
    bySupplier.set(s.id, cur);
  }

  const rows = [...bySupplier.values()]
    // reject rate on PCS, so a mixed carton/piece receipt does not skew it
    .map((r) => ({ ...r, rejectRate: r.receivedPcs > 0 ? (r.rejectedPcs / r.receivedPcs) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  return {
    rows,
    totals: {
      suppliers: rows.length,
      receipts: rows.reduce((s, r) => s + r.receipts, 0),
      received: rows.reduce((s, r) => s + r.received, 0),
      accepted: rows.reduce((s, r) => s + r.accepted, 0),
      rejected: rows.reduce((s, r) => s + r.rejected, 0),
      receivedPcs: rows.reduce((s, r) => s + r.receivedPcs, 0),
      acceptedPcs: rows.reduce((s, r) => s + r.acceptedPcs, 0),
      rejectedPcs: rows.reduce((s, r) => s + r.rejectedPcs, 0),
      receivedCtn: rows.reduce((s, r) => s + r.receivedCtn, 0),
      acceptedCtn: rows.reduce((s, r) => s + r.acceptedCtn, 0),
      rejectedCtn: rows.reduce((s, r) => s + r.rejectedCtn, 0),
      value: rows.reduce((s, r) => s + r.value, 0),
      costVariance: rows.reduce((s, r) => s + r.costVariance, 0),
    },
  };
}
