import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { visibleReports } from "@/lib/report-access";
import { REPORT_MODULES } from "@/lib/report-registry";

/**
 * The Reports hub lists only what this user has been granted.
 *
 * A report missing from here is not merely hidden — the page itself and its export route
 * refuse the same user independently, so knowing the URL gains nothing.
 */
export default async function ReportsHub() {
  const user = await requireStaff();
  const reports = visibleReports(user);
  if (!reports.length) {
    return (
      <div>
        <PageHeader title="Reports" />
        <div className="card text-center">
          <p className="text-sm text-gray-600">You have not been given access to any report.</p>
          <p className="mt-1 text-xs text-gray-500">
            Report access is granted per report by a Super Admin, under Users → Report Permissions.
          </p>
        </div>
      </div>
    );
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  // reports that read a date range get the usual two shortcuts; the rest just open
  const DATED = new Set([
    "sales", "sales-journal", "customers", "products", "pnl", "collections", "expenses",
    "inventory-movement", "receiving", "supplier-receiving", "deliveries", "executive",
    "payments", "refunds-credits",
  ]);

  return (
    <div>
      <PageHeader title="Reports">
        {user.role === "SUPER_ADMIN" && (
          <Link href="/users/report-permissions" className="btn-secondary">🔑 Report Permissions</Link>
        )}
      </PageHeader>

      {REPORT_MODULES.map((mod) => {
        const group = reports.filter((r) => r.module === mod);
        if (!group.length) return null;
        return (
          <div key={mod} className="mb-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-700">{mod}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((r) => {
                const dated = DATED.has(r.key);
                const href = dated ? `${r.href}?from=${monthStart}&to=${today}` : r.href;
                return (
                  <div key={r.key} className="card">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-emerald-900">{r.title}</h3>
                      {r.perm === "READ_ONLY" && (
                        <span
                          className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500"
                          title="You can view and filter this report. What else Read Only may do is set by the level rules under Users → Report Permissions."
                        >
                          READ ONLY
                        </span>
                      )}
                    </div>
                    <p className="mb-3 text-sm text-gray-500">{r.desc}</p>
                    <div className="flex gap-2">
                      <Link href={href} className="btn-primary">{dated ? "This Month" : "Open Report"}</Link>
                      {dated && (
                        <Link href={`${r.href}?from=${yearStart}&to=${today}`} className="btn-secondary">This Year</Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <p className="text-xs text-gray-500">
        {reports.length} report(s) available to you.
        {user.role === "SUPER_ADMIN" && " As Super Admin you have full access to every report, which cannot be removed."}
      </p>
    </div>
  );
}
