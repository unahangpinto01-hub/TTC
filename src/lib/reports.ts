import { prisma } from "./db";
import { lineCartonSize } from "./units";

export type Range = { from: Date; to: Date };

export function parseRange(searchParams: { from?: string; to?: string }): Range {
  const now = new Date();
  const from = searchParams.from ? new Date(searchParams.from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = searchParams.to ? new Date(searchParams.to) : now;
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Distinct customer provinces (customers are shared across companies), for report filters. */
export async function getProvinces(): Promise<string[]> {
  const rows = await prisma.customer.findMany({
    distinct: ["province"],
    select: { province: true },
    orderBy: { province: "asc" },
  });
  return rows.map((r) => r.province).filter(Boolean);
}

export async function getSalesReport({ from, to }: Range, companyIds: string[], filters?: { province?: string }) {
  const srs = await prisma.salesReceipt.findMany({
    where: {
      companyId: { in: companyIds },
      status: { not: "Void" },
      invoiceDate: { gte: from, lte: to },
      ...(filters?.province ? { customer: { province: filters.province } } : {}),
    },
    include: {
      company: { select: { companyName: true } },
      customer: true,
      deliveryReceipt: { include: { lines: { include: { product: true } } } },
    },
    orderBy: { invoiceDate: "asc" },
  });

  const byCustomer = new Map<string, { name: string; region: string; count: number; amount: number }>();
  // product totals roll up to the parent item (product line); standalone products use their own name
  const byProduct = new Map<string, { name: string; qty: number; ctn: number; noConversion: boolean; amount: number }>();
  const byRegion = new Map<string, number>();
  // per-company subtotals, so a combined report shows each company and a grand total
  const byCompany = new Map<string, { name: string; count: number; amount: number }>();
  let total = 0;

  for (const sr of srs) {
    total += sr.amount;
    const c = byCustomer.get(sr.customerId) ?? { name: sr.customer.businessName, region: sr.customer.region, count: 0, amount: 0 };
    c.count++;
    c.amount = round2(c.amount + sr.amount);
    byCustomer.set(sr.customerId, c);
    byRegion.set(sr.customer.region, round2((byRegion.get(sr.customer.region) ?? 0) + sr.amount));
    const co = byCompany.get(sr.companyId) ?? { name: sr.company.companyName, count: 0, amount: 0 };
    co.count++;
    co.amount = round2(co.amount + sr.amount);
    byCompany.set(sr.companyId, co);
    for (const l of sr.deliveryReceipt.lines) {
      const key = l.product.parentItem?.trim() || l.product.name;
      const p = byProduct.get(key) ?? { name: key, qty: 0, ctn: 0, noConversion: false, amount: 0 };
      p.qty += l.baseQty; // aggregate in base PCS — lines may be CARTON or PCS
      // a product line can hold several products with different carton sizes, so cartons are
      // accumulated line by line rather than dividing the rolled-up total by one figure
      const ppc = lineCartonSize(l, l.product);
      if (ppc) p.ctn += l.baseQty / ppc;
      else p.noConversion = true;
      p.amount = round2(p.amount + l.qty * l.unitPrice);
      byProduct.set(key, p);
    }
  }

  return {
    invoices: srs,
    total: round2(total),
    byCustomer: [...byCustomer.values()].sort((a, b) => b.amount - a.amount),
    byProduct: [...byProduct.values()].sort((a, b) => b.amount - a.amount),
    byRegion: [...byRegion.entries()].map(([region, amount]) => ({ region, amount })).sort((a, b) => b.amount - a.amount),
    byCompany: [...byCompany.values()].sort((a, b) => b.amount - a.amount),
  };
}

export type MonthlyProductRow = {
  name: string; // parent item (product line)
  category: string;
  monthsQty: number[]; // 12, base PCS
  monthsCtn: number[]; // 12, carton equivalent at each line's own conversion
  monthsAmt: number[]; // 12
  noConversion: boolean; // some product in this line has no packaging setup
};

/** Actual invoiced sales per product line per month, optionally filtered to one region and/or province. */
export async function getMonthlyProductSales(year: number, companyIds: string[], region?: string, province?: string) {
  const from = new Date(year, 0, 1);
  const to = new Date(year, 11, 31, 23, 59, 59, 999);
  const customerFilter = region || province ? { customer: { ...(region ? { region } : {}), ...(province ? { province } : {}) } } : {};
  const srs = await prisma.salesReceipt.findMany({
    where: {
      companyId: { in: companyIds },
      status: { not: "Void" },
      invoiceDate: { gte: from, lte: to },
      ...customerFilter,
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
        row = {
          name: key, category: l.product.category,
          monthsQty: Array(12).fill(0), monthsCtn: Array(12).fill(0), monthsAmt: Array(12).fill(0),
          noConversion: false,
        };
        map.set(key, row);
      }
      row.monthsQty[mi] += l.baseQty; // base PCS
      const ppc = lineCartonSize(l, l.product);
      if (ppc) row.monthsCtn[mi] += l.baseQty / ppc;
      else row.noConversion = true;
      row.monthsAmt[mi] = round2(row.monthsAmt[mi] + l.qty * l.unitPrice);
    }
  }

  const CATEGORY_ORDER = (
    await prisma.productCategory.findMany({ orderBy: { sortOrder: "asc" }, select: { name: true } })
  ).map((c) => c.name);
  return [...map.values()].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name)
  );
}

export async function getExpenseReport({ from, to }: Range, companyIds: string[]) {
  const expenses = await prisma.expense.findMany({
    where: { companyId: { in: companyIds }, date: { gte: from, lte: to } },
    orderBy: { date: "desc" },
    include: { company: { select: { companyName: true } }, user: { select: { name: true } } },
  });
  const byCategory = new Map<string, number>();
  const byCompany = new Map<string, { name: string; amount: number }>();
  let total = 0;
  for (const e of expenses) {
    total += e.amount;
    byCategory.set(e.category, round2((byCategory.get(e.category) ?? 0) + e.amount));
    const co = byCompany.get(e.companyId) ?? { name: e.company.companyName, amount: 0 };
    co.amount = round2(co.amount + e.amount);
    byCompany.set(e.companyId, co);
  }
  return {
    expenses,
    total: round2(total),
    byCategory: [...byCategory.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    byCompany: [...byCompany.values()].sort((a, b) => b.amount - a.amount),
  };
}

export async function getPnl(range: Range, companyIds: string[]) {
  const sales = await getSalesReport(range, companyIds);
  const expenseReport = await getExpenseReport(range, companyIds);
  // COGS at the weighted-average cost captured when the goods were delivered (per PCS × base PCS).
  // Pre-feature lines have no snapshot (0) and fall back to the product's current cost.
  let cogs = 0;
  for (const sr of sales.invoices) {
    for (const l of sr.deliveryReceipt.lines) {
      cogs += l.baseQty * (l.unitCostAtSale > 0 ? l.unitCostAtSale : l.product.unitCost);
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
  company: string;
  region: string;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  total: number;
};

export async function getArAging(companyIds: string[]): Promise<{ rows: AgingRow[]; totals: Omit<AgingRow, "customerId" | "customer" | "company" | "region"> }> {
  const srs = await prisma.salesReceipt.findMany({
    where: { companyId: { in: companyIds }, status: { in: ["Open", "Partial"] } },
    include: { company: { select: { companyName: true } }, customer: true, payments: true },
  });
  const now = new Date();
  const map = new Map<string, AgingRow>();
  for (const sr of srs) {
    const paid = sr.payments.reduce((s, p) => s + p.amount, 0);
    const bal = round2(sr.amount - paid);
    if (bal <= 0) continue;
    const days = Math.floor((now.getTime() - sr.dueDate.getTime()) / 86400000);
    // one row per customer PER company — balances from different companies never merge
    const key = `${sr.companyId}:${sr.customerId}`;
    const row = map.get(key) ?? {
      customerId: sr.customerId,
      customer: sr.customer.businessName,
      company: sr.company.companyName,
      region: sr.customer.region,
      current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0,
    };
    if (days <= 0) row.current = round2(row.current + bal);
    else if (days <= 30) row.d1_30 = round2(row.d1_30 + bal);
    else if (days <= 60) row.d31_60 = round2(row.d31_60 + bal);
    else if (days <= 90) row.d61_90 = round2(row.d61_90 + bal);
    else row.d90plus = round2(row.d90plus + bal);
    row.total = round2(row.total + bal);
    map.set(key, row);
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

export type MerchandiseInventoryRow = {
  id: string;
  company: string;
  sku: string;
  name: string;
  packSize: string;
  category: string;
  piecesPerCarton: number | null;
  unitCost: number; // cost per PCS (the product master's existing costing field)
  stock: number; // PCS as of the report date
  amount: number; // unitCost × stock
};

export type MerchandiseInventoryReport = {
  rows: MerchandiseInventoryRow[];
  items: number;
  totalStock: number;
  totalValue: number;
  historical: boolean; // true when stock was reconstructed from the stock card for a past date
};

/**
 * Inventory valuation at COST: stock PCS × product unitCost (per PCS).
 * Read-only. For a past as-of date, stock is reconstructed from StockMovement.balanceAfter
 * (the last movement on or before that date; products with no movements by then were at 0).
 * Valuation always uses the CURRENT unit cost — the system stores a single static cost per product.
 */
export async function getMerchandiseInventory(opts: {
  companyIds: string[];
  asOf?: Date | null;
  category?: string;
  q?: string;
  showZero?: boolean;
  /** "INVENTORY" (default — merchandise only) or "NON_INVENTORY" (promo materials, valued separately) */
  itemClass?: string;
}): Promise<MerchandiseInventoryReport> {
  const where: any = { companyId: { in: opts.companyIds } };
  where.itemClass = opts.itemClass === "NON_INVENTORY" ? "NON_INVENTORY" : "INVENTORY";
  if (opts.category) where.category = opts.category;
  if (opts.q) {
    where.OR = [
      { name: { contains: opts.q, mode: "insensitive" } },
      { sku: { contains: opts.q, mode: "insensitive" } },
      { packSize: { contains: opts.q, mode: "insensitive" } },
      { activeIngredient: { contains: opts.q, mode: "insensitive" } },
    ];
  }
  const products = await prisma.product.findMany({ where, orderBy: [{ category: "asc" }, { name: "asc" }], include: { company: { select: { companyName: true } } } });

  // historical only when the as-of date ends before now; today (or future) = live stock
  let asOfEnd: Date | null = null;
  if (opts.asOf) {
    asOfEnd = new Date(opts.asOf);
    asOfEnd.setHours(23, 59, 59, 999);
    if (asOfEnd.getTime() >= Date.now()) asOfEnd = null;
  }

  let stockOf: (p: (typeof products)[number]) => number;
  if (asOfEnd) {
    const balances = await prisma.$queryRaw<{ productId: string; balanceAfter: number }[]>`
      SELECT DISTINCT ON ("productId") "productId", "balanceAfter"
      FROM "StockMovement"
      WHERE "date" <= ${asOfEnd}
      ORDER BY "productId", "date" DESC, "id" DESC`;
    const map = new Map(balances.map((b) => [b.productId, b.balanceAfter]));
    stockOf = (p) => map.get(p.id) ?? 0;
  } else {
    stockOf = (p) => p.stockQty;
  }

  let rows: MerchandiseInventoryRow[] = products.map((p) => {
    const stock = stockOf(p);
    return {
      id: p.id,
      company: p.company.companyName,
      sku: p.sku,
      name: p.name,
      packSize: p.packSize,
      category: p.category,
      piecesPerCarton: p.piecesPerCarton,
      unitCost: p.unitCost,
      stock,
      // full precision — rounding to 2 decimals happens only at display time
      amount: stock * p.unitCost,
    };
  });
  // zero stock hidden by default; negative stock is always shown (never silently dropped)
  if (!opts.showZero) rows = rows.filter((r) => r.stock !== 0);

  return {
    rows,
    items: rows.length,
    totalStock: rows.reduce((s, r) => s + r.stock, 0),
    // total = SUM of full-precision amounts, rounded once at the end
    totalValue: round2(rows.reduce((s, r) => s + r.amount, 0)),
    historical: !!asOfEnd,
  };
}

export async function getMovements({ from, to }: Range, companyIds: string[]) {
  return prisma.stockMovement.findMany({
    where: { date: { gte: from, lte: to }, product: { companyId: { in: companyIds } } },
    orderBy: { date: "desc" },
    take: 500,
    include: { product: { include: { company: { select: { companyName: true } } } }, user: { select: { name: true } } },
  });
}

export async function getDeliveryPerformance({ from, to }: Range, companyIds: string[]) {
  const delivered = await prisma.deliveryReceipt.findMany({
    where: { companyId: { in: companyIds }, deliveredAt: { gte: from, lte: to }, status: { in: ["Delivered", "Invoiced"] } },
    select: { deliveredAt: true, company: { select: { companyName: true } } },
  });
  const byDay = new Map<string, { count: number; byCompany: Record<string, number> }>();
  for (const d of delivered) {
    const key = d.deliveredAt!.toISOString().slice(0, 10);
    const row = byDay.get(key) ?? { count: 0, byCompany: {} };
    row.count++;
    row.byCompany[d.company.companyName] = (row.byCompany[d.company.companyName] ?? 0) + 1;
    byDay.set(key, row);
  }
  return [...byDay.entries()].map(([date, r]) => ({ date, count: r.count, byCompany: r.byCompany })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Journal-style ledger entries derived from sales, purchases, expenses, collections. */
export async function getLedger({ from, to }: Range, companyIds: string[]) {
  const [srs, payments, expenses, poIns] = await Promise.all([
    prisma.salesReceipt.findMany({ where: { companyId: { in: companyIds }, status: { not: "Void" }, invoiceDate: { gte: from, lte: to } }, include: { company: { select: { companyName: true } }, customer: true } }),
    prisma.payment.findMany({ where: { date: { gte: from, lte: to }, salesReceipt: { companyId: { in: companyIds } } }, include: { salesReceipt: { include: { company: { select: { companyName: true } }, customer: true } } } }),
    prisma.expense.findMany({ where: { companyId: { in: companyIds }, date: { gte: from, lte: to } }, include: { company: { select: { companyName: true } } } }),
    prisma.stockMovement.findMany({ where: { date: { gte: from, lte: to }, type: "IN", refType: "PO", product: { companyId: { in: companyIds } } }, include: { product: { include: { company: { select: { companyName: true } } } } } }),
  ]);
  const entries = [
    ...srs.map((sr) => ({
      date: sr.invoiceDate,
      company: sr.company.companyName,
      ref: sr.srNumber,
      description: `Sale on account — ${sr.customer.businessName}`,
      debit: "Accounts Receivable",
      credit: "Sales",
      amount: sr.amount,
    })),
    ...payments.map((p) => ({
      date: p.date,
      company: p.salesReceipt.company.companyName,
      ref: p.refNo || p.salesReceipt.srNumber,
      description: `Collection — ${p.salesReceipt.customer.businessName} (${p.method})`,
      debit: "Cash",
      credit: "Accounts Receivable",
      amount: p.amount,
    })),
    ...expenses.map((e) => ({
      date: e.date,
      company: e.company.companyName,
      ref: "EXP",
      description: `${e.category} expense${e.notes ? ` — ${e.notes}` : ""}`,
      debit: `Expense: ${e.category}`,
      credit: "Cash",
      amount: e.amount,
    })),
    ...poIns.map((m) => ({
      date: m.date,
      company: m.product.company.companyName,
      ref: m.refNo ?? "PO",
      description: `Inventory received — ${m.product.name} × ${m.qty}`,
      debit: "Inventory",
      credit: "Accounts Payable",
      amount: round2(m.qty * m.product.unitCost),
    })),
  ];
  return entries.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export type CollectionRow = {
  id: string;
  date: Date;
  company: string;
  srNumber: string;
  customer: string;
  method: string;
  refNo: string;
  amount: number;
};

/** Payments actually received in the period — the collections report. */
export async function getCollections({ from, to }: Range, companyIds: string[], filters?: { method?: string; customerId?: string }) {
  const payments = await prisma.payment.findMany({
    where: {
      date: { gte: from, lte: to },
      ...(filters?.method ? { method: filters.method } : {}),
      salesReceipt: {
        companyId: { in: companyIds },
        status: { not: "Void" },
        ...(filters?.customerId ? { customerId: filters.customerId } : {}),
      },
    },
    include: { salesReceipt: { include: { company: { select: { companyName: true } }, customer: true } } },
    orderBy: { date: "asc" },
  });

  const rows: CollectionRow[] = payments.map((p) => ({
    id: p.id,
    date: p.date,
    company: p.salesReceipt.company.companyName,
    srNumber: p.salesReceipt.srNumber,
    customer: p.salesReceipt.customer.businessName,
    method: p.method,
    refNo: p.refNo ?? "",
    amount: p.amount,
  }));

  const group = (key: (r: CollectionRow) => string) => {
    const m = new Map<string, { name: string; count: number; amount: number }>();
    for (const r of rows) {
      const k = key(r);
      const cur = m.get(k) ?? { name: k, count: 0, amount: 0 };
      cur.count++;
      cur.amount = round2(cur.amount + r.amount);
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  };

  return {
    rows,
    total: round2(rows.reduce((s, r) => s + r.amount, 0)),
    byCompany: group((r) => r.company),
    byMethod: group((r) => r.method),
    byCustomer: group((r) => r.customer),
  };
}

/** Per-customer sales performance across the period: invoices, sales, collections, balance. */
export async function getCustomerReport({ from, to }: Range, companyIds: string[]) {
  const srs = await prisma.salesReceipt.findMany({
    where: { companyId: { in: companyIds }, status: { not: "Void" }, invoiceDate: { gte: from, lte: to } },
    include: { company: { select: { companyName: true } }, customer: true, payments: true },
  });
  const map = new Map<string, {
    key: string; customerId: string; customer: string; company: string; region: string; province: string;
    invoices: number; sales: number; collected: number; balance: number;
  }>();
  for (const sr of srs) {
    // customers are shared, but their figures stay attributed to the company that billed them
    const key = `${sr.companyId}:${sr.customerId}`;
    const row = map.get(key) ?? {
      key, customerId: sr.customerId, customer: sr.customer.businessName, company: sr.company.companyName,
      region: sr.customer.region, province: sr.customer.province,
      invoices: 0, sales: 0, collected: 0, balance: 0,
    };
    row.invoices++;
    row.sales = round2(row.sales + sr.amount);
    const paid = sr.payments.reduce((s, p) => s + p.amount, 0);
    row.collected = round2(row.collected + paid);
    row.balance = round2(row.balance + (sr.amount - paid));
    map.set(key, row);
  }
  const rows = [...map.values()].sort((a, b) => b.sales - a.sales);
  return {
    rows,
    totals: {
      invoices: rows.reduce((s, r) => s + r.invoices, 0),
      sales: round2(rows.reduce((s, r) => s + r.sales, 0)),
      collected: round2(rows.reduce((s, r) => s + r.collected, 0)),
      balance: round2(rows.reduce((s, r) => s + r.balance, 0)),
    },
  };
}

/** Per-product sales performance across the period: quantity sold, revenue, COGS, margin. */
export async function getProductReport({ from, to }: Range, companyIds: string[], filters?: { category?: string }) {
  const srs = await prisma.salesReceipt.findMany({
    where: { companyId: { in: companyIds }, status: { not: "Void" }, invoiceDate: { gte: from, lte: to } },
    include: {
      company: { select: { companyName: true } },
      deliveryReceipt: { include: { lines: { include: { product: true } } } },
    },
  });
  const map = new Map<string, {
    key: string; sku: string; name: string; company: string; category: string;
    qty: number; revenue: number; cogs: number;
    // cartons are accumulated line by line at each line's OWN conversion, so a product whose
    // packaging changed mid-year still totals correctly across old and new documents
    ctn: number; noConversion: boolean;
  }>();
  for (const sr of srs) {
    for (const l of sr.deliveryReceipt.lines) {
      if (filters?.category && l.product.category !== filters.category) continue;
      const key = `${sr.companyId}:${l.productId}`;
      const row = map.get(key) ?? {
        key, sku: l.product.sku, name: l.product.name, company: sr.company.companyName,
        category: l.product.category, qty: 0, revenue: 0, cogs: 0, ctn: 0, noConversion: false,
      };
      row.qty += l.baseQty; // base PCS
      const ppc = lineCartonSize(l, l.product);
      if (ppc) row.ctn += l.baseQty / ppc;
      else row.noConversion = true;
      row.revenue = round2(row.revenue + l.qty * l.unitPrice);
      row.cogs = round2(row.cogs + l.baseQty * (l.unitCostAtSale > 0 ? l.unitCostAtSale : l.product.unitCost));
      map.set(key, row);
    }
  }
  const rows = [...map.values()]
    .map((r) => ({ ...r, margin: round2(r.revenue - r.cogs) }))
    .sort((a, b) => b.revenue - a.revenue);
  return {
    rows,
    totals: {
      qty: rows.reduce((s, r) => s + r.qty, 0),
      ctn: round2(rows.reduce((s, r) => s + r.ctn, 0)),
      revenue: round2(rows.reduce((s, r) => s + r.revenue, 0)),
      cogs: round2(rows.reduce((s, r) => s + r.cogs, 0)),
      margin: round2(rows.reduce((s, r) => s + r.margin, 0)),
    },
  };
}

export type SalesJournalRow = {
  key: string;
  date: Date;
  company: string;
  invoiceNo: string;
  invoiceId: string;
  customer: string;
  customerId: string;
  reference: string;       // internal order / sales order references
  product: string;
  sku: string;
  productId: string | null; // null on the freight row
  qty: string;              // "5 CTN" etc, blank on the freight row
  qtyPcs: number;           // base PCS — 0 on the freight row
  qtyCtn: number | null;    // carton equivalent, null when the product has no conversion
  unitPrice: number | null;
  gross: number;            // product line amount, or the freight amount on the freight row
  freight: number;          // only set on the freight row
  net: number;              // gross - freight
  paymentStatus: string;
  salesperson: string;
  transactionStatus: "Posted" | "Void";
};

/**
 * Sales journal: every posted invoice broken out by product line, in date order.
 * Freight is carried as its own row inside the invoice, so Gross totals to what was
 * billed, Freight totals separately, and Net Sales = Gross - Freight exactly.
 * Read-only — the rows are derived from Sales Receipts and cannot be edited here.
 */
export async function getSalesJournal(
  { from, to }: Range,
  companyIds: string[],
  filters?: { customerId?: string; productId?: string; salesperson?: string; txStatus?: string; q?: string }
) {
  const srs = await prisma.salesReceipt.findMany({
    where: {
      companyId: { in: companyIds },
      invoiceDate: { gte: from, lte: to },
      ...(filters?.customerId ? { customerId: filters.customerId } : {}),
      ...(filters?.txStatus === "Posted" ? { status: { not: "Void" } } : {}),
      ...(filters?.txStatus === "Void" ? { status: "Void" } : {}),
      ...(filters?.q
        ? {
            OR: [
              { srNumber: { contains: filters.q, mode: "insensitive" as const } },
              { customer: { businessName: { contains: filters.q, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    include: {
      company: { select: { companyName: true } },
      customer: true,
      deliveryReceipt: {
        include: {
          lines: { include: { product: true } },
          salesOrder: { include: { preparedBy: { select: { name: true } }, incomingOrder: { select: { orderNo: true } } } },
        },
      },
    },
    orderBy: [{ invoiceDate: "asc" }, { srNumber: "asc" }],
  });

  const rows: SalesJournalRow[] = [];
  for (const sr of srs) {
    const so = sr.deliveryReceipt.salesOrder;
    const salesperson = so.preparedBy?.name ?? "—";
    if (filters?.salesperson && salesperson !== filters.salesperson) continue;
    const reference = [so.incomingOrder?.orderNo, so.soNumber].filter(Boolean).join(" / ");
    const tx: "Posted" | "Void" = sr.status === "Void" ? "Void" : "Posted";
    const base = {
      date: sr.invoiceDate,
      company: sr.company.companyName,
      invoiceNo: sr.srNumber,
      invoiceId: sr.id,
      customer: sr.customer.businessName,
      customerId: sr.customerId,
      reference,
      paymentStatus: tx === "Void" ? "—" : sr.status,
      salesperson,
      transactionStatus: tx,
    };

    for (const l of sr.deliveryReceipt.lines) {
      if (filters?.productId && l.productId !== filters.productId) continue;
      const gross = round2(l.qty * l.unitPrice);
      rows.push({
        ...base,
        key: `${sr.id}:${l.id}`,
        product: l.product.name,
        sku: l.product.sku,
        productId: l.productId,
        qty: `${l.qty.toLocaleString()} ${l.unit === "CARTON" ? "CTN" : "PCS"}`,
        qtyPcs: l.baseQty,
        qtyCtn: (() => {
          const ppc = lineCartonSize(l, l.product);
          return ppc ? l.baseQty / ppc : null;
        })(),
        unitPrice: l.unitPrice,
        gross,
        freight: 0,
        net: gross,
      });
    }
    // freight rides on the invoice, not on any product — its own row keeps every column honest
    if (sr.freightCharge > 0 && !filters?.productId) {
      rows.push({
        ...base,
        key: `${sr.id}:freight`,
        product: "Freight Charge",
        sku: "",
        productId: null,
        qty: "",
        qtyPcs: 0,
        qtyCtn: null,
        unitPrice: null,
        gross: sr.freightCharge,
        freight: sr.freightCharge,
        net: 0,
      });
    }
  }

  // voided invoices stay visible but never count toward the totals
  const counted = rows.filter((r) => r.transactionStatus === "Posted");
  const sum = (pick: (r: SalesJournalRow) => number) => round2(counted.reduce((s, r) => s + pick(r), 0));
  const byCompany = new Map<string, { name: string; gross: number; freight: number; net: number }>();
  for (const r of counted) {
    const c = byCompany.get(r.company) ?? { name: r.company, gross: 0, freight: 0, net: 0 };
    c.gross = round2(c.gross + r.gross);
    c.freight = round2(c.freight + r.freight);
    c.net = round2(c.net + r.net);
    byCompany.set(r.company, c);
  }

  return {
    rows,
    totals: { gross: sum((r) => r.gross), freight: sum((r) => r.freight), net: sum((r) => r.net) },
    byCompany: [...byCompany.values()].sort((a, b) => b.gross - a.gross),
    voidedCount: rows.filter((r) => r.transactionStatus === "Void").length,
    invoiceCount: new Set(counted.map((r) => r.invoiceNo)).size,
  };
}

// ---------------------------------------------------------------------------
// Sales vs Forecast — actual sales normalized to forecast units before comparing
// ---------------------------------------------------------------------------

import { packSizeToMl, isForecastBasePack } from "./forecast-units";

/** One pack size contributing to a row's actual sales (the drill-down detail). */
export type VsPack = {
  productId: string;
  name: string;
  packSize: string;
  /** actual pieces sold, exactly as invoiced — never altered */
  qty: number;
  /** forecast PCS one piece counts as (1000ml=1, 500ml=0.5, ...); null = not convertible */
  factor: number | null;
  equivalent: number;
};

export type VsRow = {
  productId: string;
  sku: string;
  name: string;
  packSize: string;
  category: string;
  companyId: string;
  /** forecast quantity for the compared months */
  forecastQty: number;
  /** actual sales converted to forecast-equivalent PCS */
  equivalent: number;
  packs: VsPack[];
};

/** Compare forecast quantities with actual invoiced sales, converting every sale
    to the forecast's unit first. A sale of the exact forecasted product counts 1:1;
    a liquid sold in another pack size converts by (pack ml ÷ 1,000) into the same
    product line's 1,000-ml forecast row. Raw invoice quantities are never changed —
    the conversion exists only inside this comparison. */
export async function getSalesVsForecast(opts: {
  year: number;
  forecastIds: string[];
  companyIds: string[];
  /** customer provinces to count sales from; null = all customers */
  provinces: string[] | null;
  /** compare January through this month (1-12) */
  throughMonth: number;
}) {
  const { year, forecastIds, companyIds, provinces, throughMonth } = opts;
  const forecasts = await prisma.forecast.findMany({
    where: { id: { in: forecastIds } },
    include: { lines: { include: { product: true } } },
  });

  const rows = new Map<string, VsRow>();
  // liquids: product line name -> the 1,000-ml forecast row other pack sizes convert into
  const mlBaseByParent = new Map<string, string>();
  for (const f of forecasts) {
    for (const l of f.lines) {
      const p = l.product;
      if (!companyIds.includes(p.companyId)) continue;
      const months = [l.m1, l.m2, l.m3, l.m4, l.m5, l.m6, l.m7, l.m8, l.m9, l.m10, l.m11, l.m12];
      const qty = months.slice(0, throughMonth).reduce((a, b) => a + b, 0);
      let row = rows.get(l.productId);
      if (!row) {
        row = {
          productId: l.productId, sku: p.sku, name: p.name, packSize: p.packSize,
          category: p.category, companyId: p.companyId, forecastQty: 0, equivalent: 0, packs: [],
        };
        rows.set(l.productId, row);
      }
      row.forecastQty += qty; // combined view may hold the same product from several areas
      if (isForecastBasePack(p.packSize)) {
        mlBaseByParent.set(p.parentItem?.trim() || p.name, l.productId);
      }
    }
  }

  const from = new Date(year, 0, 1);
  const to = new Date(year, throughMonth, 0, 23, 59, 59, 999); // last day of the compared month
  const srs = await prisma.salesReceipt.findMany({
    where: {
      companyId: { in: companyIds },
      status: { not: "Void" },
      invoiceDate: { gte: from, lte: to },
      ...(provinces ? { customer: { province: { in: provinces } } } : {}),
    },
    include: { deliveryReceipt: { include: { lines: { include: { product: true } } } } },
  });

  // sales of products the forecast doesn't cover — shown separately, never guessed into a row
  const unmatched = new Map<string, VsPack>();
  for (const sr of srs) {
    for (const l of sr.deliveryReceipt.lines) {
      const qty = l.baseQty; // pieces, exactly as invoiced
      if (!qty) continue;
      const p = l.product;
      let targetId: string | null = rows.has(p.id) ? p.id : null;
      let factor = 1;
      if (!targetId) {
        const ml = packSizeToMl(p.packSize);
        const baseId = ml !== null ? mlBaseByParent.get(p.parentItem?.trim() || p.name) : undefined;
        if (ml !== null && baseId) {
          targetId = baseId;
          factor = ml / 1000;
        }
      }
      if (targetId) {
        const row = rows.get(targetId)!;
        const eq = qty * factor;
        row.equivalent = round2(row.equivalent + eq);
        let pk = row.packs.find((x) => x.productId === p.id);
        if (!pk) {
          pk = { productId: p.id, name: p.name, packSize: p.packSize, qty: 0, factor, equivalent: 0 };
          row.packs.push(pk);
        }
        pk.qty += qty;
        pk.equivalent = round2(pk.equivalent + eq);
      } else {
        let pk = unmatched.get(p.id);
        if (!pk) {
          pk = { productId: p.id, name: p.name, packSize: p.packSize, qty: 0, factor: null, equivalent: 0 };
          unmatched.set(p.id, pk);
        }
        pk.qty += qty;
      }
    }
  }

  const CATEGORY_ORDER = (
    await prisma.productCategory.findMany({ orderBy: { sortOrder: "asc" }, select: { name: true } })
  ).map((c) => c.name);
  const sorted = [...rows.values()].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name)
  );
  for (const r of sorted) r.packs.sort((a, b) => (b.factor ?? 0) - (a.factor ?? 0));

  return {
    rows: sorted,
    unmatched: [...unmatched.values()].sort((a, b) => b.qty - a.qty),
    invoiceCount: srs.length,
  };
}
