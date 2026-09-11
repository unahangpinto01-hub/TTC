import { prisma } from "./db";
import { nextSeriesNo } from "./vouchers";
import { OPEN_BILL_STATUSES, round2 } from "./bills";

/**
 * Disbursement vouchers: the paper form the company already uses, as the BMS's payment
 * authorisation. A voucher names one payee and the posted bills it authorises paying;
 * it moves Draft → Prepared → Checked → Approved → Posted, and a Posted voucher is what
 * Pay Bills settles. Its accounting lines are read off the bills it covers.
 */

export const DV_STATUSES = ["Draft", "Prepared", "Checked", "Approved", "Posted", "Partially Paid", "Paid", "Void"] as const;
export type DvStatus = (typeof DV_STATUSES)[number];
/** vouchers that still carry an authorisation to pay */
export const OPEN_DV_STATUSES = ["Posted", "Partially Paid"];
/** vouchers that hold an allocation against a bill (anything not void, not fully paid) */
export const LIVE_DV_STATUSES = ["Draft", "Prepared", "Checked", "Approved", "Posted", "Partially Paid"];

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

export type AccountingLine = { title: string; debit: number; credit: number; ref: string; glAccountId: string | null };

/**
 * The voucher's Account Title / Debit (Credit) block as first generated from its bills — the
 * office edits it from there. A non-inventory bill is shown by the accounts it was charged
 * to (its own share of each, if the voucher covers only part of it) plus its input VAT; an
 * inventory bill by Accounts Payable; and the credit is the cash or bank account of the
 * payments already made, or Cash in Bank until one is.
 */
export function generateAccountLines(dv: {
  bills: { amount: number; bill: { billNo: string; kind: string; total: number; inputVat: number; supplier: { name: string }; expenseLines?: { amount: number; glAccountId: string; glAccount: { code: string; description: string } }[] } }[];
  company: { glPayablesId?: string | null; glPayables: { code: string; description: string } | null; glInputVatId?: string | null; glInputVat?: { code: string; description: string } | null };
  payments?: { amount: number; status?: string; cashAccount: { name: string; glAccountId?: string | null; glAccount: { code: string; description: string } | null } | null }[];
}): AccountingLine[] {
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
  const total = round2(lines.reduce((s, l) => s + l.debit, 0));
  const paid = (dv.payments ?? []).filter((p) => !p.status || p.status === "Posted");
  let credited = 0;
  for (const p of paid) {
    const acct = p.cashAccount?.glAccount ? `${p.cashAccount.glAccount.code} ${p.cashAccount.glAccount.description}` : p.cashAccount?.name ?? "Cash in Bank";
    lines.push({ title: acct, debit: 0, credit: round2(p.amount), ref: "", glAccountId: p.cashAccount?.glAccountId ?? null });
    credited = round2(credited + p.amount);
  }
  if (total - credited > 0.005) lines.push({ title: "Cash in Bank", debit: 0, credit: round2(total - credited), ref: "", glAccountId: null });
  return lines;
}

/** What prints: the lines the office saved on the voucher, or the generated ones until then. */
export function voucherLines(dv: Parameters<typeof generateAccountLines>[0] & { accountLines?: { title: string; debit: number; credit: number; glAccountId: string | null }[] }): AccountingLine[] {
  if (dv.accountLines?.length) return dv.accountLines.map((l) => ({ title: l.title, debit: l.debit, credit: l.credit, ref: "", glAccountId: l.glAccountId }));
  return generateAccountLines(dv);
}

/** Kept for callers that only need the default shape. */
export const accountingLines = generateAccountLines;

export { amountInWords } from "./dv-words";
