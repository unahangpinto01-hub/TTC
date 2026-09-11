/**
 * The arithmetic of a supplier bill — pure, so the browser can total a bill as it is typed
 * and the server posts exactly the same figures. Nothing here touches the database.
 */

export const VAT = 0.12;

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const TERMS = ["COD", "7 days", "15 days", "30 days", "45 days", "60 days", "90 days"] as const;
export const DEFAULT_TERMS = "30 days";

export const ALLOCATION_BASES = [
  ["value", "By line amount"],
  ["qty", "By pieces"],
] as const;

export function termsDays(terms: string): number {
  const m = /^(\d+)\s*days?$/i.exec(terms.trim());
  return m ? Number(m[1]) : 0;
}

/** Due date = bill date + the days in the terms; COD falls due on the bill date. */
export function dueDateFor(billDate: Date, terms: string): Date {
  const d = new Date(billDate);
  d.setDate(d.getDate() + termsDays(terms));
  return d;
}

export type LineMathIn = { qty: number; baseQty: number; unitCost: number; discount: number };
export type LineMathOut = { amount: number; freightAlloc: number; taxAmount: number; inventoryCost: number };
export type BillMath = {
  lines: LineMathOut[];
  subtotal: number;
  freight: number;
  otherCosts: number;
  inputVat: number;
  total: number;
};

/**
 * Every figure on a bill, from its lines and header.
 *
 *   amount        = qty × unit cost − discount              (product cost)
 *   freightAlloc  = the line's share of freight + other costs, by line amount or by pieces
 *   inventoryCost = amount + freightAlloc                   (what goes into stock)
 *   taxAmount     = inventoryCost × VAT rate                (input VAT — NOT in inventory)
 *   total         = subtotal + freight + other + input VAT  (what the supplier is owed)
 *
 * Allocation is rounded per line with the remainder on the last line, so the shares always
 * add back to exactly the freight and other costs entered.
 */
export function computeBill(
  lines: LineMathIn[],
  header: { freight: number; otherCosts: number; allocationBasis: string; vatRate: number }
): BillMath {
  const freight = round2(Math.max(0, header.freight || 0));
  const otherCosts = round2(Math.max(0, header.otherCosts || 0));
  const extra = round2(freight + otherCosts);
  const vatRate = header.vatRate > 0 ? VAT : 0;

  const amounts = lines.map((l) => round2(Math.max(0, l.qty * l.unitCost - (l.discount || 0))));
  const subtotal = round2(amounts.reduce((s, a) => s + a, 0));

  const weights = header.allocationBasis === "qty" ? lines.map((l) => Math.max(0, l.baseQty)) : amounts.slice();
  const weightSum = weights.reduce((s, w) => s + w, 0);

  const out: LineMathOut[] = [];
  let allocated = 0;
  let taxed = 0;
  const inputVat = lines.length ? round2((subtotal + extra) * vatRate) : 0;
  lines.forEach((l, i) => {
    const last = i === lines.length - 1;
    let freightAlloc = 0;
    if (extra > 0) {
      if (last) freightAlloc = round2(extra - allocated);
      else if (weightSum > 0) freightAlloc = round2((extra * weights[i]) / weightSum);
      else freightAlloc = round2(extra / lines.length);
      allocated = round2(allocated + freightAlloc);
    }
    const inventoryCost = round2(amounts[i] + freightAlloc);
    let taxAmount = 0;
    if (vatRate > 0) {
      taxAmount = last ? round2(inputVat - taxed) : round2(inventoryCost * vatRate);
      taxed = round2(taxed + taxAmount);
    }
    out.push({ amount: amounts[i], freightAlloc, taxAmount, inventoryCost });
  });

  return {
    lines: out,
    subtotal,
    freight,
    otherCosts,
    inputVat,
    total: round2(subtotal + (lines.length ? extra + inputVat : 0)),
  };
}

/** What a posted bill's status is for the amount paid so far. */
export function statusForPayment(total: number, paid: number): "Posted" | "Partially Paid" | "Paid" {
  if (paid <= 0) return "Posted";
  if (paid + 0.005 >= total) return "Paid";
  return "Partially Paid";
}

/* ------------------------------------------------------------------ non-inventory bills */

export type ExpenseLineIn = { amount: number };
export type ExpenseBillMath = { lines: { taxAmount: number }[]; subtotal: number; inputVat: number; total: number };

/**
 * A non-inventory bill: each line is charged to an account ex-VAT; input VAT at 12% is
 * added on top when the supplier is VAT-registered; the total is what is owed.
 */
export function computeExpenseBill(lines: ExpenseLineIn[], vatRate: number): ExpenseBillMath {
  const rate = vatRate > 0 ? VAT : 0;
  const amounts = lines.map((l) => round2(Math.max(0, l.amount || 0)));
  const subtotal = round2(amounts.reduce((s, a) => s + a, 0));
  const inputVat = lines.length ? round2(subtotal * rate) : 0;
  let taxed = 0;
  const out = amounts.map((a, i) => {
    const last = i === amounts.length - 1;
    const taxAmount = rate > 0 ? (last ? round2(inputVat - taxed) : round2(a * rate)) : 0;
    taxed = round2(taxed + taxAmount);
    return { taxAmount };
  });
  return { lines: out, subtotal, inputVat, total: round2(subtotal + inputVat) };
}
