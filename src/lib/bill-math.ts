/**
 * The arithmetic of a supplier bill — pure, so the browser can total a bill as it is typed
 * and the server posts exactly the same figures. Nothing here touches the database.
 *
 * VAT. The general rule in this company is that every amount on a supplier's invoice is
 * VAT-INCLUSIVE: a ₱900,000 invoice is ₱803,571.43 of goods and ₱96,428.57 of input VAT, and
 * ₱900,000 is what it reads. A bill can instead be EXCLUSIVE (VAT added on top of the amounts
 * entered) or carry NO VAT (an exempt or non-VAT supplier).
 *
 * Expanded withholding tax (EWT). Under BIR rules the buyer withholds a percentage of the
 * VAT-EXCLUSIVE amount and remits it to the BIR, so the supplier is paid the invoice less the
 * tax withheld. The rate comes from the withholding tax types kept as data; it is never
 * fixed here.
 */

export const VAT = 0.12;

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const TERMS = ["COD", "7 days", "15 days", "30 days", "45 days", "60 days", "90 days"] as const;
export const DEFAULT_TERMS = "30 days";

export const ALLOCATION_BASES = [
  ["value", "By line amount"],
  ["qty", "By pieces"],
] as const;

export const VAT_MODES = [
  ["INCLUSIVE", "VAT-inclusive (VAT is inside the amounts)"],
  ["EXCLUSIVE", "VAT-exclusive (12% added on top)"],
  ["NONE", "No VAT (exempt / non-VAT supplier)"],
] as const;
export type VatMode = (typeof VAT_MODES)[number][0];
export const DEFAULT_VAT_MODE: VatMode = "INCLUSIVE";

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

/** The VAT-exclusive part of an amount entered under a VAT mode. */
export function netOf(entered: number, mode: string): number {
  if (mode === "INCLUSIVE") return round2(entered / (1 + VAT));
  return round2(entered);
}
/** The VAT that goes with an amount entered under a VAT mode. */
export function vatOn(entered: number, mode: string): number {
  if (mode === "INCLUSIVE") return round2(entered - entered / (1 + VAT));
  if (mode === "EXCLUSIVE") return round2(entered * VAT);
  return 0;
}

export type BillHeaderIn = { freight: number; otherCosts: number; allocationBasis: string; vatMode: string; ewtRate: number };
export type LineMathIn = { qty: number; baseQty: number; unitCost: number; discount: number };
export type LineMathOut = {
  /** the line as entered: qty × unit cost − discount */
  grossAmount: number;
  /** the line net of VAT — the product cost */
  amount: number;
  /** the line's share of freight and other costs, net of VAT */
  freightAlloc: number;
  /** input VAT on the line and its freight share */
  taxAmount: number;
  /** what goes into stock: amount + freightAlloc */
  inventoryCost: number;
};
export type BillMath = {
  lines: LineMathOut[];
  /** Σ line amounts, net of VAT */
  subtotal: number;
  /** freight and other costs as entered */
  freight: number;
  otherCosts: number;
  /** freight and other costs net of VAT */
  freightNet: number;
  otherCostsNet: number;
  /** subtotal + freightNet + otherCostsNet — the inventory value */
  inventoryTotal: number;
  inputVat: number;
  /** inventoryTotal + inputVat — the invoice as it reads */
  grossTotal: number;
  /** what EWT is computed on: the VAT-exclusive amount */
  ewtBase: number;
  ewtAmount: number;
  /** grossTotal − ewtAmount — what the supplier is owed */
  total: number;
};

/**
 * Every figure on an inventory bill, from its lines and header.
 *
 *   grossAmount   = qty × unit cost − discount, as entered
 *   amount        = grossAmount net of VAT                  (product cost)
 *   freightAlloc  = the line's share of freight + other costs, net of VAT, by line amount or by pieces
 *   inventoryCost = amount + freightAlloc                   (what goes into stock)
 *   taxAmount     = the VAT on the line and its share      (input VAT — NOT in inventory)
 *   grossTotal    = inventoryTotal + inputVat               (the invoice as it reads)
 *   ewtAmount     = inventoryTotal × EWT rate               (withheld, owed to the BIR)
 *   total         = grossTotal − ewtAmount                  (what the supplier is owed)
 *
 * Allocation and VAT are rounded per line with the remainder on the last line, so the shares
 * always add back to exactly the totals.
 */
export function computeBill(lines: LineMathIn[], header: BillHeaderIn): BillMath {
  const mode = header.vatMode || "EXCLUSIVE";
  const freight = round2(Math.max(0, header.freight || 0));
  const otherCosts = round2(Math.max(0, header.otherCosts || 0));
  const freightNet = netOf(freight, mode);
  const otherCostsNet = netOf(otherCosts, mode);
  const extra = round2(freightNet + otherCostsNet);

  const grossAmounts = lines.map((l) => round2(Math.max(0, l.qty * l.unitCost - (l.discount || 0))));
  const amounts = grossAmounts.map((g) => netOf(g, mode));
  const subtotal = round2(amounts.reduce((s, a) => s + a, 0));
  const inventoryTotal = lines.length ? round2(subtotal + extra) : 0;
  const inputVat = lines.length ? round2(vatOn(round2(grossAmounts.reduce((s, g) => s + g, 0) + freight + otherCosts), mode)) : 0;

  const weights = header.allocationBasis === "qty" ? lines.map((l) => Math.max(0, l.baseQty)) : amounts.slice();
  const weightSum = weights.reduce((s, w) => s + w, 0);

  const out: LineMathOut[] = [];
  let allocated = 0;
  let taxed = 0;
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
    if (inputVat > 0) {
      taxAmount = last ? round2(inputVat - taxed) : round2((inputVat * inventoryCost) / (inventoryTotal || 1));
      taxed = round2(taxed + taxAmount);
    }
    out.push({ grossAmount: grossAmounts[i], amount: amounts[i], freightAlloc, taxAmount, inventoryCost });
  });

  const grossTotal = round2(inventoryTotal + inputVat);
  const ewtRate = Math.max(0, header.ewtRate || 0);
  const ewtAmount = lines.length ? round2(inventoryTotal * ewtRate) : 0;
  return {
    lines: out, subtotal, freight, otherCosts, freightNet, otherCostsNet, inventoryTotal, inputVat, grossTotal,
    ewtBase: inventoryTotal, ewtAmount, total: round2(grossTotal - ewtAmount),
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
export type ExpenseBillMath = {
  lines: { entered: number; amount: number; taxAmount: number }[];
  /** Σ line amounts, net of VAT */
  subtotal: number;
  inputVat: number;
  /** subtotal + inputVat — the invoice as it reads */
  grossTotal: number;
  ewtBase: number;
  ewtAmount: number;
  /** grossTotal − ewtAmount — what the supplier is owed */
  total: number;
};

/**
 * A non-inventory bill: each line is charged to an account net of VAT. The amount typed is
 * VAT-inclusive under the general rule, VAT-exclusive or VAT-free when the bill says so; the
 * withholding tax is taken on the net and comes off what the supplier is owed.
 */
export function computeExpenseBill(lines: ExpenseLineIn[], header: { vatMode: string; ewtRate: number }): ExpenseBillMath {
  const mode = header.vatMode || "EXCLUSIVE";
  const entered = lines.map((l) => round2(Math.max(0, l.amount || 0)));
  const amounts = entered.map((e) => netOf(e, mode));
  const subtotal = round2(amounts.reduce((s, a) => s + a, 0));
  const inputVat = lines.length ? vatOn(round2(entered.reduce((s, e) => s + e, 0)), mode) : 0;
  let taxed = 0;
  const out = amounts.map((a, i) => {
    const last = i === amounts.length - 1;
    const taxAmount = inputVat > 0 ? (last ? round2(inputVat - taxed) : round2((inputVat * a) / (subtotal || 1))) : 0;
    taxed = round2(taxed + taxAmount);
    return { entered: entered[i], amount: a, taxAmount };
  });
  const grossTotal = round2(subtotal + inputVat);
  const ewtRate = Math.max(0, header.ewtRate || 0);
  const ewtAmount = lines.length ? round2(subtotal * ewtRate) : 0;
  return { lines: out, subtotal, inputVat, grossTotal, ewtBase: subtotal, ewtAmount, total: round2(grossTotal - ewtAmount) };
}
