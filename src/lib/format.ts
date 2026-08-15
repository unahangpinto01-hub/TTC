import { format } from "date-fns";

export function peso(n: number | null | undefined): string {
  const v = n ?? 0;
  return (
    "₱" +
    v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return format(new Date(d), "MMM dd, yyyy");
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return format(new Date(d), "MMM dd, yyyy h:mm a");
}

export function termLabel(term: string): string {
  return term === "COD" ? "COD" : `${term} days`;
}

export const VAT_RATE = 0.12;

/** Prices are VAT-inclusive. Returns {net, vat} components of a gross amount. */
export function vatBreakdown(gross: number) {
  const net = gross / (1 + VAT_RATE);
  return { net, vat: gross - net };
}
