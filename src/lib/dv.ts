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

export type AccountingLine = { title: string; debit: number; credit: number; ref: string };

/**
 * The voucher's Account Title / Debit (Credit) block, generated from its bills: the payable
 * is debited per bill, cash or bank credited for the total. The bank account itself is
 * chosen when the payment is made, so until then the credit is shown as Cash / Bank.
 */
export function accountingLines(dv: {
  bills: { amount: number; bill: { billNo: string; supplier: { name: string } } }[];
  company: { glPayables: { code: string; description: string } | null };
  payments?: { amount: number; cashAccount: { name: string; glAccount: { code: string; description: string } | null } | null }[];
}): AccountingLine[] {
  const ap = dv.company.glPayables ? `${dv.company.glPayables.code} ${dv.company.glPayables.description}` : "Accounts Payable";
  const lines: AccountingLine[] = dv.bills.map((b) => ({ title: `${ap} — ${b.bill.supplier.name}`, debit: round2(b.amount), credit: 0, ref: b.bill.billNo }));
  const total = round2(dv.bills.reduce((s, b) => s + b.amount, 0));
  const paid = dv.payments ?? [];
  if (paid.length) {
    for (const p of paid) {
      const acct = p.cashAccount?.glAccount ? `${p.cashAccount.glAccount.code} ${p.cashAccount.glAccount.description}` : p.cashAccount?.name ?? "Cash / Bank";
      lines.push({ title: acct, debit: 0, credit: round2(p.amount), ref: "" });
    }
    const left = round2(total - paid.reduce((s, p) => s + p.amount, 0));
    if (left > 0) lines.push({ title: "Cash / Bank (on payment)", debit: 0, credit: left, ref: "" });
  } else {
    lines.push({ title: "Cash / Bank (on payment)", debit: 0, credit: total, ref: "" });
  }
  return lines;
}

/* ------------------------------------------------------------------ amount in words */

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES = ["", "Thousand", "Million", "Billion"];

function chunk(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r >= 20) parts.push(`${TENS[Math.floor(r / 10)]}${r % 10 ? `-${ONES[r % 10]}` : ""}`);
  else if (r) parts.push(ONES[r]);
  return parts.join(" ");
}

/** ₱12,345.60 → "Twelve Thousand Three Hundred Forty-Five Pesos and 60/100 Only" — the paper form's line. */
export function amountInWords(amount: number): string {
  const whole = Math.floor(Math.abs(amount) + 1e-9);
  const cents = Math.round((Math.abs(amount) - whole) * 100);
  if (whole === 0 && cents === 0) return "Zero Pesos Only";
  const parts: string[] = [];
  let n = whole, i = 0;
  while (n > 0) {
    const c = n % 1000;
    if (c) parts.unshift(`${chunk(c)}${SCALES[i] ? ` ${SCALES[i]}` : ""}`);
    n = Math.floor(n / 1000); i++;
  }
  const pesos = whole ? `${parts.join(" ")} Peso${whole === 1 ? "" : "s"}` : "";
  return `${pesos}${cents ? `${pesos ? " and " : ""}${String(cents).padStart(2, "0")}/100` : ""} Only`.trim();
}
