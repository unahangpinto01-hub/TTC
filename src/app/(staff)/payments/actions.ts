"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { nextDocNumber } from "@/lib/numbering";
import { logAudit } from "@/lib/salespeople";
import {
  canApprovePayments,
  postReceivePayment,
  voidReceivePayment,
  applyCredit,
  unapplyApplication,
  PAYMENT_METHODS,
} from "@/lib/receive-payments";

const round2 = (n: number) => Math.round(n * 100) / 100;

function err(id: string | null, message: string): never {
  const q = `?error=${encodeURIComponent(message)}`;
  redirect(id ? `/payments/${id}${q}` : `/payments/new${q}`);
}

/** Header fields + the amounts applied per invoice, straight from the entry form. */
function readEntry(formData: FormData) {
  const method = String(formData.get("method") || "Cash");
  return {
    customerId: String(formData.get("customerId") || ""),
    date: formData.get("date") ? new Date(String(formData.get("date"))) : new Date(),
    amount: round2(Number(formData.get("amount")) || 0),
    method: (PAYMENT_METHODS as readonly string[]).includes(method) ? method : "Cash",
    cashAccountId: String(formData.get("cashAccountId") || "") || null,
    refNo: String(formData.get("refNo") || "").trim() || null,
    checkNo: String(formData.get("checkNo") || "").trim() || null,
    checkDate: formData.get("checkDate") ? new Date(String(formData.get("checkDate"))) : null,
    remarks: String(formData.get("remarks") || "").trim() || null,
    applications: formData
      .getAll("appInvoiceId")
      .map((invId, i) => ({
        salesReceiptId: String(invId),
        amount: round2(Number(formData.getAll("appAmount")[i]) || 0),
      }))
      .filter((a) => a.salesReceiptId && a.amount > 0),
  };
}

export async function createReceivePayment(formData: FormData) {
  const user = await requirePermWrite("receivePayments");
  const company = await getActiveCompany(user);
  const e = readEntry(formData);
  if (!e.customerId) err(null, "Pick a customer.");
  if (e.amount <= 0) err(null, "Payment amount must be more than zero.");
  const appliedTotal = round2(e.applications.reduce((s, a) => s + a.amount, 0));
  if (appliedTotal > e.amount + 0.005) err(null, "Applied amounts exceed the payment amount.");
  // every applied invoice must be this customer's, this company's, and still open
  for (const a of e.applications) {
    const sr = await prisma.salesReceipt.findFirst({
      where: { id: a.salesReceiptId, companyId: company.id, customerId: e.customerId, status: { in: ["Open", "Partial"] } },
      include: { payments: true },
    });
    if (!sr) err(null, "An applied invoice is not an open invoice of this customer.");
    const balance = round2(sr.amount - sr.payments.reduce((s, p) => s + p.amount, 0));
    if (a.amount > balance + 0.005) err(null, `${sr.srNumber}: cannot apply more than its ₱${balance.toFixed(2)} balance.`);
  }
  if (e.cashAccountId) {
    const acct = await prisma.cashAccount.findFirst({ where: { id: e.cashAccountId, companyId: company.id, status: "Active" } });
    if (!acct) err(null, "Pick a valid cash/bank account.");
  }

  const prNumber = await nextDocNumber("PR", company.id);
  const rp = await prisma.receivePayment.create({
    data: {
      companyId: company.id,
      prNumber,
      customerId: e.customerId,
      date: e.date,
      amount: e.amount,
      method: e.method,
      cashAccountId: e.cashAccountId,
      refNo: e.refNo,
      checkNo: e.method === "Check" ? e.checkNo : null,
      checkDate: e.method === "Check" ? e.checkDate : null,
      remarks: e.remarks,
      receivedById: user.id,
      status: "Draft",
      applications: { create: e.applications },
    },
  });
  await logAudit({
    entity: "ReceivePayment", entityId: rp.id, action: "CREATED",
    detail: `${prNumber} drafted: ₱${e.amount.toFixed(2)} from customer, ${e.applications.length} invoice(s) selected`,
    actorName: user.name, actorEmail: user.email,
  });
  revalidatePath("/payments");
  redirect(`/payments/${rp.id}`);
}

/** Rewrite a Draft's header and applications (edits are only possible before submission). */
export async function updateReceivePayment(formData: FormData) {
  const user = await requirePermWrite("receivePayments");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const rp = await prisma.receivePayment.findUniqueOrThrow({ where: { id } });
  if (rp.companyId !== company.id) redirect("/denied");
  if (rp.status !== "Draft") err(id, "Only a Draft can be edited.");
  const e = readEntry(formData);
  if (e.amount <= 0) err(id, "Payment amount must be more than zero.");
  const appliedTotal = round2(e.applications.reduce((s, a) => s + a.amount, 0));
  if (appliedTotal > e.amount + 0.005) err(id, "Applied amounts exceed the payment amount.");
  for (const a of e.applications) {
    const sr = await prisma.salesReceipt.findFirst({
      where: { id: a.salesReceiptId, companyId: company.id, customerId: rp.customerId, status: { in: ["Open", "Partial"] } },
      include: { payments: true },
    });
    if (!sr) err(id, "An applied invoice is not an open invoice of this customer.");
    const balance = round2(sr.amount - sr.payments.reduce((s, p) => s + p.amount, 0));
    if (a.amount > balance + 0.005) err(id, `${sr.srNumber}: cannot apply more than its ₱${balance.toFixed(2)} balance.`);
  }
  await prisma.$transaction([
    prisma.paymentApplication.deleteMany({ where: { receivePaymentId: id } }),
    prisma.receivePayment.update({
      where: { id },
      data: {
        date: e.date, amount: e.amount, method: e.method, cashAccountId: e.cashAccountId,
        refNo: e.refNo,
        checkNo: e.method === "Check" ? e.checkNo : null,
        checkDate: e.method === "Check" ? e.checkDate : null,
        remarks: e.remarks,
        applications: { create: e.applications },
      },
    }),
  ]);
  await logAudit({
    entity: "ReceivePayment", entityId: id, action: "EDITED",
    detail: `${rp.prNumber} draft edited: ₱${e.amount.toFixed(2)}, ${e.applications.length} invoice(s)`,
    actorName: user.name, actorEmail: user.email,
  });
  revalidatePath(`/payments/${id}`);
  redirect(`/payments/${id}`);
}

export async function submitForApproval(formData: FormData) {
  const user = await requirePermWrite("receivePayments");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const rp = await prisma.receivePayment.findUniqueOrThrow({ where: { id } });
  if (rp.companyId !== company.id) redirect("/denied");
  if (rp.status !== "Draft") err(id, "Only a Draft can be submitted.");
  await prisma.receivePayment.update({ where: { id }, data: { status: "Pending Approval" } });
  await logAudit({
    entity: "ReceivePayment", entityId: id, action: "SUBMITTED",
    detail: `${rp.prNumber} submitted for approval`,
    actorName: user.name, actorEmail: user.email,
  });
  revalidatePath(`/payments/${id}`);
  redirect(`/payments/${id}`);
}

export async function approveAndPost(formData: FormData) {
  const user = await requirePermWrite("receivePayments");
  if (!canApprovePayments(user)) redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const rp = await prisma.receivePayment.findUniqueOrThrow({ where: { id } });
  if (rp.companyId !== company.id) redirect("/denied");
  try {
    await postReceivePayment(id, user);
  } catch (e) {
    err(id, e instanceof Error ? e.message : "Posting failed.");
  }
  revalidatePath(`/payments/${id}`);
  revalidatePath("/payments");
  revalidatePath("/finance/ar");
  redirect(`/payments/${id}`);
}

export async function cancelReceivePayment(formData: FormData) {
  const user = await requirePermWrite("receivePayments");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const rp = await prisma.receivePayment.findUniqueOrThrow({ where: { id } });
  if (rp.companyId !== company.id) redirect("/denied");
  if (rp.status !== "Draft" && rp.status !== "Pending Approval") err(id, "Only a Draft or Pending payment can be cancelled.");
  // a pending payment goes back through an admin; a draft can be cancelled by its clerk
  if (rp.status === "Pending Approval" && !canApprovePayments(user)) redirect("/denied");
  await prisma.receivePayment.update({ where: { id }, data: { status: "Cancelled" } });
  await logAudit({
    entity: "ReceivePayment", entityId: id, action: "CANCELLED",
    detail: `${rp.prNumber} cancelled`,
    actorName: user.name, actorEmail: user.email,
  });
  revalidatePath(`/payments/${id}`);
  redirect(`/payments/${id}`);
}

export async function voidPayment(formData: FormData) {
  const user = await requirePermWrite("receivePayments");
  if (!canApprovePayments(user)) redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const reason = String(formData.get("reason") || "").trim();
  const rp = await prisma.receivePayment.findUniqueOrThrow({ where: { id } });
  if (rp.companyId !== company.id) redirect("/denied");
  try {
    await voidReceivePayment(id, reason, user);
  } catch (e) {
    err(id, e instanceof Error ? e.message : "Voiding failed.");
  }
  revalidatePath(`/payments/${id}`);
  revalidatePath("/payments");
  revalidatePath("/finance/ar");
  redirect(`/payments/${id}`);
}

export async function applyCreditAction(formData: FormData) {
  const user = await requirePermWrite("receivePayments");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const invoiceId = String(formData.get("invoiceId") || "");
  const amount = Number(formData.get("amount")) || 0;
  const rp = await prisma.receivePayment.findUniqueOrThrow({ where: { id } });
  if (rp.companyId !== company.id) redirect("/denied");
  if (!invoiceId) err(id, "Pick an invoice to apply the credit to.");
  try {
    await applyCredit(id, invoiceId, amount, user);
  } catch (e) {
    err(id, e instanceof Error ? e.message : "Applying credit failed.");
  }
  revalidatePath(`/payments/${id}`);
  revalidatePath("/finance/ar");
  redirect(`/payments/${id}`);
}

export async function unapplyAction(formData: FormData) {
  const user = await requirePermWrite("receivePayments");
  if (!canApprovePayments(user)) redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const applicationId = String(formData.get("applicationId"));
  const rp = await prisma.receivePayment.findUniqueOrThrow({ where: { id } });
  if (rp.companyId !== company.id) redirect("/denied");
  try {
    await unapplyApplication(applicationId, user);
  } catch (e) {
    err(id, e instanceof Error ? e.message : "Unapplying failed.");
  }
  revalidatePath(`/payments/${id}`);
  revalidatePath("/finance/ar");
  redirect(`/payments/${id}`);
}

/** Cash/Bank account admin (admins only). */
export async function createCashAccount(formData: FormData) {
  const user = await requirePermWrite("receivePayments");
  if (!canApprovePayments(user)) redirect("/denied");
  const company = await getActiveCompany(user);
  const name = String(formData.get("name") || "").trim();
  if (!name) redirect("/finance/accounts?error=name");
  // book the physical account to a Chart of Accounts entry when one was picked
  const glAccountId = String(formData.get("glAccountId") || "") || null;
  if (glAccountId && !(await prisma.gLAccount.findFirst({ where: { id: glAccountId, status: "Active" } }))) {
    redirect("/finance/accounts?error=name");
  }
  await prisma.cashAccount.create({
    data: {
      companyId: company.id,
      name,
      type: ["Cash", "Bank", "E-Wallet"].includes(String(formData.get("type"))) ? String(formData.get("type")) : "Cash",
      openingBalance: round2(Number(formData.get("openingBalance")) || 0),
      glAccountId,
    },
  });
  revalidatePath("/finance/accounts");
  redirect("/finance/accounts");
}
