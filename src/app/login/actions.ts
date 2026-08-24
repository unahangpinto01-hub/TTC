"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import {
  createSession, promotePendingSession, destroyCurrentSession, getPendingSession,
  hasTrustedDevice, addTrustedDevice,
} from "@/lib/auth";
import {
  logSecurityEvent, loginRateLimit, twoFactorRateLimit,
  decryptSecret, verifyTotp, hashRecoveryCode, deviceLabel, requestMeta,
} from "@/lib/security";
import { notifyUser, notifyRoles } from "@/lib/notify";

const GENERIC_ERROR = "Invalid username/email or password.";

async function notifyNewLoginIfNewDevice(userId: string) {
  const { userAgent } = requestMeta();
  const label = deviceLabel(userAgent);
  const existing = await prisma.authSession.findFirst({
    where: { userId, revokedAt: null, userAgent, createdAt: { lt: new Date(Date.now() - 60 * 1000) } },
  });
  if (!existing) {
    await notifyUser(userId, "SECURITY_NEW_LOGIN", `🔐 New sign-in to your account from ${label}. If this wasn't you, change your password now.`, "/account/security");
  }
}

async function alertAdminsOnRepeatedFailures(email: string) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const fails = await prisma.securityEvent.count({ where: { email, action: "LOGIN_FAILED", createdAt: { gte: since } } });
  if (fails === 5) {
    await notifyRoles(["SUPER_ADMIN"], "SECURITY_FAILED_LOGINS", `⚠ Repeated failed login attempts for ${email}`, "/users");
  }
}

export async function login(_prev: { error?: string } | null, formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  const limited = await loginRateLimit(email);
  if (limited) return { error: limited };

  const user = await prisma.user.findUnique({ where: { email } });
  // constant-shape check: hash comparison runs even for unknown users to avoid timing/user-enumeration signals
  const hash = user?.passwordHash ?? "$2a$10$mB9W0S3P3F1t7dF8yqzjPeWv0lS1yq0mYQ7XyhZ0uUuXo0G3o8b3S";
  const ok = bcrypt.compareSync(password, hash);
  if (!user || !ok) {
    await logSecurityEvent({ action: "LOGIN_FAILED", success: false, email, userId: user?.id });
    await alertAdminsOnRepeatedFailures(email);
    return { error: GENERIC_ERROR };
  }
  if (user.access === "NONE") {
    await logSecurityEvent({ action: "LOGIN_FAILED", success: false, email, userId: user.id });
    return { error: GENERIC_ERROR };
  }

  // 2FA holders get a pending session (NOT authenticated) unless this device is trusted
  if (user.twoFactorEnabled) {
    if (await hasTrustedDevice(user.id)) {
      await createSession(user.id, { stepUp: false });
      await logSecurityEvent({ action: "LOGIN_SUCCESS", success: true, userId: user.id, email });
      await notifyNewLoginIfNewDevice(user.id);
      redirect(user.role === "DEALER" ? "/portal" : "/dashboard");
    }
    await createSession(user.id, { pending: true });
    redirect("/login/2fa");
  }

  await createSession(user.id, { stepUp: true }); // password just verified = fresh
  await logSecurityEvent({ action: "LOGIN_SUCCESS", success: true, userId: user.id, email });
  await notifyNewLoginIfNewDevice(user.id);
  redirect(user.role === "DEALER" ? "/portal" : "/dashboard");
}

export async function verifyTwoFactor(_prev: { error?: string } | null, formData: FormData) {
  const pending = await getPendingSession();
  if (!pending) redirect("/login");
  const user = pending.user;

  const limited = await twoFactorRateLimit(user.id);
  if (limited) return { error: limited };

  const code = String(formData.get("code") || "").trim();
  const useRecovery = formData.get("mode") === "recovery";
  let verified = false;

  if (useRecovery) {
    const codeHash = hashRecoveryCode(code);
    const rc = await prisma.recoveryCode.findFirst({ where: { userId: user.id, codeHash, usedAt: null } });
    if (rc) {
      await prisma.recoveryCode.update({ where: { id: rc.id }, data: { usedAt: new Date() } }); // single-use, marked immediately
      verified = true;
      await logSecurityEvent({ action: "RECOVERY_CODE_USED", success: true, userId: user.id });
      const left = await prisma.recoveryCode.count({ where: { userId: user.id, usedAt: null } });
      await notifyUser(user.id, "SECURITY_RECOVERY_USED", `🔑 A recovery code was used to sign in. ${left} code(s) remaining — regenerate them in Security settings.`, "/account/security");
    }
  } else if (user.twoFactorSecretEnc) {
    verified = verifyTotp(decryptSecret(user.twoFactorSecretEnc), code);
  }

  if (!verified) {
    await logSecurityEvent({ action: "TWO_FACTOR_FAILED", success: false, userId: user.id });
    return { error: "Invalid code. Please try again." };
  }

  await promotePendingSession(pending.id); // rotates the session token
  await logSecurityEvent({ action: "TWO_FACTOR_SUCCESS", success: true, userId: user.id });
  await logSecurityEvent({ action: "LOGIN_SUCCESS", success: true, userId: user.id, email: user.email });

  if (formData.get("rememberDevice") === "on" && !useRecovery) {
    await addTrustedDevice(user.id);
    await logSecurityEvent({ action: "TRUSTED_DEVICE_ADDED", success: true, userId: user.id });
  }
  await notifyNewLoginIfNewDevice(user.id);
  redirect(user.role === "DEALER" ? "/portal" : "/dashboard");
}

export async function logout() {
  await destroyCurrentSession();
  redirect("/login");
}
