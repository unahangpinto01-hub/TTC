/** How a posted receipt stands against its supplier bills — see lib/bill-matching.ts. */
export function InvoiceBadge({ status }: { status: string }) {
  const tone: Record<string, string> = {
    Pending: "bg-amber-100 text-amber-800",
    Entered: "bg-sky-100 text-sky-800",
    Partial: "bg-amber-100 text-amber-800",
    Billed: "bg-emerald-100 text-emerald-800",
    Discrepancy: "bg-red-100 text-red-700",
  };
  const label: Record<string, string> = {
    Pending: "Invoice pending",
    Entered: "Invoice entered",
    Partial: "Partially billed",
    Billed: "Fully billed",
    Discrepancy: "Invoice discrepancy",
  };
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone[status] ?? "bg-gray-100 text-gray-600"}`} title="Supplier invoice status for this receipt">
      {label[status] ?? status}
    </span>
  );
}
