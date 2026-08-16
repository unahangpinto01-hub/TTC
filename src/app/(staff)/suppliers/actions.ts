"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";

export async function createSupplier(formData: FormData) {
  await requirePermWrite("suppliers");
  await prisma.supplier.create({
    data: {
      name: String(formData.get("name")).trim(),
      contact: String(formData.get("contact") || "").trim() || null,
      address: String(formData.get("address") || "").trim() || null,
      status: formData.get("status") === "Inactive" ? "Inactive" : "Active",
    },
  });
  revalidatePath("/suppliers");
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
