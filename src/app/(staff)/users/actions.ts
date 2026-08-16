"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireStaffWrite } from "@/lib/auth";

const ACCESS_LEVELS = ["NONE", "READ_WRITE", "READ_ONLY"];

export async function createUser(formData: FormData) {
  await requireStaffWrite(["SUPER_ADMIN"]);
  const role = String(formData.get("role"));
  const customerId = String(formData.get("customerId")) || null;
  const access = String(formData.get("access"));
  await prisma.user.create({
    data: {
      name: String(formData.get("name")).trim(),
      email: String(formData.get("email")).trim().toLowerCase(),
      passwordHash: bcrypt.hashSync(String(formData.get("password")), 10),
      role,
      access: ACCESS_LEVELS.includes(access) ? access : "READ_WRITE",
      customerId: role === "DEALER" ? customerId : null,
    },
  });
  revalidatePath("/users");
  redirect("/users");
}

/** Save the per-function permission matrix for a user (Super Admin only). */
export async function updateUserPerms(formData: FormData) {
  await requireStaffWrite(["SUPER_ADMIN"]);
  const { FUNCTIONS } = await import("@/lib/permissions");
  const id = String(formData.get("id"));
  const target = await prisma.user.findUniqueOrThrow({ where: { id } });
  if (target.role === "SUPER_ADMIN") redirect("/users"); // super admin is always full access
  const perms: Record<string, string> = {};
  for (const [key] of FUNCTIONS) {
    const v = String(formData.get(`perm_${key}`) || "");
    perms[key] = ACCESS_LEVELS.includes(v) ? v : "NONE";
  }
  await prisma.user.update({ where: { id }, data: { permsJson: JSON.stringify(perms) } });
  revalidatePath(`/users/${id}`);
  redirect(`/users/${id}`);
}

/** Set a user's access level. You cannot change your own (prevents locking yourself out). */
export async function setUserAccess(formData: FormData) {
  const me = await requireStaffWrite(["SUPER_ADMIN"]);
  const id = String(formData.get("id"));
  const access = String(formData.get("access"));
  if (id === me.id) redirect("/users?error=self");
  if (!ACCESS_LEVELS.includes(access)) redirect("/users");
  await prisma.user.update({ where: { id }, data: { access } });
  revalidatePath("/users");
  redirect("/users");
}
