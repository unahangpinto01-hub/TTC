/**
 * Executive dashboard — the shared calculation services.
 *
 * Every figure on the dashboard comes from here, and every one is aggregated in the
 * database or in a single pass over the rows for the period; nothing loads a whole table
 * into the page to add it up. Reports and dashboards call the same functions, so a number
 * cannot mean one thing on the Sales Report and another on the dashboard.
 *
 * Definitions, fixed in one place so they stay consistent:
 *   Gross Sales   invoiced total, freight included — matches the Sales Journal
 *   Net Sales     goods only, freight removed; this is what COGS is measured against
 *   COGS          the cost captured on each delivery line at the time it was delivered
 *   Gross Profit  Net Sales − COGS
 *
 * Only posted, non-void documents count. A draft or voided invoice is not business.
 */

import { prisma } from "./db";
import { packSizeToMl, isForecastBasePack, provincesForArea } from "./forecast-units";
import { displayCartonSize, lineCartonSize } from "./units";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type ExecFilters = {
  from: Date;
  to: Date;
  companyIds: string[];
  /** an Employee id — narrows to the customers that salesperson owns */
  salespersonId?: string;
  customerId?: string;
  /** a forecast area name; resolved to customer provinces */
  area?: string;
  category?: string;
};

/** The customer-side WHERE shared by every sales query, so all metrics narrow identically. */
function customerWhere(f: ExecFilters) {
  const w: Record<string, unknown> = {};
  if (f.customerId) w.id = f.customerId;
  if (f.salespersonId) w.salespersonId = f.salespersonId;
  if (f.area) {
    const provinces = provincesForArea(f.area);
    if (provinces) w.province = { in: provinces };
  }
  return Object.keys(w).length ? w : undefined;
}

/** The previous window of the same length, for every "vs previous period" comparison. */
export function previousPeriod(f: ExecFilters): { from: Date; to: Date } {
  const span = f.to.getTime() - f.from.getTime();
  return { from: new Date(f.from.getTime() - span - 1), to: new Date(f.from.getTime() - 1) };
}

/** Growth as a percentage, or null when there is no prior figure to grow from. */
export function growthPct(now: number, before: number): number | null {
  if (!before) return null;
  return round2(((now - before) / Math.abs(before)) * 100);
}

export type SalesMetrics = {
  grossSales: number;
  freight: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  marginPct: number | null;
  invoices: number;
  orders: number;
  avgOrderValue: number | null;
  qtyPcs: number;
  qtyCtn: number;
  customers: number;
};

/**
 * Sales, cost and profit for the period.
 *
 * A category filter narrows the LINES, so value and cost follow the chosen category while
 * the invoice count stays whole — an invoice is not a fraction of itself.
 */
export async function getSalesMetrics(f: ExecFilters): Promise<SalesMetrics> {
  const cw = customerWhere(f);
  const srs = await prisma.salesReceipt.findMany({
    where: {
      companyId: { in: f.companyIds },
      status: { not: "Void" },
      invoiceDate: { gte: f.from, lte: f.to },
      ...(cw ? { customer: cw } : {}),
    },
    select: {
      id: true,
      amount: true,
      freightCharge: true,
      customerId: true,
      deliveryReceipt: {
        select: {
          lines: {
            select: {
              qty: true, unit: true, baseQty: true, unitPrice: true, unitCostAtSale: true,
              product: { select: { category: true, unitCost: true, piecesPerCarton: true } },
            },
          },
        },
      },
    },
  });

  let grossSales = 0, freight = 0, goods = 0, cogs = 0, qtyPcs = 0, qtyCtn = 0;
  const customers = new Set<string>();
  for (const sr of srs) {
    const lines = f.category
      ? sr.deliveryReceipt.lines.filter((l) => l.product.category === f.category)
      : sr.deliveryReceipt.lines;
    if (f.category && !lines.length) continue; // this invoice sold nothing in the category
    customers.add(sr.customerId);

    const lineGoods = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    goods += lineGoods;
    // with a category filter the invoice total is not the right gross — use the lines
    grossSales += f.category ? lineGoods : sr.amount;
    if (!f.category) freight += sr.freightCharge;

    for (const l of lines) {
      // the cost captured at delivery, so changing a product's cost today never
      // rewrites the margin on a sale that already happened
      cogs += l.baseQty * (l.unitCostAtSale > 0 ? l.unitCostAtSale : l.product.unitCost);
      qtyPcs += l.baseQty;
      const ppc = lineCartonSize(l, l.product);
      if (ppc) qtyCtn += l.baseQty / ppc;
    }
  }

  const invoices = f.category
    ? srs.filter((sr) => sr.deliveryReceipt.lines.some((l) => l.product.category === f.category)).length
    : srs.length;
  const netSales = round2(goods);
  const orders = await prisma.salesOrder.count({
    where: {
      companyId: { in: f.companyIds },
      status: { not: "Cancelled" },
      orderDate: { gte: f.from, lte: f.to },
      ...(cw ? { customer: cw } : {}),
    },
  });

  return {
    grossSales: round2(grossSales),
    freight: round2(freight),
    netSales,
    cogs: round2(cogs),
    grossProfit: round2(netSales - cogs),
    marginPct: netSales ? round2(((netSales - cogs) / netSales) * 100) : null,
    invoices,
    orders,
    avgOrderValue: invoices ? round2(grossSales / invoices) : null,
    qtyPcs,
    qtyCtn: round2(qtyCtn),
    customers: customers.size,
  };
}

export type ArMetrics = {
  total: number;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  overdue: number;
};

/** Receivables outstanding as at the end of the period, in the usual ageing buckets. */
export async function getArMetrics(f: ExecFilters): Promise<ArMetrics> {
  const cw = customerWhere(f);
  const srs = await prisma.salesReceipt.findMany({
    where: {
      companyId: { in: f.companyIds },
      status: { not: "Void" },
      invoiceDate: { lte: f.to },
      ...(cw ? { customer: cw } : {}),
    },
    select: { amount: true, dueDate: true, payments: { select: { amount: true, date: true } } },
  });
  const b = { total: 0, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, overdue: 0 };
  for (const sr of srs) {
    // only payments received by the as-of date count against the balance
    const paid = sr.payments.filter((p) => p.date <= f.to).reduce((s, p) => s + p.amount, 0);
    const bal = round2(sr.amount - paid);
    if (bal <= 0) continue;
    const days = Math.floor((f.to.getTime() - sr.dueDate.getTime()) / 86400000);
    b.total = round2(b.total + bal);
    if (days <= 0) b.current = round2(b.current + bal);
    else {
      b.overdue = round2(b.overdue + bal);
      if (days <= 30) b.d1_30 = round2(b.d1_30 + bal);
      else if (days <= 60) b.d31_60 = round2(b.d31_60 + bal);
      else if (days <= 90) b.d61_90 = round2(b.d61_90 + bal);
      else b.d90plus = round2(b.d90plus + bal);
    }
  }
  return b;
}

export type CollectionMetrics = { collected: number; count: number; rate: number | null };

/** Cash actually received in the period, and what share of the period's sales that is. */
export async function getCollectionMetrics(f: ExecFilters, invoiced: number): Promise<CollectionMetrics> {
  const cw = customerWhere(f);
  const rows = await prisma.payment.findMany({
    where: {
      date: { gte: f.from, lte: f.to },
      salesReceipt: {
        companyId: { in: f.companyIds },
        status: { not: "Void" },
        ...(cw ? { customer: cw } : {}),
      },
    },
    select: { amount: true },
  });
  const collected = round2(rows.reduce((s, p) => s + p.amount, 0));
  return { collected, count: rows.length, rate: invoiced ? round2((collected / invoiced) * 100) : null };
}

export type InventoryMetrics = {
  value: number;
  pcs: number;
  ctn: number;
  skus: number;
  turnover: number | null;
  noConversion: number;
};

/**
 * Inventory at weighted average cost — the cost the Receive Inventory module maintains.
 *
 * Turnover is COGS ÷ closing inventory value. The system keeps one current cost per
 * product rather than a cost history, so a true average-inventory turnover is not
 * available; this is the closing-balance approximation and is labelled as such.
 */
export async function getInventoryMetrics(f: ExecFilters, cogs: number): Promise<InventoryMetrics> {
  const products = await prisma.product.findMany({
    where: {
      companyId: { in: f.companyIds },
      itemClass: "INVENTORY",
      ...(f.category ? { category: f.category } : {}),
    },
    select: { stockQty: true, unitCost: true, piecesPerCarton: true },
  });
  let value = 0, pcs = 0, ctn = 0, noConversion = 0;
  for (const p of products) {
    value += p.stockQty * p.unitCost;
    pcs += p.stockQty;
    const ppc = displayCartonSize(p);
    if (ppc) ctn += p.stockQty / ppc;
    else noConversion++;
  }
  value = round2(value);
  return { value, pcs, ctn: round2(ctn), skus: products.length, turnover: value ? round2(cogs / value) : null, noConversion };
}

export type MonthPoint = {
  month: string;
  netSales: number;
  grossProfit: number;
  cogs: number;
  invoices: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Twelve months of net sales and gross profit for one calendar year, in one pass. */
export async function getMonthlyTrend(year: number, f: ExecFilters): Promise<MonthPoint[]> {
  const cw = customerWhere(f);
  const srs = await prisma.salesReceipt.findMany({
    where: {
      companyId: { in: f.companyIds },
      status: { not: "Void" },
      invoiceDate: { gte: new Date(year, 0, 1), lte: new Date(year, 11, 31, 23, 59, 59, 999) },
      ...(cw ? { customer: cw } : {}),
    },
    select: {
      invoiceDate: true,
      deliveryReceipt: {
        select: {
          lines: {
            select: {
              qty: true, baseQty: true, unitPrice: true, unitCostAtSale: true,
              product: { select: { category: true, unitCost: true } },
            },
          },
        },
      },
    },
  });
  const out: MonthPoint[] = MONTHS.map((m) => ({ month: m, netSales: 0, grossProfit: 0, cogs: 0, invoices: 0 }));
  for (const sr of srs) {
    const lines = f.category
      ? sr.deliveryReceipt.lines.filter((l) => l.product.category === f.category)
      : sr.deliveryReceipt.lines;
    if (!lines.length) continue;
    const i = sr.invoiceDate.getMonth();
    const goods = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const cost = lines.reduce((s, l) => s + l.baseQty * (l.unitCostAtSale > 0 ? l.unitCostAtSale : l.product.unitCost), 0);
    out[i].netSales = round2(out[i].netSales + goods);
    out[i].cogs = round2(out[i].cogs + cost);
    out[i].grossProfit = round2(out[i].netSales - out[i].cogs);
    out[i].invoices += 1;
  }
  return out;
}

export type ForecastRow = {
  key: string;
  salesperson: string;
  area: string;
  forecastQty: number;
  actualQty: number;
  forecastValue: number;
  actualValue: number;
  variance: number;
  achievementPct: number | null;
};

/**
 * Forecast against actual sales, per salesperson.
 *
 * Quantities are normalised through the 1,000-ml equivalent before comparing: a forecast
 * written on the 1-litre pack is met by 500ml bottles at half a piece each, so a sale in a
 * different pack size still counts toward the plan it belongs to. Invoiced quantities are
 * never altered — the conversion exists only inside this comparison.
 *
 * The salesperson on a forecast line is the one it was planned under, which is a stored
 * snapshot. Actual sales carry no salesperson of their own, so they are attributed through
 * the customer's CURRENT owner — reassigning an account moves its past sales with it.
 */
export async function getForecastVsActual(f: ExecFilters, year: number, throughMonth: number) {
  const lines = await prisma.forecastLine.findMany({
    where: {
      forecast: { year },
      product: { companyId: { in: f.companyIds }, ...(f.category ? { category: f.category } : {}) },
      ...(f.salespersonId ? { OR: [{ salespersonId: f.salespersonId }, { customer: { salespersonId: f.salespersonId } }] } : {}),
      ...(f.customerId ? { customerId: f.customerId } : {}),
    },
    include: {
      product: { select: { id: true, name: true, parentItem: true, packSize: true, srp: true } },
      forecast: { select: { area: true } },
      salesperson: { select: { id: true, name: true } },
      customer: { select: { salespersonId: true, salesperson: { select: { id: true, name: true } } } },
    },
  });

  const NONE = "— Unassigned —";
  const rows = new Map<string, ForecastRow>();
  // a liquid line forecast on the 1,000-ml pack claims the other pack sizes of its product line
  const baseOwner = new Map<string, string>(); // product line -> row key
  const productToRow = new Map<string, string>(); // exact product -> row key

  for (const l of lines) {
    if (f.area && !new RegExp(f.area.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(l.forecast.area)) continue;
    const sp = l.salesperson ?? l.customer?.salesperson ?? null;
    const key = sp?.id ?? "none";
    const months = [l.m1, l.m2, l.m3, l.m4, l.m5, l.m6, l.m7, l.m8, l.m9, l.m10, l.m11, l.m12];
    const qty = months.slice(0, throughMonth).reduce((a, b) => a + b, 0);
    const price = l.unitPrice ?? l.product.srp;

    let row = rows.get(key);
    if (!row) {
      row = {
        key, salesperson: sp?.name ?? NONE, area: l.forecast.area,
        forecastQty: 0, actualQty: 0, forecastValue: 0, actualValue: 0, variance: 0, achievementPct: null,
      };
      rows.set(key, row);
    } else if (!row.area.includes(l.forecast.area)) {
      row.area = `${row.area}, ${l.forecast.area}`;
    }
    row.forecastQty += qty;
    row.forecastValue = round2(row.forecastValue + qty * price);

    productToRow.set(l.productId, key);
    if (isForecastBasePack(l.product.packSize)) baseOwner.set(l.product.parentItem?.trim() || l.product.name, key);
  }

  // actual sales for the same window, attributed through the customer's current owner
  const from = new Date(year, 0, 1);
  const to = new Date(year, throughMonth, 0, 23, 59, 59, 999);
  const cw = customerWhere(f);
  const srs = await prisma.salesReceipt.findMany({
    where: {
      companyId: { in: f.companyIds },
      status: { not: "Void" },
      invoiceDate: { gte: from, lte: to },
      ...(cw ? { customer: cw } : {}),
    },
    select: {
      customer: { select: { salespersonId: true, salesperson: { select: { id: true, name: true } } } },
      deliveryReceipt: {
        select: {
          lines: {
            select: {
              qty: true, baseQty: true, unitPrice: true,
              product: { select: { id: true, name: true, parentItem: true, packSize: true, category: true } },
            },
          },
        },
      },
    },
  });

  let unmatchedValue = 0;
  for (const sr of srs) {
    const owner = sr.customer.salesperson;
    const key = owner?.id ?? "none";
    for (const l of sr.deliveryReceipt.lines) {
      if (f.category && l.product.category !== f.category) continue;
      const value = round2(l.qty * l.unitPrice);
      // which forecast row does this sale belong to? the exact product, else the
      // 1,000-ml row of the same product line, converted
      let factor = 1;
      let target = productToRow.has(l.product.id) ? key : null;
      if (!target) {
        const ml = packSizeToMl(l.product.packSize);
        const owns = ml !== null ? baseOwner.get(l.product.parentItem?.trim() || l.product.name) : undefined;
        if (ml !== null && owns) { target = key; factor = ml / 1000; }
      }
      let row = rows.get(key);
      if (!row) {
        // a salesperson with sales but no forecast still has to appear, or the total lies
        row = {
          key, salesperson: owner?.name ?? NONE, area: "—",
          forecastQty: 0, actualQty: 0, forecastValue: 0, actualValue: 0, variance: 0, achievementPct: null,
        };
        rows.set(key, row);
      }
      if (target) row.actualQty = round2(row.actualQty + l.baseQty * factor);
      else unmatchedValue = round2(unmatchedValue + value);
      row.actualValue = round2(row.actualValue + value);
    }
  }

  const out = [...rows.values()].map((r) => ({
    ...r,
    variance: round2(r.actualValue - r.forecastValue),
    achievementPct: r.forecastValue ? round2((r.actualValue / r.forecastValue) * 100) : null,
  }));
  out.sort((a, b) => (b.achievementPct ?? -1) - (a.achievementPct ?? -1));

  const totals = out.reduce(
    (t, r) => ({
      forecastQty: round2(t.forecastQty + r.forecastQty),
      actualQty: round2(t.actualQty + r.actualQty),
      forecastValue: round2(t.forecastValue + r.forecastValue),
      actualValue: round2(t.actualValue + r.actualValue),
    }),
    { forecastQty: 0, actualQty: 0, forecastValue: 0, actualValue: 0 }
  );
  const ranked = out.filter((r) => r.forecastValue > 0);
  return {
    rows: out,
    totals: {
      ...totals,
      variance: round2(totals.actualValue - totals.forecastValue),
      achievementPct: totals.forecastValue ? round2((totals.actualValue / totals.forecastValue) * 100) : null,
    },
    best: ranked[0] ?? null,
    worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    unmatchedValue,
  };
}

export type CompanyRow = {
  companyId: string;
  company: string;
  netSales: number;
  grossProfit: number;
  marginPct: number | null;
  customers: number;
  collections: number;
  ar: number;
  inventory: number;
  forecastValue: number;
};

/**
 * The same measures for each company and for the two combined.
 *
 * Each company's figures are read from its own transactions and only then added together,
 * so nothing is double counted and a shared customer is counted once per company it
 * actually bought from.
 */
export async function getCompanyComparison(f: ExecFilters, year: number, throughMonth: number): Promise<CompanyRow[]> {
  const companies = await prisma.company.findMany({
    where: { id: { in: f.companyIds } },
    select: { id: true, companyName: true, isPrimary: true },
    orderBy: { isPrimary: "desc" },
  });

  const rows: CompanyRow[] = [];
  for (const c of companies) {
    const one: ExecFilters = { ...f, companyIds: [c.id] };
    const [sales, ar, inv, fc] = await Promise.all([
      getSalesMetrics(one),
      getArMetrics(one),
      getInventoryMetrics(one, 0),
      getForecastVsActual(one, year, throughMonth),
    ]);
    const col = await getCollectionMetrics(one, sales.grossSales);
    rows.push({
      companyId: c.id,
      company: c.companyName,
      netSales: sales.netSales,
      grossProfit: sales.grossProfit,
      marginPct: sales.marginPct,
      customers: sales.customers,
      collections: col.collected,
      ar: ar.total,
      inventory: inv.value,
      forecastValue: fc.totals.forecastValue,
    });
  }
  return rows;
}
