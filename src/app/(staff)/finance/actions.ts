"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { getPerm } from "@/lib/permissions";
import { logAudit } from "@/lib/salespeople";
import { periodLabel, getCutoff, saveCutoff, inCutoffWindow, type CutoffConfig } from "@/lib/vouchers";

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
    entity: "AccountingPeriod",
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
