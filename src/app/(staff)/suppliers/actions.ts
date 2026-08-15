"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";

export async function createSupplier(formData: FormData) {
  await requireStaff(["SUPER_ADMIN", "ADMIN"]);
  await prisma.supplier.create({
    data: {
      name: String(formData.get("name")).trim(),
      contact: String(formData.get("contact") || "").trim() || null,
      address: String(formData.get("address") || "").trim() || null,
    },
  });
  revalidatePath("/suppliers");
}
