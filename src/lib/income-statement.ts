import { prisma } from "./db";
import { getLedger, getMerchandiseInventory } from "./reports";

/**
 * The monthly Income Statement in the books' own layout (the "IS" sheet of the general
 * ledger workbook): sales less discounts, cost of sales by inventory movement (beginning
 * stock plus purchases less ending stock — the periodic method the bookkeeper uses),
 * operating expenses listed account by account, other income and other expense.
 *
 * Every figure comes from the same ledger entries the Ledger report shows, aggregated per
 * GL account, plus the merchandise inventory valuation at the start and end of the month
 * (good stock at the cost in force that month, labels, and the condition buckets).
 */

export type IsLine = { code: string; description: string; amount: number };
export type InventoryValue = { good: number; labels: number; relabel: number; atSupplier: number; obsolete: number; total: number };
export type IncomeStatement = {
  year: number;
  month: number; // 1–12
  monthLabel: string; // "JANUARY 2026"
  from: Date;
  to: Date;
  grossSales: IsLine;
  discounts: IsLine[]; // shown as negatives
  netSales: number;
  beginning: InventoryValue;
  purchases: IsLine; // 430000 + inventory debits from receipts and bills
  freightIn: IsLine;
  purchaseReturns: IsLine;
  labels: IsLine;
  goodsAvailable: number;
  ending: InventoryValue;
  costOfSales: number;
  /** memo: what the deliveries of the month cost at the cost captured on each line (perpetual view) */
  costOfGoodsDelivered: number;
  grossProfit: number;
  admin: IsLine[];
  adminTotal: number;
  marketing: IsLine[];
  marketingTotal: number;
  totalExpenses: number;
  incomeBeforeOther: number;
  otherIncome: IsLine[];
  otherIncomeTotal: number;
  otherExpense: IsLine[];
  otherExpenseTotal: number;
  incomeTax: IsLine;
  netIncome: number;
};

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const r2 = (n: number) => Math.round(n * 100) / 100;

/** "2026-01" → the month, defaulting to the current month when absent or malformed. */
export function parseMonth(raw?: string | null): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(raw ?? "");
  if (m) {
    const year = Number(m[1]), month = Number(m[2]);
    if (month >= 1 && month <= 12) return { year, month };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/** First and last instant of the month, in UTC (how document dates are stored). */
export function monthRange(year: number, month: number): { from: Date; to: Date; prevEnd: Date } {
  const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  const prevEnd = new Date(Date.UTC(year, month - 1, 0, 23, 59, 59, 999));
  return { from, to, prevEnd };
}

/** Merchandise inventory on a date, in the pieces the balance sheet carries. */
export async function inventoryValueAt(companyIds: string[], asOf: Date): Promise<InventoryValue> {
  // one valuation at a time: each runs several queries of its own, and a burst of them has tripped the pooled connection
  const good = await getMerchandiseInventory({ companyIds, asOf, showZero: false });
  const nonInv = await getMerchandiseInventory({ companyIds, asOf, showZero: false, itemClass: "NON_INVENTORY" });
  const obsolete = await getMerchandiseInventory({ companyIds, asOf, showZero: false, condition: "OBSOLETE" });
  const relabel = await getMerchandiseInventory({ companyIds, asOf, showZero: false, condition: "RELABEL" });
  const atSupplier = await getMerchandiseInventory({ companyIds, asOf, showZero: false, condition: "AT_SUPPLIER" });
  const labels = r2(nonInv.rows.filter((r) => r.category === "Labels").reduce((s, r) => s + r.amount, 0));
  const v = { good: good.totalValue, labels, relabel: relabel.totalValue, atSupplier: atSupplier.totalValue, obsolete: obsolete.totalValue, total: 0 };
  v.total = r2(v.good + v.labels + v.relabel + v.atSupplier + v.obsolete);
  return v;
}

// the ledger labels revenue with the account chosen on Company Details; when none is chosen it falls back
// to a plain name, which the statement still files under the account the books use for it
const FALLBACK_CODES: Record<string, string> = { Sales: "410000", "Freight Income (account not set)": "900001", "Other Income (account not set)": "900003" };
const codeOf = (s: string) => (/^(\d{6})\b/.exec(s) ?? [])[1] ?? FALLBACK_CODES[s] ?? null;
const isInventoryAcct = (s: string) => s === "Inventory" || /^13\d{4}\b/.test(s);

export async function getIncomeStatement(year: number, month: number, companyIds: string[]): Promise<IncomeStatement> {
  const { from, to, prevEnd } = monthRange(year, month);
  const entries = await getLedger({ from, to }, companyIds);
  const accounts = await prisma.gLAccount.findMany({ where: { statement: "IS" }, orderBy: { code: "asc" }, select: { code: true, description: true, group: true, normalBalance: true } });
  const beginning = await inventoryValueAt(companyIds, prevEnd);
  const ending = await inventoryValueAt(companyIds, to);
  const deliveries = await prisma.dRLine.findMany({
    where: { deliveryReceipt: { salesReceipt: { companyId: { in: companyIds }, kind: "SALE", status: { not: "Void" }, invoiceDate: { gte: from, lte: to } } } },
    select: { baseQty: true, unitCostAtSale: true, product: { select: { unitCost: true } } },
  });

  // debits and credits per account code from the month's ledger entries
  const dr = new Map<string, number>(), cr = new Map<string, number>();
  let inventoryIn = 0;
  for (const e of entries as { ref: string; debit: string; credit: string; amount: number }[]) {
    const d = codeOf(e.debit), c = codeOf(e.credit);
    if (d) dr.set(d, (dr.get(d) ?? 0) + e.amount);
    if (c) cr.set(c, (cr.get(c) ?? 0) + e.amount);
    // Purchases beyond account 430000: the inventory cost of supplier bills — the receipt they
    // bill (cleared from Goods Received Not Billed), the goods billed without a receipt, and any
    // re-costing. A receipt itself is only a clearing entry until its bill arrives, and the
    // vouchers that pay purchases straight to 430000 are already in that account.
    const isBill = /^BL-/.test(e.ref ?? "");
    if (isBill && (isInventoryAcct(e.debit) || e.debit === "Goods Received Not Billed")) inventoryIn += e.amount;
    if (isBill && isInventoryAcct(e.credit)) inventoryIn -= e.amount;
  }
  const balance = (a: { code: string; normalBalance: string }) => {
    const d = dr.get(a.code) ?? 0, c = cr.get(a.code) ?? 0;
    return r2(a.normalBalance === "Credit" ? c - d : d - c);
  };
  const line = (code: string, fallback: string): IsLine => {
    const a = accounts.find((x) => x.code === code);
    return a ? { code, description: a.description, amount: balance(a) } : { code, description: fallback, amount: 0 };
  };
  const group = (g: string, exclude: string[] = []) => accounts.filter((a) => a.group === g && !exclude.includes(a.code)).map((a) => ({ code: a.code, description: a.description, amount: balance(a) }));

  const grossSales = line("410000", "Gross Sales");
  // discounts and returns are debits against sales, shown as negatives whatever the account's normal balance
  const discounts = ["410001", "410002", "410003", "410004"].map((c) => ({ ...line(c, c), amount: r2((cr.get(c) ?? 0) - (dr.get(c) ?? 0)) }));
  const netSales = r2(grossSales.amount + discounts.reduce((s, l) => s + l.amount, 0));

  const purchasesAcct = line("430000", "Purchases");
  const purchases: IsLine = { ...purchasesAcct, amount: r2(purchasesAcct.amount + inventoryIn) };
  const freightIn = line("440000", "Freight In");
  const purchaseReturns = { ...line("450000", "Purchase Return"), amount: r2(-line("450000", "").amount) };
  const labels = line("460000", "Labels");
  const goodsAvailable = r2(beginning.total + purchases.amount + freightIn.amount + purchaseReturns.amount + labels.amount);
  const costOfSales = r2(goodsAvailable - ending.total);
  const costOfGoodsDelivered = r2(deliveries.reduce((s, l) => s + l.baseQty * (l.unitCostAtSale > 0 ? l.unitCostAtSale : l.product.unitCost), 0));
  const grossProfit = r2(netSales - costOfSales);

  const admin = group("Administrative Expense");
  const adminTotal = r2(admin.reduce((s, l) => s + l.amount, 0));
  const marketing = group("Sales & Marketing Expense");
  const marketingTotal = r2(marketing.reduce((s, l) => s + l.amount, 0));
  const totalExpenses = r2(adminTotal + marketingTotal);
  const incomeBeforeOther = r2(grossProfit - totalExpenses);

  const otherIncome = group("Other Income");
  const otherIncomeTotal = r2(otherIncome.reduce((s, l) => s + l.amount, 0));
  const incomeTax = line("800003", "Income Tax Expense");
  const otherExpense = group("Other Expenses", ["800003"]);
  const otherExpenseTotal = r2(otherExpense.reduce((s, l) => s + l.amount, 0));
  const netIncome = r2(incomeBeforeOther + otherIncomeTotal - otherExpenseTotal - incomeTax.amount);

  return {
    year, month, monthLabel: `${MONTHS[month - 1]} ${year}`, from, to,
    grossSales, discounts, netSales,
    beginning, purchases, freightIn, purchaseReturns, labels, goodsAvailable, ending, costOfSales, costOfGoodsDelivered, grossProfit,
    admin, adminTotal, marketing, marketingTotal, totalExpenses, incomeBeforeOther,
    otherIncome, otherIncomeTotal, otherExpense, otherExpenseTotal, incomeTax, netIncome,
  };
}

/** The statement as spreadsheet rows, in the sheet's own order. */
export function incomeStatementRows(s: IncomeStatement, company: string): (string | number)[][] {
  const inv = (v: InventoryValue) => [
    ["", "", "   Good stock", v.good], ["", "", "   Labels", v.labels], ["", "", "   For label replacement", v.relabel],
    ["", "", "   Reformulation stocks in supplier", v.atSupplier], ["", "", "   Obsolete inventory", v.obsolete],
  ];
  return [
    [company], ["INCOME STATEMENT"], [`For the month of ${s.monthLabel}`], [],
    ["SALES"],
    ["", s.grossSales.code, "GROSS SALES", s.grossSales.amount],
    ...s.discounts.map((l, i) => ["", l.code, i === 0 ? "Less:" : "", l.description, l.amount]),
    ["NET SALES", "", "", s.netSales],
    ["COST OF SALES"],
    ["", "420001", "Merchandise Inventory, Beginning", s.beginning.total], ...inv(s.beginning),
    ["", s.purchases.code, "Add: Purchases", s.purchases.amount],
    ["", s.freightIn.code, "Freight In", s.freightIn.amount],
    ["", s.purchaseReturns.code, "Purchase Return", s.purchaseReturns.amount],
    ["", s.labels.code, "Labels", s.labels.amount],
    ["", "", "Cost Of Goods Available For Sale", s.goodsAvailable],
    ["", "420002", "Less: Merchandise Inventory, Ending", -s.ending.total], ...inv(s.ending),
    ["", "", "TOTAL COST OF SALES", s.costOfSales],
    ["", "", "memo: cost of the goods delivered this month, at the cost on each delivery line", s.costOfGoodsDelivered],
    [],
    ["GROSS PROFIT", "", "", s.grossProfit],
    ["OPERATING EXPENSES"],
    ["", "ADMINISTRATIVE EXPENSE"],
    ...s.admin.map((l) => ["", l.code, l.description, l.amount]),
    ["", "", "TOTAL ADMINISTRATIVE EXPENSES", s.adminTotal],
    ["", "MARKETING & SALES"],
    ...s.marketing.map((l) => ["", l.code, l.description, l.amount]),
    ["", "", "TOTAL SALES & MARKETING EXPENSES", s.marketingTotal],
    ["", "", "TOTAL EXPENSES", s.totalExpenses],
    [],
    ["NET INCOME (LOSS) BEFORE OTHER INCOME (EXPENSE)", "", "", s.incomeBeforeOther],
    ["ADD: OTHER INCOME"],
    ...s.otherIncome.map((l) => ["", l.code, l.description, l.amount]),
    ["", "", "TOTAL OTHER INCOME", s.otherIncomeTotal],
    ["LESS: OTHER EXPENSE"],
    ...s.otherExpense.map((l) => ["", l.code, l.description, l.amount]),
    ["", "", "TOTAL OTHER EXPENSE", s.otherExpenseTotal],
    ["", s.incomeTax.code, "Less: Income Tax Expense", s.incomeTax.amount],
    ["NET INCOME", "", "", s.netIncome],
  ];
}
