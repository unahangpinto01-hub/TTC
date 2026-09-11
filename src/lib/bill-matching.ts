import { prisma } from "./db";
import { LIVE_BILL_STATUSES } from "./bills";

/**
 * Receipt ↔ bill matching.
 *
 * The receipt is the record of what physically arrived and is never changed by a bill. A
 * bill carries the supplier's OWN quantities; matching compares them with what the receipt
 * accepted, less whatever earlier bills already covered. Several bills may cover one
 * receipt (a split invoice), so the comparison is always against the remainder.
 *
 *   Matched      the bill covers exactly what was left to bill
 *   Partial      the bill covers less — the receipt stays open for another bill
 *   Over         the bill claims more than was received — posts only with an Admin's reason
 *
 * The receipt shows the picture from its side:
 *
 *   Pending      posted, no bill entered yet
 *   Entered      a draft bill exists, nothing posted
 *   Partial      posted bills cover part of the accepted quantity
 *   Billed       posted bills cover all of it
 *   Discrepancy  a bill against it is flagged Over (draft or posted)
 */

export const INVOICE_STATUSES = ["Pending", "Entered", "Partial", "Billed", "Discrepancy"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const MATCH_STATUSES = ["None", "Matched", "Partial", "Over"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

type Tx = Pick<typeof prisma, "supplierBillLine" | "supplierBill" | "goodsReceipt" | "gRNLine">;

/** Quantity (in each receipt line's own unit) already covered by LIVE bills, per receipt line. */
export async function billedByGrnLine(db: Tx, grnId: string, excludeBillId?: string): Promise<Map<string, number>> {
  const lines = await db.supplierBillLine.findMany({
    where: {
      grnLineId: { not: null },
      bill: { goodsReceiptId: grnId, status: { in: LIVE_BILL_STATUSES }, ...(excludeBillId ? { id: { not: excludeBillId } } : {}) },
    },
    select: { grnLineId: true, qty: true },
  });
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.grnLineId!, (m.get(l.grnLineId!) ?? 0) + l.qty);
  return m;
}

export type LineMatch = { grnLineId: string; accepted: number; billedElsewhere: number; remaining: number; qty: number; over: boolean };

/** How one bill's lines sit against their receipt — with the bill's own quantities excluded from "already billed". */
export async function matchBillLines(
  db: Tx,
  bill: { id: string; goodsReceiptId: string | null; lines: { grnLineId: string | null; qty: number }[] }
): Promise<{ status: MatchStatus; lines: LineMatch[]; unbilledAfter: number }> {
  if (!bill.goodsReceiptId) return { status: "None", lines: [], unbilledAfter: 0 };
  const [grnLines, billed] = await Promise.all([
    db.gRNLine.findMany({ where: { goodsReceiptId: bill.goodsReceiptId }, select: { id: true, acceptedQty: true } }),
    billedByGrnLine(db, bill.goodsReceiptId, bill.id),
  ]);
  const byId = new Map(grnLines.map((g) => [g.id, g.acceptedQty]));
  const lines: LineMatch[] = [];
  let over = false;
  for (const l of bill.lines) {
    if (!l.grnLineId || !byId.has(l.grnLineId)) continue;
    const accepted = byId.get(l.grnLineId)!;
    const billedElsewhere = billed.get(l.grnLineId) ?? 0;
    const remaining = Math.max(0, accepted - billedElsewhere);
    const isOver = l.qty > remaining;
    if (isOver) over = true;
    lines.push({ grnLineId: l.grnLineId, accepted, billedElsewhere, remaining, qty: l.qty, over: isOver });
  }
  // what the receipt would still have unbilled once this bill posts
  let unbilledAfter = 0;
  for (const g of grnLines) {
    const onThis = bill.lines.filter((l) => l.grnLineId === g.id).reduce((s, l) => s + l.qty, 0);
    unbilledAfter += Math.max(0, g.acceptedQty - (billed.get(g.id) ?? 0) - onThis);
  }
  return { status: over ? "Over" : unbilledAfter > 0 ? "Partial" : "Matched", lines, unbilledAfter };
}

/** Recompute and store the receipt's invoice status from the bills against it. */
export async function refreshInvoiceStatus(db: Tx, grnId: string): Promise<InvoiceStatus> {
  const [grn, bills] = await Promise.all([
    db.goodsReceipt.findUnique({ where: { id: grnId }, select: { status: true, billedOutside: true, lines: { select: { id: true, acceptedQty: true } } } }),
    db.supplierBill.findMany({ where: { goodsReceiptId: grnId, status: { not: "Void" } }, select: { status: true, matchStatus: true } }),
  ]);
  if (!grn) return "Pending";
  const billed = await billedByGrnLine(db, grnId);
  const accepted = grn.lines.reduce((s, l) => s + l.acceptedQty, 0);
  const covered = grn.lines.reduce((s, l) => s + Math.min(l.acceptedQty, billed.get(l.id) ?? 0), 0);
  let status: InvoiceStatus;
  if (bills.some((b) => b.matchStatus === "Over")) status = "Discrepancy";
  else if (grn.billedOutside && !bills.length) status = "Billed";
  else if (accepted > 0 && covered >= accepted) status = "Billed";
  else if (covered > 0) status = "Partial";
  else if (bills.length) status = "Entered";
  else status = "Pending";
  await db.goodsReceipt.update({ where: { id: grnId }, data: { invoiceStatus: status } });
  return status;
}

/** Unbilled quantity and value per receipt line, at the receiving cost — the "received but not yet billed" figure. */
export async function unbilledOnReceipt(db: Tx, grnId: string) {
  const [lines, billed] = await Promise.all([
    db.gRNLine.findMany({ where: { goodsReceiptId: grnId }, select: { id: true, acceptedQty: true, acceptedBaseQty: true, unitCost: true, unit: true, productId: true } }),
    billedByGrnLine(db, grnId),
  ]);
  return lines.map((l) => {
    const b = Math.min(l.acceptedQty, billed.get(l.id) ?? 0);
    const remaining = l.acceptedQty - b;
    const factor = l.acceptedQty > 0 ? l.acceptedBaseQty / l.acceptedQty : 1;
    return { ...l, billed: b, remaining, remainingPcs: Math.round(remaining * factor), remainingValue: Math.round(remaining * l.unitCost * 100) / 100 };
  });
}
