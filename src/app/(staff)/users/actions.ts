"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireStaffWrite, requireStepUp } from "@/lib/auth";
import { passwordPolicyError, logSecurityEvent } from "@/lib/security";
import { notifyUser } from "@/lib/notify";

const ACCESS_LEVELS = ["NONE", "READ_WRITE", "READ_ONLY"];

export async function createUser(formData: FormData) {
  await requireStaffWrite(["SUPER_ADMIN"]);
  await requireStepUp("/users");
  const role = String(formData.get("role"));
  const customerId = String(formData.get("customerId")) || null;
  const access = String(formData.get("access"));
  const password = String(formData.get("password"));
  if (passwordPolicyError(password)) redirect("/users?error=weakpw");
  await prisma.user.create({
    data: {
      name: String(formData.get("name")).trim(),
      email: String(formData.get("email")).trim().toLowerCase(),
      passwordHash: bcrypt.hashSync(password, 12),
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
  await requireStepUp("/users");
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

/** Admin-performed password reset (no self-service email flow exists).
    Signs the target user out everywhere; does NOT bypass their 2FA. */
export async function resetUserPassword(formData: FormData) {
  const me = await requireStaffWrite(["SUPER_ADMIN"]);
  await requireStepUp("/users");
  const id = String(formData.get("id"));
  const password = String(formData.get("password") || "");
  if (passwordPolicyError(password)) redirect(`/users/${id}?error=weakpw`);
  await prisma.user.update({ where: { id }, data: { passwordHash: bcrypt.hashSync(password, 12) } });
  await prisma.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  await logSecurityEvent({ action: "PASSWORD_CHANGED", success: true, userId: id });
  await notifyUser(id, "SECURITY_PASSWORD_CHANGED", `🔐 Your password was reset by ${me.name}. All sessions were signed out.`, "/account/security");
  revalidatePath(`/users/${id}`);
  redirect(`/users/${id}?reset=ok`);
}

/** Explicitly assign which companies a user may access (Super Admin only, step-up protected).
    Null/empty = primary company only. You cannot remove your own access to all companies. */
export async function setUserCompanies(formData: FormData) {
  const me = await requireStaffWrite(["SUPER_ADMIN"]);
  await requireStepUp("/users");
  const id = String(formData.get("id"));
  const companies = await prisma.company.findMany({ where: { status: "Active" } });
  const chosen = companies.filter((c) => formData.get(`co_${c.id}`) === "on").map((c) => c.id);
  if (id === me.id && chosen.length === 0) redirect(`/users/${id}?error=selfco`);
  await prisma.user.update({
    where: { id },
    data: { companyIdsJson: chosen.length ? JSON.stringify(chosen) : null },
  });
  await logSecurityEvent({ action: "COMPANY_ACCESS_CHANGED", success: true, userId: id });
  revalidatePath(`/users/${id}`);
  redirect(`/users/${id}?companies=ok`);
}

/** Set a user's access level. You cannot change your own (prevents locking yourself out). */
export async function setUserAccess(formData: FormData) {
  const me = await requireStaffWrite(["SUPER_ADMIN"]);
  await requireStepUp("/users");
  const id = String(formData.get("id"));
  const access = String(formData.get("access"));
  if (id === me.id) redirect("/users?error=self");
  if (!ACCESS_LEVELS.includes(access)) redirect("/users");
  await prisma.user.update({ where: { id }, data: { access } });
  revalidatePath("/users");
  redirect("/users");
}
