"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { nextDocNumber } from "@/lib/numbering";
import { notifyRoles } from "@/lib/notify";
import { convertToBaseUnit } from "@/lib/units";
import { getActiveCompany } from "@/lib/company";
import { parseEffectiveDate } from "@/lib/stock";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Company isolation for mutations: the record must belong to the ACTIVE company. */
async function assertActiveCompany(companyId: string) {
  const active = await getActiveCompany();
  if (companyId !== active.id) redirect("/denied");
}

export async function updateLineQty(formData: FormData) {
  await requirePermWrite("salesOrders");
  const lineId = String(formData.get("lineId"));
  const qty = Math.max(1, Math.floor(Number(formData.get("qty")) || 1));
  const line = await prisma.salesOrderLine.findUniqueOrThrow({ where: { id: lineId }, include: { salesOrder: true, product: true } });
  await assertActiveCompany(line.salesOrder.companyId);
  if (!["Draft"].includes(line.salesOrder.status)) redirect(`/sales-orders/${line.salesOrderId}`);
  await prisma.salesOrderLine.update({
    where: { id: lineId },
    data: { qty, baseQty: convertToBaseUnit(qty, line.unit, line.product), lineTotal: round2(qty * line.unitPrice * (1 - line.discount / 100)) },
  });
  revalidatePath(`/sales-orders/${line.salesOrderId}`);
  redirect(`/sales-orders/${line.salesOrderId}`);
}

/** Edit a draft line's unit price (per the line's unit — PCS or CTN); line total recomputes. */
export async function updateLinePrice(formData: FormData) {
  await requirePermWrite("salesOrders");
  const lineId = String(formData.get("lineId"));
  const unitPrice = Math.max(0, Number(formData.get("unitPrice")) || 0);
  const line = await prisma.salesOrderLine.findUniqueOrThrow({ where: { id: lineId }, include: { salesOrder: true } });
  await assertActiveCompany(line.salesOrder.companyId);
  if (line.salesOrder.status !== "Draft") redirect(`/sales-orders/${line.salesOrderId}`);
  await prisma.salesOrderLine.update({
    where: { id: lineId },
    data: { unitPrice, lineTotal: round2(line.qty * unitPrice * (1 - line.discount / 100)) },
  });
  revalidatePath(`/sales-orders/${line.salesOrderId}`);
  redirect(`/sales-orders/${line.salesOrderId}`);
}

export async function removeLine(formData: FormData) {
  await requirePermWrite("salesOrders");
  const lineId = String(formData.get("lineId"));
  const line = await prisma.salesOrderLine.findUniqueOrThrow({ where: { id: lineId }, include: { salesOrder: true } });
  await assertActiveCompany(line.salesOrder.companyId);
  if (line.salesOrder.status !== "Draft") redirect(`/sales-orders/${line.salesOrderId}`);
  await prisma.salesOrderLine.delete({ where: { id: lineId } });
  revalidatePath(`/sales-orders/${line.salesOrderId}`);
  redirect(`/sales-orders/${line.salesOrderId}`);
}

/** Confirm SO — blocked if any line exceeds current stock. */
export async function confirmSO(formData: FormData) {
  await requirePermWrite("salesOrders");
  const soId = String(formData.get("soId"));
  const so = await prisma.salesOrder.findUniqueOrThrow({
    where: { id: soId },
    include: { lines: { include: { product: true } }, customer: true },
  });
  await assertActiveCompany(so.companyId);
  if (so.status !== "Draft") redirect(`/sales-orders/${soId}`);
  // stock check in base PCS, aggregated per product (an SO can mix CARTON and PCS lines of one product)
  const neededPcs = new Map<string, number>();
  for (const l of so.lines) neededPcs.set(l.productId, (neededPcs.get(l.productId) ?? 0) + l.baseQty);
  const short = so.lines.filter((l) => l.product.stockQty < neededPcs.get(l.productId)!);
  if (short.length) redirect(`/sales-orders/${soId}?error=short`);
  await prisma.salesOrder.update({ where: { id: soId }, data: { status: "Confirmed" } });
  await notifyRoles(["ADMIN", "SUPER_ADMIN"], "ORDER_CONFIRMED", `${so.soNumber} confirmed for ${so.customer.businessName} — ready to schedule`, `/sales-orders/${soId}`, so.companyId);
  revalidatePath(`/sales-orders/${soId}`);
  redirect(`/sales-orders/${soId}`);
}

export async function cancelSO(formData: FormData) {
  const user = await requirePermWrite("salesOrders");
  const soId = String(formData.get("soId"));
  const reason = String(formData.get("reason") || "").trim() || "Cancelled by " + user.name;
  const so = await prisma.salesOrder.findUniqueOrThrow({ where: { id: soId } });
  await assertActiveCompany(so.companyId);
  if (["Delivered", "Invoiced", "Closed"].includes(so.status)) redirect(`/sales-orders/${soId}`);
  await prisma.salesOrder.update({ where: { id: soId }, data: { status: "Cancelled", voidReason: reason } });
  revalidatePath(`/sales-orders/${soId}`);
  redirect(`/sales-orders/${soId}`);
}

export async function scheduleSO(formData: FormData) {
  await requirePermWrite("salesOrders");
  const soId = String(formData.get("soId"));
  const date = new Date(String(formData.get("date")));
  const truck = String(formData.get("truck") || "").trim();
  const driver = String(formData.get("driver") || "").trim();
  const so = await prisma.salesOrder.findUniqueOrThrow({ where: { id: soId }, include: { customer: true } });
  await assertActiveCompany(so.companyId);
  if (!["Confirmed", "Scheduled"].includes(so.status)) redirect(`/sales-orders/${soId}`);

  await prisma.deliverySchedule.upsert({
    where: { salesOrderId: soId },
    create: { salesOrderId: soId, date, truck, driver, status: "Scheduled" },
    update: { date, truck, driver },
  });
  await prisma.salesOrder.update({ where: { id: soId }, data: { status: "Scheduled" } });
  await notifyRoles(["CLERK", "ADMIN"], "ORDER_SCHEDULED", `${so.soNumber} (${so.customer.businessName}) scheduled for delivery`, `/schedule`, so.companyId);
  revalidatePath("/schedule");
  // stay on the sales order; the flag makes the page confirm the schedule was saved
  redirect(`/sales-orders/${soId}?scheduled=1`);
}

/** Generate a DR from the SO, allowing partial quantities. */
export async function generateDR(formData: FormData) {
  const user = await requirePermWrite("salesOrders");
  const soId = String(formData.get("soId"));
  const so = await prisma.salesOrder.findUniqueOrThrow({
    where: { id: soId },
    include: { lines: { include: { product: true } }, deliveryReceipts: { where: { status: { not: "Void" } } } },
  });
  await assertActiveCompany(so.companyId);
  if (!["Confirmed", "Scheduled"].includes(so.status)) redirect(`/sales-orders/${soId}`);
  if (so.deliveryReceipts.length) redirect(`/deliveries/${so.deliveryReceipts[0].id}`);

  const lineIds = formData.getAll("lineId").map(String);
  const drQtys = formData.getAll("drQty").map(Number);

  const admins = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } } });
  const checkedBy = admins.find((a) => a.role === "ADMIN")?.name ?? "";
  const approvedBy = admins.find((a) => a.role === "SUPER_ADMIN")?.name ?? "";

  // delivery date from the form — backdated when encoding a past transaction (blank/future = now).
  // markDelivered dates the stock OUT entries on this when it's in the past.
  const drDate = parseEffectiveDate(String(formData.get("drDate") || ""));

  const drNumber = await nextDocNumber("DR", so.companyId);
  const dr = await prisma.deliveryReceipt.create({
    data: {
      companyId: so.companyId,
      drNumber,
      salesOrderId: soId,
      status: "Draft",
      date: drDate,
      preparedBy: user.name,
      checkedBy,
      approvedBy,
      lines: {
        create: so.lines
          .map((l, i) => {
            const idx = lineIds.indexOf(l.id);
            // partial qty is entered in the SO line's unit; reuse that line's transaction-time factor
            const qty = idx >= 0 ? Math.max(0, Math.min(Math.floor(drQtys[idx] || 0), l.qty)) : l.qty;
            const factor = l.qty > 0 ? l.baseQty / l.qty : 1;
            return { productId: l.productId, qty, unit: l.unit, baseQty: Math.round(qty * factor), unitPrice: l.unitPrice };
          })
          .filter((l) => l.qty > 0),
      },
    },
  });
  redirect(`/deliveries/${dr.id}`);
}
