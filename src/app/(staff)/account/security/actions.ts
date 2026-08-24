"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireStaff, getCurrentSession, markStepUp } from "@/lib/auth";
import {
  logSecurityEvent, twoFactorRateLimit, passwordPolicyError,
  newTotpSecret, encryptSecret, decryptSecret, verifyTotp,
  newRecoveryCodes, hashRecoveryCode,
} from "@/lib/security";
import { notifyUser } from "@/lib/notify";

const MFA_REQUIRED_ROLES = ["SUPER_ADMIN", "ADMIN"];

/* ------------------------------------------------------------- password change */

export type FormResult = { ok?: string; error?: string; recoveryCodes?: string[] } | null;

export async function changePassword(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await requireStaff(undefined, { allowUnenrolled: true });
  const current = String(formData.get("current") || "");
  const next = String(formData.get("next") || "");
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!bcrypt.compareSync(current, dbUser.passwordHash)) {
    return { error: "Current password is incorrect." };
  }
  const policy = passwordPolicyError(next);
  if (policy) return { error: policy };
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: bcrypt.hashSync(next, 12) } });
  // sign out every OTHER session — a stolen session dies with the old password
  const me = await getCurrentSession();
  await prisma.authSession.updateMany({
    where: { userId: user.id, revokedAt: null, ...(me ? { id: { not: me.id } } : {}) },
    data: { revokedAt: new Date() },
  });
  if (me) await markStepUp(me.id);
  await logSecurityEvent({ action: "PASSWORD_CHANGED", success: true, userId: user.id });
  await notifyUser(user.id, "SECURITY_PASSWORD_CHANGED", "🔐 Your password was changed. All other sessions were signed out.", "/account/security");
  return { ok: "Password changed. Other sessions have been signed out." };
}

/* ------------------------------------------------------------- 2FA enrollment */

export async function beginTwoFactorSetup(): Promise<void> {
  const user = await requireStaff(undefined, { allowUnenrolled: true });
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (dbUser.twoFactorEnabled) redirect("/account/security");
  await prisma.user.update({
    where: { id: user.id },
    data: { pendingTotpSecretEnc: encryptSecret(newTotpSecret()) },
  });
  revalidatePath("/account/security");
  redirect("/account/security");
}

export async function cancelTwoFactorSetup(): Promise<void> {
  const user = await requireStaff(undefined, { allowUnenrolled: true });
  await prisma.user.update({ where: { id: user.id }, data: { pendingTotpSecretEnc: null } });
  revalidatePath("/account/security");
  redirect("/account/security");
}

/** Verify the first authenticator code — ONLY then does 2FA become enabled. Returns recovery codes once. */
export async function verifyTwoFactorSetup(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await requireStaff(undefined, { allowUnenrolled: true });
  const limited = await twoFactorRateLimit(user.id);
  if (limited) return { error: limited };
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!dbUser.pendingTotpSecretEnc) return { error: "Setup has not been started." };
  const code = String(formData.get("code") || "").trim();
  if (!verifyTotp(decryptSecret(dbUser.pendingTotpSecretEnc), code)) {
    await logSecurityEvent({ action: "TWO_FACTOR_FAILED", success: false, userId: user.id });
    return { error: "Invalid code — check your authenticator app and try again." };
  }
  const codes = newRecoveryCodes(10);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: true,
        twoFactorSecretEnc: dbUser.pendingTotpSecretEnc,
        pendingTotpSecretEnc: null,
        twoFactorEnabledAt: new Date(),
      },
    }),
    prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.recoveryCode.createMany({ data: codes.map((c) => ({ userId: user.id, codeHash: hashRecoveryCode(c) })) }),
  ]);
  await logSecurityEvent({ action: "TWO_FACTOR_ENABLED", success: true, userId: user.id });
  await notifyUser(user.id, "SECURITY_2FA_ENABLED", "✅ Two-factor authentication is now enabled on your account.", "/account/security");
  // NO revalidatePath here — a re-render would unmount the form and hide the one-time recovery codes
  return { ok: "Two-factor authentication enabled.", recoveryCodes: codes };
}

/* ---------------------------------------------------------------- 2FA disable */

export async function disableTwoFactor(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await requireStaff();
  if (MFA_REQUIRED_ROLES.includes(user.role)) {
    return { error: "Two-factor authentication is mandatory for administrator accounts and cannot be disabled." };
  }
  const limited = await twoFactorRateLimit(user.id);
  if (limited) return { error: limited };
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!dbUser.twoFactorEnabled || !dbUser.twoFactorSecretEnc) return { error: "Two-factor authentication is not enabled." };
  const password = String(formData.get("password") || "");
  const code = String(formData.get("code") || "").trim();
  if (!bcrypt.compareSync(password, dbUser.passwordHash)) return { error: "Password is incorrect." };
  if (!verifyTotp(decryptSecret(dbUser.twoFactorSecretEnc), code)) {
    await logSecurityEvent({ action: "TWO_FACTOR_FAILED", success: false, userId: user.id });
    return { error: "Invalid authenticator code." };
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, twoFactorSecretEnc: null, pendingTotpSecretEnc: null, twoFactorEnabledAt: null },
    }),
    prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.trustedDevice.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await logSecurityEvent({ action: "TWO_FACTOR_DISABLED", success: true, userId: user.id });
  await notifyUser(user.id, "SECURITY_2FA_DISABLED", "⚠ Two-factor authentication was DISABLED on your account. If this wasn't you, secure your account immediately.", "/account/security");
  revalidatePath("/account/security");
  return { ok: "Two-factor authentication disabled." };
}

/* ------------------------------------------------------------- recovery codes */

export async function regenerateRecoveryCodes(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const user = await requireStaff();
  const limited = await twoFactorRateLimit(user.id);
  if (limited) return { error: limited };
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!dbUser.twoFactorEnabled || !dbUser.twoFactorSecretEnc) return { error: "Enable two-factor authentication first." };
  const code = String(formData.get("code") || "").trim();
  if (!verifyTotp(decryptSecret(dbUser.twoFactorSecretEnc), code)) {
    await logSecurityEvent({ action: "TWO_FACTOR_FAILED", success: false, userId: user.id });
    return { error: "Invalid authenticator code." };
  }
  const codes = newRecoveryCodes(10);
  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.recoveryCode.createMany({ data: codes.map((c) => ({ userId: user.id, codeHash: hashRecoveryCode(c) })) }),
  ]);
  await logSecurityEvent({ action: "RECOVERY_CODES_REGENERATED", success: true, userId: user.id });
  await notifyUser(user.id, "SECURITY_CODES_REGENERATED", "🔑 Your 2FA recovery codes were regenerated. Old codes no longer work.", "/account/security");
  // no revalidatePath — keep the one-time codes visible until the user navigates away
  return { ok: "New recovery codes generated. Save them now — they will not be shown again.", recoveryCodes: codes };
}

/* ------------------------------------------------------ sessions & devices */

export async function revokeSession(formData: FormData): Promise<void> {
  const user = await requireStaff(undefined, { allowUnenrolled: true });
  const id = String(formData.get("id"));
  await prisma.authSession.updateMany({ where: { id, userId: user.id }, data: { revokedAt: new Date() } });
  await logSecurityEvent({ action: "SESSION_REVOKED", success: true, userId: user.id });
  revalidatePath("/account/security");
  redirect("/account/security");
}

export async function revokeOtherSessions(): Promise<void> {
  const user = await requireStaff(undefined, { allowUnenrolled: true });
  const me = await getCurrentSession();
  await prisma.authSession.updateMany({
    where: { userId: user.id, revokedAt: null, ...(me ? { id: { not: me.id } } : {}) },
    data: { revokedAt: new Date() },
  });
  await logSecurityEvent({ action: "ALL_SESSIONS_REVOKED", success: true, userId: user.id });
  revalidatePath("/account/security");
  redirect("/account/security");
}

export async function revokeTrustedDevice(formData: FormData): Promise<void> {
  const user = await requireStaff(undefined, { allowUnenrolled: true });
  const id = String(formData.get("id"));
  await prisma.trustedDevice.updateMany({ where: { id, userId: user.id }, data: { revokedAt: new Date() } });
  await logSecurityEvent({ action: "TRUSTED_DEVICE_REVOKED", success: true, userId: user.id });
  revalidatePath("/account/security");
  redirect("/account/security");
}
