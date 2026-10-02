"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { logAudit } from "@/lib/salespeople";
import { canApprovePayments, PAYMENT_METHODS } from "@/lib/receive-payments";
import { readReceiptLines, receiptLineProblems, linesTotal, nextCrNo, postOtherReceipt, voidOtherReceipt } from "@/lib/other-receipts";

const BASE = "/other-receipts";

function err(id: string | null, message: string): never {
  const q = `?error=${encodeURIComponent(message)}`;
  redirect(id ? `${BASE}/${id}${q}` : `${BASE}/new${q}`);
}

/** Header + lines, straight from the entry form. The payor is the employee picked, or the name typed. */
async function readEntry(formData: FormData, companyId: string, fail: (m: string) => never) {
  const method = String(formData.get("method") || "Cash");
  const employeeId = String(formData.get("employeeId") || "") || null;
  const employee = employeeId ? await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, name: true } }) : null;
  if (employeeId && !employee) fail("That employee could not be found.");
  const payor = (String(formData.get("payor") || "").trim() || employee?.name || "").slice(0, 120);
  if (!payor) fail("Who is the money from? Pick an employee or type the payor's name.");
  const dateRaw = String(formData.get("date") || "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? new Date(dateRaw) : null;
  if (!date || Number.isNaN(date.getTime())) fail("The receipt date is required.");
  if (date > new Date()) fail("A receipt cannot be dated in the future.");
  const cashAccountId = String(formData.get("cashAccountId") || "") || null;
  if (cashAccountId && !(await prisma.cashAccount.findFirst({ where: { id: cashAccountId, companyId, status: "Active" }, select: { id: true } }))) fail("Pick a valid cash/bank account.");
  const lines = readReceiptLines(formData);
  const problems = await receiptLineProblems(lines);
  if (problems.length) fail(problems.join(" "));
  const checkDateRaw = String(formData.get("checkDate") || "");
  return {
    date, payor, employeeId: employee?.id ?? null, amount: linesTotal(lines),
    method: (PAYMENT_METHODS as readonly string[]).includes(method) ? method : "Cash",
    cashAccountId,
    refNo: String(formData.get("refNo") || "").trim().slice(0, 80) || null,
    checkNo: method === "Check" ? String(formData.get("checkNo") || "").trim().slice(0, 40) || null : null,
    checkDate: method === "Check" && /^\d{4}-\d{2}-\d{2}$/.test(checkDateRaw) ? new Date(checkDateRaw) : null,
    remarks: String(formData.get("remarks") || "").trim().slice(0, 300) || null,
    lines: lines.map((l, i) => ({ ...l, sortOrder: i })),
  };
}

export async function createOtherReceipt(formData: FormData) {
  const user = await requirePermWrite("otherReceipts");
  const company = await getActiveCompany(user);
  const e = await readEntry(formData, company.id, (m) => err(null, m));
  const crNumber = await nextCrNo(company.id, e.date);
  const { lines, ...header } = e;
  const r = await prisma.otherReceipt.create({
    data: { companyId: company.id, crNumber, ...header, receivedById: user.id, status: "Draft", lines: { create: lines } },
  });
  await logAudit({
    entity: "OtherReceipt", entityId: r.id, action: "CREATED",
    detail: `${crNumber} drafted: ₱${e.amount.toFixed(2)} from ${e.payor}, ${lines.length} line(s)`,
    actorName: user.name, actorEmail: user.email, companyId: company.id,
  });
  revalidatePath(BASE);
  redirect(`${BASE}/${r.id}`);
}

/** Rewrite a Draft's header and lines (edits are only possible before submission). */
export async function updateOtherReceipt(formData: FormData) {
  const user = await requirePermWrite("otherReceipts");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const r = await prisma.otherReceipt.findUniqueOrThrow({ where: { id } });
  if (r.companyId !== company.id) redirect("/denied");
  if (r.status !== "Draft") err(id, "Only a Draft can be edited.");
  const e = await readEntry(formData, company.id, (m) => err(id, m));
  const { lines, ...header } = e;
  await prisma.$transaction([
    prisma.otherReceiptLine.deleteMany({ where: { receiptId: id } }),
    prisma.otherReceipt.update({ where: { id }, data: { ...header, lines: { create: lines } } }),
  ]);
  await logAudit({
    entity: "OtherReceipt", entityId: id, action: "EDITED",
    detail: `${r.crNumber} draft edited: ₱${e.amount.toFixed(2)} from ${e.payor}, ${lines.length} line(s)`,
    actorName: user.name, actorEmail: user.email, companyId: company.id,
  });
  revalidatePath(`${BASE}/${id}`);
  redirect(`${BASE}/${id}`);
}

export async function submitOtherReceipt(formData: FormData) {
  const user = await requirePermWrite("otherReceipts");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const r = await prisma.otherReceipt.findUniqueOrThrow({ where: { id } });
  if (r.companyId !== company.id) redirect("/denied");
  if (r.status !== "Draft") err(id, "Only a Draft can be submitted.");
  await prisma.otherReceipt.update({ where: { id }, data: { status: "Pending Approval" } });
  await logAudit({ entity: "OtherReceipt", entityId: id, action: "SUBMITTED", detail: `${r.crNumber} submitted for approval`, actorName: user.name, actorEmail: user.email, companyId: company.id });
  revalidatePath(`${BASE}/${id}`);
  redirect(`${BASE}/${id}`);
}

export async function approveAndPostOtherReceipt(formData: FormData) {
  const user = await requirePermWrite("otherReceipts");
  if (!canApprovePayments(user)) redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const r = await prisma.otherReceipt.findUniqueOrThrow({ where: { id } });
  if (r.companyId !== company.id) redirect("/denied");
  try {
    await postOtherReceipt(id, user);
  } catch (e) {
    err(id, e instanceof Error ? e.message : "Posting failed.");
  }
  revalidatePath(`${BASE}/${id}`);
  revalidatePath(BASE);
  revalidatePath("/finance/accounts");
  redirect(`${BASE}/${id}`);
}

export async function cancelOtherReceipt(formData: FormData) {
  const user = await requirePermWrite("otherReceipts");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const r = await prisma.otherReceipt.findUniqueOrThrow({ where: { id } });
  if (r.companyId !== company.id) redirect("/denied");
  if (r.status !== "Draft" && r.status !== "Pending Approval") err(id, "Only a Draft or Pending receipt can be cancelled.");
  if (r.status === "Pending Approval" && !canApprovePayments(user)) redirect("/denied");
  await prisma.otherReceipt.update({ where: { id }, data: { status: "Cancelled" } });
  await logAudit({ entity: "OtherReceipt", entityId: id, action: "CANCELLED", detail: `${r.crNumber} cancelled`, actorName: user.name, actorEmail: user.email, companyId: company.id });
  revalidatePath(`${BASE}/${id}`);
  redirect(`${BASE}/${id}`);
}

export async function voidOtherReceiptAction(formData: FormData) {
  const user = await requirePermWrite("otherReceipts");
  if (!canApprovePayments(user)) redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const reason = String(formData.get("reason") || "").trim();
  const r = await prisma.otherReceipt.findUniqueOrThrow({ where: { id } });
  if (r.companyId !== company.id) redirect("/denied");
  if (reason.length < 5) err(id, "Give a reason for voiding (at least 5 characters).");
  try {
    await voidOtherReceipt(id, reason, user);
  } catch (e) {
    err(id, e instanceof Error ? e.message : "Voiding failed.");
  }
  revalidatePath(`${BASE}/${id}`);
  revalidatePath(BASE);
  revalidatePath("/finance/accounts");
  redirect(`${BASE}/${id}`);
}
