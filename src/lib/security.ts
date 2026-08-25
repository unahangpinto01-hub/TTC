import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from "crypto";
import { headers } from "next/headers";
import { prisma } from "./db";

/* ------------------------------------------------------------------ secrets */

/** Session/2FA master secret. Required in production — no insecure fallback. */
export function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET (>=32 chars) must be set in production.");
  }
  return "dev-only-insecure-secret-000000000000";
}

/* ------------------------------------------------------------- tokens/hashes */

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/* --------------------------------------------------- AES-256-GCM at-rest enc */

function encKey(): Buffer {
  return createHash("sha256").update(`${authSecret()}:totp-encryption-key`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  const [iv, tag, data] = stored.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/* ------------------------------------------------------------------- TOTP */

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, "").toUpperCase()) {
    const idx = B32_ALPHABET.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20)); // 160-bit, RFC 4226 recommended
}

function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
  return code;
}

/** RFC 6238 TOTP check: 30s steps, 6 digits, ±1 step clock-drift window. Constant-time compare. */
export function verifyTotp(secretB32: string, code: string): boolean {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const secret = base32Decode(secretB32);
  const step = Math.floor(Date.now() / 1000 / 30);
  for (const delta of [-1, 0, 1]) {
    const expected = hotp(secret, step + delta);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return true;
  }
  return false;
}

export function otpauthUrl(email: string, secretB32: string, issuer = "Teamagro BMS"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/* ----------------------------------------------------------- recovery codes */

export function newRecoveryCodes(n = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    const raw = randomBytes(5).toString("hex").toUpperCase(); // 10 hex chars
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

/* --------------------------------------------------------- password policy */

const WEAK_PASSWORDS = new Set([
  "password", "password1", "password123", "password1234", "passw0rd", "p@ssword", "p@ssw0rd",
  "123456", "1234567", "12345678", "123456789", "1234567890", "12345678910", "qwerty", "qwerty123",
  "qwertyuiop", "abc123", "abcd1234", "iloveyou", "welcome", "welcome1", "admin", "administrator",
  "letmein", "monkey", "dragon", "sunshine", "princess", "football", "baseball", "master",
  "superman", "batman", "trustno1", "shadow", "michael", "jennifer", "111111", "000000",
  "teamagro", "teamagro123", "teamagro2026",
]);

/** Returns an error message, or null when the password is acceptable. */
export function passwordPolicyError(password: string): string | null {
  if (password.length < 12) return "Password must be at least 12 characters long.";
  const lower = password.toLowerCase();
  if (WEAK_PASSWORDS.has(lower)) return "That password is too common — choose something less guessable.";
  for (const weak of WEAK_PASSWORDS) {
    if (weak.length >= 8 && lower.includes(weak)) return "That password contains a very common password — choose something less guessable.";
  }
  if (/^(.)\1+$/.test(password)) return "Password cannot be a single repeated character.";
  return null;
}

/* -------------------------------------------------------------- request meta */

export function requestMeta(): { ip: string | null; userAgent: string | null } {
  try {
    const h = headers();
    const fwd = h.get("x-forwarded-for");
    return {
      ip: fwd ? fwd.split(",")[0].trim() : h.get("x-real-ip"),
      userAgent: h.get("user-agent"),
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/** Compact human label from a user agent, for session lists and alerts. */
export function deviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent) ? "Edge"
    : /OPR\//.test(userAgent) ? "Opera"
    : /Chrome\//.test(userAgent) ? "Chrome"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : /Safari\//.test(userAgent) ? "Safari"
    : "Browser";
  const os = /Windows/.test(userAgent) ? "Windows"
    : /Android/.test(userAgent) ? "Android"
    : /iPhone|iPad/.test(userAgent) ? "iOS"
    : /Mac OS/.test(userAgent) ? "macOS"
    : /Linux/.test(userAgent) ? "Linux"
    : "Unknown OS";
  return `${browser} on ${os}`;
}

/* ------------------------------------------------------ audit + rate limiting */

export type SecurityAction =
  | "LOGIN_SUCCESS" | "LOGIN_FAILED" | "RATE_LIMITED"
  | "TWO_FACTOR_SUCCESS" | "TWO_FACTOR_FAILED" | "TWO_FACTOR_ENABLED" | "TWO_FACTOR_DISABLED"
  | "RECOVERY_CODE_USED" | "RECOVERY_CODES_REGENERATED"
  | "PASSWORD_CHANGED" | "STEP_UP_SUCCESS" | "STEP_UP_FAILED"
  | "SESSION_REVOKED" | "ALL_SESSIONS_REVOKED" | "TRUSTED_DEVICE_ADDED" | "TRUSTED_DEVICE_REVOKED"
  | "COMPANY_ACCESS_CHANGED";

/** Append to the security audit trail. Never pass secrets/codes/tokens in here. */
export async function logSecurityEvent(opts: {
  action: SecurityAction;
  success: boolean;
  userId?: string | null;
  email?: string | null;
}) {
  const { ip, userAgent } = requestMeta();
  await prisma.securityEvent.create({
    data: { action: opts.action, success: opts.success, userId: opts.userId ?? null, email: opts.email ?? null, ip, userAgent },
  });
}

/** DB-backed rate limit: count matching failures in the window. Serverless-safe. */
async function recentFailures(where: { email?: string; ip?: string | null; userId?: string }, actions: string[], windowMin: number) {
  const since = new Date(Date.now() - windowMin * 60 * 1000);
  return prisma.securityEvent.count({
    where: {
      action: { in: actions },
      success: false,
      createdAt: { gte: since },
      ...(where.email ? { email: where.email } : {}),
      ...(where.ip ? { ip: where.ip } : {}),
      ...(where.userId ? { userId: where.userId } : {}),
    },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Password brute-force guard. Returns an error message when blocked; applies progressive delay otherwise. */
export async function loginRateLimit(email: string): Promise<string | null> {
  const { ip } = requestMeta();
  const [byEmail, byIp] = await Promise.all([
    recentFailures({ email }, ["LOGIN_FAILED"], 15),
    ip ? recentFailures({ ip }, ["LOGIN_FAILED"], 15) : Promise.resolve(0),
  ]);
  const n = Math.max(byEmail, byIp);
  if (n >= 8) {
    await logSecurityEvent({ action: "RATE_LIMITED", success: false, email });
    return "Too many attempts. Please wait 15 minutes and try again.";
  }
  if (n >= 3) await sleep(Math.min((n - 2) * 700, 3000)); // progressive delay
  return null;
}

/** 2FA brute-force guard for one user. */
export async function twoFactorRateLimit(userId: string): Promise<string | null> {
  const n = await recentFailures({ userId }, ["TWO_FACTOR_FAILED", "STEP_UP_FAILED"], 10);
  if (n >= 6) {
    await logSecurityEvent({ action: "RATE_LIMITED", success: false, userId });
    return "Too many incorrect codes. Please wait 10 minutes and try again.";
  }
  if (n >= 3) await sleep(1000);
  return null;
}
