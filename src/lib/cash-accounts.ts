import { prisma } from "./db";

/**
 * One cash or bank account's register: every posted money document that touched it, in
 * date order, with a running balance from the opening balance. Customer payments, other
 * receipts and transfers in add; customer refunds, supplier cheques/payments and transfers
 * out subtract. Drafts and voided documents never appear — only Posted ones move money.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export type RegisterRow = {
  date: Date;
  docNo: string;
  href: string;
  kind: "Customer payment" | "Other receipt" | "Transfer in" | "Transfer out" | "Supplier cheque / payment" | "Customer refund" | "Journal voucher";
  party: string;
  detail: string;
  inflow: number;
  outflow: number;
  balance: number;
};

export async function cashAccountRegister(accountId: string, range?: { from?: Date; to?: Date }) {
  const a = await prisma.cashAccount.findUniqueOrThrow({
    where: { id: accountId },
    include: {
      glAccount: { select: { code: true, description: true } },
      company: { select: { id: true, companyName: true } },
      payments: { where: { status: "Posted" }, select: { id: true, prNumber: true, date: true, amount: true, method: true, refNo: true, checkNo: true, customer: { select: { businessName: true } } } },
      otherReceipts: { where: { status: "Posted" }, select: { id: true, crNumber: true, date: true, amount: true, method: true, refNo: true, payor: true } },
      transfersIn: { where: { status: "Posted" }, select: { id: true, trNumber: true, date: true, amount: true, refNo: true, remarks: true, fromAccount: { select: { name: true } } } },
      transfersOut: { where: { status: "Posted" }, select: { id: true, trNumber: true, date: true, amount: true, refNo: true, remarks: true, toAccount: { select: { name: true } } } },
      supplierPayments: { where: { status: "Posted" }, select: { id: true, paymentNo: true, date: true, amount: true, method: true, checkNo: true, refNo: true, payee: true, supplier: { select: { name: true } }, dv: { select: { dvNo: true, padRef: true } } } },
      refundCredits: { where: { status: "Posted", type: "Refund" }, select: { id: true, rcNumber: true, date: true, amount: true, refundMethod: true, refundRefNo: true, customer: { select: { businessName: true } } } },
      journalLines: { where: { voucher: { status: "Posted" } }, select: { id: true, debit: true, credit: true, description: true, voucher: { select: { id: true, jvNumber: true, date: true, memo: true, refNo: true } } } },
    },
  });
  const rows: Omit<RegisterRow, "balance">[] = [
    ...a.journalLines.map((l) => ({ date: l.voucher.date, docNo: l.voucher.jvNumber, href: `/finance/journal/${l.voucher.id}`, kind: "Journal voucher" as const, party: l.voucher.memo, detail: [l.description, l.voucher.refNo].filter(Boolean).join(" · "), inflow: l.debit, outflow: l.credit })),
    ...a.payments.map((p) => ({ date: p.date, docNo: p.prNumber, href: `/payments/${p.id}`, kind: "Customer payment" as const, party: p.customer.businessName, detail: [p.method, p.refNo, p.checkNo ? `cheque ${p.checkNo}` : ""].filter(Boolean).join(" · "), inflow: p.amount, outflow: 0 })),
    ...a.otherReceipts.map((r) => ({ date: r.date, docNo: r.crNumber, href: `/other-receipts/${r.id}`, kind: "Other receipt" as const, party: r.payor, detail: [r.method, r.refNo].filter(Boolean).join(" · "), inflow: r.amount, outflow: 0 })),
    ...a.transfersIn.map((t) => ({ date: t.date, docNo: t.trNumber, href: `/finance/transfers`, kind: "Transfer in" as const, party: `from ${t.fromAccount.name}`, detail: [t.refNo, t.remarks].filter(Boolean).join(" · "), inflow: t.amount, outflow: 0 })),
    ...a.transfersOut.map((t) => ({ date: t.date, docNo: t.trNumber, href: `/finance/transfers`, kind: "Transfer out" as const, party: `to ${t.toAccount.name}`, detail: [t.refNo, t.remarks].filter(Boolean).join(" · "), inflow: 0, outflow: t.amount })),
    ...a.supplierPayments.map((s) => ({ date: s.date, docNo: s.paymentNo, href: `/payments/bills/${s.id}`, kind: "Supplier cheque / payment" as const, party: s.supplier?.name ?? s.payee, detail: [s.checkNo ? `cheque ${s.checkNo}` : s.method, s.dv ? `${s.dv.dvNo}${s.dv.padRef ? ` (pad ${s.dv.padRef})` : ""}` : "", s.refNo].filter(Boolean).join(" · "), inflow: 0, outflow: s.amount })),
    ...a.refundCredits.map((r) => ({ date: r.date, docNo: r.rcNumber, href: `/refunds/${r.id}`, kind: "Customer refund" as const, party: r.customer.businessName, detail: [r.refundMethod, r.refundRefNo].filter(Boolean).join(" · "), inflow: 0, outflow: r.amount })),
  ].sort((x, y) => x.date.getTime() - y.date.getTime() || x.docNo.localeCompare(y.docNo));

  // the running balance always starts from the opening balance, whatever window is shown
  let balance = a.openingBalance;
  let broughtForward = a.openingBalance;
  const all: RegisterRow[] = rows.map((r) => { balance = round2(balance + r.inflow - r.outflow); return { ...r, balance }; });
  const shown = all.filter((r) => (!range?.from || r.date >= range.from) && (!range?.to || r.date <= range.to));
  if (range?.from) { const before = all.filter((r) => r.date < range.from!); broughtForward = before.length ? before[before.length - 1].balance : a.openingBalance; }
  const totals = {
    inflow: round2(shown.reduce((s, r) => s + r.inflow, 0)),
    outflow: round2(shown.reduce((s, r) => s + r.outflow, 0)),
    customerIn: round2(a.payments.reduce((s, p) => s + p.amount, 0)),
    otherIn: round2(a.otherReceipts.reduce((s, p) => s + p.amount, 0)),
    transfersIn: round2(a.transfersIn.reduce((s, p) => s + p.amount, 0)),
    transfersOut: round2(a.transfersOut.reduce((s, p) => s + p.amount, 0)),
    chequesOut: round2(a.supplierPayments.reduce((s, p) => s + p.amount, 0)),
    refundsOut: round2(a.refundCredits.reduce((s, p) => s + p.amount, 0)),
    journalIn: round2(a.journalLines.reduce((s, l) => s + l.debit, 0)),
    journalOut: round2(a.journalLines.reduce((s, l) => s + l.credit, 0)),
    documents: all.length,
  };
  return { account: a, rows: shown, broughtForward, balance, totals, earliest: all[0]?.date ?? null };
}
