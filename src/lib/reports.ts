import { prisma } from "./db";

export type Range = { from: Date; to: Date };

export function parseRange(searchParams: { from?: string; to?: string }): Range {
  const now = new Date();
  const from = searchParams.from ? new Date(searchParams.from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = searchParams.to ? new Date(searchParams.to) : now;
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function getSalesReport({ from, to }: Range) {
  const srs = await prisma.salesReceipt.findMany({
    where: { status: { not: "Void" }, invoiceDate: { gte: from, lte: to } },
    include: {
      customer: true,
      deliveryReceipt: { include: { lines: { include: { product: true } } } },
    },
    orderBy: { invoiceDate: "asc" },
  });

  const byCustomer = new Map<string, { name: string; region: string; count: number; amount: number }>();
  const byProduct = new Map<string, { name: string; sku: string; qty: number; amount: number }>();
  const byRegion = new Map<string, number>();
  let total = 0;

  for (const sr of srs) {
    total += sr.amount;
    const c = byCustomer.get(sr.customerId) ?? { name: sr.customer.businessName, region: sr.customer.region, count: 0, amount: 0 };
    c.count++;
    c.amount = round2(c.amount + sr.amount);
    byCustomer.set(sr.customerId, c);
    byRegion.set(sr.customer.region, round2((byRegion.get(sr.customer.region) ?? 0) + sr.amount));
    for (const l of sr.deliveryReceipt.lines) {
      const p = byProduct.get(l.productId) ?? { name: l.product.name, sku: l.product.sku, qty: 0, amount: 0 };
      p.qty += l.baseQty; // aggregate in base PCS — lines may be CARTON or PCS
      p.amount = round2(p.amount + l.qty * l.unitPrice);
      byProduct.set(l.productId, p);
    }
  }

  return {
    invoices: srs,
    total: round2(total),
    byCustomer: [...byCustomer.values()].sort((a, b) => b.amount - a.amount),
    byProduct: [...byProduct.values()].sort((a, b) => b.amount - a.amount),
    byRegion: [...byRegion.entries()].map(([region, amount]) => ({ region, amount })).sort((a, b) => b.amount - a.amount),
  };
}

export type MonthlyProductRow = {
  name: string; // parent item (product line)
  category: string;
  monthsQty: number[]; // 12
  monthsAmt: number[]; // 12
};

/** Actual invoiced sales per product line per month, optionally filtered to one region. */
export async function getMonthlyProductSales(year: number, region?: string) {
  const from = new Date(year, 0, 1);
  const to = new Date(year, 11, 31, 23, 59, 59, 999);
  const srs = await prisma.salesReceipt.findMany({
    where: {
      status: { not: "Void" },
      invoiceDate: { gte: from, lte: to },
      ...(region ? { customer: { region } } : {}),
    },
    include: { deliveryReceipt: { include: { lines: { include: { product: true } } } } },
  });

  const map = new Map<string, MonthlyProductRow>();
  for (const sr of srs) {
    const mi = sr.invoiceDate.getMonth();
    for (const l of sr.deliveryReceipt.lines) {
      const key = l.product.parentItem?.trim() || l.product.name;
      let row = map.get(key);
      if (!row) {
        row = { name: key, category: l.product.category, monthsQty: Array(12).fill(0), monthsAmt: Array(12).fill(0) };
        map.set(key, row);
      }
      row.monthsQty[mi] += l.baseQty; // base PCS
      row.monthsAmt[mi] = round2(row.monthsAmt[mi] + l.qty * l.unitPrice);
    }
  }

  const CATEGORY_ORDER = ["Insecticide", "Herbicide", "Fungicide", "Molluscicide", "Foliar Fertilizer", "Others"];
  return [...map.values()].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name)
  );
}

export async function getExpenseReport({ from, to }: Range) {
  const expenses = await prisma.expense.findMany({
    where: { date: { gte: from, lte: to } },
    orderBy: { date: "desc" },
    include: { user: { select: { name: true } } },
  });
  const byCategory = new Map<string, number>();
  let total = 0;
  for (const e of expenses) {
    total += e.amount;
    byCategory.set(e.category, round2((byCategory.get(e.category) ?? 0) + e.amount));
  }
  return {
    expenses,
    total: round2(total),
    byCategory: [...byCategory.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
  };
}

export async function getPnl(range: Range) {
  const sales = await getSalesReport(range);
  const expenseReport = await getExpenseReport(range);
  // COGS from delivered lines at product unit cost (per PCS × base PCS quantity)
  let cogs = 0;
  for (const sr of sales.invoices) {
    for (const l of sr.deliveryReceipt.lines) {
      cogs += l.baseQty * l.product.unitCost;
    }
  }
  cogs = round2(cogs);
  const revenue = sales.total;
  const grossProfit = round2(revenue - cogs);
  const totalExpenses = expenseReport.total;
  const netIncome = round2(grossProfit - totalExpenses);
  return { revenue, cogs, grossProfit, expenses: expenseReport.byCategory, totalExpenses, netIncome };
}

export type AgingRow = {
  customerId: string;
  customer: string;
  region: string;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  total: number;
};

export async function getArAging(): Promise<{ rows: AgingRow[]; totals: Omit<AgingRow, "customerId" | "customer" | "region"> }> {
  const srs = await prisma.salesReceipt.findMany({
    where: { status: { in: ["Open", "Partial"] } },
    include: { customer: true, payments: true },
  });
  const now = new Date();
  const map = new Map<string, AgingRow>();
  for (const sr of srs) {
    const paid = sr.payments.reduce((s, p) => s + p.amount, 0);
    const bal = round2(sr.amount - paid);
    if (bal <= 0) continue;
    const days = Math.floor((now.getTime() - sr.dueDate.getTime()) / 86400000);
    const row = map.get(sr.customerId) ?? {
      customerId: sr.customerId,
      customer: sr.customer.businessName,
      region: sr.customer.region,
      current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0,
    };
    if (days <= 0) row.current = round2(row.current + bal);
    else if (days <= 30) row.d1_30 = round2(row.d1_30 + bal);
    else if (days <= 60) row.d31_60 = round2(row.d31_60 + bal);
    else if (days <= 90) row.d61_90 = round2(row.d61_90 + bal);
    else row.d90plus = round2(row.d90plus + bal);
    row.total = round2(row.total + bal);
    map.set(sr.customerId, row);
  }
  const rows = [...map.values()].sort((a, b) => b.total - a.total);
  const totals = rows.reduce(
    (t, r) => ({
      current: round2(t.current + r.current),
      d1_30: round2(t.d1_30 + r.d1_30),
      d31_60: round2(t.d31_60 + r.d31_60),
      d61_90: round2(t.d61_90 + r.d61_90),
      d90plus: round2(t.d90plus + r.d90plus),
      total: round2(t.total + r.total),
    }),
    { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 }
  );
  return { rows, totals };
}

export async function getMovements({ from, to }: Range) {
  return prisma.stockMovement.findMany({
    where: { date: { gte: from, lte: to } },
    orderBy: { date: "desc" },
    take: 500,
    include: { product: true, user: { select: { name: true } } },
  });
}

export async function getDeliveryPerformance({ from, to }: Range) {
  const delivered = await prisma.deliveryReceipt.findMany({
    where: { deliveredAt: { gte: from, lte: to }, status: { in: ["Delivered", "Invoiced"] } },
    select: { deliveredAt: true },
  });
  const byDay = new Map<string, number>();
  for (const d of delivered) {
    const key = d.deliveredAt!.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  return [...byDay.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Journal-style ledger entries derived from sales, purchases, expenses, collections. */
export async function getLedger({ from, to }: Range) {
  const [srs, payments, expenses, poIns] = await Promise.all([
    prisma.salesReceipt.findMany({ where: { status: { not: "Void" }, invoiceDate: { gte: from, lte: to } }, include: { customer: true } }),
    prisma.payment.findMany({ where: { date: { gte: from, lte: to } }, include: { salesReceipt: { include: { customer: true } } } }),
    prisma.expense.findMany({ where: { date: { gte: from, lte: to } } }),
    prisma.stockMovement.findMany({ where: { date: { gte: from, lte: to }, type: "IN", refType: "PO" }, include: { product: true } }),
  ]);
  const entries = [
    ...srs.map((sr) => ({
      date: sr.invoiceDate,
      ref: sr.srNumber,
      description: `Sale on account — ${sr.customer.businessName}`,
      debit: "Accounts Receivable",
      credit: "Sales",
      amount: sr.amount,
    })),
    ...payments.map((p) => ({
      date: p.date,
      ref: p.refNo || p.salesReceipt.srNumber,
      description: `Collection — ${p.salesReceipt.customer.businessName} (${p.method})`,
      debit: "Cash",
      credit: "Accounts Receivable",
      amount: p.amount,
    })),
    ...expenses.map((e) => ({
      date: e.date,
      ref: "EXP",
      description: `${e.category} expense${e.notes ? ` — ${e.notes}` : ""}`,
      debit: `Expense: ${e.category}`,
      credit: "Cash",
      amount: e.amount,
    })),
    ...poIns.map((m) => ({
      date: m.date,
      ref: m.refNo ?? "PO",
      description: `Inventory received — ${m.product.name} × ${m.qty}`,
      debit: "Inventory",
      credit: "Accounts Payable",
      amount: round2(m.qty * m.product.unitCost),
    })),
  ];
  return entries.sort((a, b) => b.date.getTime() - a.date.getTime());
}
