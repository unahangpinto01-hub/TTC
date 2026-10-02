"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { logAudit } from "@/lib/salespeople";

const BASE = "/finance/discount-reasons";

/**
 * The reasons an Other Discount may be granted for are data, not program: each carries the
 * account it is booked to, and whether it must be explained. Editing one never touches the
 * payments already posted under it.
 */
export async function saveDiscountReason(formData: FormData) {
  const user = await requirePermWrite("coa");
  const id = String(formData.get("id") || "");
  const name = String(formData.get("name") || "").trim().slice(0, 80);
  const glAccountId = String(formData.get("glAccountId") || "") || null;
  const requiresRemarks = formData.get("requiresRemarks") === "on";
  const status = String(formData.get("status")) === "Inactive" ? "Inactive" : "Active";
  if (!name) redirect(`${BASE}?error=fields`);
  if (glAccountId && !(await prisma.gLAccount.findFirst({ where: { id: glAccountId, status: "Active" }, select: { id: true } }))) redirect(`${BASE}?error=account`);
  const clash = await prisma.otherDiscountReason.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
  if (clash) redirect(`${BASE}?error=dupe`);
  const before = id ? await prisma.otherDiscountReason.findUnique({ where: { id } }) : null;
  const sortOrder = Number(formData.get("sortOrder")) || before?.sortOrder || 0;
  const row = before
    ? await prisma.otherDiscountReason.update({ where: { id }, data: { name, glAccountId, requiresRemarks, status, sortOrder } })
    : await prisma.otherDiscountReason.create({ data: { name, glAccountId, requiresRemarks, status, sortOrder } });
  await logAudit({
    entity: "OtherDiscountReason", entityId: row.id, action: before ? "EDITED" : "CREATED",
    detail: `${name}: ${status}${requiresRemarks ? ", remarks required" : ""}${glAccountId ? "" : ", booked to the company default account"}`,
    actorName: user.name, actorEmail: user.email,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?saved=1`);
}
