"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { logAudit } from "@/lib/salespeople";

/**
 * The BIR expanded withholding tax types are data, not program: the office adds a type or
 * changes a rate here. A bill copies the rate when it is saved, so changing a rate never
 * touches bills already saved or posted.
 */
export async function saveWithholdingTaxType(formData: FormData) {
  const user = await requirePermWrite("coa");
  const id = String(formData.get("id") || "");
  const code = String(formData.get("code") || "").trim().toUpperCase();
  const name = String(formData.get("name") || "").trim();
  const ratePct = Number(formData.get("ratePct"));
  const appliesTo = ["GOODS", "SERVICES", "ANY"].includes(String(formData.get("appliesTo"))) ? String(formData.get("appliesTo")) : "ANY";
  const status = String(formData.get("status")) === "Inactive" ? "Inactive" : "Active";
  if (!code || !name) redirect("/finance/withholding-tax?error=fields");
  if (!Number.isFinite(ratePct) || ratePct <= 0 || ratePct >= 100) redirect("/finance/withholding-tax?error=rate");
  const rate = Math.round(ratePct * 10000) / 1000000; // 1 → 0.01, four decimals of a percent

  const clash = await prisma.withholdingTaxType.findFirst({ where: { code, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
  if (clash) redirect("/finance/withholding-tax?error=dupe");
  const before = id ? await prisma.withholdingTaxType.findUnique({ where: { id } }) : null;
  const sortOrder = Number(formData.get("sortOrder")) || before?.sortOrder || 0;
  const row = before
    ? await prisma.withholdingTaxType.update({ where: { id }, data: { code, name, rate, appliesTo, status, sortOrder } })
    : await prisma.withholdingTaxType.create({ data: { code, name, rate, appliesTo, status, sortOrder } });
  await logAudit({
    entity: "WithholdingTaxType", entityId: row.id, action: before ? "EDITED" : "CREATED",
    detail: before ? `${code} ${name}: ${(before.rate * 100).toFixed(2)}% → ${(rate * 100).toFixed(2)}% · ${before.status} → ${status}` : `${code} ${name} at ${(rate * 100).toFixed(2)}% for ${appliesTo}`,
    actorName: user.name, actorEmail: user.email,
  });
  revalidatePath("/finance/withholding-tax");
  redirect("/finance/withholding-tax?saved=1");
}
