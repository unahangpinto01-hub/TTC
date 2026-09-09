"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireStaffWrite, requireStepUp } from "@/lib/auth";
import { passwordPolicyCode, logSecurityEvent } from "@/lib/security";
import { notifyUser } from "@/lib/notify";
import { logAudit } from "@/lib/salespeople";
import { REPORTS, reportPermKey } from "@/lib/report-registry";
import { storedReportPerm } from "@/lib/report-access";

const ACCESS_LEVELS = ["NONE", "READ_WRITE", "READ_ONLY"];

/** Deliberately strict but ordinary: one @, a dotted domain, no spaces. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function createUser(formData: FormData) {
  await requireStaffWrite(["SUPER_ADMIN"]);
  await requireStepUp("/users");
  const role = String(formData.get("role"));
  const customerId = String(formData.get("customerId")) || null;
  const access = String(formData.get("access"));
  const password = String(formData.get("password"));
  const name = String(formData.get("name") || "").trim().replace(/\s+/g, " ");
  const email = String(formData.get("email") || "").trim().toLowerCase();

  if (!name) redirect("/users?error=name_required");
  if (!email) redirect("/users?error=email_required");
  if (!EMAIL_RE.test(email)) redirect("/users?error=email_invalid");
  if (email.length > 120) redirect("/users?error=email_long");
  const pw = passwordPolicyCode(password);
  if (pw) redirect(`/users?error=${pw}`);
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    redirect("/users?error=email_taken");
  }

  try {
    await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: bcrypt.hashSync(password, 12),
        role,
        access: ACCESS_LEVELS.includes(access) ? access : "READ_WRITE",
        customerId: role === "DEALER" ? customerId : null,
      },
    });
  } catch {
    // e.g. the address was claimed between the check above and the insert
    redirect("/users?error=create_failed");
  }
  revalidatePath("/users");
  redirect("/users?created=ok");
}

/** Save the per-function permission matrix for a user (Super Admin only). */
export async function updateUserPerms(formData: FormData) {
  await requireStaffWrite(["SUPER_ADMIN"]);
  await requireStepUp("/users");
  const { FUNCTIONS } = await import("@/lib/permissions");
  const id = String(formData.get("id"));
  const target = await prisma.user.findUniqueOrThrow({ where: { id } });
  if (target.role === "SUPER_ADMIN") redirect("/users"); // super admin is always full access
  // start from what is already stored: the report grants live in the same blob and are
  // edited on their own screen, so rebuilding from FUNCTIONS alone would erase them
  let perms: Record<string, string> = {};
  try {
    perms = target.permsJson ? (JSON.parse(target.permsJson) as Record<string, string>) : {};
  } catch {
    perms = {};
  }
  for (const [key] of FUNCTIONS) {
    const v = String(formData.get(`perm_${key}`) || "");
    perms[key] = ACCESS_LEVELS.includes(v) ? v : "NONE";
  }
  await prisma.user.update({ where: { id }, data: { permsJson: JSON.stringify(perms) } });
  revalidatePath(`/users/${id}`);
  redirect(`/users/${id}`);
}

/**
 * Save the Report Permissions grid (Super Admin only).
 *
 * Writes into the same per-user permissions the rest of the BMS reads, so a report grant and
 * a module grant can never drift into two different stories. Only the rows actually on
 * screen are touched, and only real changes are written or logged.
 */
export async function saveReportPermissions(formData: FormData) {
  const actor = await requireStaffWrite(["SUPER_ADMIN"]);
  await requireStepUp("/users/report-permissions");

  const targets = await prisma.user.findMany({
    where: { role: { notIn: ["SUPER_ADMIN", "DEALER"] } },
    select: { id: true, name: true, email: true, role: true, access: true, permsJson: true },
  });

  type Change = { user: string; report: string; from: string; to: string };
  const changes: Change[] = [];

  for (const u of targets) {
    let perms: Record<string, string> = {};
    try {
      perms = u.permsJson ? (JSON.parse(u.permsJson) as Record<string, string>) : {};
    } catch {
      perms = {};
    }
    let touched = false;

    for (const r of REPORTS) {
      const field = formData.get(`p_${u.id}_${r.key}`);
      if (field === null) continue; // not on the filtered screen — leave it exactly as it is
      const next = ACCESS_LEVELS.includes(String(field)) ? String(field) : "NONE";
      const before = storedReportPerm(u, r.key);
      if (before === next) continue;
      perms[reportPermKey(r.key)] = next;
      touched = true;
      changes.push({ user: u.name, report: r.title, from: before, to: next });
    }

    if (touched) await prisma.user.update({ where: { id: u.id }, data: { permsJson: JSON.stringify(perms) } });
  }

  const label: Record<string, string> = { NONE: "No Access", READ_ONLY: "Read Only", READ_WRITE: "Read/Write" };
  for (const c of changes) {
    await logAudit({
      entity: "ReportPermission",
      // one shared thread, so the whole history reads in order on the permissions screen
      entityId: "ALL",
      action: "CHANGED",
      detail: `${c.user} · ${c.report}: ${label[c.from] ?? c.from} → ${label[c.to] ?? c.to}`,
      actorName: actor.name,
      actorEmail: actor.email,
    });
  }

  const back = String(formData.get("returnTo") || "");
  revalidatePath("/users/report-permissions");
  revalidatePath("/reports");
  redirect(`/users/report-permissions?${back ? back + "&" : ""}saved=${changes.length ? "ok" : "none"}`);
}

/** Admin-performed password reset (no self-service email flow exists).
    Signs the target user out everywhere; does NOT bypass their 2FA. */
export async function resetUserPassword(formData: FormData) {
  const me = await requireStaffWrite(["SUPER_ADMIN"]);
  await requireStepUp("/users");
  const id = String(formData.get("id"));
  const password = String(formData.get("password") || "");
  const pw = passwordPolicyCode(password);
  if (pw) redirect(`/users/${id}?error=${pw}`);
  await prisma.user.update({ where: { id }, data: { passwordHash: bcrypt.hashSync(password, 12) } });
  await prisma.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  await logSecurityEvent({ action: "PASSWORD_CHANGED", success: true, userId: id });
  await notifyUser(id, "SECURITY_PASSWORD_CHANGED", `🔐 Your password was reset by ${me.name}. All sessions were signed out.`, "/account/security");
  revalidatePath(`/users/${id}`);
  redirect(`/users/${id}?reset=ok`);
}

/** Rename a user. Super Admin only; the audit trail records who made the change. */
export async function renameUser(formData: FormData) {
  const me = await requireStaffWrite(["SUPER_ADMIN"]);
  await requireStepUp("/users");
  const id = String(formData.get("id"));
  const name = String(formData.get("name") || "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) redirect(`/users/${id}?error=name`);
  const before = await prisma.user.findUniqueOrThrow({ where: { id }, select: { name: true } });
  if (before.name === name) redirect(`/users/${id}`);
  await prisma.user.update({ where: { id }, data: { name } });
  // the event sits on the renamed account; email carries the super admin who did it
  await logSecurityEvent({ action: "USER_RENAMED", success: true, userId: id, email: me.email });
  revalidatePath(`/users/${id}`);
  revalidatePath("/users");
  redirect(`/users/${id}?renamed=ok`);
}

/** Change a user's email address — this is their login, so every session is revoked and
    the audit trail keeps the old address alongside the new one. Super Admin only. */
export async function changeUserEmail(formData: FormData) {
  const me = await requireStaffWrite(["SUPER_ADMIN"]);
  await requireStepUp("/users");
  const id = String(formData.get("id"));
  const email = String(formData.get("email") || "").trim().toLowerCase();

  if (!email) redirect(`/users/${id}?error=email_required`);
  if (email.length > 120) redirect(`/users/${id}?error=email_long`);
  if (!EMAIL_RE.test(email)) redirect(`/users/${id}?error=email_invalid`);

  const before = await prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true, name: true } });
  if (before.email === email) redirect(`/users/${id}`); // nothing to do
  const clash = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (clash && clash.id !== id) redirect(`/users/${id}?error=email_taken`);

  await prisma.user.update({ where: { id }, data: { email } });
  // the address is the login credential: everyone signed in on the old one is cut off
  await prisma.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  await logSecurityEvent({
    action: "USER_EMAIL_CHANGED",
    success: true,
    userId: id,
    email: `${before.email} → ${email}`,
  });
  await notifyUser(
    id,
    "SECURITY_EMAIL_CHANGED",
    `🔐 Your sign-in email was changed to ${email} by ${me.name}. All sessions were signed out.`,
    "/account/security"
  );
  revalidatePath(`/users/${id}`);
  revalidatePath("/users");
  redirect(`/users/${id}?email=ok`);
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
