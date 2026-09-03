"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { parseUpload } from "@/lib/xlsx-helpers";
import { logAudit } from "@/lib/salespeople";
import { revalidatePath } from "next/cache";
import type { ImportResult } from "../inventory/import/actions";

export async function createCustomer(formData: FormData) {
  await requirePermWrite("customers");
  const terms = ["COD", "30", "60", "90"].filter((t) => formData.get(`term_${t}`));
  const c = await prisma.customer.create({
    data: {
      businessName: String(formData.get("businessName")).trim(),
      contactPerson: String(formData.get("contactPerson") || "").trim(),
      mobile: String(formData.get("mobile") || "").trim(),
      messengerHandle: String(formData.get("messengerHandle") || "").trim() || null,
      address: String(formData.get("address") || "").trim() || null,
      region: String(formData.get("region")),
      province: String(formData.get("province") || "").trim(),
      creditLimit: Number(formData.get("creditLimit")) || 0,
      allowedTerms: terms.length ? terms.join(",") : "COD",
      salespersonId: String(formData.get("salespersonId") || "") || null,
    },
  });
  redirect(`/customers/${c.id}`);
}

/** Assign or change the salesperson who owns this account. Recorded in the audit trail.
    Existing forecast lines keep the salesperson they were planned under. */
export async function setCustomerSalesperson(formData: FormData) {
  const me = await requirePermWrite("customers");
  const id = String(formData.get("id"));
  const nextId = String(formData.get("salespersonId") || "") || null;

  const before = await prisma.customer.findUniqueOrThrow({
    where: { id },
    select: { businessName: true, salespersonId: true, salesperson: { select: { name: true } } },
  });
  if (before.salespersonId === nextId) redirect(`/customers/${id}`);

  const next = nextId
    ? await prisma.employee.findFirst({ where: { id: nextId, isSalesperson: true }, select: { id: true, name: true } })
    : null;
  if (nextId && !next) redirect(`/customers/${id}?error=salesperson`);

  await prisma.customer.update({ where: { id }, data: { salespersonId: next?.id ?? null } });

  const fromName = before.salesperson?.name ?? "(none)";
  const toName = next?.name ?? "(none)";
  await logAudit({
    entity: "Customer",
    entityId: id,
    action: !before.salespersonId ? "SALESPERSON_ASSIGNED" : next ? "SALESPERSON_CHANGED" : "SALESPERSON_CLEARED",
    detail: `Salesperson: ${fromName} → ${toName}`,
    actorName: me.name,
    actorEmail: me.email,
  });
  revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
  redirect(`/customers/${id}?salesperson=ok`);
}

export async function updateCustomer(formData: FormData) {
  await requirePermWrite("customers");
  const id = String(formData.get("id"));
  const terms = ["COD", "30", "60", "90"].filter((t) => formData.get(`term_${t}`));
  await prisma.customer.update({
    where: { id },
    data: {
      businessName: String(formData.get("businessName")).trim(),
      contactPerson: String(formData.get("contactPerson") || "").trim(),
      mobile: String(formData.get("mobile") || "").trim(),
      messengerHandle: String(formData.get("messengerHandle") || "").trim() || null,
      address: String(formData.get("address") || "").trim() || null,
      region: String(formData.get("region")),
      province: String(formData.get("province") || "").trim(),
      creditLimit: Number(formData.get("creditLimit")) || 0,
      allowedTerms: terms.length ? terms.join(",") : "COD",
      status: formData.get("status") === "Inactive" ? "Inactive" : "Active",
    },
  });
  redirect(`/customers/${id}`);
}

const REGIONS = ["Luzon", "Visayas", "Mindanao"];
const VALID_TERMS = ["COD", "30", "60", "90"];

export async function importCustomers(_prev: ImportResult, formData: FormData): Promise<ImportResult> {
  await requirePermWrite("customers");
  const file = formData.get("file") as File | null;
  if (!file || !file.size) return { imported: 0, errors: [{ row: 0, message: "No file uploaded." }] };

  let rows: Record<string, any>[];
  try {
    rows = await parseUpload(file);
  } catch {
    return { imported: 0, errors: [{ row: 0, message: "Could not read file — upload an .xlsx file." }] };
  }

  const existing = new Set(
    (await prisma.customer.findMany({ select: { businessName: true } })).map((c) => c.businessName.toLowerCase())
  );
  const errors: { row: number; message: string }[] = [];
  let imported = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2;
    const r = rows[i];
    const businessName = String(r.businessName || "").trim();
    const region = String(r.region || "").trim();
    const termsRaw = String(r.allowedTerms || "COD").split(",").map((t) => t.trim()).filter(Boolean);
    const problems: string[] = [];
    if (!businessName) problems.push("businessName is required");
    else if (existing.has(businessName.toLowerCase())) problems.push(`"${businessName}" already exists`);
    if (!REGIONS.includes(region)) problems.push("region must be Luzon, Visayas, or Mindanao");
    const badTerms = termsRaw.filter((t) => !VALID_TERMS.includes(t));
    if (badTerms.length) problems.push(`invalid terms: ${badTerms.join(", ")} (use COD,30,60,90)`);
    const creditLimit = r.creditLimit === "" ? 0 : Number(r.creditLimit);
    if (Number.isNaN(creditLimit) || creditLimit < 0) problems.push("creditLimit must be ≥ 0");

    if (problems.length) {
      errors.push({ row: rowNo, message: problems.join("; ") });
      continue;
    }

    await prisma.customer.create({
      data: {
        businessName,
        contactPerson: String(r.contactPerson || "").trim(),
        mobile: String(r.mobile || "").trim(),
        region,
        province: String(r.province || "").trim(),
        allowedTerms: termsRaw.join(","),
        creditLimit,
      },
    });
    existing.add(businessName.toLowerCase());
    imported++;
  }

  return { imported, errors };
}
