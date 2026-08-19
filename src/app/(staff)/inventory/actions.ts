"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { notifyRole } from "@/lib/notify";
import { convertToBaseUnit, parseUnit, UnitError } from "@/lib/units";

/** Unit cost per PCS at FULL precision: entered directly, or derived as carton cost ÷ pieces per carton.
    Never round the stored cost — 2 decimals are for display only. */
function resolveUnitCost(formData: FormData): number {
  const ppc = Math.floor(Number(formData.get("piecesPerCarton")));
  const cartonCost = Number(formData.get("costPerCarton"));
  if (cartonCost > 0 && ppc > 0) return cartonCost / ppc;
  return Math.max(0, Number(formData.get("unitCost")) || 0);
}

export async function createProduct(formData: FormData) {
  await requirePermWrite("inventory");
  const data = {
    sku: String(formData.get("sku")).trim(),
    name: String(formData.get("name")).trim(),
    activeIngredient: String(formData.get("activeIngredient")).trim(),
    category: String(formData.get("category")),
    cropTags: String(formData.get("cropTags") || "").trim(),
    packSize: String(formData.get("packSize")).trim(),
    unitCost: resolveUnitCost(formData),
    dealerPrice: Number(formData.get("dealerPrice")) || 0,
    srp: Number(formData.get("srp")) || 0,
    reorderPoint: Number(formData.get("reorderPoint")) || 10,
    piecesPerCarton: Math.floor(Number(formData.get("piecesPerCarton"))) > 0 ? Math.floor(Number(formData.get("piecesPerCarton"))) : null,
    cartonDealerPrice: Number(formData.get("cartonDealerPrice")) > 0 ? Number(formData.get("cartonDealerPrice")) : null,
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

/** Full product edit (everything except SKU and stock). Superadmin only. */
export async function updateProduct(formData: FormData) {
  const user = await requirePermWrite("inventory");
  if (user.role !== "SUPER_ADMIN") redirect("/denied");
  const productId = String(formData.get("productId"));
  const mfg = String(formData.get("mfgDate") || "");
  const exp = String(formData.get("expDate") || "");
  await prisma.product.update({
    where: { id: productId },
    data: {
      name: String(formData.get("name")).trim(),
      activeIngredient: String(formData.get("activeIngredient") || "").trim(),
      category: String(formData.get("category")),
      cropTags: String(formData.get("cropTags") || "").trim(),
      packSize: String(formData.get("packSize")).trim(),
      unitCost: resolveUnitCost(formData),
      dealerPrice: Math.max(0, Number(formData.get("dealerPrice")) || 0),
      srp: Math.max(0, Number(formData.get("srp")) || 0),
      reorderPoint: Math.max(0, Number(formData.get("reorderPoint")) || 0),
      piecesPerCarton: Math.floor(Number(formData.get("piecesPerCarton"))) > 0 ? Math.floor(Number(formData.get("piecesPerCarton"))) : null,
      cartonDealerPrice: Number(formData.get("cartonDealerPrice")) > 0 ? Number(formData.get("cartonDealerPrice")) : null,
      supplierId: String(formData.get("supplierId")) || null,
      batchNo: String(formData.get("batchNo") || "").trim() || null,
      mfgDate: mfg ? new Date(mfg) : null,
      expDate: exp ? new Date(exp) : null,
      parentItem: String(formData.get("parentItem") || "").trim() || null,
    },
  });
  revalidatePath("/inventory");
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
  const delta = Math.trunc(Number(formData.get("delta")) || 0);
  const unit = parseUnit(formData.get("unit"));
  const reason = String(formData.get("reason") || "Manual adjustment");
  if (delta === 0) redirect(`/inventory/${productId}`);
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  let basePcs: number;
  try {
    basePcs = convertToBaseUnit(delta, unit, product);
  } catch (e) {
    if (e instanceof UnitError) redirect(`/inventory/${productId}?error=nocarton`);
    throw e;
  }

  // Effective date: when the movement applies (stock card + all calculations use it).
  // Backdated entries land at end-of-day; today/blank/future = right now. createdAt keeps the real entry time.
  const effRaw = String(formData.get("effectiveDate") || "");
  let effective = new Date();
  if (effRaw) {
    const d = new Date(`${effRaw}T23:59:59.999`);
    if (!Number.isNaN(d.getTime()) && d.getTime() < Date.now()) effective = d;
  }

  // Insert, then recompute the product's whole balance chain in effective-date order —
  // a backdated entry shifts every later balanceAfter. Rejected if any point in history would go negative.
  let newQty = 0;
  try {
    newQty = await prisma.$transaction(async (tx) => {
      await tx.stockMovement.create({
        data: {
          productId,
          type: "ADJUST",
          qty: basePcs, // signed: negative = stock removed
          balanceAfter: 0, // set by the recompute below
          enteredQty: Math.abs(delta),
          enteredUnit: unit,
          refType: "ADJUST",
          refNo: reason,
          date: effective,
          userId: user.id,
        },
      });
      const moves = await tx.stockMovement.findMany({
        where: { productId },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      });
      let bal = 0;
      for (const m of moves) {
        bal += m.type === "OUT" ? -m.qty : m.qty;
        if (bal < 0) throw new UnitError("negative");
        if (m.balanceAfter !== bal) await tx.stockMovement.update({ where: { id: m.id }, data: { balanceAfter: bal } });
      }
      await tx.product.update({ where: { id: productId }, data: { stockQty: bal } });
      return bal;
    });
  } catch (e) {
    if (e instanceof UnitError) redirect(`/inventory/${productId}?error=negative`);
    throw e;
  }
  if (newQty <= product.reorderPoint) {
    await notifyRole("ADMIN", "LOW_STOCK", `${product.name} is at/below reorder point (${newQty} left)`, `/inventory/${productId}`);
  }
  revalidatePath(`/inventory/${productId}`);
  redirect(`/inventory/${productId}`);
}
