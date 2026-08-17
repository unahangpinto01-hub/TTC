"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { notifyRole } from "@/lib/notify";

export async function createProduct(formData: FormData) {
  await requirePermWrite("inventory");
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
    batchNo: String(formData.get("batchNo") || "").trim() || null,
    mfgDate: formData.get("mfgDate") ? new Date(String(formData.get("mfgDate"))) : null,
    expDate: formData.get("expDate") ? new Date(String(formData.get("expDate"))) : null,
    parentItem: String(formData.get("parentItem") || "").trim() || null,
  };
  const product = await prisma.product.create({ data });
  const opening = Number(formData.get("openingStock")) || 0;
  if (opening > 0) {
    const user = await requirePermWrite("inventory");
    await prisma.product.update({ where: { id: product.id }, data: { stockQty: opening } });
    await prisma.stockMovement.create({
      data: { productId: product.id, type: "IN", qty: opening, balanceAfter: opening, refType: "OPENING", refNo: "OPENING", userId: user.id },
    });
  }
  redirect(`/inventory/${product.id}`);
}

export async function updateBatchInfo(formData: FormData) {
  await requirePermWrite("inventory");
  const productId = String(formData.get("productId"));
  const mfg = String(formData.get("mfgDate") || "");
  const exp = String(formData.get("expDate") || "");
  await prisma.product.update({
    where: { id: productId },
    data: {
      batchNo: String(formData.get("batchNo") || "").trim() || null,
      mfgDate: mfg ? new Date(mfg) : null,
      expDate: exp ? new Date(exp) : null,
      parentItem: String(formData.get("parentItem") || "").trim() || null,
    },
  });
  revalidatePath(`/inventory/${productId}`);
  redirect(`/inventory/${productId}`);
}

/** Rename a parent group across all its sub-items (merging into an existing name is allowed). */
export async function renameParentItem(formData: FormData) {
  await requirePermWrite("inventory");
  const from = String(formData.get("from") || "").trim();
  const to = String(formData.get("to") || "").trim();
  if (from && to && from !== to) {
    await prisma.product.updateMany({ where: { parentItem: from }, data: { parentItem: to } });
  }
  revalidatePath("/inventory");
  redirect("/inventory");
}

/** Dissolve a parent group: all its sub-items become standalone rows again. */
export async function ungroupParentItem(formData: FormData) {
  await requirePermWrite("inventory");
  const from = String(formData.get("from") || "").trim();
  if (from) {
    await prisma.product.updateMany({ where: { parentItem: from }, data: { parentItem: null } });
  }
  revalidatePath("/inventory");
  redirect("/inventory");
}

export async function adjustStock(formData: FormData) {
  const user = await requirePermWrite("inventory");
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
