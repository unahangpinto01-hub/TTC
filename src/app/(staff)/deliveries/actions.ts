"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite, requireStaffWrite } from "@/lib/auth";
import { notifyRoles } from "@/lib/notify";

export async function updateScheduleStatus(formData: FormData) {
  await requirePermWrite("schedule");
  const id = String(formData.get("scheduleId"));
  const status = String(formData.get("status"));
  if (!["Scheduled", "Loading", "In Transit"].includes(status)) return;
  await prisma.deliverySchedule.update({ where: { id }, data: { status } });
  revalidatePath("/schedule");
}

/** Confirm delivery: deducts stock (OUT entries), updates SO + schedule, notifies accounting. */
export async function markDelivered(formData: FormData) {
  const user = await requirePermWrite("deliveries");
  const drId = String(formData.get("drId"));
  const dr = await prisma.deliveryReceipt.findUniqueOrThrow({
    where: { id: drId },
    include: { lines: { include: { product: true } }, salesOrder: { include: { customer: true, schedule: true } } },
  });
  if (dr.status !== "Draft") redirect(`/deliveries/${drId}`);

  // Validate first, in base PCS aggregated per product: stock must never go negative.
  const neededPcs = new Map<string, number>();
  for (const line of dr.lines) neededPcs.set(line.productId, (neededPcs.get(line.productId) ?? 0) + line.baseQty);
  const short = dr.lines.filter((l) => l.product.stockQty < neededPcs.get(l.productId)!);
  if (short.length) redirect(`/deliveries/${drId}?error=short`);

  const now = new Date();
  const running = new Map<string, number>(); // per-product running balance across this DR's lines
  for (const line of dr.lines) {
    const newQty = (running.get(line.productId) ?? line.product.stockQty) - line.baseQty;
    running.set(line.productId, newQty);
    // snapshot the weighted-average cost per PCS at the moment of sale — COGS uses this, not later costs
    await prisma.dRLine.update({ where: { id: line.id }, data: { unitCostAtSale: line.product.unitCost } });
    await prisma.product.update({ where: { id: line.productId }, data: { stockQty: newQty } });
    await prisma.stockMovement.create({
      data: {
        productId: line.productId, type: "OUT", qty: line.baseQty, balanceAfter: newQty,
        enteredQty: line.qty, enteredUnit: line.unit,
        refType: "DR", refNo: dr.drNumber, date: now, userId: user.id,
      },
    });
    if (newQty <= line.product.reorderPoint) {
      await notifyRoles(["ADMIN", "SUPER_ADMIN"], "LOW_STOCK", `${line.product.name} hit reorder point (${newQty} left)`, `/inventory/${line.productId}`);
    }
  }
  await prisma.deliveryReceipt.update({ where: { id: drId }, data: { status: "Delivered", deliveredAt: now } });
  await prisma.salesOrder.update({ where: { id: dr.salesOrderId }, data: { status: "Delivered" } });
  if (dr.salesOrder.schedule) {
    await prisma.deliverySchedule.update({ where: { id: dr.salesOrder.schedule.id }, data: { status: "Delivered" } });
  }
  await notifyRoles(
    ["ADMIN", "SUPER_ADMIN"],
    "DR_FOR_INVOICING",
    `${dr.drNumber} delivered to ${dr.salesOrder.customer.businessName} — ready for invoicing`,
    `/invoicing`
  );
  revalidatePath(`/deliveries/${drId}`);
  redirect(`/deliveries/${drId}`);
}

/** Void a DR (Super Admin only, per spec). Restores stock if it was already delivered. */
export async function voidDR(formData: FormData) {
  const user = await requireStaffWrite(["SUPER_ADMIN"]);
  const drId = String(formData.get("drId"));
  const reason = String(formData.get("reason") || "").trim();
  if (!reason) redirect(`/deliveries/${drId}?error=reason`);
  const dr = await prisma.deliveryReceipt.findUniqueOrThrow({
    where: { id: drId },
    include: { lines: { include: { product: true } }, salesReceipt: true },
  });
  if (dr.salesReceipt) redirect(`/deliveries/${drId}?error=invoiced`);

  if (dr.status === "Delivered") {
    const running = new Map<string, number>();
    for (const line of dr.lines) {
      const newQty = (running.get(line.productId) ?? line.product.stockQty) + line.baseQty;
      running.set(line.productId, newQty);
      await prisma.product.update({ where: { id: line.productId }, data: { stockQty: newQty } });
      await prisma.stockMovement.create({
        data: {
          productId: line.productId, type: "IN", qty: line.baseQty, balanceAfter: newQty,
          enteredQty: line.qty, enteredUnit: line.unit,
          refType: "ADJUST", refNo: `VOID ${dr.drNumber}`, userId: user.id,
        },
      });
    }
  }
  await prisma.deliveryReceipt.update({ where: { id: drId }, data: { status: "Void", voidReason: reason } });
  await prisma.salesOrder.update({ where: { id: dr.salesOrderId }, data: { status: "Confirmed" } });
  revalidatePath(`/deliveries/${drId}`);
  redirect(`/deliveries/${drId}`);
}
