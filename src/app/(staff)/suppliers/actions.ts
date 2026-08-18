"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";

export type CreateSupplierResult = { ok: boolean; message: string; ts: number } | null;

export async function createSupplier(_prev: CreateSupplierResult, formData: FormData): Promise<CreateSupplierResult> {
  await requirePermWrite("suppliers");
  const name = String(formData.get("name")).trim();
  if (!name) return { ok: false, message: "Name is required.", ts: Date.now() };
  const duplicate = await prisma.supplier.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (duplicate) return { ok: false, message: `"${duplicate.name}" already exists.`, ts: Date.now() };
  await prisma.supplier.create({
    data: {
      name,
      contact: String(formData.get("contact") || "").trim() || null,
      address: String(formData.get("address") || "").trim() || null,
      status: formData.get("status") === "Inactive" ? "Inactive" : "Active",
    },
  });
  revalidatePath("/suppliers");
  return { ok: true, message: `Supplier "${name}" added.`, ts: Date.now() };
}

export async function updateSupplier(formData: FormData) {
  await requirePermWrite("suppliers");
  const id = String(formData.get("id"));
  await prisma.supplier.update({
    where: { id },
    data: {
      name: String(formData.get("name")).trim(),
      contact: String(formData.get("contact") || "").trim() || null,
      address: String(formData.get("address") || "").trim() || null,
      status: formData.get("status") === "Inactive" ? "Inactive" : "Active",
    },
  });
  revalidatePath("/suppliers");
  redirect("/suppliers");
}
