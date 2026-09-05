import { prisma } from "./db";
import { logAudit } from "./salespeople";
import { unappliedOf, refreshInvoiceStatus } from "./receive-payments";

/** Refunds & Credits core: approving, posting, voiding, and applying credit memos.
 *
 * The same materialisation trick as Receive Payment: applying a posted credit memo to
 * an invoice creates a legacy Payment row (refNo = the CM number), so AR aging,
 * collections, statements and the invoice screens read it natively. Returned goods
 * re-enter inventory only on posting, and only on lines ticked "return to stock".
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export const RC_REASONS = [
  "Sales Return",
  "Overpayment",
  "Pricing Adjustment",
  "Damaged Product",
  "Incorrect Billing",
  "Others",
] as const;

/** amount − applications − posted refunds drawn from this credit = remaining balance. */
export function remainingOf(c: {
  amount: number;
  applications: { amount: number }[];
  refundsDrawn?: { amount: number; status: string }[];
}): number {
  const drawn = (c.refundsDrawn ?? []).filter((r) => r.status === "Posted").reduce((s, r) => s + r.amount, 0);
  return round2(c.amount - c.applications.reduce((s, a) => s + a.amount, 0) - drawn);
}

/** The status badge readers see: a posted credit reports how far it has been used. */
export function creditDisplayStatus(c: {
  type: string;
  status: string;
  amount: number;
  applications: { amount: number }[];
  refundsDrawn?: { amount: number; status: string }[];
}): string {
  if (c.type !== "Credit" || c.status !== "Posted") return c.status;
  const left = remainingOf(c);
  if (left <= 0.005) return "Fully Applied";
  if (left < c.amount - 0.005) return "Partially Applied";
  return "Posted";
}

export type CreditSource = {
  kind: "Payment" | "Credit";
  id: string;
  number: string;
  date: Date;
  available: number;
};

/** One combined credit pot per customer per company: unapplied payments + open credit memos. */
export async function combinedCustomerCredit(customerId: string, companyId: string) {
  const [payments, credits] = await Promise.all([
    prisma.receivePayment.findMany({
      where: { customerId, companyId, status: "Posted" },
      include: {
        applications: { select: { amount: true } },
        refunds: { where: { status: "Posted" }, select: { amount: true, status: true } },
      },
    }),
    prisma.refundCredit.findMany({
      where: { customerId, companyId, type: "Credit", status: "Posted" },
      include: {
        applications: { select: { amount: true } },
        refundsDrawn: { where: { status: "Posted" }, select: { amount: true, status: true } },
      },
    }),
  ]);
  const sources: CreditSource[] = [
    ...payments
      .map((p) => ({ kind: "Payment" as const, id: p.id, number: p.prNumber, date: p.date, available: unappliedOf(p) }))
      .filter((s) => s.available > 0.005),
    ...credits
      .map((c) => ({ kind: "Credit" as const, id: c.id, number: c.rcNumber, date: c.date, available: remainingOf(c) }))
      .filter((s) => s.available > 0.005),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
  return { total: round2(sources.reduce((s, x) => s + x.available, 0)), sources };
}

/** Post an APPROVED credit memo or refund. Refund payout details come from the post form. */
export async function postRefundCredit(
  id: string,
  actor: { id: string; name: string; email: string },
  payout?: { method: string; refNo: string | null; refundDate: Date; cashAccountId: string | null; sourcePaymentId: string | null; sourceCreditId: string | null }
) {
  const rc = await prisma.refundCredit.findUniqueOrThrow({
    where: { id },
    include: {
      lines: { include: { product: true } },
      salesReceipt: { include: { payments: true } },
    },
  });
  if (rc.status !== "Approved") throw new Error(`Only an Approved document can be posted (this one is ${rc.status}).`);

  if (rc.type === "Refund") {
    if (!payout?.method) throw new Error("Record the refund method before posting.");
    // a refund drawing on existing credit may not exceed what that source still holds
    if (payout.sourcePaymentId) {
      const src = await prisma.receivePayment.findFirst({
        where: { id: payout.sourcePaymentId, companyId: rc.companyId, customerId: rc.customerId, status: "Posted" },
        include: {
          applications: { select: { amount: true } },
          refunds: { where: { status: "Posted" }, select: { amount: true, status: true } },
        },
      });
      if (!src) throw new Error("The source payment is not a posted payment of this customer.");
      if (rc.amount > unappliedOf(src) + 0.005) {
        throw new Error(`${src.prNumber} only holds ₱${unappliedOf(src).toFixed(2)} of credit.`);
      }
    }
    if (payout.sourceCreditId) {
      const src = await prisma.refundCredit.findFirst({
        where: { id: payout.sourceCreditId, companyId: rc.companyId, customerId: rc.customerId, type: "Credit", status: "Posted" },
        include: {
          applications: { select: { amount: true } },
          refundsDrawn: { where: { status: "Posted" }, select: { amount: true, status: true } },
        },
      });
      if (!src) throw new Error("The source credit memo is not a posted credit of this customer.");
      if (rc.amount > remainingOf(src) + 0.005) {
        throw new Error(`${src.rcNumber} only holds ₱${remainingOf(src).toFixed(2)} of credit.`);
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    // returned goods re-enter inventory — ticked lines only, never for damaged items
    for (const l of rc.lines) {
      if (!l.returnToStock || !l.productId || l.qty <= 0) continue;
      const prod = await tx.product.update({
        where: { id: l.productId },
        data: { stockQty: { increment: l.qty } },
      });
      await tx.stockMovement.create({
        data: {
          productId: l.productId,
          type: "IN",
          qty: l.qty,
          balanceAfter: prod.stockQty,
          enteredQty: l.qty,
          enteredUnit: "PCS",
          refType: "RETURN",
          refNo: rc.rcNumber,
          date: rc.date,
          userId: actor.id,
        },
      });
    }

    // a credit with a related open invoice offsets it immediately, up to its balance
    if (rc.type === "Credit" && rc.salesReceipt && rc.salesReceipt.status !== "Void" && rc.salesReceipt.status !== "Paid") {
      const balance = round2(rc.salesReceipt.amount - rc.salesReceipt.payments.reduce((s, p) => s + p.amount, 0));
      const apply = round2(Math.min(rc.amount, balance));
      if (apply > 0.005) {
        const pay = await tx.payment.create({
          data: { salesReceiptId: rc.salesReceipt.id, amount: apply, date: rc.date, method: "Credit Memo", refNo: rc.rcNumber },
        });
        await tx.creditApplication.create({
          data: { refundCreditId: rc.id, salesReceiptId: rc.salesReceipt.id, amount: apply, paymentId: pay.id },
        });
      }
    }

    await tx.refundCredit.update({
      where: { id },
      data: {
        status: "Posted",
        ...(rc.type === "Refund" && payout
          ? {
              refundMethod: payout.method,
              refundRefNo: payout.refNo,
              refundDate: payout.refundDate,
              cashAccountId: payout.cashAccountId,
              sourcePaymentId: payout.sourcePaymentId,
              sourceCreditId: payout.sourceCreditId,
            }
          : {}),
      },
    });
  });
  if (rc.type === "Credit" && rc.salesReceiptId) await refreshInvoiceStatus(rc.salesReceiptId);
  await logAudit({
    entity: "RefundCredit", entityId: id, action: "POSTED",
    detail: `${rc.rcNumber} (${rc.type}) posted: ₱${rc.amount.toFixed(2)}${rc.type === "Refund" && payout ? ` refunded via ${payout.method}` : ""}`,
    actorName: actor.name, actorEmail: actor.email,
  });
}

/** Void a posted document: applications come off the invoices, returned stock goes back out. */
export async function voidRefundCredit(id: string, reason: string, actor: { id: string; name: string; email: string }) {
  const rc = await prisma.refundCredit.findUniqueOrThrow({
    where: { id },
    include: { applications: true, lines: true },
  });
  if (rc.status !== "Posted") throw new Error(`Only a Posted document can be voided (this one is ${rc.status}).`);
  await prisma.$transaction(async (tx) => {
    for (const a of rc.applications) {
      if (a.paymentId) {
        await tx.creditApplication.update({ where: { id: a.id }, data: { paymentId: null } });
        await tx.payment.delete({ where: { id: a.paymentId } });
      }
    }
    for (const l of rc.lines) {
      if (!l.returnToStock || !l.productId || l.qty <= 0) continue;
      const prod = await tx.product.update({
        where: { id: l.productId },
        data: { stockQty: { decrement: l.qty } },
      });
      await tx.stockMovement.create({
        data: {
          productId: l.productId,
          type: "OUT",
          qty: l.qty,
          balanceAfter: prod.stockQty,
          enteredQty: l.qty,
          enteredUnit: "PCS",
          refType: "RETURN",
          refNo: `${rc.rcNumber} (void)`,
          userId: actor.id,
        },
      });
    }
    await tx.refundCredit.update({ where: { id }, data: { status: "Void", voidReason: reason || "voided" } });
  });
  for (const a of rc.applications) await refreshInvoiceStatus(a.salesReceiptId);
  await logAudit({
    entity: "RefundCredit", entityId: id, action: "VOIDED",
    detail: `${rc.rcNumber} voided (${reason || "no reason given"}); ${rc.applications.length} application(s) reversed`,
    actorName: actor.name, actorEmail: actor.email,
  });
}

/** Apply part of a posted credit memo's remaining balance to one open invoice, now. */
export async function applyCreditMemo(
  refundCreditId: string,
  salesReceiptId: string,
  amount: number,
  actor: { name: string; email: string }
) {
  amount = round2(amount);
  if (amount <= 0) throw new Error("Amount must be positive.");
  const rc = await prisma.refundCredit.findUniqueOrThrow({
    where: { id: refundCreditId },
    include: {
      applications: { select: { amount: true } },
      refundsDrawn: { where: { status: "Posted" }, select: { amount: true, status: true } },
    },
  });
  if (rc.type !== "Credit" || rc.status !== "Posted") throw new Error("Only a Posted credit memo can be applied.");
  const available = remainingOf(rc);
  if (amount > available + 0.005) throw new Error(`Only ₱${available.toFixed(2)} of this credit remains.`);
  const sr = await prisma.salesReceipt.findUniqueOrThrow({ where: { id: salesReceiptId }, include: { payments: true } });
  if (sr.companyId !== rc.companyId) throw new Error("That invoice belongs to another company.");
  if (sr.customerId !== rc.customerId) throw new Error("That invoice belongs to another customer.");
  if (sr.status === "Void") throw new Error("That invoice is void.");
  const balance = round2(sr.amount - sr.payments.reduce((s, p) => s + p.amount, 0));
  if (amount > balance + 0.005) throw new Error(`Only ₱${balance.toFixed(2)} is outstanding on ${sr.srNumber}.`);

  await prisma.$transaction(async (tx) => {
    const pay = await tx.payment.create({
      data: { salesReceiptId, amount, date: new Date(), method: "Credit Memo", refNo: rc.rcNumber },
    });
    await tx.creditApplication.create({ data: { refundCreditId, salesReceiptId, amount, paymentId: pay.id } });
  });
  await refreshInvoiceStatus(salesReceiptId);
  await logAudit({
    entity: "RefundCredit", entityId: refundCreditId, action: "CREDIT_APPLIED",
    detail: `₱${amount.toFixed(2)} of ${rc.rcNumber} applied to ${sr.srNumber}`,
    actorName: actor.name, actorEmail: actor.email,
  });
}

/** Take one credit application back off its invoice. */
export async function unapplyCreditApplication(applicationId: string, actor: { name: string; email: string }) {
  const a = await prisma.creditApplication.findUniqueOrThrow({
    where: { id: applicationId },
    include: { refundCredit: true, salesReceipt: { select: { srNumber: true } } },
  });
  if (a.refundCredit.status !== "Posted") throw new Error("Only applications of a Posted credit can be unapplied.");
  await prisma.$transaction(async (tx) => {
    await tx.creditApplication.delete({ where: { id: applicationId } });
    if (a.paymentId) await tx.payment.delete({ where: { id: a.paymentId } });
  });
  await refreshInvoiceStatus(a.salesReceiptId);
  await logAudit({
    entity: "RefundCredit", entityId: a.refundCreditId, action: "UNAPPLIED",
    detail: `₱${a.amount.toFixed(2)} taken off ${a.salesReceipt.srNumber} — back to ${a.refundCredit.rcNumber} balance`,
    actorName: actor.name, actorEmail: actor.email,
  });
}
