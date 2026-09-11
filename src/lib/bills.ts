import { prisma } from "./db";
import { nextSeriesNo } from "./vouchers";
import { round2 } from "./bill-math";

export {
  VAT, round2, TERMS, DEFAULT_TERMS, ALLOCATION_BASES, termsDays, dueDateFor, computeBill, statusForPayment,
} from "./bill-math";
export type { LineMathIn, LineMathOut, BillMath } from "./bill-math";

/**
 * Enter Bills Against Inventory — the rules, in one place, read by the pages, the actions,
 * the reports and the print. The arithmetic lives in bill-math.ts so the browser can share it.
 *
 * A bill is the document that both stocks the goods and raises the payable. Receiving no
 * longer touches inventory: a goods received note confirms what arrived and moves the
 * purchase order along, and the bill that follows it puts the accepted quantities into
 * stock at the billed cost — product cost plus the freight and other purchasing costs the
 * bill allocates to them — and credits the supplier for the whole amount, VAT included.
 */

export const BILL_STATUSES = ["Draft", "Posted", "Partially Paid", "Paid", "Void"] as const;
/** statuses that carry a payable balance */
export const OPEN_BILL_STATUSES = ["Posted", "Partially Paid"];
/** statuses that count as a real purchase in reports — a draft or a voided bill is not one */
export const LIVE_BILL_STATUSES = ["Posted", "Partially Paid", "Paid"];

export const outstandingOf = (b: { total: number; paidAmount: number; status: string }) =>
  OPEN_BILL_STATUSES.includes(b.status) ? round2(Math.max(0, b.total - b.paidAmount)) : 0;

/** BL-TTC-2026-000001 — per company, per accounting year, from the bill's own date. */
export const nextBillNo = (companyId: string, billDate: Date) => nextSeriesNo("BL", companyId, billDate);

/** Only a Draft may be changed. Everything after that goes through void. */
export function billEditBlocker(bill: { status: string }): string | null {
  if (bill.status === "Draft") return null;
  if (bill.status === "Void") return "This bill has been voided.";
  return "A posted bill cannot be edited. Void it and enter a corrected bill.";
}

export function billVoidBlocker(bill: { status: string; paidAmount: number }): string | null {
  if (bill.status === "Void") return "This bill is already void.";
  if (bill.paidAmount > 0) return "A bill with a payment against it cannot be voided — reverse the payment first.";
  return null;
}

type LineForCheck = {
  qty: number;
  unitCost: number;
  batchNo: string | null;
  grnLineId: string | null;
  product: { name: string; itemClass: string; companyId: string; batchNo: string | null };
};

/**
 * Why a bill may not be posted yet — every reason, not just the first, so the user fixes
 * the whole document in one pass. An empty list means it can post.
 */
export async function postBlockers(bill: {
  id: string;
  companyId: string;
  supplierId: string | null;
  billDate: Date | null;
  supplierInvoiceNo: string | null;
  invoiceUnavailable: boolean;
  lines: LineForCheck[];
}): Promise<string[]> {
  const out: string[] = [];
  if (!bill.supplierId) out.push("Supplier is required.");
  if (!bill.billDate) out.push("Bill date is required.");
  const inv = (bill.supplierInvoiceNo ?? "").trim();
  if (!inv && !bill.invoiceUnavailable) out.push("Supplier invoice number is required, unless it is marked as not available.");
  if (!bill.lines.length) out.push("At least one inventory item is required.");
  for (const l of bill.lines) {
    if (l.qty <= 0) out.push(`${l.product.name}: quantity must be greater than zero.`);
    if (l.unitCost < 0) out.push(`${l.product.name}: unit cost cannot be negative.`);
    if (l.product.itemClass !== "INVENTORY") out.push(`${l.product.name} is not an inventory item.`);
    if (l.product.companyId !== bill.companyId) out.push(`${l.product.name} belongs to another company.`);
    // a batch-tracked product (one that carries a batch on its master) must say which batch arrived
    if (l.product.batchNo && !(l.batchNo ?? "").trim()) out.push(`${l.product.name}: batch number is required.`);
  }
  if (inv && bill.supplierId) {
    const dupe = await prisma.supplierBill.findFirst({
      where: {
        id: { not: bill.id },
        supplierId: bill.supplierId,
        supplierInvoiceNo: { equals: inv, mode: "insensitive" },
        status: { not: "Void" },
      },
      select: { billNo: true },
    });
    if (dupe) out.push(`Supplier invoice ${inv} is already on bill ${dupe.billNo}.`);
  }
  return out;
}
