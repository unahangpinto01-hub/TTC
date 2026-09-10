import { prisma } from "./db";

/**
 * The one place that decides what "sales" means.
 *
 *   Product Sales      the invoice LINES only — what the customer actually bought
 *   Returns            posted credit memos raised against those invoices
 *   Net Product Sales  Product Sales − Returns
 *   Freight            the delivery charge billed on the invoice
 *   Other Charges      any other non-product charge billed on the invoice
 *   Total Billing      Product Sales + Freight + Other Charges
 *
 * Freight and other charges are billed to the customer and belong on the invoice, but they
 * are not product revenue. Every measure of product performance — by product, customer,
 * salesperson or area, and every forecast comparison — reads Product Sales, so a big
 * delivery charge can never make a salesperson or a product line look better than it did.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export type SalesComponents = {
  productSales: number;
  returns: number;
  netProductSales: number;
  freight: number;
  otherCharges: number;
  totalBilling: number;
};

export const emptyComponents = (): SalesComponents => ({
  productSales: 0,
  returns: 0,
  netProductSales: 0,
  freight: 0,
  otherCharges: 0,
  totalBilling: 0,
});

/** The shape any invoice must present to be broken into components. */
export type ComponentSource = {
  freightCharge: number;
  otherCharges: number;
  deliveryReceipt: { lines: { qty: number; unitPrice: number }[] };
  /** posted credit memos raised against this invoice, when they were loaded */
  refundCredits?: { amount: number; status: string; type: string }[];
};

/** Product sales on one invoice: its lines, and nothing else on the document. */
export const productSalesOf = (sr: ComponentSource): number =>
  round2(sr.deliveryReceipt.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));

/** Credit memos posted against one invoice — the returns that reduce net product sales. */
export const returnsOf = (sr: ComponentSource): number =>
  round2((sr.refundCredits ?? []).filter((r) => r.status === "Posted").reduce((s, r) => s + r.amount, 0));

/** Break one invoice into its components. */
export function componentsOf(sr: ComponentSource): SalesComponents {
  const productSales = productSalesOf(sr);
  const returns = returnsOf(sr);
  const freight = round2(sr.freightCharge);
  const otherCharges = round2(sr.otherCharges);
  return {
    productSales,
    returns,
    netProductSales: round2(productSales - returns),
    freight,
    otherCharges,
    totalBilling: round2(productSales + freight + otherCharges),
  };
}

/** Add one invoice's components into a running total. */
export function addComponents(into: SalesComponents, sr: ComponentSource): SalesComponents {
  const c = componentsOf(sr);
  into.productSales = round2(into.productSales + c.productSales);
  into.returns = round2(into.returns + c.returns);
  into.netProductSales = round2(into.netProductSales + c.netProductSales);
  into.freight = round2(into.freight + c.freight);
  into.otherCharges = round2(into.otherCharges + c.otherCharges);
  into.totalBilling = round2(into.totalBilling + c.totalBilling);
  return into;
}

export function sumComponents(invoices: ComponentSource[]): SalesComponents {
  return invoices.reduce<SalesComponents>((acc, sr) => addComponents(acc, sr), emptyComponents());
}

/** The Prisma include every caller needs to break invoices apart correctly. */
export const COMPONENT_INCLUDE = {
  deliveryReceipt: { select: { lines: { select: { qty: true, unitPrice: true } } } },
  refundCredits: { select: { amount: true, status: true, type: true } },
} as const;

/* --------------------------------------------------------------- GL mapping */

export type BillingAccounts = {
  sales: { code: string; description: string } | null;
  freight: { code: string; description: string } | null;
  other: { code: string; description: string } | null;
};

/**
 * Which Chart of Accounts entry each billing component credits.
 *
 * Chosen on Company Details rather than written into the code, so freight income can be
 * pointed at the right account without a deploy. An unset account falls back to a plain
 * label, and the screen says it is unset rather than pretending it was mapped.
 */
export async function billingAccounts(companyId: string): Promise<BillingAccounts> {
  const c = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      glSales: { select: { code: true, description: true } },
      glFreight: { select: { code: true, description: true } },
      glOther: { select: { code: true, description: true } },
    },
  });
  return { sales: c?.glSales ?? null, freight: c?.glFreight ?? null, other: c?.glOther ?? null };
}

export const accountLabel = (a: { code: string; description: string } | null, fallback: string) =>
  a ? `${a.code} ${a.description}` : fallback;
