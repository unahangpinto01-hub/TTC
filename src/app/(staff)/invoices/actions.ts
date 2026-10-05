"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { logAudit } from "@/lib/salespeople";

/**
 * The customer's own reference for an invoice — the TRA number a dealer like DCS quotes on
 * its remittances — so a collection can be matched to the document the customer names.
 * It is a label on the invoice, never part of its accounting, so AR write access is enough.
 */
export async function setCustomerRef(formData: FormData) {
  const user = await requirePermWrite("ar");
  const company = await getActiveCompany(user);
  const id = String(formData.get("srId") || "");
  const ref = String(formData.get("customerRef") || "").trim().slice(0, 80) || null;
  const sr = await prisma.salesReceipt.findUnique({ where: { id }, select: { id: true, srNumber: true, companyId: true, customerRef: true } });
  if (!sr || sr.companyId !== company.id) redirect("/denied");
  if ((sr.customerRef ?? null) !== ref) {
    await prisma.salesReceipt.update({ where: { id }, data: { customerRef: ref } });
    await logAudit({
      entity: "SalesReceipt", entityId: id, action: "EDITED",
      detail: `${sr.srNumber} customer reference: ${sr.customerRef ?? "—"} → ${ref ?? "—"}`,
      actorName: user.name, actorEmail: user.email, companyId: company.id,
    });
  }
  revalidatePath(`/invoices/${id}`);
  redirect(`/invoices/${id}`);
}
