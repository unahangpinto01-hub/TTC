import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac } from "crypto";
import { prisma } from "./db";
import { getPerm, type FnKey } from "./permissions";

const SECRET = process.env.AUTH_SECRET || "teamagro-dev-secret-change-me";
const COOKIE = "tt_session";

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}

export function makeToken(userId: string): string {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 days
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function parseToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  if (sign(`${userId}.${exp}`) !== sig) return null;
  if (Number(exp) < Date.now()) return null;
  return userId;
}

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  access: string;
  permsJson: string | null;
  customerId: string | null;
};

export async function getUser(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE)?.value;
  const userId = parseToken(token);
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, access: true, permsJson: true, customerId: true },
  });
  if (user?.access === "NONE") return null; // no-access accounts are treated as signed out
  return user;
}

/** Staff-only guard. Dealers are bounced to the portal. */
export async function requireStaff(roles?: string[]): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.role === "DEALER") redirect("/portal");
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

export const SESSION_COOKIE = COOKIE;
