"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite, requireStaffWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { nextDocNumber } from "@/lib/numbering";
import { parseEffectiveDate, recomputeStockChain } from "@/lib/stock";
import { notifyRole } from "@/lib/notify";
import { logAudit } from "@/lib/salespeople";

// Draft is the only editable state; Posted and Void are terminal. A "use server" file may
// only export async functions, so this stays module-private.
const EDITABLE = ["Draft"];

const money = (n: number) => Math.round(n * 100) / 100;

/** Ordered / already accepted / still outstanding for one PO, in the line's own unit. */
export async function poProgress(purchaseOrderId: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: purchaseOrderId },
    include: {
      supplier: true,
      company: { select: { companyName: true } },
      lines: { include: { product: true } },
    },
  });
  return {
    po,
    lines: po.lines.map((l) => ({
      line: l,
      ordered: l.qty,
      received: l.receivedQty,
      remaining: Math.max(0, l.qty - l.receivedQty),
    })),
  };
}

/** Start a receipt against a purchase order. Creates a Draft only — nothing touches stock. */
export async function createGRN(formData: FormData) {
  const user = await requirePermWrite("purchaseOrders");
  const company = await getActiveCompany(user);
  const poId = String(formData.get("poId"));

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    include: { lines: true },
  });
  // a receipt must belong to the same company as its purchase order
  if (!po || po.companyId !== company.id) redirect("/receiving?error=po");
  if (["Draft", "Cancelled"].includes(po.status)) redirect(`/purchase-orders/${poId}?error=notopen`);

  const deliveryRefNo = String(formData.get("deliveryRefNo") || "").trim() || null;
  // the same supplier delivery must not be received twice
  if (deliveryRefNo) {
    const dupe = await prisma.goodsReceipt.findFirst({
      where: {
        companyId: company.id,
        deliveryRefNo,
        status: { not: "Void" },
        purchaseOrder: { supplierId: po.supplierId },
      },
      select: { grnNumber: true },
    });
    if (dupe) redirect(`/receiving/new?po=${poId}&error=duplicate&ref=${encodeURIComponent(dupe.grnNumber)}`);
  }

  const grnNumber = await nextDocNumber("GRN", company.id);
  const grn = await prisma.goodsReceipt.create({
    data: {
      companyId: company.id,
      grnNumber,
      purchaseOrderId: poId,
      status: "Draft",
      receivedDate: parseEffectiveDate(String(formData.get("receivedDate") || "")),
      warehouse: String(formData.get("warehouse") || "").trim() || null,
      deliveryRefNo,
      supplierInvoiceNo: String(formData.get("supplierInvoiceNo") || "").trim() || null,
      remarks: String(formData.get("remarks") || "").trim() || null,
      createdById: user.id,
      // every outstanding line starts at zero; the user fills in what actually arrived
      lines: {
        create: po.lines
          .filter((l) => l.qty - l.receivedQty > 0)
          .map((l) => ({
            poLineId: l.id,
            productId: l.productId,
            qty: 0,
            unit: l.unit,
            baseQty: 0,
            acceptedQty: 0,
            acceptedBaseQty: 0,
            rejectedQty: 0,
            unitCost: l.unitCost,
            poUnitCost: l.unitCost,
          })),
      },
    },
  });
  await logAudit({
    entity: "GoodsReceipt",
    entityId: grn.id,
    action: "CREATED",
    detail: `${grnNumber} raised against ${po.poNumber}`,
    actorName: user.name,
    actorEmail: user.email,
  });
  redirect(`/receiving/${grn.id}`);
}

/** Save the quantities, costs and batch details on a Draft. Still no stock movement. */
export async function saveGRNLines(formData: FormData) {
  const user = await requirePermWrite("purchaseOrders");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));

  const grn = await prisma.goodsReceipt.findUnique({
    where: { id },
    include: { lines: { include: { poLine: true, product: true } }, purchaseOrder: true },
  });
  if (!grn || grn.companyId !== company.id) redirect("/receiving");
  if (!EDITABLE.includes(grn.status)) redirect(`/receiving/${id}?error=locked`);

  const canOverride = ["SUPER_ADMIN", "ADMIN"].includes(user.role);
  const overrides: string[] = [];

  for (const line of grn.lines) {
    const recv = Math.max(0, Math.floor(Number(formData.get(`qty_${line.id}`)) || 0));
    const rejected = Math.max(0, Math.min(recv, Math.floor(Number(formData.get(`rej_${line.id}`)) || 0)));
    const accepted = recv - rejected;
    const cost = money(Math.max(0, Number(formData.get(`cost_${line.id}`)) || 0));

    // outstanding on the PO excludes what THIS receipt already counted
    const remaining = Math.max(0, line.poLine.qty - line.poLine.receivedQty);
    if (accepted > remaining) {
      if (!canOverride) redirect(`/receiving/${id}?error=exceeds`);
      overrides.push(`${line.product.name}: accepted ${accepted} over the remaining ${remaining}`);
    }
    if (cost > 0 && Math.abs(cost - line.poUnitCost) > 0.004) {
      if (!canOverride) redirect(`/receiving/${id}?error=cost`);
      overrides.push(`${line.product.name}: cost ${line.poUnitCost.toFixed(2)} → ${cost.toFixed(2)}`);
    }

    // the PO line's own conversion keeps carton→piece maths identical to the order
    const factor = line.poLine.qty > 0 ? line.poLine.baseQty / line.poLine.qty : 1;
    await prisma.gRNLine.update({
      where: { id: line.id },
      data: {
        qty: recv,
        baseQty: Math.round(recv * factor),
        acceptedQty: accepted,
        acceptedBaseQty: Math.round(accepted * factor),
        rejectedQty: rejected,
        rejectReason: String(formData.get(`rr_${line.id}`) || "").trim() || null,
        unitCost: cost > 0 ? cost : line.poUnitCost,
        batchNo: String(formData.get(`batch_${line.id}`) || "").trim() || null,
        expDate: (() => {
          const raw = String(formData.get(`exp_${line.id}`) || "").trim();
          return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00.000Z`) : null;
        })(),
      },
    });
  }

  await prisma.goodsReceipt.update({
    where: { id },
    data: {
      receivedDate: parseEffectiveDate(String(formData.get("receivedDate") || "")),
      warehouse: String(formData.get("warehouse") || "").trim() || null,
      deliveryRefNo: String(formData.get("deliveryRefNo") || "").trim() || null,
      supplierInvoiceNo: String(formData.get("supplierInvoiceNo") || "").trim() || null,
      remarks: String(formData.get("remarks") || "").trim() || null,
      overrideReason: overrides.length ? overrides.join("; ") : null,
    },
  });
  await logAudit({
    entity: "GoodsReceipt",
    entityId: id,
    action: overrides.length ? "EDITED_WITH_OVERRIDE" : "EDITED",
    detail: overrides.length ? `${grn.grnNumber} — ${overrides.join("; ")}` : `${grn.grnNumber} lines saved`,
    actorName: user.name,
    actorEmail: user.email,
  });
  revalidatePath(`/receiving/${id}`);
  redirect(`/receiving/${id}?saved=ok`);
}

/** Move along the workflow. Posting is handled separately — it is the one that moves stock. */
export async function setGRNStatus(formData: FormData) {
  const user = await requirePermWrite("purchaseOrders");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const next = String(formData.get("status"));

  const grn = await prisma.goodsReceipt.findUnique({ where: { id }, include: { lines: true } });
  if (!grn || grn.companyId !== company.id) redirect("/receiving");
  if (["Posted", "Void"].includes(grn.status)) redirect(`/receiving/${id}?error=locked`);
  if (!["Pending Inspection", "Received", "Rejected", "Draft"].includes(next)) redirect(`/receiving/${id}`);
  if (next === "Received" && !grn.lines.some((l) => l.qty > 0)) redirect(`/receiving/${id}?error=empty`);

  await prisma.goodsReceipt.update({ where: { id }, data: { status: next } });
  await logAudit({
    entity: "GoodsReceipt",
    entityId: id,
    action: "STATUS_CHANGED",
    detail: `${grn.grnNumber}: ${grn.status} → ${next}`,
    actorName: user.name,
    actorEmail: user.email,
  });
  revalidatePath(`/receiving/${id}`);
  redirect(`/receiving/${id}`);
}

/**
 * Post the receipt: the only step that touches inventory.
 *
 * Accepted quantities are added to stock at weighted average cost, a stock-card entry is
 * written against the PO and this GRN, and the PO line's received figure moves on.
 * Rejected quantities are recorded but never added to stock.
 */
export async function postGRN(formData: FormData) {
  const user = await requireStaffWrite(["SUPER_ADMIN", "ADMIN"]);
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));

  const grn = await prisma.goodsReceipt.findUnique({
    where: { id },
    include: {
      purchaseOrder: true,
      lines: { include: { product: true, poLine: true } },
    },
  });
  if (!grn || grn.companyId !== company.id) redirect("/receiving");
  if (grn.status !== "Received") redirect(`/receiving/${id}?error=notready`);
  if (!grn.lines.some((l) => l.acceptedQty > 0)) redirect(`/receiving/${id}?error=nothing`);

  const backdated = grn.receivedDate.getTime() < Date.now() - 60 * 1000;

  for (const line of grn.lines) {
    if (line.acceptedBaseQty <= 0) continue;
    const product = line.product;
    const basePcs = line.acceptedBaseQty;
    const newStock = product.stockQty + basePcs;

    // Weighted average cost at full precision — the actual receiving cost, not the PO's
    const factor = line.poLine.qty > 0 ? line.poLine.baseQty / line.poLine.qty : 1;
    const receivedCostPerPcs = line.unitCost / factor;
    const oldQty = Math.max(0, product.stockQty);
    const newAvgCost =
      oldQty > 0
        ? (oldQty * product.unitCost + basePcs * receivedCostPerPcs) / (oldQty + basePcs)
        : receivedCostPerPcs;

    await prisma.$transaction(async (tx) => {
      await tx.pOLine.update({
        where: { id: line.poLineId },
        data: { receivedQty: line.poLine.receivedQty + line.acceptedQty },
      });
      await tx.product.update({
        where: { id: line.productId },
        data: { stockQty: newStock, unitCost: newAvgCost },
      });
      await tx.stockMovement.create({
        data: {
          productId: line.productId,
          type: "IN",
          qty: basePcs,
          balanceAfter: newStock,
          enteredQty: line.acceptedQty,
          enteredUnit: line.unit,
          refType: "PO",
          // the movement names both documents, so the stock card traces back to either
          refNo: `${grn.purchaseOrder.poNumber} / ${grn.grnNumber}`,
          supplierRef: grn.deliveryRefNo,
          date: grn.receivedDate,
          userId: user.id,
        },
      });
      // a backdated receipt slots into stock-card history — rebuild every later balance
      if (backdated) await recomputeStockChain(tx, line.productId);
    });
  }

  await prisma.goodsReceipt.update({
    where: { id },
    data: { status: "Posted", postedAt: new Date(), postedById: user.id },
  });

  // PO status follows what has actually been accepted
  const po = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: grn.purchaseOrderId },
    include: { lines: true },
  });
  const fully = po.lines.every((l) => l.receivedQty >= l.qty);
  const any = po.lines.some((l) => l.receivedQty > 0);
  if (po.status !== "Closed") {
    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { status: fully ? "Received" : any ? "Partially Received" : po.status },
    });
  }

  const accepted = grn.lines.reduce((s, l) => s + l.acceptedQty, 0);
  const rejected = grn.lines.reduce((s, l) => s + l.rejectedQty, 0);
  await logAudit({
    entity: "GoodsReceipt",
    entityId: id,
    action: "POSTED",
    detail: `${grn.grnNumber} posted to inventory — ${accepted} accepted${rejected ? `, ${rejected} rejected (not stocked)` : ""}; ${po.poNumber} is now ${fully ? "Received" : "Partially Received"}`,
    actorName: user.name,
    actorEmail: user.email,
  });
  if (fully) {
    await notifyRole("ADMIN", "PO_RECEIVED", `${po.poNumber} fully received`, `/purchase-orders/${po.id}`, po.companyId);
  }
  revalidatePath(`/receiving/${id}`);
  revalidatePath(`/purchase-orders/${po.id}`);
  redirect(`/receiving/${id}?posted=ok`);
}

/** Void a receipt. A posted one cannot be voided — reverse it with a stock adjustment. */
export async function voidGRN(formData: FormData) {
  const user = await requireStaffWrite(["SUPER_ADMIN", "ADMIN"]);
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const reason = String(formData.get("voidReason") || "").trim();

  const grn = await prisma.goodsReceipt.findUnique({ where: { id } });
  if (!grn || grn.companyId !== company.id) redirect("/receiving");
  if (grn.status === "Posted") redirect(`/receiving/${id}?error=posted`);
  if (!reason) redirect(`/receiving/${id}?error=reason`);

  await prisma.goodsReceipt.update({ where: { id }, data: { status: "Void", voidReason: reason } });
  await logAudit({
    entity: "GoodsReceipt",
    entityId: id,
    action: "VOIDED",
    detail: `${grn.grnNumber} voided — ${reason}`,
    actorName: user.name,
    actorEmail: user.email,
  });
  revalidatePath(`/receiving/${id}`);
  redirect(`/receiving/${id}`);
}

/** Close a purchase order: no further receiving, even if quantities are outstanding. */
export async function closePO(formData: FormData) {
  const user = await requireStaffWrite(["SUPER_ADMIN", "ADMIN"]);
  const company = await getActiveCompany(user);
  const poId = String(formData.get("poId"));
  const po = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
  if (!po || po.companyId !== company.id) redirect("/purchase-orders");
  if (["Cancelled", "Closed"].includes(po.status)) redirect(`/purchase-orders/${poId}`);

  await prisma.purchaseOrder.update({ where: { id: poId }, data: { status: "Closed" } });
  await logAudit({
    entity: "PurchaseOrder",
    entityId: poId,
    action: "CLOSED",
    detail: `${po.poNumber} closed from ${po.status}`,
    actorName: user.name,
    actorEmail: user.email,
  });
  revalidatePath(`/purchase-orders/${poId}`);
  redirect(`/purchase-orders/${poId}`);
}
