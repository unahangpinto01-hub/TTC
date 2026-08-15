"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";

export async function createUser(formData: FormData) {
  await requireStaff(["SUPER_ADMIN"]);
  const role = String(formData.get("role"));
  const customerId = String(formData.get("customerId")) || null;
  await prisma.user.create({
    data: {
      name: String(formData.get("name")).trim(),
      email: String(formData.get("email")).trim().toLowerCase(),
      passwordHash: bcrypt.hashSync(String(formData.get("password")), 10),
      role,
      customerId: role === "DEALER" ? customerId : null,
    },
  });
  revalidatePath("/users");
  redirect("/users");
}
