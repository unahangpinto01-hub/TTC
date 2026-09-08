import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { fmtDateTime } from "@/lib/format";
import { getPage, pageCount } from "@/lib/paginate";
import { PageHeader, Pagination, SearchBox } from "@/components/ui";

/**
 * Deleted Orders — the audit trail for permanent deletions.
 *
 * A deleted order leaves no record to hang an audit panel on, so the entry has to be
 * readable somewhere of its own. Everything shown here was captured at the moment of
 * deletion; nothing is looked up from the order, because the order no longer exists.
 */
export default async function DeletedOrdersPage({
  searchParams,
}: {
  searchParams: { page?: string; q?: string };
}) {
  // Super Admin only — requireStaff bounces every other role to the dashboard
  const user = await requireStaff(["SUPER_ADMIN"]);
  const company = await getActiveCompany(user);
  const { page, skip, take } = getPage(searchParams);
  const q = (searchParams.q || "").trim();

  const where: any = { entity: "IncomingOrder", action: "DELETED", companyId: company.id };
  if (q) {
    where.OR = [
      { detail: { contains: q, mode: "insensitive" } },
      { reason: { contains: q, mode: "insensitive" } },
      { actorName: { contains: q, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    prisma.auditLog.count({ where }),
  ]);

  const meta = (raw: string | null) => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Record<string, string | number | null>;
    } catch {
      return null; // an entry written before the snapshot existed still lists, just thinner
    }
  };
  const peso = (n: unknown) =>
    typeof n === "number" ? `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";

  return (
    <div>
      <Link href="/orders" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
        ← Back to Order Inbox
      </Link>
      <PageHeader title={`Deleted Orders · ${company.companyName}`} />

      <p className="mb-4 text-sm text-gray-600">
        Every permanent deletion of an incoming order, newest first. The orders themselves are gone — this is the only
        remaining record of them.
      </p>

      <div className="mb-4">
        <SearchBox placeholder="Search order no., customer, reason or who deleted it…" defaultValue={q} />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[980px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Deleted</th>
              <th className="table-th">Order No.</th>
              <th className="table-th">Customer</th>
              <th className="table-th">Company</th>
              <th className="table-th text-right">Amount</th>
              <th className="table-th">Deleted By</th>
              <th className="table-th">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => {
              const m = meta(r.meta);
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="table-td whitespace-nowrap text-sm">{fmtDateTime(r.createdAt)}</td>
                  <td className="table-td font-mono text-sm font-semibold text-gray-700">
                    {(m?.orderNo as string) ?? "—"}
                    {m?.status && <span className="block text-xs font-normal text-gray-400">was {String(m.status)}</span>}
                  </td>
                  <td className="table-td text-sm">
                    {(m?.customer as string) ?? "—"}
                    {m?.source && <span className="block text-xs uppercase text-gray-400">{String(m.source)}</span>}
                  </td>
                  <td className="table-td text-sm text-gray-600">{(m?.company as string) ?? "—"}</td>
                  <td className="table-td whitespace-nowrap text-right text-sm">
                    {peso(m?.amount)}
                    {m?.lines != null && <span className="block text-xs text-gray-400">{String(m.lines)} line(s)</span>}
                  </td>
                  <td className="table-td text-sm">
                    {r.actorName}
                    <span className="block text-xs text-gray-400">{r.actorEmail}</span>
                  </td>
                  <td className="table-td text-sm text-gray-700">{r.reason ?? "—"}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-sm text-gray-500">
                  {q ? <>No deletions match &ldquo;{q}&rdquo;.</> : "No orders have been permanently deleted."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pageCount={pageCount(total)} baseUrl="/orders/deleted" params={q ? { q } : undefined} />
      <p className="mt-2 text-xs text-gray-500">
        {total} deletion(s) recorded. Order numbers are never reused, so a gap in the inbox sequence is itself evidence
        that something was removed.
      </p>
    </div>
  );
}
