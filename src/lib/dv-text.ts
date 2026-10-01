/** Browser-safe wording helpers for vouchers. */

/**
 * The particulars a voucher starts with when it is raised from bills: which invoices it pays
 * and what for. The office may edit it; the bill references themselves stay on the voucher
 * whatever the text says.
 */
export function defaultParticulars(bills: { supplierInvoiceNo?: string | null; billNo: string; kind: string }[]): string {
  if (!bills.length) return "";
  const refs = bills.map((b) => b.supplierInvoiceNo?.trim() || b.billNo);
  if (bills.every((b) => b.kind === "OPENING")) return `Payment on account — balance brought forward (${refs.join(", ")}).`;
  const label = (k: string) => (k === "EXPENSE" ? "non-inventory expenses" : k === "OPENING" ? "balance brought forward" : "inventory purchases");
  const what = [...new Set(bills.map((b) => label(b.kind)))].join(" and ");
  return `Payment of supplier invoice${refs.length > 1 ? "s" : ""} ${refs.join(", ")} for ${what}.`;
}
