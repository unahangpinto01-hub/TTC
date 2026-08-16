"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireStaffWrite } from "@/lib/auth";
import { nextDocNumber } from "@/lib/numbering";
import { notifyRoles } from "@/lib/notify";

export async function encodeOrder(formData: FormData) {
  await requireStaffWrite();
  const customerId = String(formData.get("customerId"));
  const source = String(formData.get("source"));
  const term = String(formData.get("term"));
  const notes = String(formData.get("notes") || "").trim() || null;
  const productIds = formData.getAll("productId").map(String);
  const qtys = formData.getAll("qty").map(Number);

  const lines = productIds
    .map((pid, i) => ({ productId: pid, qty: Math.floor(qtys[i] || 0) }))
    .filter((l) => l.productId && l.qty > 0);
  if (!lines.length) redirect("/orders/new?error=empty");

  const products = await prisma.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } } });
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });

  const order = await prisma.incomingOrder.create({
    data: {
      source,
      customerId,
      term,
      status: "Pending",
      notes,
      lines: {
        create: lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          unitPrice: products.find((p) => p.id === l.productId)?.dealerPrice ?? 0,
        })),
      },
    },
  });
  await notifyRoles(["ADMIN", "SUPER_ADMIN"], "NEW_ORDER", `New ${source.toLowerCase()} order encoded for ${customer.businessName}`, `/orders/${order.id}`);
  redirect(`/orders/${order.id}`);
}

export async function convertToSO(formData: FormData) {
  const user = await requireStaffWrite();
  const orderId = String(formData.get("orderId"));
  const order = await prisma.incomingOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { lines: true, customer: true },
  });
  if (order.status !== "Pending") redirect(`/orders/${orderId}`);

  const soNumber = await nextDocNumber("SO");
  const so = await prisma.salesOrder.create({
    data: {
      soNumber,
      customerId: order.customerId,
      incomingOrderId: order.id,
      term: order.term,
      status: "Draft",
      preparedById: user.id,
      lines: {
        create: order.lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          unitPrice: l.unitPrice,
          lineTotal: Math.round(l.qty * l.unitPrice * 100) / 100,
        })),
      },
    },
  });
  await prisma.incomingOrder.update({ where: { id: orderId }, data: { status: "Converted" } });
  await notifyRoles(["ADMIN", "SUPER_ADMIN"], "ORDER_CONVERTED", `${soNumber} created from ${order.customer.businessName}'s order`, `/sales-orders/${so.id}`);
  redirect(`/sales-orders/${so.id}`);
}

export async function cancelIncoming(formData: FormData) {
  await requireStaffWrite();
  const orderId = String(formData.get("orderId"));
  await prisma.incomingOrder.update({ where: { id: orderId }, data: { status: "Cancelled" } });
  revalidatePath("/orders");
  redirect("/orders");
}
