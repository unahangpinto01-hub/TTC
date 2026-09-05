"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { nextDocNumber } from "@/lib/numbering";
import { logAudit } from "@/lib/salespeople";
import { canApprovePayments } from "@/lib/receive-payments";
import { RC_REASONS, postRefundCredit, voidRefundCredit, applyCreditMemo, unapplyCreditApplication } from "@/lib/refunds-credits";

const round2 = (n: number) => Math.round(n * 100) / 100;

function err(id: string | null, message: string): never {
  const q = `?error=${encodeURIComponent(message)}`;
  redirect(id ? `/refunds/${id}${q}` : `/refunds/new${q}`);
}

/** Header + item lines from the entry form. Amount-only documents have a typed total
    and no product lines; item-based ones total their lines. */
async function readEntry(formData: FormData, companyId: string, forId: string | null) {
  const type = String(formData.get("type")) === "Refund" ? "Refund" : "Credit";
  const reason = (RC_REASONS as readonly string[]).includes(String(formData.get("reason"))) ? String(formData.get("reason")) : "Others";
  const remarks = String(formData.get("remarks") || "").trim();
  if (!remarks) err(forId, "Remarks are required — say why this document exists.");

  const ids = formData.getAll("lineProductId").map(String);
  const descs = formData.getAll("lineDescription").map(String);
  const qtys = formData.getAll("lineQty").map((v) => Math.max(0, Math.floor(Number(v) || 0)));
  const prices = formData.getAll("linePrice").map((v) => round2(Number(v) || 0));
  const returns = formData.getAll("lineReturn").map(String); // holds the row index when ticked
  const lines = ids
    .map((pid, i) => ({
      productId: pid || null,
      description: descs[i]?.trim() || null,
      qty: qtys[i] ?? 0,
      unitPrice: prices[i] ?? 0,
      returnToStock: returns.includes(String(i)),
    }))
    .filter((l) => (l.productId || l.description) && l.qty > 0 && l.unitPrice > 0);

  for (const l of lines) {
    if (!l.productId) continue;
    const p = await prisma.product.findFirst({ where: { id: l.productId, companyId } });
    if (!p) err(forId, "A line's product belongs to another company.");
    if (l.returnToStock && !l.productId) err(forId, "Only product lines can return to stock.");
  }

  const typedAmount = round2(Number(formData.get("amount")) || 0);
  const lineTotal = round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const amount = lines.length ? lineTotal : typedAmount;
  if (amount <= 0) err(forId, "The document amount must be more than zero — add item lines or type an amount.");

  const salesReceiptId = String(formData.get("salesReceiptId") || "") || null;
  if (salesReceiptId) {
    const sr = await prisma.salesReceipt.findFirst({
      where: { id: salesReceiptId, companyId, customerId: String(formData.get("customerId") || "") || undefined },
    });
    if (!sr) err(forId, "The related invoice is not this customer's invoice in this company.");
  }

  return {
    type,
    reason,
    remarks,
    amount,
    lines,
    salesReceiptId,
    date: formData.get("date") ? new Date(String(formData.get("date"))) : new Date(),
  };
}

export async function createRefundCredit(formData: FormData) {
  const user = await requirePermWrite("refundsCredits");
  const company = await getActiveCompany(user);
  const customerId = String(formData.get("customerId") || "");
  if (!customerId) err(null, "Pick a customer.");
  const e = await readEntry(formData, company.id, null);
  const rcNumber = await nextDocNumber(e.type === "Credit" ? "CM" : "RF", company.id);
  const rc = await prisma.refundCredit.create({
    data: {
      companyId: company.id,
      rcNumber,
      type: e.type,
      customerId,
      salesReceiptId: e.salesReceiptId,
      date: e.date,
      reason: e.reason,
      remarks: e.remarks,
      amount: e.amount,
      createdById: user.id,
      status: "Draft",
      lines: { create: e.lines },
    },
  });
  await logAudit({
    entity: "RefundCredit", entityId: rc.id, action: "CREATED",
    detail: `${rcNumber} (${e.type}) drafted: ₱${e.amount.toFixed(2)} — ${e.reason}`,
    actorName: user.name, actorEmail: user.email,
  });
  revalidatePath("/refunds");
  redirect(`/refunds/${rc.id}`);
}

export async function updateRefundCredit(formData: FormData) {
  const user = await requirePermWrite("refundsCredits");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const rc = await prisma.refundCredit.findUniqueOrThrow({ where: { id } });
  if (rc.companyId !== company.id) redirect("/denied");
  if (rc.status !== "Draft") err(id, "Only a Draft can be edited.");
  const e = await readEntry(formData, company.id, id);
  await prisma.$transaction([
    prisma.refundCreditLine.deleteMany({ where: { refundCreditId: id } }),
    prisma.refundCredit.update({
      where: { id },
      data: {
        date: e.date, reason: e.reason, remarks: e.remarks, amount: e.amount,
        salesReceiptId: e.salesReceiptId,
        lines: { create: e.lines },
      },
    }),
  ]);
  await logAudit({
    entity: "RefundCredit", entityId: id, action: "EDITED",
    detail: `${rc.rcNumber} draft edited: ₱${e.amount.toFixed(2)} — ${e.reason}`,
    actorName: user.name, actorEmail: user.email,
  });
  revalidatePath(`/refunds/${id}`);
  redirect(`/refunds/${id}`);
}

export async function submitRefundCredit(formData: FormData) {
  const user = await requirePermWrite("refundsCredits");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const rc = await prisma.refundCredit.findUniqueOrThrow({ where: { id } });
  if (rc.companyId !== company.id) redirect("/denied");
  if (rc.status !== "Draft") err(id, "Only a Draft can be submitted.");
  await prisma.refundCredit.update({ where: { id }, data: { status: "Pending Approval" } });
  await logAudit({ entity: "RefundCredit", entityId: id, action: "SUBMITTED", detail: `${rc.rcNumber} submitted for approval`, actorName: user.name, actorEmail: user.email });
  revalidatePath(`/refunds/${id}`);
  redirect(`/refunds/${id}`);
}

export async function approveRefundCredit(formData: FormData) {
  const user = await requirePermWrite("refundsCredits");
  if (!canApprovePayments(user)) redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const rc = await prisma.refundCredit.findUniqueOrThrow({ where: { id } });
  if (rc.companyId !== company.id) redirect("/denied");
  if (rc.status !== "Pending Approval") err(id, "Only a Pending document can be approved.");
  await prisma.refundCredit.update({ where: { id }, data: { status: "Approved", approvedById: user.id } });
  await logAudit({ entity: "RefundCredit", entityId: id, action: "APPROVED", detail: `${rc.rcNumber} approved`, actorName: user.name, actorEmail: user.email });
  revalidatePath(`/refunds/${id}`);
  redirect(`/refunds/${id}`);
}

export async function rejectRefundCredit(formData: FormData) {
  const user = await requirePermWrite("refundsCredits");
  if (!canApprovePayments(user)) redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const reason = String(formData.get("reason") || "").trim();
  const rc = await prisma.refundCredit.findUniqueOrThrow({ where: { id } });
  if (rc.companyId !== company.id) redirect("/denied");
  if (rc.status !== "Pending Approval" && rc.status !== "Approved") err(id, "Only a Pending or Approved document can be rejected.");
  await prisma.refundCredit.update({ where: { id }, data: { status: "Rejected", voidReason: reason || null } });
  await logAudit({ entity: "RefundCredit", entityId: id, action: "REJECTED", detail: `${rc.rcNumber} rejected${reason ? `: ${reason}` : ""}`, actorName: user.name, actorEmail: user.email });
  revalidatePath(`/refunds/${id}`);
  redirect(`/refunds/${id}`);
}

export async function postRefundCreditAction(formData: FormData) {
  const user = await requirePermWrite("refundsCredits");
  if (!canApprovePayments(user)) redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const rc = await prisma.refundCredit.findUniqueOrThrow({ where: { id } });
  if (rc.companyId !== company.id) redirect("/denied");
  const source = String(formData.get("source") || ""); // "pay:<id>" | "cm:<id>" | ""
  try {
    await postRefundCredit(id, user, rc.type === "Refund"
      ? {
          method: String(formData.get("refundMethod") || ""),
          refNo: String(formData.get("refundRefNo") || "").trim() || null,
          refundDate: formData.get("refundDate") ? new Date(String(formData.get("refundDate"))) : new Date(),
          cashAccountId: String(formData.get("cashAccountId") || "") || null,
          sourcePaymentId: source.startsWith("pay:") ? source.slice(4) : null,
          sourceCreditId: source.startsWith("cm:") ? source.slice(3) : null,
        }
      : undefined);
  } catch (e) {
    err(id, e instanceof Error ? e.message : "Posting failed.");
  }
  revalidatePath(`/refunds/${id}`);
  revalidatePath("/refunds");
  revalidatePath("/finance/ar");
  redirect(`/refunds/${id}`);
}

export async function voidRefundCreditAction(formData: FormData) {
  const user = await requirePermWrite("refundsCredits");
  if (!canApprovePayments(user)) redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const rc = await prisma.refundCredit.findUniqueOrThrow({ where: { id } });
  if (rc.companyId !== company.id) redirect("/denied");
  try {
    await voidRefundCredit(id, String(formData.get("reason") || "").trim(), user);
  } catch (e) {
    err(id, e instanceof Error ? e.message : "Voiding failed.");
  }
  revalidatePath(`/refunds/${id}`);
  revalidatePath("/refunds");
  revalidatePath("/finance/ar");
  redirect(`/refunds/${id}`);
}

export async function applyCreditMemoAction(formData: FormData) {
  const user = await requirePermWrite("refundsCredits");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const invoiceId = String(formData.get("invoiceId") || "");
  const amount = Number(formData.get("amount")) || 0;
  const rc = await prisma.refundCredit.findUniqueOrThrow({ where: { id } });
  if (rc.companyId !== company.id) redirect("/denied");
  if (!invoiceId) err(id, "Pick an invoice to apply the credit to.");
  try {
    await applyCreditMemo(id, invoiceId, amount, user);
  } catch (e) {
    err(id, e instanceof Error ? e.message : "Applying failed.");
  }
  revalidatePath(`/refunds/${id}`);
  revalidatePath("/finance/ar");
  redirect(`/refunds/${id}`);
}

export async function unapplyCreditAction(formData: FormData) {
  const user = await requirePermWrite("refundsCredits");
  if (!canApprovePayments(user)) redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const applicationId = String(formData.get("applicationId"));
  const rc = await prisma.refundCredit.findUniqueOrThrow({ where: { id } });
  if (rc.companyId !== company.id) redirect("/denied");
  try {
    await unapplyCreditApplication(applicationId, user);
  } catch (e) {
    err(id, e instanceof Error ? e.message : "Unapplying failed.");
  }
  revalidatePath(`/refunds/${id}`);
  revalidatePath("/finance/ar");
  redirect(`/refunds/${id}`);
}
