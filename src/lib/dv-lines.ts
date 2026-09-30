import { round2 } from "./bill-math";

/**
 * The voucher's Account Title / Debit (Credit) block, generated from what it pays. Pure and
 * browser-safe: the voucher page derives the block live as bills are allocated and items
 * typed, and the server uses the same function when it saves, so both always agree.
 */

export type AccountingLine = { title: string; debit: number; credit: number; ref: string; glAccountId: string | null };

export type DvForLines = {
  bills: { amount: number; bill: { billNo: string; kind: string; total: number; inputVat: number; ewtAmount?: number; supplier: { name: string }; expenseLines?: { amount: number; glAccountId: string; glAccount: { code: string; description: string } }[] } }[];
  items?: { amount: number; description: string; glAccountId: string | null; glAccount?: { code: string; description: string } | null }[];
  payee?: string;
  company: { glPayablesId?: string | null; glPayables: { code: string; description: string } | null; glInputVatId?: string | null; glInputVat?: { code: string; description: string } | null; glEwtPayableId?: string | null; glEwtPayable?: { code: string; description: string } | null };
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
  const ewt = dv.company.glEwtPayable ? `${dv.company.glEwtPayable.code} ${dv.company.glEwtPayable.description}` : "Withholding Tax Payable";
  const lines: AccountingLine[] = [];
  for (const b of dv.bills) {
    const share = b.bill.total > 0 ? b.amount / b.bill.total : 1;
    if (b.bill.kind === "EXPENSE" && b.bill.expenseLines?.length) {
      for (const l of b.bill.expenseLines) lines.push({ title: `${l.glAccount.code} ${l.glAccount.description}`, debit: round2(l.amount * share), credit: 0, ref: b.bill.billNo, glAccountId: l.glAccountId });
      if (b.bill.inputVat) lines.push({ title: vat, debit: round2(b.bill.inputVat * share), credit: 0, ref: b.bill.billNo, glAccountId: dv.company.glInputVatId ?? null });
      // what was withheld is owed to the BIR, not to the supplier
      if (b.bill.ewtAmount) lines.push({ title: ewt, debit: 0, credit: round2(b.bill.ewtAmount * share), ref: b.bill.billNo, glAccountId: dv.company.glEwtPayableId ?? null });
    } else {
      lines.push({ title: `${ap} — ${b.bill.supplier.name}`, debit: round2(b.amount), credit: 0, ref: b.bill.billNo, glAccountId: dv.company.glPayablesId ?? null });
    }
  }
  const billTotal = round2(lines.reduce((s, l) => s + l.debit - l.credit, 0));
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


/** Two blocks are the same block when every line matches on account, title, debit and credit. */
export function linesEqual(a: { title: string; debit: number; credit: number; glAccountId: string | null }[], b: { title: string; debit: number; credit: number; glAccountId: string | null }[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((l, i) => l.title.trim() === b[i].title.trim() && Math.abs(l.debit - b[i].debit) < 0.005 && Math.abs(l.credit - b[i].credit) < 0.005 && (l.glAccountId ?? null) === (b[i].glAccountId ?? null));
}
