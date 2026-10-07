import { prisma } from "./db";
import { nextDocNumber } from "./numbering";
import { logAudit } from "./salespeople";
import { recomputeStockChain } from "./stock";
import { UnitError } from "./units";

/**
 * Stock conditions. GOOD stock is Product.stockQty — what receipts add, deliveries take and
 * the stock card shows. Beside it a product may hold OBSOLETE stock, stock waiting FOR
 * RELABELLING, or stock AT THE SUPPLIER for reformulation: each a bucket with its own quantity
 * and cost basis, because obsolete stock stays at the cost it was bought at. The books keep the
 * same split — 131000–135000 good stock by category, 131100 obsolete, 137000 others — so each
 * condition maps to its ledger account, and a reclassification between conditions is the entry
 * the bookkeeper makes by hand today. Buckets never feed a delivery; only a reclassification
 * moves stock in or out of them.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export const CONDITIONS = {
  GOOD: "Good stock",
  OBSOLETE: "Obsolete",
  RELABEL: "For relabelling",
  AT_SUPPLIER: "At supplier for reformulation",
} as const;
export type Condition = keyof typeof CONDITIONS;
export const BUCKETS = ["OBSOLETE", "RELABEL", "AT_SUPPLIER"] as const;
export type Bucket = (typeof BUCKETS)[number];
export const isBucket = (c: string): c is Bucket => (BUCKETS as readonly string[]).includes(c);
export const isCondition = (c: string): c is Condition => c in CONDITIONS;

/** Chart of Accounts codes the books use for each kind of stock. */
export const CATEGORY_GL: Record<string, string> = {
  Herbicide: "131000", Insecticide: "132000", Molluscicide: "133000", Fungicide: "134000", "Foliar Fertilizer": "135000", Labels: "136000", Others: "137000",
};
export const CONDITION_GL: Record<Bucket, string> = { OBSOLETE: "131100", RELABEL: "137000", AT_SUPPLIER: "137000" };

export function glCodeFor(condition: Condition, product: { category: string; itemClass: string }): string {
  if (condition !== "GOOD") return CONDITION_GL[condition];
  if (product.itemClass === "NON_INVENTORY") return product.category === "Labels" ? "136000" : "137000";
  return CATEGORY_GL[product.category] ?? "137000";
}

export type ReclassInput = {
  companyId: string;
  productId: string;
  date: Date;
  from: Condition | "OPENING";
  to: Condition;
  qty: number;
  reason: string;
  remarks?: string | null;
  /** cost per piece for an OPENING load; otherwise the cost comes from where the stock leaves */
  unitCost?: number;
  actor: { id?: string; name: string; email: string };
  /** numbering override for scripted loads */
  rsNumber?: string;
};

/**
 * Move a quantity between conditions at cost. From GOOD: the product's unit cost, and an OUT on
 * the stock card. From a bucket: that bucket's cost basis. To a bucket: moving-average cost. To
 * GOOD: an IN on the stock card. OPENING loads a bucket without touching anything else and
 * makes no ledger entry (the balance already sits in the books).
 */
export async function reclassifyStock(input: ReclassInput) {
  const qty = Math.trunc(input.qty);
  if (!(qty > 0)) throw new Error("Quantity must be a positive number of pieces.");
  if (input.from === input.to) throw new Error("Pick two different conditions.");
  if (input.from === "OPENING" && !isBucket(input.to)) throw new Error("An opening load goes into Obsolete, For relabelling or At supplier.");
  if (!input.reason.trim()) throw new Error("A reason is required.");
  const product = await prisma.product.findUniqueOrThrow({ where: { id: input.productId }, select: { id: true, companyId: true, name: true, unitCost: true, stockQty: true, category: true, itemClass: true } });
  if (product.companyId !== input.companyId) throw new Error("That product belongs to another company.");
  const rsNumber = input.rsNumber ?? (await nextDocNumber("RS", input.companyId, input.date));

  const result = await prisma.$transaction(async (tx) => {
    // the cost basis that travels with the pieces
    let unitCost: number;
    if (input.from === "OPENING") { if (!(input.unitCost! >= 0)) throw new Error("An opening load needs a unit cost."); unitCost = input.unitCost!; }
    else if (input.from === "GOOD") { if (product.stockQty < qty) throw new UnitError("negative"); unitCost = product.unitCost; }
    else {
      const b = await tx.stockBucket.findUnique({ where: { productId_condition: { productId: product.id, condition: input.from } } });
      if (!b || b.qty < qty) throw new Error(`Only ${b?.qty ?? 0} PCS are ${CONDITIONS[input.from].toLowerCase()}.`);
      unitCost = b.unitCost;
      await tx.stockBucket.update({ where: { id: b.id }, data: { qty: b.qty - qty } });
    }
    const move = { refType: "RECLASS", refNo: rsNumber, date: input.date, userId: input.actor.id ?? null, balanceAfter: 0, enteredQty: qty, enteredUnit: "PCS" };
    if (input.from === "GOOD") { await tx.stockMovement.create({ data: { productId: product.id, type: "OUT", qty, ...move } }); await recomputeStockChain(tx, product.id); }
    if (input.to === "GOOD") { await tx.stockMovement.create({ data: { productId: product.id, type: "IN", qty, ...move } }); await recomputeStockChain(tx, product.id); }
    else {
      const b = await tx.stockBucket.findUnique({ where: { productId_condition: { productId: product.id, condition: input.to } } });
      const newQty = (b?.qty ?? 0) + qty;
      const newCost = newQty > 0 ? ((b?.qty ?? 0) * (b?.unitCost ?? 0) + qty * unitCost) / newQty : unitCost;
      await tx.stockBucket.upsert({ where: { productId_condition: { productId: product.id, condition: input.to } }, create: { productId: product.id, condition: input.to, qty: newQty, unitCost: newCost }, update: { qty: newQty, unitCost: newCost } });
    }
    const rs = await tx.stockReclass.create({
      data: { companyId: input.companyId, rsNumber, productId: product.id, date: input.date, fromCondition: input.from, toCondition: input.to, qty, unitCost, amount: round2(qty * unitCost), reason: input.reason.trim().slice(0, 200), remarks: input.remarks?.trim().slice(0, 300) || null, createdById: input.actor.id ?? null },
    });
    return rs;
  });
  await logAudit({
    entity: "StockReclass", entityId: result.id, action: "POSTED",
    detail: `${rsNumber}: ${qty} PCS of ${product.name} ${input.from === "OPENING" ? "loaded as" : `moved from ${CONDITIONS[input.from as Condition]} to`} ${CONDITIONS[input.to]} at ₱${result.unitCost.toFixed(4)} = ₱${result.amount.toFixed(2)} — ${input.reason}`,
    actorName: input.actor.name, actorEmail: input.actor.email, companyId: input.companyId,
  });
  return result;
}

/** Reverse a reclassification: the pieces go back where they came from at the same cost. */
export async function voidReclass(id: string, reason: string, actor: { id?: string; name: string; email: string }) {
  const rs = await prisma.stockReclass.findUniqueOrThrow({ where: { id }, include: { product: { select: { name: true } } } });
  if (rs.status !== "Posted") throw new Error(`Only a Posted reclassification can be voided (this one is ${rs.status}).`);
  await prisma.$transaction(async (tx) => {
    const move = { refType: "RECLASS", refNo: `${rs.rsNumber} void`, date: new Date(), userId: actor.id ?? null, balanceAfter: 0, enteredQty: rs.qty, enteredUnit: "PCS" };
    // take the pieces out of where they went
    if (rs.toCondition === "GOOD") { await tx.stockMovement.create({ data: { productId: rs.productId, type: "OUT", qty: rs.qty, ...move } }); await recomputeStockChain(tx, rs.productId); }
    else {
      const b = await tx.stockBucket.findUnique({ where: { productId_condition: { productId: rs.productId, condition: rs.toCondition } } });
      if (!b || b.qty < rs.qty) throw new Error(`Only ${b?.qty ?? 0} PCS are left in ${CONDITIONS[rs.toCondition as Condition]} — the pieces have moved on.`);
      await tx.stockBucket.update({ where: { id: b.id }, data: { qty: b.qty - rs.qty } });
    }
    // and put them back where they came from
    if (rs.fromCondition === "GOOD") { await tx.stockMovement.create({ data: { productId: rs.productId, type: "IN", qty: rs.qty, ...move } }); await recomputeStockChain(tx, rs.productId); }
    else if (rs.fromCondition !== "OPENING") {
      const b = await tx.stockBucket.findUnique({ where: { productId_condition: { productId: rs.productId, condition: rs.fromCondition } } });
      const newQty = (b?.qty ?? 0) + rs.qty;
      const newCost = ((b?.qty ?? 0) * (b?.unitCost ?? 0) + rs.qty * rs.unitCost) / newQty;
      await tx.stockBucket.upsert({ where: { productId_condition: { productId: rs.productId, condition: rs.fromCondition } }, create: { productId: rs.productId, condition: rs.fromCondition, qty: newQty, unitCost: newCost }, update: { qty: newQty, unitCost: newCost } });
    }
    await tx.stockReclass.update({ where: { id }, data: { status: "Void", voidReason: reason || "voided" } });
  });
  await logAudit({ entity: "StockReclass", entityId: id, action: "VOIDED", detail: `${rs.rsNumber} voided (${reason || "no reason given"}): ${rs.qty} PCS of ${rs.product.name} returned from ${CONDITIONS[rs.toCondition as Condition]} to ${rs.fromCondition === "OPENING" ? "nowhere (opening load removed)" : CONDITIONS[rs.fromCondition as Condition]}`, actorName: actor.name, actorEmail: actor.email, companyId: rs.companyId, reason });
}

export type BucketState = { qty: number; unitCost: number };

/**
 * Bucket quantities and cost bases as of a date, replayed from the posted reclassifications
 * (moving average into a bucket, cost basis out of it) — the same arithmetic the live
 * StockBucket rows were built with. Keyed productId → condition.
 */
export async function bucketBalancesAt(companyIds: string[], asOf: Date): Promise<Map<string, Partial<Record<Bucket, BucketState>>>> {
  const rows = await prisma.stockReclass.findMany({ where: { companyId: { in: companyIds }, status: "Posted", date: { lte: asOf } }, orderBy: [{ date: "asc" }, { createdAt: "asc" }], select: { productId: true, fromCondition: true, toCondition: true, qty: true, unitCost: true } });
  const out = new Map<string, Partial<Record<Bucket, BucketState>>>();
  const get = (pid: string) => { let m = out.get(pid); if (!m) { m = {}; out.set(pid, m); } return m; };
  for (const r of rows) {
    const m = get(r.productId);
    if (isBucket(r.fromCondition)) { const b = m[r.fromCondition] ?? { qty: 0, unitCost: 0 }; m[r.fromCondition] = { qty: b.qty - r.qty, unitCost: b.unitCost }; }
    if (isBucket(r.toCondition)) { const b = m[r.toCondition] ?? { qty: 0, unitCost: 0 }; const q = b.qty + r.qty; m[r.toCondition] = { qty: q, unitCost: q > 0 ? (b.qty * b.unitCost + r.qty * r.unitCost) / q : r.unitCost }; }
  }
  return out;
}
