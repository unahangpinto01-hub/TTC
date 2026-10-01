/** Browser-safe wording helpers for vouchers. */

/**
 * The particulars a voucher starts with when it is raised from bills: which invoices it pays
 * and what for. The office may edit it; the bill references themselves stay on the voucher
 * whatever the text says.
 */
export function defaultParticulars(bills: { supplierInvoiceNo?: string | null; billNo: string; kind: string }[]): string {
  if (!bills.length) return "";
  const refs = bills.map((b) => b.supplierInvoiceNo?.trim() || b.billNo);
  const kinds = new Set(bills.map((b) => (b.kind === "EXPENSE" ? "expense" : "inventory")));
  const what = kinds.size === 2 ? "inventory purchases and non-inventory expenses" : kinds.has("expense") ? "non-inventory expenses" : "inventory purchases";
  return `Payment of supplier invoice${refs.length > 1 ? "s" : ""} ${refs.join(", ")} for ${what}.`;
}
