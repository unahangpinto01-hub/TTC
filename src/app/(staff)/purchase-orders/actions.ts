"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { nextDocNumber } from "@/lib/numbering";
import { notifyRole } from "@/lib/notify";
import { convertToBaseUnit, parseUnit, UnitError, CARTON } from "@/lib/units";
import { getActiveCompany } from "@/lib/company";
import { recomputeStockChain, parseEffectiveDate } from "@/lib/stock";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function createPO(formData: FormData) {
  const actor = await requirePermWrite("purchaseOrders");
  const company = await getActiveCompany(actor);
  const supplierId = String(formData.get("supplierId"));
  const productIds = formData.getAll("productId").map(String);
  const qtys = formData.getAll("qty").map(Number);
  const units = formData.getAll("unit").map(parseUnit);
  const costs = formData.getAll("cost").map(Number);

  const lines = productIds
    .map((pid, i) => ({ productId: pid, qty: Math.floor(qtys[i] || 0), unit: units[i] ?? "PCS", cost: costs[i] || 0 }))
    .filter((l) => l.productId && l.qty > 0);
  if (!lines.length) redirect("/purchase-orders/new?error=empty");

  // products must belong to the active company
  const products = await prisma.product.findMany({ where: { id: { in: lines.map((l) => l.productId) }, companyId: company.id } });
  if (products.length !== new Set(lines.map((l) => l.productId)).size) redirect("/purchase-orders/new?error=empty");
  let lineData;
  try {
    lineData = lines.map((l) => {
      const product = products.find((p) => p.id === l.productId)!;
      const baseQty = convertToBaseUnit(l.qty, l.unit, product);
      // cost per entered unit: the typed override wins (supplier price changes);
      // blank = product's current cost (carton = PCS cost × pieces per carton)
      const unitCost =
        l.cost > 0 ? l.cost : l.unit === CARTON ? round2(product.unitCost * (baseQty / l.qty)) : product.unitCost;
      return { productId: l.productId, qty: l.qty, unit: l.unit, baseQty, unitCost };
    });
  } catch (e) {
    if (e instanceof UnitError) redirect("/purchase-orders/new?error=nocarton");
    throw e;
  }

  // PO date from the form (defaults to today when blank/invalid)
  const dateRaw = String(formData.get("date") || "");
  const parsed = dateRaw ? new Date(`${dateRaw}T12:00:00`) : null;
  const date = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();

  const poNumber = await nextDocNumber("PO", company.id);
  const po = await prisma.purchaseOrder.create({
    data: { companyId: company.id, poNumber, supplierId, status: "Draft", date, lines: { create: lineData } },
  });
  redirect(`/purchase-orders/${po.id}`);
}

/** Cancel a PO. Allowed only before any stock is received — received goods already moved inventory. */
export async function cancelPO(formData: FormData) {
  const user = await requirePermWrite("purchaseOrders");
  const id = String(formData.get("id"));
  const reason = String(formData.get("reason") || "").trim();
  if (!reason) redirect(`/purchase-orders/${id}?error=reason`);
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  const cancelCo = await getActiveCompany(user);
  if (po.companyId !== cancelCo.id) redirect("/denied"); // company isolation
  if (["Received", "Cancelled"].includes(po.status)) redirect(`/purchase-orders/${id}`);
  if (po.lines.some((l) => l.receivedQty > 0)) redirect(`/purchase-orders/${id}?error=received`);
  await prisma.purchaseOrder.update({
    where: { id },
    data: { status: "Cancelled", voidReason: `${reason} — by ${user.name}` },
  });
  revalidatePath(`/purchase-orders/${id}`);
  redirect(`/purchase-orders/${id}`);
}

export async function markPOSent(formData: FormData) {
  await requirePermWrite("purchaseOrders");
  const id = String(formData.get("id"));
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } });
  const sentCo = await getActiveCompany();
  if (po.companyId !== sentCo.id) redirect("/denied"); // company isolation
  if (po.status !== "Draft") redirect(`/purchase-orders/${id}`);
  await prisma.purchaseOrder.update({ where: { id }, data: { status: "Sent" } });
  revalidatePath(`/purchase-orders/${id}`);
}

/** Receive quantities against PO lines; adds IN stock movements dated on the received date. */
export async function receivePO(formData: FormData) {
  const user = await requirePermWrite("purchaseOrders");
  const poId = String(formData.get("poId"));
  const lineIds = formData.getAll("lineId").map(String);
  const recvQtys = formData.getAll("recvQty").map(Number);
  // when the stocks were physically received — backdated days land at end-of-day (createdAt keeps the entry time)
  const receivedAt = parseEffectiveDate(String(formData.get("receivedDate") || ""));
  const backdated = receivedAt.getTime() < Date.now() - 60 * 1000;

  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: { include: { product: true } } } });
  const recvCo = await getActiveCompany(user);
  if (po.companyId !== recvCo.id) redirect("/denied"); // company isolation
  if (["Cancelled", "Received"].includes(po.status)) redirect(`/purchase-orders/${poId}`);

  for (let i = 0; i < lineIds.length; i++) {
    const line = po.lines.find((l) => l.id === lineIds[i]);
    // received qty is entered in the line's unit; stock moves in base PCS via the line's factor
    const qty = Math.max(0, Math.min(Math.floor(recvQtys[i] || 0), line ? line.qty - line.receivedQty : 0));
    if (!line || qty <= 0) continue;
    const factor = line.qty > 0 ? line.baseQty / line.qty : 1;
    const basePcs = Math.round(qty * factor);
    const newStock = line.product.stockQty + basePcs;

    // Weighted average cost, full precision (rounding is display-only):
    // ((old qty × old cost) + (received qty × received cost per PCS)) ÷ total qty
    const oldQty = Math.max(0, line.product.stockQty);
    const receivedCostPerPcs = line.unitCost / factor;
    const newAvgCost =
      oldQty > 0
        ? (oldQty * line.product.unitCost + basePcs * receivedCostPerPcs) / (oldQty + basePcs)
        : receivedCostPerPcs;

    await prisma.$transaction(async (tx) => {
      await tx.pOLine.update({ where: { id: line.id }, data: { receivedQty: line.receivedQty + qty } });
      await tx.product.update({ where: { id: line.productId }, data: { stockQty: newStock, unitCost: newAvgCost } });
      await tx.stockMovement.create({
        data: {
          productId: line.productId, type: "IN", qty: basePcs, balanceAfter: newStock,
          enteredQty: qty, enteredUnit: line.unit,
          refType: "PO", refNo: po.poNumber, date: receivedAt, userId: user.id,
        },
      });
      // a backdated receipt slots into stock-card history — rebuild every later balance
      if (backdated) await recomputeStockChain(tx, line.productId);
    });
  }

  const updated = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
  const fullyReceived = updated.lines.every((l) => l.receivedQty >= l.qty);
  const anyReceived = updated.lines.some((l) => l.receivedQty > 0);
  await prisma.purchaseOrder.update({
    where: { id: poId },
    data: { status: fullyReceived ? "Received" : anyReceived ? "Partially Received" : updated.status },
  });
  if (fullyReceived) await notifyRole("ADMIN", "PO_RECEIVED", `${po.poNumber} fully received`, `/purchase-orders/${poId}`, po.companyId);
  revalidatePath(`/purchase-orders/${poId}`);
  redirect(`/purchase-orders/${poId}`);
}
