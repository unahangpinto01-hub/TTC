"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { notifyRole } from "@/lib/notify";

export async function createProduct(formData: FormData) {
  await requireStaff(["SUPER_ADMIN", "ADMIN"]);
  const data = {
    sku: String(formData.get("sku")).trim(),
    name: String(formData.get("name")).trim(),
    activeIngredient: String(formData.get("activeIngredient")).trim(),
    category: String(formData.get("category")),
    cropTags: String(formData.get("cropTags") || "").trim(),
    packSize: String(formData.get("packSize")).trim(),
    unitCost: Number(formData.get("unitCost")) || 0,
    dealerPrice: Number(formData.get("dealerPrice")) || 0,
    srp: Number(formData.get("srp")) || 0,
    reorderPoint: Number(formData.get("reorderPoint")) || 10,
    supplierId: String(formData.get("supplierId")) || null,
  };
  const product = await prisma.product.create({ data });
  const opening = Number(formData.get("openingStock")) || 0;
  if (opening > 0) {
    const user = await requireStaff();
    await prisma.product.update({ where: { id: product.id }, data: { stockQty: opening } });
    await prisma.stockMovement.create({
      data: { productId: product.id, type: "IN", qty: opening, balanceAfter: opening, refType: "OPENING", refNo: "OPENING", userId: user.id },
    });
  }
  redirect(`/inventory/${product.id}`);
}

export async function adjustStock(formData: FormData) {
  const user = await requireStaff(["SUPER_ADMIN", "ADMIN"]);
  const productId = String(formData.get("productId"));
  const delta = Number(formData.get("delta")) || 0;
  const reason = String(formData.get("reason") || "Manual adjustment");
  if (delta === 0) redirect(`/inventory/${productId}`);
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  const newQty = Math.max(0, product.stockQty + delta);
  await prisma.product.update({ where: { id: productId }, data: { stockQty: newQty } });
  await prisma.stockMovement.create({
    data: {
      productId,
      type: "ADJUST",
      qty: Math.abs(newQty - product.stockQty),
      balanceAfter: newQty,
      refType: "ADJUST",
      refNo: reason,
      userId: user.id,
    },
  });
  if (newQty <= product.reorderPoint) {
    await notifyRole("ADMIN", "LOW_STOCK", `${product.name} is at/below reorder point (${newQty} left)`, `/inventory/${productId}`);
  }
  revalidatePath(`/inventory/${productId}`);
  redirect(`/inventory/${productId}`);
}
