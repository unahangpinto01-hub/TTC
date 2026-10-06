import { prisma } from "./db";
import { logAudit } from "./salespeople";

/** Receive Payment core: the one place that posts, voids, applies and unapplies.
 *
 * Posting turns each application into legacy Payment rows on its invoice, so AR
 * aging, collections, customer statements, the invoice screens and the P&L keep
 * reading the records they always have — nothing downstream had to change.
 * Only Posted payments ever touch those records.
 *
 * An application settles an invoice with up to three parts, each its own Payment row:
 *   PAYMENT   the money received (the only part that is cash collected)
 *   PPD       a prompt payment discount granted for paying inside the company's window
 *   DISCOUNT  another approved discount, with a reason from the configurable list
 * Payment + PPD + Other Discount = the AR settled. The receipt's own amount is cash only.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export const PAYMENT_METHODS = ["Cash", "Check", "Bank Transfer", "GCash"] as const;

export type PaymentStatus = "Draft" | "Pending Approval" | "Posted" | "Cancelled" | "Void";

/** The parts of an invoice settlement, as stored on Payment.kind. */
export const PAYMENT_KINDS = { payment: "PAYMENT", ppd: "PPD", discount: "DISCOUNT" } as const;

/** Approve / Post / Void / Unapply are for admins; everyone else drafts and submits. */
export function canApprovePayments(user: { role: string }): boolean {
  return user.role === "SUPER_ADMIN" || user.role === "ADMIN";
}

/* ------------------------------------------------------------------ PPD policy */

export type PpdSettings = { rate: number; days: number; maxRate: number };

export const ppdSettingsOf = (c: { ppdRate: number; ppdDays: number; ppdMaxRate: number }): PpdSettings => ({ rate: c.ppdRate, days: c.ppdDays, maxRate: c.ppdMaxRate });

/** The last day a payment may still earn PPD on this invoice, or null when there is no window
    (every PPD is then entered by hand) — an opening balance never qualifies by rule. */
export function ppdDeadline(invoice: { kind: string; invoiceDate: Date }, s: PpdSettings): Date | null {
  if (invoice.kind === "OPENING" || s.days <= 0) return null;
  const d = new Date(invoice.invoiceDate);
  d.setDate(d.getDate() + s.days);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Inside the window on the payment date? Without a window, yes; an opening balance, never. */
export function ppdEligible(invoice: { kind: string; invoiceDate: Date }, paymentDate: Date, s: PpdSettings): boolean {
  if (invoice.kind === "OPENING") return false;
  const deadline = ppdDeadline(invoice, s);
  return deadline ? paymentDate <= deadline : true;
}

/**
 * The PPD a payment earns at a rate: the discount is a share of the PRODUCT amount of the
 * invoice — freight and other charges are never discounted — pro-rated to what the payment
 * settles. An invoice of goods G and charges F is settled in full by G(1 − r) + F of cash;
 * a payment P settles the share P / (G(1 − r) + F) of it and earns that share of G·r. So on
 * a 100,000 invoice of goods alone at 2%, 98,000 earns 2,000 and 49,000 earns 1,000; on
 * 65,040 of goods plus 500 freight at 6%, the full 61,637.60 earns 3,902.40 — 6% of the goods.
 */
export function ppdFor(payment: number, rate: number, goods?: number, total?: number): number {
  if (payment <= 0 || rate <= 0 || rate >= 1) return 0;
  const g = goods ?? payment / (1 - rate), t = total ?? g;
  const f = Math.max(0, t - g);
  if (goods === undefined || g <= 0) return round2((payment * rate) / (1 - rate));
  const settleable = g * (1 - rate) + f;
  const share = settleable > 0 ? Math.min(1, payment / settleable) : 0;
  return round2(share * g * rate);
}

/* ------------------------------------------------------------------ outstanding */

export type OutstandingInvoice = {
  id: string;
  srNumber: string;
  kind: string;
  invoiceDate: Date;
  dueDate: Date;
  amount: number;
  /** the product amount — what PPD is computed on; freight and other charges are not discounted */
  discountable: number;
  /** the customer's own reference (TRA number) or, on an opening balance, its memo */
  reference: string | null;
  /** payments recorded directly on the invoice (the pre-module rows) */
  previousPayments: number;
  /** everything that arrived through posted applications: cash, PPD and other discounts */
  creditApplied: number;
  outstanding: number;
};

/** Every invoice of this customer, in this company, that still has a balance. */
export async function getOutstandingInvoices(customerId: string, companyId: string): Promise<OutstandingInvoice[]> {
  const srs = await prisma.salesReceipt.findMany({
    where: { customerId, companyId, status: { in: ["Open", "Partial"] } },
    include: { payments: { include: { application: { select: { id: true } }, ppdApplication: { select: { id: true } }, discountApplication: { select: { id: true } } } } },
    orderBy: { invoiceDate: "asc" },
  });
  return srs
    .map((sr) => {
      const viaApp = (p: (typeof sr.payments)[number]) => !!(p.application || p.ppdApplication || p.discountApplication);
      const previous = sr.payments.filter((p) => !viaApp(p)).reduce((s, p) => s + p.amount, 0);
      const applied = sr.payments.filter(viaApp).reduce((s, p) => s + p.amount, 0);
      return {
        id: sr.id,
        srNumber: sr.srNumber,
        kind: sr.kind,
        invoiceDate: sr.invoiceDate,
        dueDate: sr.dueDate,
        amount: sr.amount,
        discountable: sr.kind === "OPENING" ? sr.amount : round2(Math.max(0, sr.amount - sr.freightCharge - sr.otherCharges)),
        reference: sr.customerRef ?? sr.memo ?? null,
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

/** amount − applications − posted refunds drawn from it = the credit still available.
    Only the cash applied counts: a discount never came out of the money received. */
export function unappliedOf(p: {
  amount: number;
  applications: { amount: number }[];
  refunds?: { amount: number; status: string }[];
}): number {
  const drawn = (p.refunds ?? []).filter((r) => r.status === "Posted").reduce((s, r) => s + r.amount, 0);
  return round2(p.amount - p.applications.reduce((s, a) => s + a.amount, 0) - drawn);
}

/** Payment + PPD + Other Discount — what one application settles on its invoice. */
export const settledOf = (a: { amount: number; ppdAmount: number; otherDiscount: number }) => round2(a.amount + a.ppdAmount + a.otherDiscount);

/** A customer's available credit from posted payments in one company (overpayments not
    yet applied or refunded). Credit memos add to this — see combinedCustomerCredit. */
export async function customerCredit(customerId: string, companyId: string): Promise<number> {
  const posted = await prisma.receivePayment.findMany({
    where: { customerId, companyId, status: "Posted" },
    include: {
      applications: { select: { amount: true } },
      refunds: { where: { status: "Posted" }, select: { amount: true, status: true } },
    },
  });
  return round2(posted.reduce((s, p) => s + unappliedOf(p), 0));
}

/* ------------------------------------------------------------------ post / void */

/** Post: validate every application against the invoice's live balance, then create the
    Payment rows (cash, PPD, other discount) and refresh each invoice. Throws with a readable
    message on any problem. */
export async function postReceivePayment(id: string, actor: { name: string; email: string }) {
  const rp = await prisma.receivePayment.findUniqueOrThrow({
    where: { id },
    include: {
      company: { select: { ppdRate: true, ppdDays: true, ppdMaxRate: true } },
      applications: { include: { salesReceipt: { include: { payments: true } }, otherDiscountReason: { select: { name: true, status: true } } } },
    },
  });
  if (rp.status !== "Draft" && rp.status !== "Pending Approval") throw new Error(`Cannot post a ${rp.status} payment.`);
  // same rule as Other Receipts: posted money must land in a real account, or no
  // bank balance would ever carry it and the cash would be untraceable
  if (!rp.cashAccountId) throw new Error("Assign a cash/bank account before posting — the money must land somewhere.");
  const appliedTotal = round2(rp.applications.reduce((s, a) => s + a.amount, 0));
  if (appliedTotal > rp.amount + 0.005) throw new Error("Applied more than the payment amount.");
  const settings = ppdSettingsOf(rp.company);

  for (const a of rp.applications) {
    const sr = a.salesReceipt;
    if (sr.companyId !== rp.companyId) throw new Error(`${sr.srNumber} belongs to another company.`);
    if (sr.status === "Void") throw new Error(`${sr.srNumber} is void.`);
    const balance = round2(sr.amount - sr.payments.reduce((s, p) => s + p.amount, 0));
    const settled = settledOf(a);
    if (settled > balance + 0.005) {
      throw new Error(`${sr.srNumber}: total application exceeds the invoice outstanding balance — settling ${settled.toFixed(2)} but only ${balance.toFixed(2)} is outstanding (payment ${a.amount.toFixed(2)}, maximum remaining discount ${Math.max(0, round2(balance - a.amount)).toFixed(2)}).`);
    }
    if (a.ppdAmount > 0 && !ppdEligible(sr, rp.date, settings) && !(a.ppdOverrideReason ?? "").trim()) {
      throw new Error(`${sr.srNumber}: the payment date is outside the prompt payment window and no override was recorded.`);
    }
    if (a.otherDiscount > 0 && !a.otherDiscountReason) throw new Error(`${sr.srNumber}: an other discount needs a reason.`);
  }

  await prisma.$transaction(async (tx) => {
    for (const a of rp.applications) {
      const base = { salesReceiptId: a.salesReceiptId, date: rp.date, refNo: rp.prNumber };
      const data: { paymentId?: string; ppdPaymentId?: string; discountPaymentId?: string } = {};
      if (a.amount > 0) {
        const pay = await tx.payment.create({ data: { ...base, kind: PAYMENT_KINDS.payment, amount: a.amount, method: rp.method } });
        data.paymentId = pay.id;
      }
      if (a.ppdAmount > 0) {
        const pay = await tx.payment.create({ data: { ...base, kind: PAYMENT_KINDS.ppd, amount: a.ppdAmount, method: "Prompt Payment Discount" } });
        data.ppdPaymentId = pay.id;
      }
      if (a.otherDiscount > 0) {
        const pay = await tx.payment.create({ data: { ...base, kind: PAYMENT_KINDS.discount, amount: a.otherDiscount, method: "Other Discount" } });
        data.discountPaymentId = pay.id;
      }
      await tx.paymentApplication.update({ where: { id: a.id }, data });
    }
    await tx.receivePayment.update({ where: { id }, data: { status: "Posted" } });
  });
  for (const a of rp.applications) await refreshInvoiceStatus(a.salesReceiptId);

  const ppdTotal = round2(rp.applications.reduce((s, a) => s + a.ppdAmount, 0));
  const otherTotal = round2(rp.applications.reduce((s, a) => s + a.otherDiscount, 0));
  const parts = rp.applications.map((a) => {
    const bits = [`${a.salesReceipt.srNumber}: payment ₱${a.amount.toFixed(2)}`];
    if (a.ppdAmount > 0) bits.push(`PPD ₱${a.ppdAmount.toFixed(2)} at ${(a.ppdRate * 100).toFixed(2)}%${a.ppdEligible ? " (inside window)" : ` (OVERRIDE: ${a.ppdOverrideReason})`}`);
    if (a.otherDiscount > 0) bits.push(`other discount ₱${a.otherDiscount.toFixed(2)} — ${a.otherDiscountReason?.name ?? "?"}${a.otherDiscountRemarks ? ` (${a.otherDiscountRemarks})` : ""}`);
    return bits.join(", ");
  });
  await logAudit({
    entity: "ReceivePayment", entityId: id, action: "POSTED",
    detail: `${rp.prNumber} posted: ₱${rp.amount.toFixed(2)} received, applied ₱${appliedTotal.toFixed(2)} to ${rp.applications.length} invoice(s)` +
      (ppdTotal ? `, PPD ₱${ppdTotal.toFixed(2)}` : "") + (otherTotal ? `, other discounts ₱${otherTotal.toFixed(2)}` : "") +
      `, AR settled ₱${round2(appliedTotal + ppdTotal + otherTotal).toFixed(2)}, unapplied ₱${(rp.amount - appliedTotal).toFixed(2)}` +
      (parts.length ? ` · ${parts.join(" · ")}` : ""),
    actorName: actor.name, actorEmail: actor.email,
  });
}

/** Void a posted payment: remove every Payment row it created (cash, PPD, other discount) and put the invoices back. */
export async function voidReceivePayment(id: string, reason: string, actor: { name: string; email: string }) {
  const rp = await prisma.receivePayment.findUniqueOrThrow({
    where: { id },
    include: { applications: true },
  });
  if (rp.status !== "Posted") throw new Error(`Only a Posted payment can be voided (this one is ${rp.status}).`);
  await prisma.$transaction(async (tx) => {
    for (const a of rp.applications) await detachPayments(tx, a);
    await tx.receivePayment.update({ where: { id }, data: { status: "Void", voidReason: reason || "voided" } });
  });
  for (const a of rp.applications) await refreshInvoiceStatus(a.salesReceiptId);
  const ppdTotal = round2(rp.applications.reduce((s, a) => s + a.ppdAmount, 0));
  const otherTotal = round2(rp.applications.reduce((s, a) => s + a.otherDiscount, 0));
  await logAudit({
    entity: "ReceivePayment", entityId: id, action: "VOIDED",
    detail: `${rp.prNumber} voided (${reason || "no reason given"}); ${rp.applications.length} application(s) reversed` +
      (ppdTotal ? `, PPD ₱${ppdTotal.toFixed(2)} reversed` : "") + (otherTotal ? `, other discounts ₱${otherTotal.toFixed(2)} reversed` : ""),
    actorName: actor.name, actorEmail: actor.email,
  });
}

/** Remove the Payment rows an application produced, leaving the application itself. */
async function detachPayments(tx: Pick<typeof prisma, "payment" | "paymentApplication">, a: { id: string; paymentId: string | null; ppdPaymentId: string | null; discountPaymentId: string | null }) {
  const ids = [a.paymentId, a.ppdPaymentId, a.discountPaymentId].filter((x): x is string => !!x);
  if (!ids.length) return;
  await tx.paymentApplication.update({ where: { id: a.id }, data: { paymentId: null, ppdPaymentId: null, discountPaymentId: null } });
  await tx.payment.deleteMany({ where: { id: { in: ids } } });
}

/** Apply available credit from a posted payment to one more invoice, effective now. Cash only — no discount is granted after the fact. */
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
      data: { salesReceiptId, amount, date: new Date(), method: rp.method, refNo: rp.prNumber, kind: PAYMENT_KINDS.payment },
    });
    await tx.paymentApplication.create({
      data: { receivePaymentId, salesReceiptId, amount, paymentId: pay.id, fromCredit: true },
    });
  });
  await refreshInvoiceStatus(salesReceiptId);
  await logAudit({
    entity: "ReceivePayment", entityId: receivePaymentId, action: "CREDIT_APPLIED",
    detail: `₱${amount.toFixed(2)} of ${rp.prNumber} credit applied to ${sr.srNumber}`,
    actorName: actor.name, actorEmail: actor.email,
  });
}

/** Take one application back off its invoice — the money returns to the payment's credit and any discount granted with it is withdrawn. */
export async function unapplyApplication(applicationId: string, actor: { name: string; email: string }) {
  const a = await prisma.paymentApplication.findUniqueOrThrow({
    where: { id: applicationId },
    include: { receivePayment: true, salesReceipt: { select: { srNumber: true } } },
  });
  if (a.receivePayment.status !== "Posted") throw new Error("Only applications of a Posted payment can be unapplied.");
  await prisma.$transaction(async (tx) => {
    await detachPayments(tx, a);
    await tx.paymentApplication.delete({ where: { id: applicationId } });
  });
  await refreshInvoiceStatus(a.salesReceiptId);
  await logAudit({
    entity: "ReceivePayment", entityId: a.receivePaymentId, action: "UNAPPLIED",
    detail: `₱${a.amount.toFixed(2)} taken off ${a.salesReceipt.srNumber} — back to ${a.receivePayment.prNumber} credit` +
      (a.ppdAmount ? `; PPD ₱${a.ppdAmount.toFixed(2)} withdrawn` : "") + (a.otherDiscount ? `; other discount ₱${a.otherDiscount.toFixed(2)} withdrawn` : ""),
    actorName: actor.name, actorEmail: actor.email,
  });
}

/* ------------------------------------------------------------------ settlement history */

export type SettlementRow = {
  date: Date;
  ref: string;
  /** where the row came from: a receive payment, a credit memo, or a payment recorded straight on the invoice */
  source: "receipt" | "credit" | "direct";
  href: string | null;
  method: string;
  payment: number;
  ppd: number;
  other: number;
  otherReason: string | null;
  total: number;
  remaining: number;
};

/** One line per settlement of an invoice — payment, PPD and other discount side by side, with the balance after each. */
export async function settlementHistory(salesReceiptId: string): Promise<{ rows: SettlementRow[]; amount: number; balance: number }> {
  const sr = await prisma.salesReceipt.findUniqueOrThrow({
    where: { id: salesReceiptId },
    include: {
      payments: {
        orderBy: { date: "asc" },
        include: {
          application: { select: { id: true, receivePaymentId: true, receivePayment: { select: { prNumber: true } } } },
          ppdApplication: { select: { id: true, receivePaymentId: true, receivePayment: { select: { prNumber: true } } } },
          discountApplication: { select: { id: true, receivePaymentId: true, otherDiscountReason: { select: { name: true } }, receivePayment: { select: { prNumber: true } } } },
          creditApplication: { select: { refundCredit: { select: { id: true, rcNumber: true } } } },
        },
      },
    },
  });
  const byApp = new Map<string, SettlementRow>();
  const rows: SettlementRow[] = [];
  for (const p of sr.payments) {
    const app = p.application ?? p.ppdApplication ?? p.discountApplication;
    if (app) {
      const row = byApp.get(app.id) ?? { date: p.date, ref: app.receivePayment.prNumber, source: "receipt" as const, href: `/payments/${app.receivePaymentId}`, method: "", payment: 0, ppd: 0, other: 0, otherReason: null, total: 0, remaining: 0 };
      if (p.kind === PAYMENT_KINDS.ppd) row.ppd = round2(row.ppd + p.amount);
      else if (p.kind === PAYMENT_KINDS.discount) { row.other = round2(row.other + p.amount); row.otherReason = p.discountApplication?.otherDiscountReason?.name ?? row.otherReason; }
      else { row.payment = round2(row.payment + p.amount); row.method = p.method; }
      if (!byApp.has(app.id)) { byApp.set(app.id, row); rows.push(row); }
    } else if (p.creditApplication) {
      rows.push({ date: p.date, ref: p.creditApplication.refundCredit.rcNumber, source: "credit", href: `/refunds/${p.creditApplication.refundCredit.id}`, method: "Credit Memo", payment: p.amount, ppd: 0, other: 0, otherReason: null, total: 0, remaining: 0 });
    } else {
      rows.push({ date: p.date, ref: p.refNo ?? "", source: "direct", href: null, method: p.method, payment: p.amount, ppd: 0, other: 0, otherReason: null, total: 0, remaining: 0 });
    }
  }
  let remaining = sr.amount;
  for (const r of rows) {
    r.total = round2(r.payment + r.ppd + r.other);
    remaining = round2(remaining - r.total);
    r.remaining = remaining;
  }
  return { rows, amount: sr.amount, balance: remaining };
}

/** A cash/bank account's running balance — EVERY posted money document, in and out:
    opening + customer payments + other receipts + transfers in
            − customer refunds − supplier cheques/payments − transfers out. */
export async function cashAccountBalances(companyId: string) {
  const accounts = await prisma.cashAccount.findMany({
    where: { companyId },
    include: {
      payments: { where: { status: "Posted" }, select: { amount: true } },
      otherReceipts: { where: { status: "Posted" }, select: { amount: true } },
      refundCredits: { where: { status: "Posted", type: "Refund" }, select: { amount: true } },
      supplierPayments: { where: { status: "Posted" }, select: { amount: true } },
      transfersIn: { where: { status: "Posted" }, select: { amount: true } },
      transfersOut: { where: { status: "Posted" }, select: { amount: true } },
      glAccount: { select: { code: true, description: true } },
    },
    orderBy: { name: "asc" },
  });
  return accounts.map((a) => {
    const sum = (xs: { amount: number }[]) => round2(xs.reduce((s, x) => s + x.amount, 0));
    const customerIn = sum(a.payments);
    const otherIn = sum(a.otherReceipts);
    const transfersIn = sum(a.transfersIn);
    const refundsOut = sum(a.refundCredits);
    const chequesOut = sum(a.supplierPayments);
    const transfersOut = sum(a.transfersOut);
    const inflows = round2(customerIn + otherIn + transfersIn);
    const outflows = round2(refundsOut + chequesOut + transfersOut);
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      status: a.status,
      bankName: a.bankName,
      accountNo: a.accountNo,
      glCode: a.glAccount ? `${a.glAccount.code} ${a.glAccount.description}` : null,
      openingBalance: a.openingBalance,
      customerIn,
      otherIn,
      transfersIn,
      refundsOut,
      chequesOut,
      transfersOut,
      inflows,
      outflows,
      balance: round2(a.openingBalance + inflows - outflows),
    };
  });
}
