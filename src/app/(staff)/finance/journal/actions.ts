"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { logAudit } from "@/lib/salespeople";
import { canPostJournal, readJournalLines, journalLineProblems, resolveCashAccounts, totalsOf, nextJvNo, postJournalVoucher, voidJournalVoucher } from "@/lib/journal";

const BASE = "/finance/journal";

function err(id: string | null, message: string): never {
  const q = `?error=${encodeURIComponent(message)}`;
  redirect(id ? `${BASE}/${id}${q}` : `${BASE}/new${q}`);
}

/** Header + lines, straight from the entry form; every problem reported at once. */
async function readEntry(formData: FormData, companyId: string, fail: (m: string) => never) {
  const dateRaw = String(formData.get("date") || "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? new Date(dateRaw) : null;
  if (!date || Number.isNaN(date.getTime())) fail("The voucher date is required.");
  if (date > new Date()) fail("A voucher cannot be dated in the future.");
  const memo = String(formData.get("memo") || "").trim().slice(0, 500);
  if (!memo) fail("Write the explanation (memo) — what the voucher records and why.");
  const lines = readJournalLines(formData);
  const ambiguous = await resolveCashAccounts(lines, companyId);
  const problems = [...(await journalLineProblems(lines, companyId)), ...ambiguous];
  if (problems.length) fail(problems.join(" "));
  return {
    date, memo,
    refNo: String(formData.get("refNo") || "").trim().slice(0, 80) || null,
    lines: lines.map((l, i) => ({ ...l, sortOrder: i })),
  };
}

export async function createJournalVoucher(formData: FormData) {
  const user = await requirePermWrite("journal");
  const company = await getActiveCompany(user);
  const e = await readEntry(formData, company.id, (m) => err(null, m));
  const jvNumber = await nextJvNo(company.id, e.date);
  const { lines, ...header } = e;
  const v = await prisma.journalVoucher.create({
    data: { companyId: company.id, jvNumber, ...header, preparedById: user.id, status: "Draft", lines: { create: lines } },
  });
  await logAudit({
    entity: "JournalVoucher", entityId: v.id, action: "CREATED",
    detail: `${jvNumber} drafted: ₱${totalsOf(lines).debit.toFixed(2)}, ${lines.length} line(s) — ${e.memo}`,
    actorName: user.name, actorEmail: user.email, companyId: company.id,
  });
  revalidatePath(BASE);
  redirect(`${BASE}/${v.id}`);
}

/** Rewrite a Draft's header and lines (edits are only possible before submission). */
export async function updateJournalVoucher(formData: FormData) {
  const user = await requirePermWrite("journal");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const v = await prisma.journalVoucher.findUniqueOrThrow({ where: { id } });
  if (v.companyId !== company.id) redirect("/denied");
  if (v.status !== "Draft") err(id, "Only a Draft can be edited.");
  const e = await readEntry(formData, company.id, (m) => err(id, m));
  const { lines, ...header } = e;
  await prisma.$transaction([
    prisma.journalLine.deleteMany({ where: { voucherId: id } }),
    prisma.journalVoucher.update({ where: { id }, data: { ...header, lines: { create: lines } } }),
  ]);
  await logAudit({
    entity: "JournalVoucher", entityId: id, action: "EDITED",
    detail: `${v.jvNumber} draft edited: ₱${totalsOf(lines).debit.toFixed(2)}, ${lines.length} line(s) — ${e.memo}`,
    actorName: user.name, actorEmail: user.email, companyId: company.id,
  });
  revalidatePath(`${BASE}/${id}`);
  redirect(`${BASE}/${id}`);
}

export async function submitJournalVoucher(formData: FormData) {
  const user = await requirePermWrite("journal");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const v = await prisma.journalVoucher.findUniqueOrThrow({ where: { id } });
  if (v.companyId !== company.id) redirect("/denied");
  if (v.status !== "Draft") err(id, "Only a Draft can be submitted.");
  await prisma.journalVoucher.update({ where: { id }, data: { status: "Pending Approval" } });
  await logAudit({ entity: "JournalVoucher", entityId: id, action: "SUBMITTED", detail: `${v.jvNumber} submitted for approval`, actorName: user.name, actorEmail: user.email, companyId: company.id });
  revalidatePath(`${BASE}/${id}`);
  redirect(`${BASE}/${id}`);
}

export async function approveAndPostJournalVoucher(formData: FormData) {
  const user = await requirePermWrite("journal");
  if (!canPostJournal(user)) redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const v = await prisma.journalVoucher.findUniqueOrThrow({ where: { id } });
  if (v.companyId !== company.id) redirect("/denied");
  try {
    await postJournalVoucher(id, user);
  } catch (e) {
    err(id, e instanceof Error ? e.message : "Posting failed.");
  }
  revalidatePath(`${BASE}/${id}`);
  revalidatePath(BASE);
  revalidatePath("/finance/accounts");
  revalidatePath("/finance/ledger");
  redirect(`${BASE}/${id}`);
}

export async function cancelJournalVoucher(formData: FormData) {
  const user = await requirePermWrite("journal");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const v = await prisma.journalVoucher.findUniqueOrThrow({ where: { id } });
  if (v.companyId !== company.id) redirect("/denied");
  if (v.status !== "Draft" && v.status !== "Pending Approval") err(id, "Only a Draft or Pending voucher can be cancelled.");
  if (v.status === "Pending Approval" && !canPostJournal(user)) redirect("/denied");
  await prisma.journalVoucher.update({ where: { id }, data: { status: "Cancelled" } });
  await logAudit({ entity: "JournalVoucher", entityId: id, action: "CANCELLED", detail: `${v.jvNumber} cancelled`, actorName: user.name, actorEmail: user.email, companyId: company.id });
  revalidatePath(`${BASE}/${id}`);
  redirect(`${BASE}/${id}`);
}

export async function voidJournalVoucherAction(formData: FormData) {
  const user = await requirePermWrite("journal");
  if (!canPostJournal(user)) redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const reason = String(formData.get("reason") || "").trim();
  const v = await prisma.journalVoucher.findUniqueOrThrow({ where: { id } });
  if (v.companyId !== company.id) redirect("/denied");
  if (reason.length < 5) err(id, "Give a reason for voiding (at least 5 characters).");
  try {
    await voidJournalVoucher(id, reason, user);
  } catch (e) {
    err(id, e instanceof Error ? e.message : "Voiding failed.");
  }
  revalidatePath(`${BASE}/${id}`);
  revalidatePath(BASE);
  revalidatePath("/finance/accounts");
  revalidatePath("/finance/ledger");
  redirect(`${BASE}/${id}`);
}
