import Link from "next/link";

/** The three purchase views share one filter bar; this is the switch between them. */
export function PurchaseNav({ active, qs }: { active: "bills" | "product" | "supplier"; qs: string }) {
  const tabs: [typeof active, string, string][] = [
    ["bills", "Bills", "/reports/purchases"],
    ["product", "By Product", "/reports/purchases/by-product"],
    ["supplier", "By Supplier", "/reports/purchases/by-supplier"],
  ];
  return (
    <div className="no-print mb-3 flex gap-1 rounded-lg bg-gray-100 p-1 text-sm w-fit">
      {tabs.map(([key, label, href]) => (
        <Link
          key={key}
          href={`${href}?${qs}`}
          className={`rounded-md px-3 py-1 ${active === key ? "bg-white font-semibold text-emerald-900 shadow-sm" : "text-gray-600 hover:text-gray-900"}`}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
