import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac } from "crypto";
import { prisma } from "./db";

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
  customerId: string | null;
};

export async function getUser(): Promise<SessionUser | null> {
  const token = cookies().get(COOKIE)?.value;
  const userId = parseToken(token);
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, customerId: true },
  });
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

export async function requireDealer(): Promise<SessionUser & { customerId: string }> {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.role !== "DEALER" || !user.customerId) redirect("/dashboard");
  return user as SessionUser & { customerId: string };
}

export const SESSION_COOKIE = COOKIE;
