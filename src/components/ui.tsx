import Link from "next/link";

const STATUS_COLORS: Record<string, string> = {
  // generic
  Active: "bg-emerald-100 text-emerald-800",
  Inactive: "bg-gray-100 text-gray-600",
  // orders / documents
  Pending: "bg-amber-100 text-amber-800",
  Converted: "bg-blue-100 text-blue-800",
  Draft: "bg-gray-100 text-gray-700",
  Confirmed: "bg-blue-100 text-blue-800",
  Scheduled: "bg-indigo-100 text-indigo-800",
  Loading: "bg-amber-100 text-amber-800",
  "In Transit": "bg-cyan-100 text-cyan-800",
  Delivered: "bg-emerald-100 text-emerald-800",
  Invoiced: "bg-purple-100 text-purple-800",
  Closed: "bg-gray-200 text-gray-700",
  Cancelled: "bg-red-100 text-red-700",
  Void: "bg-red-100 text-red-700",
  // AR
  Open: "bg-blue-100 text-blue-800",
  Partial: "bg-amber-100 text-amber-800",
  Paid: "bg-emerald-100 text-emerald-800",
  Current: "bg-emerald-100 text-emerald-800",
  "Due Soon": "bg-amber-100 text-amber-800",
  Overdue: "bg-red-100 text-red-700",
  // PO
  Sent: "bg-blue-100 text-blue-800",
  "Partially Received": "bg-amber-100 text-amber-800",
  Received: "bg-emerald-100 text-emerald-800",
  // stock
  "In Stock": "bg-emerald-100 text-emerald-800",
  Low: "bg-amber-100 text-amber-800",
  Out: "bg-red-100 text-red-700",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] || "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

export function stockStatus(qty: number, reorderPoint: number): "In Stock" | "Low" | "Out" {
  if (qty <= 0) return "Out";
  if (qty <= reorderPoint) return "Low";
  return "In Stock";
}

export function SearchBox({ placeholder, defaultValue, extraParams }: { placeholder?: string; defaultValue?: string; extraParams?: Record<string, string> }) {
  return (
    <form method="GET" className="flex gap-2">
      {extraParams &&
        Object.entries(extraParams).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder || "Search…"}
        className="input max-w-xs"
      />
      <button className="btn-secondary" type="submit">
        Search
      </button>
    </form>
  );
}

export function Pagination({ page, pageCount, baseUrl, params }: { page: number; pageCount: number; baseUrl: string; params?: Record<string, string> }) {
  if (pageCount <= 1) return null;
  const qs = (p: number) => {
    const sp = new URLSearchParams({ ...(params || {}), page: String(p) });
    return `${baseUrl}?${sp.toString()}`;
  };
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-gray-600">
      <span>
        Page {page} of {pageCount}
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link className="btn-secondary" href={qs(page - 1)}>
            ← Prev
          </Link>
        )}
        {page < pageCount && (
          <Link className="btn-secondary" href={qs(page + 1)}>
            Next →
          </Link>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
      {message}
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-bold text-gray-900">{title}</h1>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
