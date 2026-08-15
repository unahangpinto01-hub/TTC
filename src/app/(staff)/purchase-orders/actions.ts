"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { nextDocNumber } from "@/lib/numbering";
import { notifyRole } from "@/lib/notify";

export async function createPO(formData: FormData) {
  await requireStaff(["SUPER_ADMIN", "ADMIN"]);
  const supplierId = String(formData.get("supplierId"));
  const productIds = formData.getAll("productId").map(String);
  const qtys = formData.getAll("qty").map(Number);

  const lines = productIds
    .map((pid, i) => ({ productId: pid, qty: qtys[i] || 0 }))
    .filter((l) => l.productId && l.qty > 0);
  if (!lines.length) redirect("/purchase-orders/new?error=empty");

  const products = await prisma.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } } });
  const poNumber = await nextDocNumber("PO");
  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber,
      supplierId,
      status: "Draft",
      lines: {
        create: lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          unitCost: products.find((p) => p.id === l.productId)?.unitCost ?? 0,
        })),
      },
    },
  });
  redirect(`/purchase-orders/${po.id}`);
}

export async function markPOSent(formData: FormData) {
  await requireStaff(["SUPER_ADMIN", "ADMIN"]);
  const id = String(formData.get("id"));
  await prisma.purchaseOrder.update({ where: { id }, data: { status: "Sent" } });
  revalidatePath(`/purchase-orders/${id}`);
}

/** Receive quantities against PO lines; adds IN stock movements. */
export async function receivePO(formData: FormData) {
  const user = await requireStaff(["SUPER_ADMIN", "ADMIN"]);
  const poId = String(formData.get("poId"));
  const lineIds = formData.getAll("lineId").map(String);
  const recvQtys = formData.getAll("recvQty").map(Number);

  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: { include: { product: true } } } });

  for (let i = 0; i < lineIds.length; i++) {
    const line = po.lines.find((l) => l.id === lineIds[i]);
    const qty = Math.max(0, Math.min(recvQtys[i] || 0, line ? line.qty - line.receivedQty : 0));
    if (!line || qty <= 0) continue;
    const newStock = line.product.stockQty + qty;
    await prisma.pOLine.update({ where: { id: line.id }, data: { receivedQty: line.receivedQty + qty } });
    await prisma.product.update({ where: { id: line.productId }, data: { stockQty: newStock } });
    await prisma.stockMovement.create({
      data: { productId: line.productId, type: "IN", qty, balanceAfter: newStock, refType: "PO", refNo: po.poNumber, userId: user.id },
    });
  }

  const updated = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { lines: true } });
  const fullyReceived = updated.lines.every((l) => l.receivedQty >= l.qty);
  const anyReceived = updated.lines.some((l) => l.receivedQty > 0);
  await prisma.purchaseOrder.update({
    where: { id: poId },
    data: { status: fullyReceived ? "Received" : anyReceived ? "Partially Received" : updated.status },
  });
  if (fullyReceived) await notifyRole("ADMIN", "PO_RECEIVED", `${po.poNumber} fully received`, `/purchase-orders/${poId}`);
  revalidatePath(`/purchase-orders/${poId}`);
  redirect(`/purchase-orders/${poId}`);
}
