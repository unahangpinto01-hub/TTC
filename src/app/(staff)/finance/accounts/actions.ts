"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { logAudit } from "@/lib/salespeople";

const round2 = (n: number) => Math.round(n * 100) / 100;
const TYPES = ["Cash", "Bank", "E-Wallet"];
const dateOf = (v: unknown): Date | null => { const s = String(v || ""); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s) : null; };

/**
 * A cash or bank account's own details — name, bank and account number, opening balance and
 * its date, the chart account it books to, status, notes. Super Admin only: the opening
 * balance and the GL mapping move the books, so this is not an everyday edit. Every change is
 * written to the audit trail as before → after.
 */
export async function updateCashAccount(formData: FormData) {
  const user = await requirePermWrite("receivePayments");
  if (user.role !== "SUPER_ADMIN") redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id") || "");
  const a = await prisma.cashAccount.findUnique({ where: { id }, include: { glAccount: { select: { code: true, description: true } } } });
  if (!a || a.companyId !== company.id) redirect("/denied");
  const back = (error: string): never => redirect(`/finance/accounts/${id}?error=${error}`);

  const name = String(formData.get("name") || "").trim().slice(0, 80);
  if (!name) back("name");
  const type = TYPES.includes(String(formData.get("type"))) ? String(formData.get("type")) : a.type;
  const bankName = String(formData.get("bankName") || "").trim().slice(0, 80) || null;
  const accountNo = String(formData.get("accountNo") || "").trim().slice(0, 40) || null;
  const openingBalance = round2(Number(formData.get("openingBalance")));
  if (!Number.isFinite(openingBalance)) back("opening");
  const openingDate = dateOf(formData.get("openingDate"));
  const status = String(formData.get("status")) === "Inactive" ? "Inactive" : "Active";
  const notes = String(formData.get("notes") || "").trim().slice(0, 500) || null;
  const glRaw = String(formData.get("glAccountId") || "");
  // blank keeps the mapping; "none" clears it; an id must be an active chart account
  let glAccountId = a.glAccountId;
  if (glRaw === "none") glAccountId = null;
  else if (glRaw) { const gl = await prisma.gLAccount.findFirst({ where: { id: glRaw, status: "Active" }, select: { id: true } }); if (!gl) back("gl"); else glAccountId = gl.id; }
  const dupe = await prisma.cashAccount.findFirst({ where: { companyId: company.id, id: { not: id }, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
  if (dupe) back("dupe");

  const updated = await prisma.cashAccount.update({ where: { id }, data: { name, type, bankName, accountNo, openingBalance, openingDate, status, notes, glAccountId }, include: { glAccount: { select: { code: true, description: true } } } });
  const changes: string[] = [];
  const diff = (label: string, before: unknown, after: unknown) => { if ((before ?? "") !== (after ?? "")) changes.push(`${label}: ${before ?? "—"} → ${after ?? "—"}`); };
  diff("name", a.name, updated.name); diff("type", a.type, updated.type); diff("bank", a.bankName, updated.bankName); diff("account no.", a.accountNo, updated.accountNo);
  diff("opening balance", a.openingBalance.toFixed(2), updated.openingBalance.toFixed(2)); diff("opening date", a.openingDate?.toISOString().slice(0, 10), updated.openingDate?.toISOString().slice(0, 10));
  diff("status", a.status, updated.status); diff("GL account", a.glAccount ? `${a.glAccount.code} ${a.glAccount.description}` : null, updated.glAccount ? `${updated.glAccount.code} ${updated.glAccount.description}` : null); diff("notes", a.notes, updated.notes);
  if (changes.length) await logAudit({ entity: "CashAccount", entityId: id, action: "EDITED", detail: `${updated.name}: ${changes.join(" · ")}`, actorName: user.name, actorEmail: user.email, companyId: company.id });
  revalidatePath("/finance/accounts");
  revalidatePath(`/finance/accounts/${id}`);
  redirect(`/finance/accounts/${id}?saved=1`);
}
