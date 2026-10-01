import { prisma } from "./db";
import { Prisma } from "@prisma/client";
import { nextSeriesNo } from "./vouchers";
import { OPEN_BILL_STATUSES, round2 } from "./bills";

/**
 * Disbursement vouchers: the paper form the company already uses, as the BMS's payment
 * authorisation for ANY expense. A voucher names one payee — a supplier, an employee or just
 * a name — and carries either the posted bills it authorises paying, or its own itemised
 * particulars (a liquidation, a permit fee, a reimbursement), or both. It moves
 * Draft → Prepared → Checked → Approved → Posted, and a Posted voucher is what Cheques /
 * Payments settles. A bill-backed voucher books nothing itself (the bills already did); a voucher's
 * own items are booked when it is posted: Dr each item's account / Cr Accounts Payable.
 */

export const DV_STATUSES = ["Draft", "Prepared", "Checked", "Approved", "Posted", "Partially Paid", "Paid", "Void"] as const;
export type DvStatus = (typeof DV_STATUSES)[number];
/** vouchers that still carry an authorisation to pay */
export const OPEN_DV_STATUSES = ["Posted", "Partially Paid"];
/** vouchers that hold an allocation against a bill (anything not void, not fully paid) */
export const LIVE_DV_STATUSES = ["Draft", "Prepared", "Checked", "Approved", "Posted", "Partially Paid"];
/** vouchers whose own items are in the books */
export const BOOKED_DV_STATUSES = ["Posted", "Partially Paid", "Paid"];

export const nextDvNo = (companyId: string, date: Date) => nextSeriesNo("DV", companyId, date);

/** Only a Draft may be edited; once Prepared it walks the approval chain. */
export function dvEditBlocker(dv: { status: string }): string | null {
  if (dv.status === "Draft") return null;
  if (dv.status === "Void") return "This voucher has been voided.";
  return "A voucher can only be changed while it is a Draft. Send it back to Draft first.";
}

/**
 * How much of a bill is still open for a NEW voucher: the bill's outstanding balance less
 * what other live vouchers already authorise. Two vouchers can never authorise the same
 * peso twice.
 */
export async function availableForVoucher(billId: string, excludeDvId?: string, db: Pick<typeof prisma, "supplierBill" | "dVBill"> = prisma): Promise<{ outstanding: number; onOtherVouchers: number; available: number }> {
  const bill = await db.supplierBill.findUniqueOrThrow({ where: { id: billId }, select: { total: true, paidAmount: true, status: true } });
  const outstanding = OPEN_BILL_STATUSES.includes(bill.status) ? round2(Math.max(0, bill.total - bill.paidAmount)) : 0;
  const others = await db.dVBill.findMany({
    where: { billId, dv: { status: { in: LIVE_DV_STATUSES }, ...(excludeDvId ? { id: { not: excludeDvId } } : {}) } },
    select: { amount: true, dv: { select: { paidAmount: true, amount: true } } },
  });
  // what another voucher still authorises = its allocation less the share of it already paid
  const onOtherVouchers = round2(others.reduce((s, o) => s + Math.max(0, o.amount - (o.dv.amount > 0 ? (o.dv.paidAmount * o.amount) / o.dv.amount : 0)), 0));
  return { outstanding, onOtherVouchers, available: round2(Math.max(0, outstanding - onOtherVouchers)) };
}

/**
 * Lock the bills a voucher is about to claim, for the rest of the transaction. Two vouchers
 * saved at the same moment then take turns: the second waits, re-reads the availability the
 * first has just reduced, and is refused if the peso is gone. The reservation is enforced by
 * the database, not only by the screen.
 */
export async function lockBills(tx: Prisma.TransactionClient, billIds: string[]): Promise<void> {
  const ids = [...new Set(billIds)].sort();
  if (!ids.length) return;
  await tx.$queryRaw`SELECT "id" FROM "SupplierBill" WHERE "id" IN (${Prisma.join(ids)}) FOR UPDATE`;
}

/**
 * The part of a voucher's payments that settled its own items rather than a bill: each
 * payment's amount less what its bill lines carried.
 */
export function directPaidOf(payments: { amount: number; status?: string; lines?: { amount: number }[] }[]): number {
  return round2(payments.filter((p) => !p.status || p.status === "Posted").reduce((s, p) => s + p.amount - (p.lines ?? []).reduce((x, l) => x + l.amount, 0), 0));
}

/** What a voucher's own items still have to be paid. */
export async function directOutstanding(dvId: string): Promise<{ authorised: number; paid: number; left: number }> {
  const dv = await prisma.disbursementVoucher.findUniqueOrThrow({ where: { id: dvId }, select: { directAmount: true, payments: { where: { status: "Posted" }, select: { amount: true, lines: { select: { amount: true } } } } } });
  const paid = directPaidOf(dv.payments);
  return { authorised: dv.directAmount, paid, left: round2(Math.max(0, dv.directAmount - paid)) };
}

export type DvItemInput = { glAccountId: string | null; description: string; amount: number };

/**
 * Why a voucher with its own items cannot be posted yet. Its items are the accounting entry,
 * so each must name an account from the chart, and together they must come to something to pay.
 */
export function directPostBlockers(dv: { directAmount: number; items: { glAccountId: string | null; description: string; amount: number }[] }): string[] {
  const out: string[] = [];
  if (!dv.items.length) return out;
  const noAccount = dv.items.filter((i) => !i.glAccountId);
  if (noAccount.length) out.push(`${noAccount.length} item(s) have no account from the Chart of Accounts: ${noAccount.map((i) => i.description || "(blank)").slice(0, 3).join(", ")}`);
  if (dv.directAmount <= 0) out.push("The voucher's own items net to nothing to pay.");
  return out;
}

import { generateAccountLines, linesEqual, type AccountingLine, type DvForLines } from "./dv-lines";
export { generateAccountLines, linesEqual };
export type { AccountingLine, DvForLines };

/** What prints: the lines the office saved on the voucher, or the generated ones until then. */
export function voucherLines(dv: DvForLines & { accountLines?: { title: string; debit: number; credit: number; glAccountId: string | null }[] }): AccountingLine[] {
  if (dv.accountLines?.length) return dv.accountLines.map((l) => ({ title: l.title, debit: l.debit, credit: l.credit, ref: "", glAccountId: l.glAccountId }));
  return generateAccountLines(dv);
}

/** Kept for callers that only need the default shape. */
export const accountingLines = generateAccountLines;

export { amountInWords } from "./dv-words";

/**
 * What a status is called on screen. The stored values stay as they are (Posted, Paid…);
 * the office reads them as the paper form does: a posted voucher is Unpaid until a cheque
 * settles it, then Partially Paid, then Fully Paid.
 */
export function dvStatusLabel(status: string): string {
  if (status === "Posted") return "Unpaid";
  if (status === "Paid") return "Fully Paid";
  return status;
}

/** Register filters: which stored statuses each one covers. */
export const DV_FILTERS: Record<string, { label: string; statuses: string[] }> = {
  pending: { label: "Awaiting approval", statuses: ["Draft", "Prepared", "Checked", "Approved"] },
  unpaid: { label: "Unpaid", statuses: ["Posted"] },
  partial: { label: "Partially Paid", statuses: ["Partially Paid"] },
  paid: { label: "Fully Paid", statuses: ["Paid"] },
  open: { label: "Unpaid + Partially Paid", statuses: ["Posted", "Partially Paid"] },
  void: { label: "Voided", statuses: ["Void"] },
};
