import { prisma } from "./db";
import { nextSeriesNo } from "./vouchers";
import { OPEN_BILL_STATUSES, round2 } from "./bills";

/**
 * Disbursement vouchers: the paper form the company already uses, as the BMS's payment
 * authorisation for ANY expense. A voucher names one payee — a supplier, an employee or just
 * a name — and carries either the posted bills it authorises paying, or its own itemised
 * particulars (a liquidation, a permit fee, a reimbursement), or both. It moves
 * Draft → Prepared → Checked → Approved → Posted, and a Posted voucher is what Pay Bills
 * settles. A bill-backed voucher books nothing itself (the bills already did); a voucher's
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
export async function availableForVoucher(billId: string, excludeDvId?: string): Promise<{ outstanding: number; onOtherVouchers: number; available: number }> {
  const bill = await prisma.supplierBill.findUniqueOrThrow({ where: { id: billId }, select: { total: true, paidAmount: true, status: true } });
  const outstanding = OPEN_BILL_STATUSES.includes(bill.status) ? round2(Math.max(0, bill.total - bill.paidAmount)) : 0;
  const others = await prisma.dVBill.findMany({
    where: { billId, dv: { status: { in: LIVE_DV_STATUSES }, ...(excludeDvId ? { id: { not: excludeDvId } } : {}) } },
    select: { amount: true, dv: { select: { paidAmount: true, amount: true } } },
  });
  // what another voucher still authorises = its allocation less the share of it already paid
  const onOtherVouchers = round2(others.reduce((s, o) => s + Math.max(0, o.amount - (o.dv.amount > 0 ? (o.dv.paidAmount * o.amount) / o.dv.amount : 0)), 0));
  return { outstanding, onOtherVouchers, available: round2(Math.max(0, outstanding - onOtherVouchers)) };
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

export type AccountingLine = { title: string; debit: number; credit: number; ref: string; glAccountId: string | null };

type DvForLines = {
  bills: { amount: number; bill: { billNo: string; kind: string; total: number; inputVat: number; supplier: { name: string }; expenseLines?: { amount: number; glAccountId: string; glAccount: { code: string; description: string } }[] } }[];
  items?: { amount: number; description: string; glAccountId: string | null; glAccount?: { code: string; description: string } | null }[];
  payee?: string;
  company: { glPayablesId?: string | null; glPayables: { code: string; description: string } | null; glInputVatId?: string | null; glInputVat?: { code: string; description: string } | null };
  payments?: { amount: number; status?: string; lines?: { amount: number }[]; cashAccount: { name: string; glAccountId?: string | null; glAccount: { code: string; description: string } | null } | null }[];
};

/**
 * The voucher's Account Title / Debit (Credit) block as first generated — the office edits it
 * from there. Bills: a non-inventory bill is shown by the accounts it was charged to (its own
 * share of each, if the voucher covers only part of it) plus its input VAT; an inventory bill
 * by Accounts Payable; and the credit is the cash or bank account of the payments already
 * made, or Cash in Bank until one is. The voucher's own items: each account debited (a
 * deduction credited), and Accounts Payable credited with what is owed to the payee — the
 * entry the paper voucher is.
 */
export function generateAccountLines(dv: DvForLines): AccountingLine[] {
  const ap = dv.company.glPayables ? `${dv.company.glPayables.code} ${dv.company.glPayables.description}` : "Accounts Payable";
  const vat = dv.company.glInputVat ? `${dv.company.glInputVat.code} ${dv.company.glInputVat.description}` : "Input VAT";
  const lines: AccountingLine[] = [];
  for (const b of dv.bills) {
    const share = b.bill.total > 0 ? b.amount / b.bill.total : 1;
    if (b.bill.kind === "EXPENSE" && b.bill.expenseLines?.length) {
      for (const l of b.bill.expenseLines) lines.push({ title: `${l.glAccount.code} ${l.glAccount.description}`, debit: round2(l.amount * share), credit: 0, ref: b.bill.billNo, glAccountId: l.glAccountId });
      if (b.bill.inputVat) lines.push({ title: vat, debit: round2(b.bill.inputVat * share), credit: 0, ref: b.bill.billNo, glAccountId: dv.company.glInputVatId ?? null });
    } else {
      lines.push({ title: `${ap} — ${b.bill.supplier.name}`, debit: round2(b.amount), credit: 0, ref: b.bill.billNo, glAccountId: dv.company.glPayablesId ?? null });
    }
  }
  const billTotal = round2(lines.reduce((s, l) => s + l.debit, 0));
  // the bills' credit: the cash or bank account of what was paid so far, else Cash in Bank
  const paidLines = (dv.payments ?? []).filter((p) => !p.status || p.status === "Posted");
  let credited = 0;
  for (const p of paidLines) {
    const billPart = round2((p.lines ?? []).reduce((s, l) => s + l.amount, 0) || (dv.items?.length ? 0 : p.amount));
    if (billPart <= 0) continue;
    const acct = p.cashAccount?.glAccount ? `${p.cashAccount.glAccount.code} ${p.cashAccount.glAccount.description}` : p.cashAccount?.name ?? "Cash in Bank";
    lines.push({ title: acct, debit: 0, credit: billPart, ref: "", glAccountId: p.cashAccount?.glAccountId ?? null });
    credited = round2(credited + billPart);
  }
  if (billTotal - credited > 0.005) lines.push({ title: "Cash in Bank", debit: 0, credit: round2(billTotal - credited), ref: "", glAccountId: null });

  // the voucher's own items, grouped by account: debits, then deductions, then the payable
  const items = dv.items ?? [];
  if (items.length) {
    const byAcct = new Map<string, { title: string; glAccountId: string | null; amount: number }>();
    for (const it of items) {
      const title = it.glAccount ? `${it.glAccount.code} ${it.glAccount.description}` : it.description || "(no account)";
      const key = it.glAccountId ?? `txt:${title}`;
      const g = byAcct.get(key) ?? { title, glAccountId: it.glAccountId, amount: 0 };
      g.amount = round2(g.amount + it.amount);
      byAcct.set(key, g);
    }
    const groups = [...byAcct.values()];
    for (const g of groups.filter((g) => g.amount > 0)) lines.push({ title: g.title, debit: g.amount, credit: 0, ref: "", glAccountId: g.glAccountId });
    for (const g of groups.filter((g) => g.amount < 0)) lines.push({ title: g.title, debit: 0, credit: round2(-g.amount), ref: "", glAccountId: g.glAccountId });
    const net = round2(items.reduce((s, i) => s + i.amount, 0));
    if (net > 0) lines.push({ title: dv.payee ? `${ap} — ${dv.payee}` : ap, debit: 0, credit: net, ref: "", glAccountId: dv.company.glPayablesId ?? null });
  }
  return lines;
}

/** What prints: the lines the office saved on the voucher, or the generated ones until then. */
export function voucherLines(dv: DvForLines & { accountLines?: { title: string; debit: number; credit: number; glAccountId: string | null }[] }): AccountingLine[] {
  if (dv.accountLines?.length) return dv.accountLines.map((l) => ({ title: l.title, debit: l.debit, credit: l.credit, ref: "", glAccountId: l.glAccountId }));
  return generateAccountLines(dv);
}

/** Kept for callers that only need the default shape. */
export const accountingLines = generateAccountLines;

export { amountInWords } from "./dv-words";
