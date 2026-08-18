"use server";

import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { parseUpload } from "@/lib/xlsx-helpers";

export type ImportResult = {
  imported: number;
  errors: { row: number; message: string }[];
} | null;

const CATEGORIES = ["Insecticide", "Herbicide", "Fungicide", "Molluscicide", "Foliar Fertilizer", "Others"];

export async function importProducts(_prev: ImportResult, formData: FormData): Promise<ImportResult> {
  const user = await requirePermWrite("inventory");
  const file = formData.get("file") as File | null;
  if (!file || !file.size) return { imported: 0, errors: [{ row: 0, message: "No file uploaded." }] };

  let rows: Record<string, any>[];
  try {
    rows = await parseUpload(file);
  } catch {
    return { imported: 0, errors: [{ row: 0, message: "Could not read file — upload an .xlsx file." }] };
  }

  const suppliers = await prisma.supplier.findMany();
  const existingSkus = new Set((await prisma.product.findMany({ select: { sku: true } })).map((p) => p.sku));
  const errors: { row: number; message: string }[] = [];
  let imported = 0;
  const seenSkus = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2; // header is row 1
    const r = rows[i];
    const sku = String(r.sku || "").trim();
    const name = String(r.name || "").trim();
    const category = String(r.category || "").trim();
    const problems: string[] = [];
    if (!sku) problems.push("sku is required");
    else if (existingSkus.has(sku) || seenSkus.has(sku)) problems.push(`sku "${sku}" already exists`);
    if (!name) problems.push("name is required");
    if (!CATEGORIES.includes(category)) problems.push(`category must be one of: ${CATEGORIES.join(", ")}`);
    const unitCost = Number(r.unitCost);
    const dealerPrice = Number(r.dealerPrice);
    if (!(unitCost > 0)) problems.push("unitCost must be a positive number");
    if (!(dealerPrice > 0)) problems.push("dealerPrice must be a positive number");
    const openingStock = r.openingStock === "" ? 0 : Number(r.openingStock);
    if (Number.isNaN(openingStock) || openingStock < 0) problems.push("openingStock must be ≥ 0");

    if (problems.length) {
      errors.push({ row: rowNo, message: problems.join("; ") });
      continue;
    }

    const supplierName = String(r.supplier || "").trim();
    const supplier = suppliers.find((s) => s.name.toLowerCase() === supplierName.toLowerCase());
    const product = await prisma.product.create({
      data: {
        sku,
        name,
        parentItem: String(r.parentItem || "").trim() || null,
        activeIngredient: String(r.activeIngredient || "").trim(),
        category,
        cropTags: String(r.cropTags || "").trim(),
        packSize: String(r.packSize || "").trim(),
        unitCost,
        dealerPrice,
        srp: Number(r.srp) > 0 ? Number(r.srp) : dealerPrice,
        reorderPoint: Number(r.reorderPoint) > 0 ? Number(r.reorderPoint) : 10,
        supplierId: supplier?.id ?? null,
        stockQty: openingStock,
      },
    });
    if (openingStock > 0) {
      await prisma.stockMovement.create({
        data: { productId: product.id, type: "IN", qty: openingStock, balanceAfter: openingStock, refType: "OPENING", refNo: "IMPORT", userId: user.id },
      });
    }
    seenSkus.add(sku);
    imported++;
  }

  return { imported, errors };
}
