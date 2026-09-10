"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { getPerm } from "@/lib/permissions";
import { logAudit } from "@/lib/salespeople";
import {
  nextVoucherNo, periodOf, periodLabel, checkVoucherDate, getCutoff, saveCutoff,
  inCutoffWindow, type CutoffConfig,
} from "@/lib/vouchers";

/** A date typed into a form field, at midday so a timezone can never shift the day. */
function formDate(raw: unknown): Date | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function recordPayment(formData: FormData) {
  await requirePermWrite("ar");
  const srId = String(formData.get("srId"));
  const amount = round2(Number(formData.get("amount")) || 0);
  const method = String(formData.get("method") || "Cash");
  const refNo = String(formData.get("refNo") || "").trim() || null;
  const dateStr = String(formData.get("date") || "");
  if (amount <= 0) redirect(`/invoices/${srId}?error=amount`);

  const sr = await prisma.salesReceipt.findUniqueOrThrow({ where: { id: srId }, include: { payments: true } });
  const company = await getActiveCompany();
  if (sr.companyId !== company.id) redirect("/denied"); // company isolation
  if (sr.status === "Void" || sr.status === "Paid") redirect(`/invoices/${srId}`);

  await prisma.payment.create({
    data: { salesReceiptId: srId, amount, method, refNo, date: dateStr ? new Date(dateStr) : new Date() },
  });
  const paid = sr.payments.reduce((s, p) => s + p.amount, 0) + amount;
  await prisma.salesReceipt.update({
    where: { id: srId },
    data: { status: paid >= sr.amount - 0.005 ? "Paid" : "Partial" },
  });
  revalidatePath(`/invoices/${srId}`);
  revalidatePath("/finance/ar");
  redirect(`/invoices/${srId}`);
}

/**
 * Record an expense voucher.
 *
 * The voucher date is what matters: it draws the number from that accounting year's series
 * and files the voucher in that period. The actual expense date, the date the document was
 * received and the moment it was typed in are all kept separately, and none of them touches
 * the numbering.
 */
export async function createExpense(formData: FormData) {
  const user = await requirePermWrite("expenses");
  const company = await getActiveCompany(user);

  const glAccountId = String(formData.get("glAccountId") || "") || null;
  if (glAccountId && !(await prisma.gLAccount.findFirst({ where: { id: glAccountId, status: "Active" } }))) {
    redirect("/finance/expenses?error=gl");
  }

  const expenseDate = formDate(formData.get("date")) ?? new Date();
  // blank voucher date follows the expense date, which is the ordinary case
  const voucherDate = formDate(formData.get("voucherDate")) ?? expenseDate;
  const receivedDate = formDate(formData.get("receivedDate"));
  const reason = String(formData.get("periodReason") || "").trim();

  const canPriorPeriod = getPerm(user, "priorPeriod") !== "NONE";
  const check = await checkVoucherDate({ companyId: company.id, voucherDate, canPriorPeriod });
  if (!check.ok) redirect(`/finance/expenses?error=locked`);
  if (check.reasonRequired && reason.length < 5) redirect(`/finance/expenses?error=reason`);

  const { year, month } = periodOf(voucherDate);
  const now = new Date();
  const voucherNo = await nextVoucherNo(company.id, voucherDate);

  const expense = await prisma.expense.create({
    data: {
      companyId: company.id,
      voucherNo,
      voucherDate,
      date: expenseDate,
      receivedDate,
      payee: String(formData.get("payee") || "").trim() || null,
      accountingYear: year,
      accountingMonth: month,
      // encoded in a later calendar year than it is dated — the year-end cutoff case
      priorYearEntry: now.getFullYear() > year,
      category: String(formData.get("category")),
      amount: round2(Number(formData.get("amount")) || 0),
      notes: String(formData.get("notes") || "").trim() || null,
      userId: user.id,
      glAccountId,
    },
  });

  await logAudit({
    entity: "ExpenseVoucher",
    entityId: expense.id,
    action: "CREATED",
    detail:
      `${voucherNo} · ${periodLabel(year, month)} · voucher ${voucherDate.toDateString()} · ` +
      `expense ${expenseDate.toDateString()}${receivedDate ? ` · received ${receivedDate.toDateString()}` : ""}` +
      (now.getFullYear() > year ? " · ENTERED IN A LATER CALENDAR YEAR = YES" : ""),
    actorName: user.name,
    actorEmail: user.email,
    companyId: company.id,
    reason: check.reasonRequired ? reason : undefined,
  });

  revalidatePath("/finance/expenses");
  redirect("/finance/expenses?saved=ok");
}

/**
 * Override a voucher number by hand.
 *
 * Automatic numbering is the rule; this is the exception, so it needs its own permission,
 * a reason, and it refuses a number already used by another voucher in the same company.
 * The number it replaces is never handed back to the counter.
 */
export async function editVoucherNumber(formData: FormData) {
  const user = await requirePermWrite("expenses");
  if (getPerm(user, "voucherNumber") === "NONE") redirect("/denied");
  const company = await getActiveCompany(user);

  const id = String(formData.get("id"));
  const next = String(formData.get("voucherNo") || "").trim().toUpperCase();
  const reason = String(formData.get("reason") || "").trim();

  const voucher = await prisma.expense.findUnique({ where: { id }, select: { id: true, companyId: true, voucherNo: true } });
  if (!voucher || voucher.companyId !== company.id) redirect("/finance/expenses?error=missing");
  if (!next) redirect(`/finance/expenses?error=vno`);
  if (reason.length < 5) redirect(`/finance/expenses?error=vreason`);
  if (next === voucher.voucherNo) redirect("/finance/expenses?saved=none");

  const clash = await prisma.expense.findFirst({
    where: { companyId: company.id, voucherNo: next, NOT: { id } },
    select: { id: true },
  });
  if (clash) redirect(`/finance/expenses?error=dupe`);

  await prisma.expense.update({ where: { id }, data: { voucherNo: next } });
  await logAudit({
    entity: "ExpenseVoucher",
    entityId: id,
    action: "VOUCHER_NO_CHANGED",
    detail: `Voucher number ${voucher.voucherNo ?? "(none)"} → ${next}`,
    actorName: user.name,
    actorEmail: user.email,
    companyId: company.id,
    reason,
  });
  revalidatePath("/finance/expenses");
  redirect("/finance/expenses?saved=vno");
}

/** Open, close or lock an accounting period (needs the Prior-Period permission). */
export async function setAccountingPeriod(formData: FormData) {
  const user = await requirePermWrite("expenses");
  if (getPerm(user, "priorPeriod") === "NONE") redirect("/denied");
  const company = await getActiveCompany(user);

  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  const status = String(formData.get("status") || "Open");
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) redirect("/finance/expenses?error=period");
  if (!["Open", "Closing", "Locked"].includes(status)) redirect("/finance/expenses?error=period");

  const before = await prisma.accountingPeriod.findUnique({
    where: { companyId_year_month: { companyId: company.id, year, month } },
    select: { status: true },
  });
  const wasStatus = before?.status ?? "Open";
  if (wasStatus === status) redirect("/finance/expenses?saved=none");

  await prisma.accountingPeriod.upsert({
    where: { companyId_year_month: { companyId: company.id, year, month } },
    create: { companyId: company.id, year, month, status, changedById: user.id },
    update: { status, changedById: user.id },
  });
  await logAudit({
    entity: "ExpenseVoucher",
    entityId: "PERIOD",
    action: "PERIOD_CHANGED",
    detail: `${periodLabel(year, month)} · ${wasStatus} → ${status}`,
    actorName: user.name,
    actorEmail: user.email,
    companyId: company.id,
  });
  revalidatePath("/finance/expenses");
  redirect("/finance/expenses?saved=period");
}

/** The January year-end cutoff window, set by anyone who may adjust prior periods. */
export async function saveCutoffConfig(formData: FormData) {
  const user = await requirePermWrite("expenses");
  if (getPerm(user, "priorPeriod") === "NONE") redirect("/denied");

  const before = await getCutoff();
  const next: CutoffConfig = {
    enabled: formData.get("cutoffEnabled") === "on",
    lastDay: Math.min(31, Math.max(1, Math.floor(Number(formData.get("cutoffLastDay")) || before.lastDay))),
  };
  if (before.enabled === next.enabled && before.lastDay === next.lastDay) redirect("/finance/expenses?saved=none");

  await saveCutoff(next, user.id);
  await logAudit({
    entity: "ExpenseVoucher",
    entityId: "CUTOFF",
    action: "CUTOFF_CHANGED",
    detail:
      `Year-end cutoff ${before.enabled ? `1–${before.lastDay} January` : "off"} → ` +
      `${next.enabled ? `1–${next.lastDay} January` : "off"}`,
    actorName: user.name,
    actorEmail: user.email,
  });
  revalidatePath("/finance/expenses");
  redirect("/finance/expenses?saved=cutoff");
}
