"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite, type SessionUser } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { getPerm } from "@/lib/permissions";
import { nextDocNumber } from "@/lib/numbering";
import { logAudit } from "@/lib/salespeople";
import {
  canApprovePayments,
  postReceivePayment,
  voidReceivePayment,
  applyCredit,
  unapplyApplication,
  ppdEligible,
  ppdSettingsOf,
  settledOf,
  PAYMENT_METHODS,
} from "@/lib/receive-payments";

const round2 = (n: number) => Math.round(n * 100) / 100;

function err(id: string | null, message: string): never {
  const q = `?error=${encodeURIComponent(message)}`;
  redirect(id ? `/payments/${id}${q}` : `/payments/new${q}`);
}

type AppIn = {
  salesReceiptId: string;
  amount: number;
  /** a fraction: 0.02 = 2% */
  ppdRate: number;
  ppdAmount: number;
  otherDiscount: number;
  otherDiscountReasonId: string | null;
  otherDiscountRemarks: string | null;
  ppdOverrideReason: string | null;
};

/** Header fields + what is applied per invoice (payment, PPD, other discount), straight from the entry form. */
function readEntry(formData: FormData) {
  const method = String(formData.get("method") || "Cash");
  const col = (name: string) => formData.getAll(name).map((v) => String(v ?? ""));
  const ids = col("appInvoiceId"), amounts = col("appAmount"), rates = col("appPpdRate"), ppds = col("appPpd"), others = col("appOther"), reasons = col("appOtherReason"), remarks = col("appOtherRemarks"), overrides = col("appOverride");
  const applications: AppIn[] = ids
    .map((salesReceiptId, i) => ({
      salesReceiptId,
      amount: round2(Math.max(0, Number(amounts[i]) || 0)),
      ppdRate: Math.max(0, Number(rates[i]) || 0) / 100,
      ppdAmount: round2(Math.max(0, Number(ppds[i]) || 0)),
      otherDiscount: round2(Math.max(0, Number(others[i]) || 0)),
      otherDiscountReasonId: (reasons[i] ?? "").trim() || null,
      otherDiscountRemarks: (remarks[i] ?? "").trim().slice(0, 300) || null,
      ppdOverrideReason: (overrides[i] ?? "").trim().slice(0, 300) || null,
    }))
    .filter((a) => a.salesReceiptId && settledOf(a) > 0);
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
    // the part of the money that is the affiliate company's collection, not ours
    affiliateAmount: round2(Math.max(0, Number(formData.get("affiliateAmount")) || 0)),
    affiliateRemarks: String(formData.get("affiliateRemarks") || "").trim().slice(0, 300) || null,
    applications,
  };
}

/**
 * Every application checked against the live invoice, the company's PPD policy and the user's
 * rights, and turned into the rows to store. The money applied can never exceed the amount
 * received, and payment + PPD + other discount can never exceed an invoice's balance.
 */
async function checkApplications(
  e: ReturnType<typeof readEntry>,
  companyId: string,
  customerId: string,
  user: SessionUser,
  fail: (message: string) => never
) {
  const appliedTotal = round2(e.applications.reduce((s, a) => s + a.amount, 0));
  if (appliedTotal + e.affiliateAmount > e.amount + 0.005) fail(e.affiliateAmount > 0 ? "Applied amounts plus the part collected for the affiliate exceed the amount received." : "Applied amounts exceed the amount received. Discounts are not money received — only the payment column counts against it.");
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { ppdRate: true, ppdDays: true, ppdMaxRate: true, affiliateCompanyId: true, glAffiliateAdvancesId: true } });
  if (e.affiliateAmount > 0 && (!company.affiliateCompanyId || !company.glAffiliateAdvancesId)) fail("Collecting for an affiliate needs the affiliate company and the Advances from Affiliate account set on Company Details.");
  const settings = ppdSettingsOf(company);
  const canDiscount = getPerm(user, "paymentDiscounts") === "READ_WRITE";
  const canOverride = getPerm(user, "ppdOverride") === "READ_WRITE";
  const out: (AppIn & { ppdEligible: boolean; ppdOverrideById: string | null; ppdOverrideAt: Date | null })[] = [];
  for (const a of e.applications) {
    const sr = await prisma.salesReceipt.findFirst({
      where: { id: a.salesReceiptId, companyId, customerId, status: { in: ["Open", "Partial"] } },
      include: { payments: true },
    });
    if (!sr) fail("An applied invoice is not an open invoice of this customer.");
    const balance = round2(sr.amount - sr.payments.reduce((s, p) => s + p.amount, 0));
    const settled = settledOf(a);
    if (settled > balance + 0.005) {
      fail(`${sr.srNumber}: total application exceeds the invoice outstanding balance. Outstanding ₱${balance.toFixed(2)}, payment ₱${a.amount.toFixed(2)}, maximum remaining discount ₱${Math.max(0, round2(balance - a.amount)).toFixed(2)}.`);
    }
    const hasDiscount = a.ppdAmount > 0 || a.otherDiscount > 0;
    if (hasDiscount && !canDiscount) fail(`${sr.srNumber}: you are not allowed to grant discounts on a payment (Payment Discounts permission).`);
    let eligible = true, overrideReason: string | null = null;
    if (a.ppdAmount > 0) {
      if (settings.maxRate > 0 && a.ppdRate > settings.maxRate + 0.000001) fail(`${sr.srNumber}: PPD rate ${(a.ppdRate * 100).toFixed(2)}% is above the ${(settings.maxRate * 100).toFixed(2)}% ceiling.`);
      eligible = ppdEligible(sr, e.date, settings);
      if (!eligible) {
        if (!canOverride) fail(`${sr.srNumber}: ${sr.kind === "OPENING" ? "an opening balance earns no PPD by rule" : "the payment date is outside the prompt payment window"} — only a user with PPD Override may grant it.`);
        overrideReason = a.ppdOverrideReason;
        if (!overrideReason || overrideReason.length < 5) fail(`${sr.srNumber}: PPD outside the window needs an override reason (at least 5 characters).`);
      }
    }
    let reasonId: string | null = null, remarks: string | null = null;
    if (a.otherDiscount > 0) {
      const reason = a.otherDiscountReasonId ? await prisma.otherDiscountReason.findFirst({ where: { id: a.otherDiscountReasonId, status: "Active" } }) : null;
      if (!reason) fail(`${sr.srNumber}: Other Discount needs a reason from the list.`);
      if (reason.requiresRemarks && !a.otherDiscountRemarks) fail(`${sr.srNumber}: reason "${reason.name}" needs remarks / explanation.`);
      reasonId = reason.id;
      remarks = a.otherDiscountRemarks;
    }
    out.push({
      salesReceiptId: a.salesReceiptId, amount: a.amount,
      ppdRate: a.ppdAmount > 0 ? a.ppdRate : 0, ppdAmount: a.ppdAmount, ppdEligible: eligible,
      ppdOverrideReason: overrideReason, ppdOverrideById: overrideReason ? user.id : null, ppdOverrideAt: overrideReason ? new Date() : null,
      otherDiscount: a.otherDiscount, otherDiscountReasonId: reasonId, otherDiscountRemarks: remarks,
    });
  }
  return out;
}

const discountNote = (apps: { ppdAmount: number; otherDiscount: number; ppdOverrideReason: string | null }[]) => {
  const ppd = round2(apps.reduce((s, a) => s + a.ppdAmount, 0));
  const other = round2(apps.reduce((s, a) => s + a.otherDiscount, 0));
  const overrides = apps.filter((a) => a.ppdOverrideReason).length;
  return (ppd ? `, PPD ₱${ppd.toFixed(2)}` : "") + (other ? `, other discounts ₱${other.toFixed(2)}` : "") + (overrides ? `, ${overrides} PPD override(s)` : "");
};

export async function createReceivePayment(formData: FormData) {
  const user = await requirePermWrite("receivePayments");
  const company = await getActiveCompany(user);
  const e = readEntry(formData);
  if (!e.customerId) err(null, "Pick a customer.");
  if (e.amount <= 0) err(null, "Amount received must be more than zero.");
  const applications = await checkApplications(e, company.id, e.customerId, user, (m) => err(null, m));
  if (e.cashAccountId) {
    const acct = await prisma.cashAccount.findFirst({ where: { id: e.cashAccountId, companyId: company.id, status: "Active" } });
    if (!acct) err(null, "Pick a valid cash/bank account.");
  }

  const prNumber = await nextDocNumber("PR", company.id, e.date);
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
      affiliateAmount: e.affiliateAmount,
      affiliateRemarks: e.affiliateAmount > 0 ? e.affiliateRemarks : null,
      receivedById: user.id,
      status: "Draft",
      applications: { create: applications },
    },
  });
  await logAudit({
    entity: "ReceivePayment", entityId: rp.id, action: "CREATED",
    detail: `${prNumber} drafted: ₱${e.amount.toFixed(2)} received, ${applications.length} invoice(s) selected${discountNote(applications)}${e.affiliateAmount > 0 ? `, collected for affiliate ₱${e.affiliateAmount.toFixed(2)}` : ""}`,
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
  if (e.amount <= 0) err(id, "Amount received must be more than zero.");
  // a mirrored receipt stands for money the affiliate holds: its amount, date and account are fixed by the originating receipt
  if (rp.mirrorOfId && (Math.abs(e.amount - rp.amount) > 0.005 || e.affiliateAmount > 0)) err(id, "This receipt mirrors a collection made by the affiliate — its amount is fixed there; only the invoices it is applied to can change.");
  const applications = await checkApplications(e, company.id, rp.customerId, user, (m) => err(id, m));
  await prisma.$transaction([
    prisma.paymentApplication.deleteMany({ where: { receivePaymentId: id } }),
    prisma.receivePayment.update({
      where: { id },
      data: {
        date: rp.mirrorOfId ? rp.date : e.date, amount: e.amount, method: e.method, cashAccountId: rp.mirrorOfId ? rp.cashAccountId : e.cashAccountId,
        refNo: e.refNo,
        checkNo: e.method === "Check" ? e.checkNo : null,
        checkDate: e.method === "Check" ? e.checkDate : null,
        remarks: e.remarks,
        affiliateAmount: e.affiliateAmount,
        affiliateRemarks: e.affiliateAmount > 0 ? e.affiliateRemarks : null,
        applications: { create: applications },
      },
    }),
  ]);
  await logAudit({
    entity: "ReceivePayment", entityId: id, action: "EDITED",
    detail: `${rp.prNumber} draft edited: ₱${e.amount.toFixed(2)} received, ${applications.length} invoice(s)${discountNote(applications)}${e.affiliateAmount > 0 ? `, collected for affiliate ₱${e.affiliateAmount.toFixed(2)}` : ""}`,
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
  const openingRaw = String(formData.get("openingDate") || "");
  await prisma.cashAccount.create({
    data: {
      companyId: company.id,
      name,
      type: ["Cash", "Bank", "E-Wallet"].includes(String(formData.get("type"))) ? String(formData.get("type")) : "Cash",
      bankName: String(formData.get("bankName") || "").trim().slice(0, 80) || null,
      accountNo: String(formData.get("accountNo") || "").trim().slice(0, 40) || null,
      openingBalance: round2(Number(formData.get("openingBalance")) || 0),
      openingDate: /^\d{4}-\d{2}-\d{2}$/.test(openingRaw) ? new Date(openingRaw) : null,
      glAccountId,
    },
  });
  revalidatePath("/finance/accounts");
  redirect("/finance/accounts");
}
