import { round2 } from "./bill-math";

/**
 * The account totals of a set of vouchers — the register's column totals. A voucher with its
 * own items contributes them as booked (a deduction is a credit); a voucher that pays bills
 * contributes what those bills booked, in proportion to the amount the voucher covers:
 * inventory bills their goods, input VAT and EWT, non-inventory bills their account lines,
 * input VAT and EWT. The cheques themselves are the Accounts Payable side and are listed last.
 */

export type VoucherForTotals = {
  status: string;
  amount: number;
  paidAmount: number;
  items: { amount: number; glAccountId: string | null; glAccount: { code: string; description: string } | null; description: string }[];
  bills: { amount: number; bill: { kind: string; total: number; inventoryTotal: number; subtotal: number; freight: number; otherCosts: number; inputVat: number; ewtAmount: number; expenseLines: { amount: number; glAccount: { code: string; description: string } }[] } }[];
};

export type AccountTotal = { code: string; name: string; debit: number; credit: number; net: number; vouchers: number };

export function voucherAccountTotals(
  vouchers: VoucherForTotals[],
  company: { glInventory?: { code: string; description: string } | null; glInputVat?: { code: string; description: string } | null; glEwtPayable?: { code: string; description: string } | null; glPayables?: { code: string; description: string } | null }
): { rows: AccountTotal[]; debits: number; credits: number; cheques: number } {
  const acc = new Map<string, AccountTotal & { seen: Set<number> }>();
  const add = (code: string, name: string, signed: number, v: number) => {
    const key = `${code}|${name}`;
    const row = acc.get(key) ?? { code, name, debit: 0, credit: 0, net: 0, vouchers: 0, seen: new Set<number>() };
    if (signed >= 0) row.debit = round2(row.debit + signed); else row.credit = round2(row.credit - signed);
    row.net = round2(row.debit - row.credit);
    row.seen.add(v);
    acc.set(key, row);
  };
  const inv = company.glInventory ?? { code: "", description: "Inventory" };
  const vat = company.glInputVat ?? { code: "", description: "Input VAT" };
  const ewt = company.glEwtPayable ?? { code: "", description: "Withholding Tax Payable" };
  const ap = company.glPayables ?? { code: "", description: "Accounts Payable" };
  let cheques = 0;
  vouchers.forEach((dv, i) => {
    if (dv.status === "Void") return;
    cheques = round2(cheques + dv.paidAmount);
    for (const it of dv.items) {
      if (!it.amount) continue;
      add(it.glAccount?.code ?? "", it.glAccount?.description ?? it.description, it.amount, i);
    }
    for (const a of dv.bills) {
      const b = a.bill;
      const share = b.total > 0 ? a.amount / b.total : 1;
      if (b.kind === "EXPENSE") {
        for (const l of b.expenseLines) if (l.amount) add(l.glAccount.code, l.glAccount.description, round2(l.amount * share), i);
      } else if (b.kind === "OPENING") {
        // a balance carried in: the voucher settles the payable itself, nothing else was booked
        add(ap.code, ap.description, round2(a.amount), i);
      } else {
        const goods = b.inventoryTotal || round2(b.subtotal + b.freight + b.otherCosts);
        if (goods) add(inv.code, inv.description, round2(goods * share), i);
      }
      if (b.inputVat) add(vat.code, vat.description, round2(b.inputVat * share), i);
      if (b.ewtAmount) add(ewt.code, ewt.description, -round2(b.ewtAmount * share), i);
    }
  });
  const rows = [...acc.values()].map(({ seen, ...r }) => ({ ...r, vouchers: seen.size })).sort((x, y) => Math.abs(y.net) - Math.abs(x.net) || x.code.localeCompare(y.code));
  const debits = round2(rows.reduce((s, r) => s + r.debit, 0));
  const credits = round2(rows.reduce((s, r) => s + r.credit, 0));
  return { rows, debits, credits, cheques };
}
