import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import { getPerm, type FnKey } from "./permissions";
import { newToken, hashToken, requestMeta } from "./security";

const COOKIE = "tt_session";
const DEVICE_COOKIE = "tt_device";
const SESSION_DAYS = 7;
const PENDING_MINUTES = 10; // password-verified, waiting for 2FA
const STEP_UP_MINUTES = 15; // freshness window for sensitive actions

function cookieOpts(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/* ----------------------------------------------------------- session lifecycle */

/** Create a session row + cookie. pending=true = password OK but 2FA still required (NOT authenticated). */
export async function createSession(userId: string, opts?: { pending?: boolean; stepUp?: boolean }): Promise<void> {
  const token = newToken();
  const { ip, userAgent } = requestMeta();
  const pending = opts?.pending ?? false;
  const ttlMs = pending ? PENDING_MINUTES * 60 * 1000 : SESSION_DAYS * 24 * 60 * 60 * 1000;
  await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      userAgent,
      ip,
      pendingTwoFactor: pending,
      stepUpAt: opts?.stepUp ? new Date() : null,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  cookies().set(COOKIE, token, cookieOpts(pending ? PENDING_MINUTES * 60 : SESSION_DAYS * 24 * 60 * 60));
}

/** Promote a pending (post-password, pre-2FA) session to authenticated, ROTATING the token. */
export async function promotePendingSession(sessionId: string): Promise<void> {
  const token = newToken();
  await prisma.authSession.update({
    where: { id: sessionId },
    data: {
      tokenHash: hashToken(token),
      pendingTwoFactor: false,
      stepUpAt: new Date(),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  cookies().set(COOKIE, token, cookieOpts(SESSION_DAYS * 24 * 60 * 60));
}

export async function destroyCurrentSession(): Promise<void> {
  const token = cookies().get(COOKIE)?.value;
  if (token) {
    await prisma.authSession.updateMany({ where: { tokenHash: hashToken(token) }, data: { revokedAt: new Date() } });
  }
  cookies().delete(COOKIE);
}

type SessionRow = NonNullable<Awaited<ReturnType<typeof loadSession>>>;

async function loadSession(opts?: { allowPending?: boolean }) {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  const s = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!s || s.revokedAt || s.expiresAt < new Date()) return null;
  if (s.pendingTwoFactor && !opts?.allowPending) return null;
  if (!s.pendingTwoFactor && Date.now() - s.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await prisma.authSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return s;
}

/** The pending (password-verified, pre-2FA) session for the /login/2fa step. */
export async function getPendingSession() {
  const s = await loadSession({ allowPending: true });
  return s && s.pendingTwoFactor ? s : null;
}

export async function getCurrentSession() {
  return loadSession();
}

/* ----------------------------------------------------------------- user guards */

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  access: string;
  permsJson: string | null;
  customerId: string | null;
  twoFactorEnabled: boolean;
};

function toSessionUser(s: SessionRow): SessionUser {
  const u = s.user;
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, access: u.access,
    permsJson: u.permsJson, customerId: u.customerId, twoFactorEnabled: u.twoFactorEnabled,
  };
}

export async function getUser(): Promise<SessionUser | null> {
  const s = await loadSession();
  if (!s) return null;
  if (s.user.access === "NONE") return null; // no-access accounts are treated as signed out
  return toSessionUser(s);
}

/** Admin roles must have 2FA enabled; unenrolled admins are sent to enrollment before anything else. */
const MFA_REQUIRED_ROLES = ["SUPER_ADMIN", "ADMIN"];

function enforceAdminMfa(user: SessionUser, allowUnenrolled?: boolean) {
  if (!allowUnenrolled && MFA_REQUIRED_ROLES.includes(user.role) && !user.twoFactorEnabled) {
    redirect("/account/security?enroll=required");
  }
}

/** Staff-only guard. Dealers are bounced to the portal. */
export async function requireStaff(roles?: string[], opts?: { allowUnenrolled?: boolean }): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.role === "DEALER") redirect("/portal");
  enforceAdminMfa(user, opts?.allowUnenrolled);
  if (roles && !roles.includes(user.role)) redirect("/dashboard");
  return user;
}

/** Staff guard for mutating actions: read-only accounts are bounced to /denied. */
export async function requireStaffWrite(roles?: string[]): Promise<SessionUser> {
  const user = await requireStaff(roles);
  if (user.access === "READ_ONLY") redirect("/denied");
  return user;
}

/** Page guard for a specific function: NONE is bounced to /denied.
    Returns the user with their effective permission for the function. */
export async function requirePerm(fn: FnKey): Promise<SessionUser & { perm: "READ_WRITE" | "READ_ONLY" }> {
  const user = await requireStaff();
  const perm = getPerm(user, fn);
  if (perm === "NONE") redirect("/denied");
  return { ...user, perm };
}

/** Action guard for a specific function: only READ_WRITE may proceed. */
export async function requirePermWrite(fn: FnKey): Promise<SessionUser> {
  const user = await requirePerm(fn);
  if (user.perm !== "READ_WRITE") redirect("/denied");
  return user;
}

export async function requireDealer(): Promise<SessionUser & { customerId: string }> {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.role !== "DEALER" || !user.customerId) redirect("/dashboard");
  return user as SessionUser & { customerId: string };
}

/* --------------------------------------------------------------------- step-up */

/** Sensitive actions require a FRESH password/2FA confirmation (within 15 min).
    Call after the permission guard; redirects to the confirmation screen when stale. */
export async function requireStepUp(nextPath: string): Promise<void> {
  const s = await loadSession();
  if (!s) redirect("/login");
  if (!s.stepUpAt || Date.now() - s.stepUpAt.getTime() > STEP_UP_MINUTES * 60 * 1000) {
    redirect(`/account/step-up?next=${encodeURIComponent(nextPath)}`);
  }
}

export async function markStepUp(sessionId: string): Promise<void> {
  await prisma.authSession.update({ where: { id: sessionId }, data: { stepUpAt: new Date() } });
}

/* -------------------------------------------------------------- trusted devices */

export const SESSION_COOKIE = COOKIE;
export const TRUSTED_DEVICE_COOKIE = DEVICE_COOKIE;
export const TRUSTED_DEVICE_DAYS = 30;

/** True when this browser holds a valid trusted-device token for the user (skips TOTP at login). */
export async function hasTrustedDevice(userId: string): Promise<boolean> {
  const token = cookies().get(DEVICE_COOKIE)?.value;
  if (!token) return false;
  const d = await prisma.trustedDevice.findUnique({ where: { tokenHash: hashToken(token) } });
  return !!d && d.userId === userId && !d.revokedAt && d.expiresAt > new Date();
}

export async function addTrustedDevice(userId: string): Promise<void> {
  const token = newToken();
  const { userAgent } = requestMeta();
  await prisma.trustedDevice.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      userAgent,
      expiresAt: new Date(Date.now() + TRUSTED_DEVICE_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  cookies().set(DEVICE_COOKIE, token, cookieOpts(TRUSTED_DEVICE_DAYS * 24 * 60 * 60));
}
