"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireStaff, getCurrentSession, markStepUp } from "@/lib/auth";
import { logSecurityEvent, twoFactorRateLimit, decryptSecret, verifyTotp } from "@/lib/security";

export async function confirmStepUp(_prev: { error?: string } | null, formData: FormData) {
  const user = await requireStaff();
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  const nextRaw = String(formData.get("next") || "/dashboard");
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/dashboard";

  const limited = await twoFactorRateLimit(user.id);
  if (limited) return { error: limited };

  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  let ok = false;
  if (dbUser.twoFactorEnabled && dbUser.twoFactorSecretEnc) {
    ok = verifyTotp(decryptSecret(dbUser.twoFactorSecretEnc), String(formData.get("code") || "").trim());
  } else {
    ok = bcrypt.compareSync(String(formData.get("password") || ""), dbUser.passwordHash);
  }
  if (!ok) {
    await logSecurityEvent({ action: "STEP_UP_FAILED", success: false, userId: user.id });
    return { error: dbUser.twoFactorEnabled ? "Invalid authenticator code." : "Incorrect password." };
  }
  await markStepUp(session.id);
  await logSecurityEvent({ action: "STEP_UP_SUCCESS", success: true, userId: user.id });
  redirect(next);
}
