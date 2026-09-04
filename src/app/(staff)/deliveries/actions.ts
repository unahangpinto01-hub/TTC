"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite, requireStaffWrite } from "@/lib/auth";
import { notifyRoles } from "@/lib/notify";
import { lineGrossWeightKg, UnitError } from "@/lib/units";
import { getActiveCompany } from "@/lib/company";
import { recomputeStockChain } from "@/lib/stock";
import { logAudit } from "@/lib/salespeople";

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
  const activeCo = await getActiveCompany(user);
  if (dr.companyId !== activeCo.id) redirect("/denied"); // company isolation
  if (dr.status !== "Draft") redirect(`/deliveries/${drId}`);

  // Validate first, in base PCS aggregated per product: stock must never go negative.
  const neededPcs = new Map<string, number>();
  for (const line of dr.lines) neededPcs.set(line.productId, (neededPcs.get(line.productId) ?? 0) + line.baseQty);
  const short = dr.lines.filter((l) => l.product.stockQty < neededPcs.get(l.productId)!);
  if (short.length) redirect(`/deliveries/${drId}?error=short`);

  const now = new Date();
  // a DR generated with a past delivery date is an encoded past transaction: the stock card
  // and deliveredAt use that date, and every later balance is re-threaded
  const backdated = dr.date.getTime() < now.getTime() - 60 * 1000;
  const effectiveAt = backdated ? dr.date : now;

  const running = new Map<string, number>(); // per-product running balance across this DR's lines
  try {
    // one transaction for the whole DR: either every line's stock moves or none does
    await prisma.$transaction(async (tx) => {
      for (const line of dr.lines) {
        const newQty = (running.get(line.productId) ?? line.product.stockQty) - line.baseQty;
        running.set(line.productId, newQty);
        // snapshot at the moment of delivery — historical records must not change when the master data does:
        // weighted-average cost per PCS (COGS) and this line's total gross weight (logistics)
        await tx.dRLine.update({
          where: { id: line.id },
          data: {
            unitCostAtSale: line.product.unitCost,
            grossWeightKg: lineGrossWeightKg(line.baseQty, line.product) ?? 0,
          },
        });
        await tx.product.update({ where: { id: line.productId }, data: { stockQty: newQty } });
        await tx.stockMovement.create({
          data: {
            productId: line.productId, type: "OUT", qty: line.baseQty, balanceAfter: newQty,
            enteredQty: line.qty, enteredUnit: line.unit,
            refType: "DR", refNo: dr.drNumber, date: effectiveAt, userId: user.id,
          },
        });
        if (backdated) await recomputeStockChain(tx, line.productId);
      }
      await tx.deliveryReceipt.update({ where: { id: drId }, data: { status: "Delivered", deliveredAt: effectiveAt } });
    }, { timeout: 60000 });
  } catch (e) {
    // recompute refuses when the backdated OUT would push some point of history below zero
    if (e instanceof UnitError) redirect(`/deliveries/${drId}?error=history`);
    throw e;
  }
  for (const line of dr.lines) {
    const newQty = running.get(line.productId)!;
    if (newQty <= line.product.reorderPoint) {
      await notifyRoles(["ADMIN", "SUPER_ADMIN"], "LOW_STOCK", `${line.product.name} hit reorder point (${newQty} left)`, `/inventory/${line.productId}`, dr.companyId);
    }
  }
  await prisma.salesOrder.update({ where: { id: dr.salesOrderId }, data: { status: "Delivered" } });
  if (dr.salesOrder.schedule) {
    await prisma.deliverySchedule.update({ where: { id: dr.salesOrder.schedule.id }, data: { status: "Delivered" } });
  }
  await notifyRoles(
    ["ADMIN", "SUPER_ADMIN"],
    "DR_FOR_INVOICING",
    `${dr.drNumber} delivered to ${dr.salesOrder.customer.businessName} — ready for invoicing`,
    `/invoicing`,
    dr.companyId
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
  const activeCo = await getActiveCompany(user);
  if (dr.companyId !== activeCo.id) redirect("/denied"); // company isolation
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

/**
 * Save the batch/lot references typed against a delivery's lines.
 *
 * Batch numbers are a printed reference, not a figure: they touch no totals, no stock and
 * no accounting, so they stay editable on an invoiced receipt too — a batch is often only
 * known after picking, and past receipts get reprinted. A voided receipt is left alone.
 */
export async function saveDRBatches(formData: FormData) {
  const user = await requirePermWrite("deliveries");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));

  const dr = await prisma.deliveryReceipt.findUnique({
    where: { id },
    select: { id: true, companyId: true, status: true, lines: { select: { id: true } } },
  });
  if (!dr || dr.companyId !== company.id) redirect("/deliveries");
  if (dr.status === "Void") redirect(`/deliveries/${id}?error=void`);

  for (const line of dr.lines) {
    const raw = String(formData.get(`batch_${line.id}`) ?? "").trim().replace(/\s+/g, " ");
    await prisma.dRLine.update({
      where: { id: line.id },
      data: { batchNo: raw ? raw.slice(0, 120) : null },
    });
  }
  revalidatePath(`/deliveries/${id}`);
  revalidatePath(`/deliveries/${id}/print`);
  redirect(`/deliveries/${id}?batch=ok`);
}

/**
 * Reassign who prepared, checked or approved a delivery receipt.
 *
 * Signatories are an approval record, so this is Admin / Super Admin only and every change
 * is written to the business audit trail. The receipt stores employee links, not names, so
 * a rename in HR flows through to past receipts without rewriting them.
 */
export async function setDRSignatories(formData: FormData) {
  const me = await requireStaffWrite(["SUPER_ADMIN", "ADMIN"]);
  const company = await getActiveCompany(me);
  const id = String(formData.get("id"));

  const dr = await prisma.deliveryReceipt.findUnique({
    where: { id },
    select: {
      id: true, companyId: true, status: true, drNumber: true,
      preparedByEmp: { select: { id: true, name: true } },
      checkedByEmp: { select: { id: true, name: true } },
      approvedByEmp: { select: { id: true, name: true } },
    },
  });
  if (!dr || dr.companyId !== company.id) redirect("/deliveries");
  if (dr.status === "Void") redirect(`/deliveries/${id}?error=sig`);

  const slots = [
    ["preparedById", "Prepared by", dr.preparedByEmp],
    ["checkedById", "Checked by", dr.checkedByEmp],
    ["approvedById", "Approved by", dr.approvedByEmp],
  ] as const;

  const picked: Record<string, string | null> = {};
  for (const [field] of slots) {
    const raw = String(formData.get(field) || "");
    if (!raw) { picked[field] = null; continue; }
    // only an active employee may be assigned — never create or guess a record
    const emp = await prisma.employee.findFirst({ where: { id: raw, status: "Active" }, select: { id: true } });
    if (!emp) redirect(`/deliveries/${id}?error=sig`);
    picked[field] = emp.id;
  }

  const changes: string[] = [];
  for (const [field, label, before] of slots) {
    if ((before?.id ?? null) === picked[field]) continue;
    const after = picked[field]
      ? (await prisma.employee.findUniqueOrThrow({ where: { id: picked[field]! }, select: { name: true } })).name
      : "(none)";
    changes.push(`${label}: ${before?.name ?? "(none)"} → ${after}`);
  }
  if (!changes.length) redirect(`/deliveries/${id}`);

  await prisma.deliveryReceipt.update({
    where: { id },
    data: {
      preparedById: picked.preparedById,
      checkedById: picked.checkedById,
      approvedById: picked.approvedById,
    },
  });
  await logAudit({
    entity: "DeliveryReceipt",
    entityId: id,
    action: "SIGNATORIES_CHANGED",
    detail: `${dr.drNumber} — ${changes.join("; ")}`,
    actorName: me.name,
    actorEmail: me.email,
  });
  revalidatePath(`/deliveries/${id}`);
  revalidatePath(`/deliveries/${id}/print`);
  redirect(`/deliveries/${id}?sig=ok`);
}
