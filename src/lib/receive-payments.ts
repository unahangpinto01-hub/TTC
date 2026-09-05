import { prisma } from "./db";
import { logAudit } from "./salespeople";

/** Receive Payment core: the one place that posts, voids, applies and unapplies.
 *
 * Posting turns each application into a legacy Payment row on its invoice, so AR
 * aging, collections, customer statements, the invoice screens and the P&L keep
 * reading the records they always have — nothing downstream had to change.
 * Only Posted payments ever touch those records.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export const PAYMENT_METHODS = ["Cash", "Check", "Bank Transfer", "GCash"] as const;

export type PaymentStatus = "Draft" | "Pending Approval" | "Posted" | "Cancelled" | "Void";

/** Approve / Post / Void / Unapply are for admins; everyone else drafts and submits. */
export function canApprovePayments(user: { role: string }): boolean {
  return user.role === "SUPER_ADMIN" || user.role === "ADMIN";
}

export type OutstandingInvoice = {
  id: string;
  srNumber: string;
  invoiceDate: Date;
  dueDate: Date;
  amount: number;
  /** payments recorded directly on the invoice (the pre-module rows) */
  previousPayments: number;
  /** payments that arrived through posted Receive Payment applications */
  creditApplied: number;
  outstanding: number;
};

/** Every invoice of this customer, in this company, that still has a balance. */
export async function getOutstandingInvoices(customerId: string, companyId: string): Promise<OutstandingInvoice[]> {
  const srs = await prisma.salesReceipt.findMany({
    where: { customerId, companyId, status: { in: ["Open", "Partial"] } },
    include: { payments: { include: { application: { select: { id: true } } } } },
    orderBy: { invoiceDate: "asc" },
  });
  return srs
    .map((sr) => {
      const previous = sr.payments.filter((p) => !p.application).reduce((s, p) => s + p.amount, 0);
      const applied = sr.payments.filter((p) => p.application).reduce((s, p) => s + p.amount, 0);
      return {
        id: sr.id,
        srNumber: sr.srNumber,
        invoiceDate: sr.invoiceDate,
        dueDate: sr.dueDate,
        amount: sr.amount,
        previousPayments: round2(previous),
        creditApplied: round2(applied),
        outstanding: round2(sr.amount - previous - applied),
      };
    })
    .filter((x) => x.outstanding > 0.005);
}

/** Re-derive an invoice's status from its payments. Void invoices are never touched. */
export async function refreshInvoiceStatus(salesReceiptId: string) {
  const sr = await prisma.salesReceipt.findUniqueOrThrow({
    where: { id: salesReceiptId },
    include: { payments: true },
  });
  if (sr.status === "Void") return;
  const paid = sr.payments.reduce((s, p) => s + p.amount, 0);
  const status = paid >= sr.amount - 0.005 ? "Paid" : paid > 0.005 ? "Partial" : "Open";
  if (status !== sr.status) await prisma.salesReceipt.update({ where: { id: sr.id }, data: { status } });
}

/** amount − everything applied = the credit still available on this payment. */
export function unappliedOf(p: { amount: number; applications: { amount: number }[] }): number {
  return round2(p.amount - p.applications.reduce((s, a) => s + a.amount, 0));
}

/** A customer's total available credit in one company (posted, unapplied money). */
export async function customerCredit(customerId: string, companyId: string): Promise<number> {
  const posted = await prisma.receivePayment.findMany({
    where: { customerId, companyId, status: "Posted" },
    include: { applications: { select: { amount: true } } },
  });
  return round2(posted.reduce((s, p) => s + unappliedOf(p), 0));
}

/** Post: validate every application against the invoice's live balance, then create the
    Payment rows and refresh each invoice. Throws with a readable message on any problem. */
export async function postReceivePayment(id: string, actor: { name: string; email: string }) {
  const rp = await prisma.receivePayment.findUniqueOrThrow({
    where: { id },
    include: { applications: { include: { salesReceipt: { include: { payments: true } } } } },
  });
  if (rp.status !== "Draft" && rp.status !== "Pending Approval") throw new Error(`Cannot post a ${rp.status} payment.`);
  const appliedTotal = round2(rp.applications.reduce((s, a) => s + a.amount, 0));
  if (appliedTotal > rp.amount + 0.005) throw new Error("Applied more than the payment amount.");

  for (const a of rp.applications) {
    const sr = a.salesReceipt;
    if (sr.companyId !== rp.companyId) throw new Error(`${sr.srNumber} belongs to another company.`);
    if (sr.status === "Void") throw new Error(`${sr.srNumber} is void.`);
    const balance = round2(sr.amount - sr.payments.reduce((s, p) => s + p.amount, 0));
    if (a.amount > balance + 0.005) {
      throw new Error(`${sr.srNumber}: applying ${a.amount.toFixed(2)} but only ${balance.toFixed(2)} is outstanding.`);
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const a of rp.applications) {
      const pay = await tx.payment.create({
        data: {
          salesReceiptId: a.salesReceiptId,
          amount: a.amount,
          date: rp.date,
          method: rp.method,
          refNo: rp.prNumber,
        },
      });
      await tx.paymentApplication.update({ where: { id: a.id }, data: { paymentId: pay.id } });
    }
    await tx.receivePayment.update({ where: { id }, data: { status: "Posted" } });
  });
  for (const a of rp.applications) await refreshInvoiceStatus(a.salesReceiptId);
  await logAudit({
    entity: "ReceivePayment", entityId: id, action: "POSTED",
    detail: `${rp.prNumber} posted: ₱${rp.amount.toFixed(2)}, applied ₱${appliedTotal.toFixed(2)} to ${rp.applications.length} invoice(s), unapplied ₱${(rp.amount - appliedTotal).toFixed(2)}`,
    actorName: actor.name, actorEmail: actor.email,
  });
}

/** Void a posted payment: remove the Payment rows it created and put the invoices back. */
export async function voidReceivePayment(id: string, reason: string, actor: { name: string; email: string }) {
  const rp = await prisma.receivePayment.findUniqueOrThrow({
    where: { id },
    include: { applications: true },
  });
  if (rp.status !== "Posted") throw new Error(`Only a Posted payment can be voided (this one is ${rp.status}).`);
  await prisma.$transaction(async (tx) => {
    for (const a of rp.applications) {
      if (a.paymentId) {
        await tx.paymentApplication.update({ where: { id: a.id }, data: { paymentId: null } });
        await tx.payment.delete({ where: { id: a.paymentId } });
      }
    }
    await tx.receivePayment.update({ where: { id }, data: { status: "Void", voidReason: reason || "voided" } });
  });
  for (const a of rp.applications) await refreshInvoiceStatus(a.salesReceiptId);
  await logAudit({
    entity: "ReceivePayment", entityId: id, action: "VOIDED",
    detail: `${rp.prNumber} voided (${reason || "no reason given"}); ${rp.applications.length} application(s) reversed`,
    actorName: actor.name, actorEmail: actor.email,
  });
}

/** Apply available credit from a posted payment to one more invoice, effective now. */
export async function applyCredit(
  receivePaymentId: string,
  salesReceiptId: string,
  amount: number,
  actor: { name: string; email: string }
) {
  amount = round2(amount);
  if (amount <= 0) throw new Error("Amount must be positive.");
  const rp = await prisma.receivePayment.findUniqueOrThrow({
    where: { id: receivePaymentId },
    include: { applications: true },
  });
  if (rp.status !== "Posted") throw new Error("Credit can only be applied from a Posted payment.");
  const available = unappliedOf(rp);
  if (amount > available + 0.005) throw new Error(`Only ₱${available.toFixed(2)} of credit is available.`);
  const sr = await prisma.salesReceipt.findUniqueOrThrow({ where: { id: salesReceiptId }, include: { payments: true } });
  if (sr.companyId !== rp.companyId) throw new Error("That invoice belongs to another company.");
  if (sr.customerId !== rp.customerId) throw new Error("That invoice belongs to another customer.");
  if (sr.status === "Void") throw new Error("That invoice is void.");
  const balance = round2(sr.amount - sr.payments.reduce((s, p) => s + p.amount, 0));
  if (amount > balance + 0.005) throw new Error(`Only ₱${balance.toFixed(2)} is outstanding on ${sr.srNumber}.`);

  await prisma.$transaction(async (tx) => {
    const pay = await tx.payment.create({
      data: { salesReceiptId, amount, date: new Date(), method: rp.method, refNo: rp.prNumber },
    });
    await tx.paymentApplication.create({
      data: { receivePaymentId, salesReceiptId, amount, paymentId: pay.id },
    });
  });
  await refreshInvoiceStatus(salesReceiptId);
  await logAudit({
    entity: "ReceivePayment", entityId: receivePaymentId, action: "CREDIT_APPLIED",
    detail: `₱${amount.toFixed(2)} of ${rp.prNumber} credit applied to ${sr.srNumber}`,
    actorName: actor.name, actorEmail: actor.email,
  });
}

/** Take one application back off its invoice — the money returns to the payment's credit. */
export async function unapplyApplication(applicationId: string, actor: { name: string; email: string }) {
  const a = await prisma.paymentApplication.findUniqueOrThrow({
    where: { id: applicationId },
    include: { receivePayment: true, salesReceipt: { select: { srNumber: true } } },
  });
  if (a.receivePayment.status !== "Posted") throw new Error("Only applications of a Posted payment can be unapplied.");
  await prisma.$transaction(async (tx) => {
    await tx.paymentApplication.delete({ where: { id: applicationId } });
    if (a.paymentId) await tx.payment.delete({ where: { id: a.paymentId } });
  });
  await refreshInvoiceStatus(a.salesReceiptId);
  await logAudit({
    entity: "ReceivePayment", entityId: a.receivePaymentId, action: "UNAPPLIED",
    detail: `₱${a.amount.toFixed(2)} taken off ${a.salesReceipt.srNumber} — back to ${a.receivePayment.prNumber} credit`,
    actorName: actor.name, actorEmail: actor.email,
  });
}

/** A cash/bank account's running balance: opening + every posted inflow. */
export async function cashAccountBalances(companyId: string) {
  const accounts = await prisma.cashAccount.findMany({
    where: { companyId },
    include: { payments: { where: { status: "Posted" }, select: { amount: true } } },
    orderBy: { name: "asc" },
  });
  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    status: a.status,
    openingBalance: a.openingBalance,
    inflows: round2(a.payments.reduce((s, p) => s + p.amount, 0)),
    balance: round2(a.openingBalance + a.payments.reduce((s, p) => s + p.amount, 0)),
  }));
}
