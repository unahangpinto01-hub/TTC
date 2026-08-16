"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireStaffWrite } from "@/lib/auth";
import { nextDocNumber } from "@/lib/numbering";
import { notifyRoles } from "@/lib/notify";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function updateLineQty(formData: FormData) {
  await requireStaffWrite();
  const lineId = String(formData.get("lineId"));
  const qty = Math.max(1, Math.floor(Number(formData.get("qty")) || 1));
  const line = await prisma.salesOrderLine.findUniqueOrThrow({ where: { id: lineId }, include: { salesOrder: true } });
  if (!["Draft"].includes(line.salesOrder.status)) redirect(`/sales-orders/${line.salesOrderId}`);
  await prisma.salesOrderLine.update({
    where: { id: lineId },
    data: { qty, lineTotal: round2(qty * line.unitPrice * (1 - line.discount / 100)) },
  });
  revalidatePath(`/sales-orders/${line.salesOrderId}`);
  redirect(`/sales-orders/${line.salesOrderId}`);
}

export async function removeLine(formData: FormData) {
  await requireStaffWrite();
  const lineId = String(formData.get("lineId"));
  const line = await prisma.salesOrderLine.findUniqueOrThrow({ where: { id: lineId }, include: { salesOrder: true } });
  if (line.salesOrder.status !== "Draft") redirect(`/sales-orders/${line.salesOrderId}`);
  await prisma.salesOrderLine.delete({ where: { id: lineId } });
  revalidatePath(`/sales-orders/${line.salesOrderId}`);
  redirect(`/sales-orders/${line.salesOrderId}`);
}

/** Confirm SO — blocked if any line exceeds current stock. */
export async function confirmSO(formData: FormData) {
  await requireStaffWrite();
  const soId = String(formData.get("soId"));
  const so = await prisma.salesOrder.findUniqueOrThrow({
    where: { id: soId },
    include: { lines: { include: { product: true } }, customer: true },
  });
  if (so.status !== "Draft") redirect(`/sales-orders/${soId}`);
  const short = so.lines.filter((l) => l.product.stockQty < l.qty);
  if (short.length) redirect(`/sales-orders/${soId}?error=short`);
  await prisma.salesOrder.update({ where: { id: soId }, data: { status: "Confirmed" } });
  await notifyRoles(["ADMIN", "SUPER_ADMIN"], "ORDER_CONFIRMED", `${so.soNumber} confirmed for ${so.customer.businessName} — ready to schedule`, `/sales-orders/${soId}`);
  revalidatePath(`/sales-orders/${soId}`);
  redirect(`/sales-orders/${soId}`);
}

export async function cancelSO(formData: FormData) {
  const user = await requireStaffWrite(["SUPER_ADMIN", "ADMIN"]);
  const soId = String(formData.get("soId"));
  const reason = String(formData.get("reason") || "").trim() || "Cancelled by " + user.name;
  const so = await prisma.salesOrder.findUniqueOrThrow({ where: { id: soId } });
  if (["Delivered", "Invoiced", "Closed"].includes(so.status)) redirect(`/sales-orders/${soId}`);
  await prisma.salesOrder.update({ where: { id: soId }, data: { status: "Cancelled", voidReason: reason } });
  revalidatePath(`/sales-orders/${soId}`);
  redirect(`/sales-orders/${soId}`);
}

export async function scheduleSO(formData: FormData) {
  await requireStaffWrite();
  const soId = String(formData.get("soId"));
  const date = new Date(String(formData.get("date")));
  const truck = String(formData.get("truck") || "").trim();
  const driver = String(formData.get("driver") || "").trim();
  const so = await prisma.salesOrder.findUniqueOrThrow({ where: { id: soId }, include: { customer: true } });
  if (!["Confirmed", "Scheduled"].includes(so.status)) redirect(`/sales-orders/${soId}`);

  await prisma.deliverySchedule.upsert({
    where: { salesOrderId: soId },
    create: { salesOrderId: soId, date, truck, driver, status: "Scheduled" },
    update: { date, truck, driver },
  });
  await prisma.salesOrder.update({ where: { id: soId }, data: { status: "Scheduled" } });
  await notifyRoles(["CLERK", "ADMIN"], "ORDER_SCHEDULED", `${so.soNumber} (${so.customer.businessName}) scheduled for delivery`, `/schedule`);
  revalidatePath("/schedule");
  redirect(`/schedule`);
}

/** Generate a DR from the SO, allowing partial quantities. */
export async function generateDR(formData: FormData) {
  const user = await requireStaffWrite();
  const soId = String(formData.get("soId"));
  const so = await prisma.salesOrder.findUniqueOrThrow({
    where: { id: soId },
    include: { lines: { include: { product: true } }, deliveryReceipts: { where: { status: { not: "Void" } } } },
  });
  if (!["Confirmed", "Scheduled"].includes(so.status)) redirect(`/sales-orders/${soId}`);
  if (so.deliveryReceipts.length) redirect(`/deliveries/${so.deliveryReceipts[0].id}`);

  const lineIds = formData.getAll("lineId").map(String);
  const drQtys = formData.getAll("drQty").map(Number);

  const admins = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "SUPER_ADMIN"] } } });
  const checkedBy = admins.find((a) => a.role === "ADMIN")?.name ?? "";
  const approvedBy = admins.find((a) => a.role === "SUPER_ADMIN")?.name ?? "";

  const drNumber = await nextDocNumber("DR");
  const dr = await prisma.deliveryReceipt.create({
    data: {
      drNumber,
      salesOrderId: soId,
      status: "Draft",
      preparedBy: user.name,
      checkedBy,
      approvedBy,
      lines: {
        create: so.lines
          .map((l, i) => {
            const idx = lineIds.indexOf(l.id);
            const qty = idx >= 0 ? Math.max(0, Math.min(Math.floor(drQtys[idx] || 0), l.qty)) : l.qty;
            return { productId: l.productId, qty, unitPrice: l.unitPrice };
          })
          .filter((l) => l.qty > 0),
      },
    },
  });
  redirect(`/deliveries/${dr.id}`);
}
