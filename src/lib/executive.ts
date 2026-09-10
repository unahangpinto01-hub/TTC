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
import { componentsOf, emptyComponents, addComponents, type SalesComponents } from "./sales-components";

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

/** The same calendar day one year earlier, clamped so 29 Feb lands on 28 Feb. */
function sameDayLastYear(d: Date): Date {
  const year = d.getFullYear() - 1;
  const month = d.getMonth();
  const lastOfMonth = new Date(year, month + 1, 0).getDate();
  return new Date(
    year, month, Math.min(d.getDate(), lastOfMonth),
    d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()
  );
}

/**
 * The period every "vs" figure is measured against: the SAME window one year earlier.
 *
 * Taking the immediately preceding window of equal length instead reads badly for the view
 * people actually open — a year to date of 1 January to 9 September would be compared with
 * 24 April to 31 December of the year before, a stretch that straddles two years and lines
 * up with nothing. Against September last year, the number means something.
 */
export function previousPeriod(f: ExecFilters): { from: Date; to: Date } {
  return { from: sameDayLastYear(f.from), to: sameDayLastYear(f.to) };
}

/** Growth as a percentage, or null when there is no prior figure to grow from. */
export function growthPct(now: number, before: number): number | null {
  if (!before) return null;
  return round2(((now - before) / Math.abs(before)) * 100);
}

export type SalesMetrics = {
  /** TOTAL CUSTOMER BILLING — product sales + freight + other charges */
  grossSales: number;
  freight: number;
  otherCharges: number;
  /** the full billing breakdown, from the one service that defines it */
  components: SalesComponents;
  /** NET PRODUCT SALES — product lines less posted credit memos. The primary sales figure. */
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
      otherCharges: true,
      customerId: true,
      refundCredits: { select: { amount: true, status: true, type: true } },
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

  let goods = 0, cogs = 0, qtyPcs = 0, qtyCtn = 0;
  // freight and other charges are billed to the customer but are NOT product revenue —
  // they are totalled here and never added into the product figures below
  const components = emptyComponents();
  const customers = new Set<string>();
  for (const sr of srs) {
    const lines = f.category
      ? sr.deliveryReceipt.lines.filter((l) => l.product.category === f.category)
      : sr.deliveryReceipt.lines;
    if (f.category && !lines.length) continue; // this invoice sold nothing in the category
    customers.add(sr.customerId);

    const lineGoods = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    goods += lineGoods;
    if (f.category) {
      // narrowed to one category, so only the matching product lines count and the
      // invoice-level charges are left out of the picture entirely
      components.productSales = round2(components.productSales + lineGoods);
      components.netProductSales = round2(components.netProductSales + lineGoods);
      components.totalBilling = round2(components.totalBilling + lineGoods);
    } else {
      addComponents(components, sr);
    }

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
  // net product sales: the lines, less any credit memo posted against those invoices
  const netSales = round2(goods - components.returns);
  const orders = await prisma.salesOrder.count({
    where: {
      companyId: { in: f.companyIds },
      status: { not: "Cancelled" },
      orderDate: { gte: f.from, lte: f.to },
      ...(cw ? { customer: cw } : {}),
    },
  });

  return {
    grossSales: components.totalBilling,
    freight: components.freight,
    otherCharges: components.otherCharges,
    components,
    netSales,
    cogs: round2(cogs),
    grossProfit: round2(netSales - cogs),
    marginPct: netSales ? round2(((netSales - cogs) / netSales) * 100) : null,
    invoices,
    orders,
    avgOrderValue: invoices ? round2(components.totalBilling / invoices) : null,
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
export async function getForecastVsActual(f: ExecFilters, year: number, fromMonth: number, throughMonth: number) {
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
    // only the months the chosen period actually covers — picking August alone must not
    // compare August's plan against the whole year to date
    const qty = months.slice(fromMonth - 1, throughMonth).reduce((a, b) => a + b, 0);
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
  const from = new Date(year, fromMonth - 1, 1);
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
export async function getCompanyComparison(f: ExecFilters, year: number, fromMonth: number, throughMonth: number): Promise<CompanyRow[]> {
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
      getForecastVsActual(one, year, fromMonth, throughMonth),
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

/* ==========================================================================
 * Phase 2 — customers, products, inventory, purchasing, credits and alerts.
 * Same rules as above: posted documents only, one pass per dataset, and every
 * figure derived from the same definitions the KPI row uses.
 * ========================================================================== */

const pesoText = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Every invoice in scope, resolved once so the breakdowns below share one read. */
async function salesLines(f: ExecFilters) {
  const cw = customerWhere(f);
  return prisma.salesReceipt.findMany({
    where: {
      companyId: { in: f.companyIds },
      status: { not: "Void" },
      invoiceDate: { gte: f.from, lte: f.to },
      ...(cw ? { customer: cw } : {}),
    },
    select: {
      id: true, srNumber: true, invoiceDate: true, companyId: true, amount: true,
      company: { select: { companyName: true } },
      customer: {
        select: { id: true, businessName: true, province: true, region: true, salesperson: { select: { id: true, name: true } } },
      },
      deliveryReceipt: {
        select: {
          lines: {
            select: {
              qty: true, unit: true, baseQty: true, unitPrice: true, unitCostAtSale: true,
              product: { select: { id: true, sku: true, name: true, category: true, packSize: true, unitCost: true, piecesPerCarton: true } },
            },
          },
        },
      },
    },
  });
}

export type Measured = { amount: number; qtyPcs: number; qtyCtn: number; cogs: number; grossProfit: number };
const emptyMeasure = (): Measured => ({ amount: 0, qtyPcs: 0, qtyCtn: 0, cogs: 0, grossProfit: 0 });

export type BreakdownRow = Measured & { key: string; label: string; sub?: string; marginPct: number | null };
export type BreakdownDim = "product" | "customer" | "salesperson" | "area" | "company" | "category";

/**
 * Sales cut by one dimension, carrying all four measures at once so the screen can switch
 * between Amount, Quantity, Equivalent CTN and Gross Profit without another query.
 *
 * "Area" uses the customer's province, which is what the forecast areas are mapped from.
 */
export async function getSalesBreakdown(f: ExecFilters, dim: BreakdownDim): Promise<BreakdownRow[]> {
  const srs = await salesLines(f);
  const map = new Map<string, BreakdownRow>();
  for (const sr of srs) {
    for (const l of sr.deliveryReceipt.lines) {
      if (f.category && l.product.category !== f.category) continue;
      const spec: [string, string, string | undefined] =
        dim === "product" ? [l.product.id, l.product.name, l.product.sku]
        : dim === "customer" ? [sr.customer.id, sr.customer.businessName, sr.customer.salesperson?.name ?? "— Unassigned —"]
        : dim === "salesperson" ? [sr.customer.salesperson?.id ?? "none", sr.customer.salesperson?.name ?? "— Unassigned —", undefined]
        : dim === "area" ? [sr.customer.province || "none", sr.customer.province || "— No province —", sr.customer.region]
        : dim === "company" ? [sr.companyId, sr.company.companyName, undefined]
        : [l.product.category, l.product.category, undefined];
      const [key, label, sub] = spec;

      let row = map.get(key);
      if (!row) {
        row = { key, label, sub, marginPct: null, ...emptyMeasure() };
        map.set(key, row);
      }
      row.amount = round2(row.amount + l.qty * l.unitPrice);
      row.cogs = round2(row.cogs + l.baseQty * (l.unitCostAtSale > 0 ? l.unitCostAtSale : l.product.unitCost));
      row.grossProfit = round2(row.amount - row.cogs);
      row.qtyPcs += l.baseQty;
      const ppc = lineCartonSize(l, l.product);
      if (ppc) row.qtyCtn = round2(row.qtyCtn + l.baseQty / ppc);
    }
  }
  return [...map.values()]
    .map((r) => ({ ...r, marginPct: r.amount ? round2((r.grossProfit / r.amount) * 100) : null }))
    .sort((a, b) => b.amount - a.amount);
}

export type CustomerRow = BreakdownRow & {
  salesperson: string;
  outstanding: number;
  lastSale: Date | null;
  invoices: number;
  isNew: boolean;
};

/**
 * Customer performance: what each account bought, what it earned, and what it still owes.
 *
 * "New" means the account's first ever invoice falls inside the period. Accounts that
 * bought nothing are returned too, with zeroes, so a customer going quiet is visible
 * rather than simply absent from the list.
 */
export async function getCustomerPerformance(f: ExecFilters): Promise<CustomerRow[]> {
  const [srs, firstEver, balances, customers] = await Promise.all([
    salesLines(f),
    prisma.salesReceipt.groupBy({
      by: ["customerId"],
      where: { companyId: { in: f.companyIds }, status: { not: "Void" } },
      _min: { invoiceDate: true },
    }),
    prisma.salesReceipt.findMany({
      where: { companyId: { in: f.companyIds }, status: { not: "Void" }, invoiceDate: { lte: f.to } },
      select: { customerId: true, amount: true, payments: { select: { amount: true, date: true } } },
    }),
    prisma.customer.findMany({
      where: {
        ...(f.customerId ? { id: f.customerId } : {}),
        ...(f.salespersonId ? { salespersonId: f.salespersonId } : {}),
      },
      select: { id: true, businessName: true, salesperson: { select: { name: true } } },
    }),
  ]);

  const firstBy = new Map(firstEver.map((x) => [x.customerId, x._min.invoiceDate]));
  const owed = new Map<string, number>();
  for (const sr of balances) {
    const paid = sr.payments.filter((p) => p.date <= f.to).reduce((s, p) => s + p.amount, 0);
    const bal = sr.amount - paid;
    if (bal > 0) owed.set(sr.customerId, round2((owed.get(sr.customerId) ?? 0) + bal));
  }

  const map = new Map<string, CustomerRow>();
  const ensure = (id: string, name: string, sp: string) => {
    let r = map.get(id);
    if (!r) {
      const first = firstBy.get(id) ?? null;
      r = {
        key: id, label: name, sub: sp, salesperson: sp, marginPct: null,
        outstanding: owed.get(id) ?? 0, lastSale: null, invoices: 0,
        isNew: !!first && first >= f.from && first <= f.to,
        ...emptyMeasure(),
      };
      map.set(id, r);
    }
    return r;
  };

  for (const sr of srs) {
    const lines = f.category ? sr.deliveryReceipt.lines.filter((l) => l.product.category === f.category) : sr.deliveryReceipt.lines;
    if (!lines.length) continue;
    const r = ensure(sr.customer.id, sr.customer.businessName, sr.customer.salesperson?.name ?? "— Unassigned —");
    r.invoices += 1;
    if (!r.lastSale || sr.invoiceDate > r.lastSale) r.lastSale = sr.invoiceDate;
    for (const l of lines) {
      r.amount = round2(r.amount + l.qty * l.unitPrice);
      r.cogs = round2(r.cogs + l.baseQty * (l.unitCostAtSale > 0 ? l.unitCostAtSale : l.product.unitCost));
      r.grossProfit = round2(r.amount - r.cogs);
      r.qtyPcs += l.baseQty;
      const ppc = lineCartonSize(l, l.product);
      if (ppc) r.qtyCtn = round2(r.qtyCtn + l.baseQty / ppc);
    }
  }
  for (const c of customers) ensure(c.id, c.businessName, c.salesperson?.name ?? "— Unassigned —");

  return [...map.values()]
    .map((r) => ({ ...r, marginPct: r.amount ? round2((r.grossProfit / r.amount) * 100) : null }))
    .sort((a, b) => b.amount - a.amount);
}

export type ProductRow = BreakdownRow & {
  sku: string;
  packSize: string;
  category: string;
  unitCost: number;
  avgPrice: number | null;
};

/** Product profitability — quantity, cartons, cost, achieved price and margin. */
export async function getProductPerformance(f: ExecFilters): Promise<ProductRow[]> {
  const srs = await salesLines(f);
  const map = new Map<string, ProductRow>();
  for (const sr of srs) {
    for (const l of sr.deliveryReceipt.lines) {
      if (f.category && l.product.category !== f.category) continue;
      const p = l.product;
      let r = map.get(p.id);
      if (!r) {
        r = {
          key: p.id, label: p.name, sub: p.sku, sku: p.sku, packSize: p.packSize, category: p.category,
          unitCost: p.unitCost, avgPrice: null, marginPct: null, ...emptyMeasure(),
        };
        map.set(p.id, r);
      }
      r.amount = round2(r.amount + l.qty * l.unitPrice);
      // the cost captured at delivery — changing a cost or price today never rewrites this
      r.cogs = round2(r.cogs + l.baseQty * (l.unitCostAtSale > 0 ? l.unitCostAtSale : p.unitCost));
      r.grossProfit = round2(r.amount - r.cogs);
      r.qtyPcs += l.baseQty;
      const ppc = lineCartonSize(l, p);
      if (ppc) r.qtyCtn = round2(r.qtyCtn + l.baseQty / ppc);
    }
  }
  return [...map.values()]
    .map((r) => ({
      ...r,
      marginPct: r.amount ? round2((r.grossProfit / r.amount) * 100) : null,
      avgPrice: r.qtyPcs ? round2(r.amount / r.qtyPcs) : null,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export type StockRow = {
  id: string;
  sku: string;
  name: string;
  category: string;
  company: string;
  stockPcs: number;
  stockCtn: number | null;
  unitCost: number;
  value: number;
  reorderPoint: number;
  soldPcs: number;
  monthsCover: number | null;
  movement: "Fast" | "Normal" | "Slow" | "None";
  lowStock: boolean;
  stockout: boolean;
  lastMovement: Date | null;
  ageDays: number | null;
};

/**
 * Inventory performance at weighted average cost.
 *
 * Movement is judged on how long the stock on hand would last at the period's own selling
 * rate — under two months is Fast, over six is Slow, nothing sold at all is No Movement.
 * Ageing is days since the last stock movement of any kind.
 */
export async function getInventoryPerformance(f: ExecFilters): Promise<StockRow[]> {
  const months = Math.max(1, (f.to.getTime() - f.from.getTime()) / (30 * 86400000));
  const [products, sold, lastMoves] = await Promise.all([
    prisma.product.findMany({
      where: { companyId: { in: f.companyIds }, itemClass: "INVENTORY", ...(f.category ? { category: f.category } : {}) },
      select: {
        id: true, sku: true, name: true, category: true, stockQty: true, unitCost: true,
        reorderPoint: true, piecesPerCarton: true, company: { select: { companyName: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.dRLine.groupBy({
      by: ["productId"],
      where: {
        deliveryReceipt: {
          companyId: { in: f.companyIds },
          status: { not: "Cancelled" },
          deliveredAt: { gte: f.from, lte: f.to },
        },
      },
      _sum: { baseQty: true },
    }),
    prisma.stockMovement.groupBy({
      by: ["productId"],
      where: { product: { companyId: { in: f.companyIds } } },
      _max: { date: true },
    }),
  ]);

  const soldBy = new Map(sold.map((x) => [x.productId, x._sum.baseQty ?? 0]));
  const lastBy = new Map(lastMoves.map((x) => [x.productId, x._max.date]));
  // stockQty is the CURRENT balance, so ageing is measured to today — a report run with a
  // future end date must not make every product look months more stale than it is
  const now = Math.min(f.to.getTime(), Date.now());

  return products.map((p) => {
    const ppc = displayCartonSize(p);
    const soldPcs = soldBy.get(p.id) ?? 0;
    const perMonth = soldPcs / months;
    const monthsCover = perMonth > 0 ? round2(p.stockQty / perMonth) : null;
    const last = lastBy.get(p.id) ?? null;
    return {
      id: p.id, sku: p.sku, name: p.name, category: p.category, company: p.company.companyName,
      stockPcs: p.stockQty,
      stockCtn: ppc ? round2(p.stockQty / ppc) : null,
      unitCost: p.unitCost,
      value: round2(p.stockQty * p.unitCost),
      reorderPoint: p.reorderPoint,
      soldPcs,
      monthsCover,
      movement: soldPcs === 0 ? "None" : monthsCover === null ? "Normal" : monthsCover < 2 ? "Fast" : monthsCover > 6 ? "Slow" : "Normal",
      lowStock: p.stockQty > 0 && p.stockQty <= p.reorderPoint,
      // running out within the month at the rate it has been selling
      stockout: p.stockQty <= 0 || (perMonth > 0 && p.stockQty / perMonth < 1),
      lastMovement: last,
      ageDays: last ? Math.floor((now - last.getTime()) / 86400000) : null,
    } as StockRow;
  });
}

export type PurchasingMetrics = {
  totalOrdered: number;
  totalReceived: number;
  outstandingValue: number;
  openOrders: number;
  bySupplier: { id: string; name: string; ordered: number; received: number; orders: number }[];
  byCompany: { company: string; ordered: number; received: number }[];
};

/**
 * Purchasing, from the purchase orders and goods received notes.
 *
 * Nothing here is a payable. There is no supplier bill in the system, and what a supplier
 * is owed cannot be derived from a receipt alone — the payables figures stay blank until an
 * Enter Bills module exists.
 */
export async function getPurchasingMetrics(f: ExecFilters): Promise<PurchasingMetrics> {
  const pos = await prisma.purchaseOrder.findMany({
    where: { companyId: { in: f.companyIds }, status: { not: "Draft" }, date: { gte: f.from, lte: f.to } },
    select: {
      id: true, status: true,
      company: { select: { companyName: true } },
      supplier: { select: { id: true, name: true } },
      lines: { select: { qty: true, receivedQty: true, unitCost: true } },
    },
  });

  let totalOrdered = 0, totalReceived = 0, outstandingValue = 0, openOrders = 0;
  const bySupplier = new Map<string, { id: string; name: string; ordered: number; received: number; orders: number }>();
  const byCompany = new Map<string, { company: string; ordered: number; received: number }>();

  for (const po of pos) {
    const ordered = po.lines.reduce((s, l) => s + l.qty * l.unitCost, 0);
    const received = po.lines.reduce((s, l) => s + l.receivedQty * l.unitCost, 0);
    const outstanding = po.lines.reduce((s, l) => s + Math.max(0, l.qty - l.receivedQty) * l.unitCost, 0);
    totalOrdered = round2(totalOrdered + ordered);
    totalReceived = round2(totalReceived + received);
    if (!["Cancelled", "Closed"].includes(po.status) && outstanding > 0) {
      outstandingValue = round2(outstandingValue + outstanding);
      openOrders++;
    }
    const s = bySupplier.get(po.supplier.id) ?? { id: po.supplier.id, name: po.supplier.name, ordered: 0, received: 0, orders: 0 };
    s.ordered = round2(s.ordered + ordered);
    s.received = round2(s.received + received);
    s.orders++;
    bySupplier.set(po.supplier.id, s);

    const c = byCompany.get(po.company.companyName) ?? { company: po.company.companyName, ordered: 0, received: 0 };
    c.ordered = round2(c.ordered + ordered);
    c.received = round2(c.received + received);
    byCompany.set(po.company.companyName, c);
  }

  return {
    totalOrdered, totalReceived, outstandingValue, openOrders,
    bySupplier: [...bySupplier.values()].sort((a, b) => b.ordered - a.ordered),
    byCompany: [...byCompany.values()],
  };
}

export type CreditMetrics = { unapplied: number; credits: number; unappliedCount: number; creditCount: number };

/** Money received or credited that is not yet sitting against an invoice. */
export async function getCreditMetrics(f: ExecFilters): Promise<CreditMetrics> {
  const cw = customerWhere(f);
  const [payments, credits] = await Promise.all([
    prisma.receivePayment.findMany({
      where: { companyId: { in: f.companyIds }, status: "Posted", date: { lte: f.to }, ...(cw ? { customer: cw } : {}) },
      select: { amount: true, applications: { select: { amount: true } }, refunds: { select: { amount: true, status: true } } },
    }),
    prisma.refundCredit.findMany({
      where: { companyId: { in: f.companyIds }, type: "Credit", status: "Posted", date: { lte: f.to }, ...(cw ? { customer: cw } : {}) },
      select: { amount: true, applications: { select: { amount: true } }, refundsDrawn: { select: { amount: true, status: true } } },
    }),
  ]);

  let unapplied = 0, unappliedCount = 0, creditBal = 0, creditCount = 0;
  for (const p of payments) {
    const used = p.applications.reduce((s, a) => s + a.amount, 0) +
      p.refunds.filter((r) => r.status === "Posted").reduce((s, r) => s + r.amount, 0);
    const left = round2(p.amount - used);
    if (left > 0) { unapplied = round2(unapplied + left); unappliedCount++; }
  }
  for (const c of credits) {
    const used = c.applications.reduce((s, a) => s + a.amount, 0) +
      c.refundsDrawn.filter((r) => r.status === "Posted").reduce((s, r) => s + r.amount, 0);
    const left = round2(c.amount - used);
    if (left > 0) { creditBal = round2(creditBal + left); creditCount++; }
  }
  return { unapplied, credits: creditBal, unappliedCount, creditCount };
}

export type Alert = { level: "red" | "amber" | "yellow" | "green"; title: string; detail: string; href?: string };

/**
 * Business alerts, raised only from figures already computed for this period, so the
 * warnings can never disagree with the tiles above them.
 */
export function buildAlerts(input: {
  ar: ArMetrics;
  stock: StockRow[];
  forecast: { totals: { achievementPct: number | null }; rows: { salesperson: string; achievementPct: number | null }[] };
  customers: CustomerRow[];
  credits: CreditMetrics;
  purchasing: PurchasingMetrics;
  sales: SalesMetrics;
  prevSales: SalesMetrics;
}): Alert[] {
  const a: Alert[] = [];
  const { ar, stock, forecast, customers, credits, purchasing, sales, prevSales } = input;

  const out = stock.filter((s) => s.stockout);
  if (out.length) {
    const names = out.slice(0, 3).map((s) => s.name).join(", ");
    a.push({ level: "red", title: "Stockout risk", detail: `${out.length} product(s) are out, or under a month of cover at the current rate — ${names}${out.length > 3 ? "…" : ""}`, href: "/inventory?stock=low" });
  }

  // the same set the Inventory panel counts — a product can honestly be both low and at
  // risk of running out, and two figures for the same thing on one screen reads as a bug
  const low = stock.filter((s) => s.lowStock);
  if (low.length) a.push({ level: "red", title: "Low inventory", detail: `${low.length} product(s) at or below their reorder point.`, href: "/inventory?stock=low" });

  if (ar.d90plus > 0) a.push({ level: "red", title: "Overdue customer accounts", detail: `${pesoText(ar.d90plus)} is more than 90 days past due, of ${pesoText(ar.overdue)} overdue in total.`, href: "/finance/ar" });
  else if (ar.overdue > 0) a.push({ level: "red", title: "Overdue customer accounts", detail: `${pesoText(ar.overdue)} past due.`, href: "/finance/ar" });

  const ach = forecast.totals.achievementPct;
  if (ach != null && ach < 100) a.push({ level: "red", title: "Sales below forecast", detail: `Achievement is ${ach.toFixed(1)}% of plan for the period.`, href: "/reports/forecast" });
  if (ach != null && ach >= 100) a.push({ level: "green", title: "Sales target achieved", detail: `Achievement is ${ach.toFixed(1)}% of plan.`, href: "/reports/forecast" });

  const slow = stock.filter((s) => s.movement === "Slow" || s.movement === "None");
  if (slow.length) {
    const value = round2(slow.reduce((s, x) => s + x.value, 0));
    a.push({ level: "amber", title: "Slow-moving inventory", detail: `${slow.length} product(s) worth ${pesoText(value)} have over six months of cover, or no sales at all this period.` });
  }

  const quiet = customers.filter((c) => c.amount === 0);
  if (quiet.length) {
    const names = quiet.slice(0, 3).map((c) => c.label).join(", ");
    a.push({ level: "amber", title: "Customers with no recent sales", detail: `${quiet.length} account(s) bought nothing in this period: ${names}${quiet.length > 3 ? "…" : ""}`, href: "/customers" });
  }

  const weak = forecast.rows.filter((r) => r.achievementPct != null && r.achievementPct < 50);
  if (weak.length) a.push({ level: "amber", title: "Declining salesperson performance", detail: `${weak.length} salesperson(s) below half of plan: ${weak.map((r) => r.salesperson).join(", ")}.` });

  if (prevSales.netSales > 0 && sales.netSales < prevSales.netSales) {
    const drop = growthPct(sales.netSales, prevSales.netSales) ?? 0;
    a.push({ level: "amber", title: "Sales down on the previous period", detail: `Net sales are ${Math.abs(drop).toFixed(1)}% lower than the equivalent period before.` });
  }

  if (credits.unapplied > 0) a.push({ level: "yellow", title: "Unapplied payments", detail: `${pesoText(credits.unapplied)} across ${credits.unappliedCount} payment(s) is not yet applied to an invoice.`, href: "/payments" });
  if (credits.credits > 0) a.push({ level: "yellow", title: "Customer credits outstanding", detail: `${pesoText(credits.credits)} of credit memos remain unused.`, href: "/refunds" });
  if (purchasing.openOrders > 0) a.push({ level: "yellow", title: "Outstanding purchase orders", detail: `${purchasing.openOrders} order(s) worth ${pesoText(purchasing.outstandingValue)} still to arrive.`, href: "/reports/po-receiving?outstanding=1" });

  return a;
}

export type RecentTx = { id: string; kind: string; ref: string; date: Date; party: string; company: string; amount: number; href: string };

/** The latest documents across the modules, so the dashboard ends on something actionable. */
export async function getRecentTransactions(f: ExecFilters, take = 8): Promise<RecentTx[]> {
  const cw = customerWhere(f);
  const [invoices, receipts] = await Promise.all([
    prisma.salesReceipt.findMany({
      where: { companyId: { in: f.companyIds }, status: { not: "Void" }, invoiceDate: { gte: f.from, lte: f.to }, ...(cw ? { customer: cw } : {}) },
      orderBy: { invoiceDate: "desc" },
      take,
      select: { id: true, srNumber: true, invoiceDate: true, amount: true, customer: { select: { businessName: true } }, company: { select: { companyName: true } } },
    }),
    prisma.goodsReceipt.findMany({
      where: { companyId: { in: f.companyIds }, status: "Posted", receivedDate: { gte: f.from, lte: f.to } },
      orderBy: { receivedDate: "desc" },
      take,
      select: {
        id: true, grnNumber: true, receivedDate: true,
        company: { select: { companyName: true } },
        purchaseOrder: { select: { supplier: { select: { name: true } } } },
        lines: { select: { acceptedQty: true, unitCost: true } },
      },
    }),
  ]);

  const rows: RecentTx[] = [
    ...invoices.map((x) => ({
      id: x.id, kind: "Invoice", ref: x.srNumber, date: x.invoiceDate,
      party: x.customer.businessName, company: x.company.companyName, amount: x.amount, href: `/invoices/${x.id}`,
    })),
    ...receipts.map((x) => ({
      id: x.id, kind: "Goods Received", ref: x.grnNumber, date: x.receivedDate,
      party: x.purchaseOrder.supplier.name, company: x.company.companyName,
      amount: round2(x.lines.reduce((s, l) => s + l.acceptedQty * l.unitCost, 0)), href: `/receiving/${x.id}`,
    })),
  ];
  return rows.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, take);
}
