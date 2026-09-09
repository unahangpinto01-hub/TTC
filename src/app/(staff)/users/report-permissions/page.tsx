import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { REPORTS, REPORT_MODULES } from "@/lib/report-registry";
import { storedReportPerm, reportPerm } from "@/lib/report-access";
import { getPerm } from "@/lib/permissions";
import { saveReportPermissions, saveReportLevelPolicy } from "../actions";
import { getReportPolicy } from "@/lib/report-policy";
import { getAuditTrail } from "@/lib/salespeople";

const LEVELS = [
  ["NONE", "No Access"],
  ["READ_ONLY", "Read Only"],
  ["READ_WRITE", "Read/Write"],
] as const;

/**
 * Report Permissions — User → Report → Access, for Super Admin only.
 *
 * This writes the same per-user permissions the rest of the BMS reads, so there is one
 * source of truth rather than a second permission system running alongside the first.
 */
export default async function ReportPermissionsPage({
  searchParams,
}: {
  searchParams: { user?: string; module?: string; report?: string; company?: string; saved?: string; policy?: string };
}) {
  // Super Admin only — everyone else is bounced to the dashboard by requireStaff
  const viewer = await requireStaff(["SUPER_ADMIN"]);

  const [policy, users, companies, audit] = await Promise.all([
    getReportPolicy(),
    prisma.user.findMany({
      where: { role: { notIn: ["SUPER_ADMIN", "DEALER"] } },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true, email: true, role: true, access: true, permsJson: true, companyIdsJson: true },
    }),
    prisma.company.findMany({ where: { status: "Active" }, orderBy: [{ isPrimary: "desc" }] , select: { id: true, companyName: true } }),
    getAuditTrail("ReportPermission", "ALL", 25),
  ]);

  const pickedUser = searchParams.user || "";
  const pickedModule = searchParams.module || "";
  const pickedReport = searchParams.report || "";
  const pickedCompany = searchParams.company || "";

  // Company here narrows WHICH USERS are listed — which companies a user may see is settled
  // on their account, and every report already honours it, so it is not granted per report.
  const shownUsers = users.filter((u) => {
    if (pickedUser && u.id !== pickedUser) return false;
    if (!pickedCompany) return true;
    try {
      const ids: string[] = u.companyIdsJson ? JSON.parse(u.companyIdsJson) : [];
      return ids.includes(pickedCompany);
    } catch {
      return false;
    }
  });
  const shownReports = REPORTS.filter(
    (r) => (!pickedModule || r.module === pickedModule) && (!pickedReport || r.key === pickedReport)
  );

  const rows = shownUsers.flatMap((u) =>
    shownReports.map((r) => ({
      user: u,
      report: r,
      stored: storedReportPerm(u, r.key),
      effective: reportPerm(u, r.key),
      moduleCap: getPerm(u, r.fn),
    }))
  );

  return (
    <div>
      <Link href="/users" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
        ← Back to Users
      </Link>
      <PageHeader title="Report Permissions" />

      {searchParams.saved === "ok" && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          ✔ Saved. Every change is recorded in the audit trail below.
        </p>
      )}
      {searchParams.saved === "none" && (
        <p className="mb-3 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">Nothing changed.</p>
      )}
      {searchParams.policy === "ok" && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          ✔ Access level rules saved. Every report and export follows them from now on.
        </p>
      )}
      {searchParams.policy === "none" && (
        <p className="mb-3 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">The level rules were already set that way.</p>
      )}

      {/* ------------------------------------------------- what each level may do */}
      <form action={saveReportLevelPolicy} className="card mb-4">
        <h2 className="font-semibold text-emerald-900">What each access level can do</h2>
        <p className="mb-3 text-sm text-gray-600">
          The three levels are fixed, but what they mean is yours to set. Viewing and filtering always come with access;
          these switches decide the rest. Super Admin is unaffected by them.
        </p>
        <table className="w-full max-w-xl text-sm">
          <thead className="border-b border-gray-200">
            <tr>
              <th className="py-1 text-left">Level</th>
              <th className="py-1 text-center">View &amp; filter</th>
              <th className="py-1 text-center">Print / Save as PDF</th>
              <th className="py-1 text-center">Export to Excel</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr>
              <td className="py-2 font-medium">No Access</td>
              <td className="py-2 text-center text-gray-300">✕</td>
              <td className="py-2 text-center text-gray-300">✕</td>
              <td className="py-2 text-center text-gray-300">✕</td>
            </tr>
            <tr>
              <td className="py-2 font-medium">Read Only</td>
              <td className="py-2 text-center text-emerald-700">✔ always</td>
              <td className="py-2 text-center"><input type="checkbox" name="ro_print" defaultChecked={policy.READ_ONLY.print} className="h-4 w-4" /></td>
              <td className="py-2 text-center"><input type="checkbox" name="ro_export" defaultChecked={policy.READ_ONLY.export} className="h-4 w-4" /></td>
            </tr>
            <tr>
              <td className="py-2 font-medium">Read/Write</td>
              <td className="py-2 text-center text-emerald-700">✔ always</td>
              <td className="py-2 text-center"><input type="checkbox" name="rw_print" defaultChecked={policy.READ_WRITE.print} className="h-4 w-4" /></td>
              <td className="py-2 text-center"><input type="checkbox" name="rw_export" defaultChecked={policy.READ_WRITE.export} className="h-4 w-4" /></td>
            </tr>
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="btn-primary" type="submit">💾 Save Level Rules</button>
          <span className="text-xs text-gray-500">
            The Excel export is refused by the server, not merely hidden. Unticking Print hides the button, but a browser
            can always print a page it is showing — treat that one as a nudge, not a lock.
          </span>
        </div>
      </form>

      <p className="mb-3 text-sm text-gray-600">
        Access is granted per user, per report. Anything not granted is <strong>No Access</strong>, so a report added to
        the BMS later is closed to everyone until you open it. <strong>Super Admins are not listed</strong> — they always
        have full access to every report and it cannot be removed.
      </p>

      {/* ------------------------------------------------------------- filters */}
      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="label">User</label>
          <select name="user" defaultValue={pickedUser} className="input max-w-[200px]">
            <option value="">All users</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
          </select>
        </div>
        <div>
          <label className="label">Module</label>
          <select name="module" defaultValue={pickedModule} className="input max-w-[160px]">
            <option value="">All modules</option>
            {REPORT_MODULES.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Report</label>
          <select name="report" defaultValue={pickedReport} className="input max-w-[220px]">
            <option value="">All reports</option>
            {REPORTS.map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Company</label>
          <select name="company" defaultValue={pickedCompany} className="input max-w-[190px]" title="Narrows the list to users granted this company">
            <option value="">All companies</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
          </select>
        </div>
        <button className="btn-secondary" type="submit">Filter</button>
        <Link href="/users/report-permissions" className="btn-secondary">Reset</Link>
      </form>

      {/* --------------------------------------------------------------- grid */}
      <form action={saveReportPermissions}>
        <input type="hidden" name="returnTo" value={new URLSearchParams(
          Object.entries({ user: pickedUser, module: pickedModule, report: pickedReport, company: pickedCompany })
            .filter(([, v]) => v) as [string, string][]
        ).toString()} />

        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[840px]">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="table-th">User</th>
                <th className="table-th">Report</th>
                <th className="table-th">Module</th>
                <th className="table-th">Access</th>
                <th className="table-th">Effective</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ user: u, report: r, stored, effective, moduleCap }) => {
                const blocked = stored !== "NONE" && effective === "NONE";
                const capped = stored === "READ_WRITE" && effective === "READ_ONLY";
                return (
                  <tr key={`${u.id}:${r.key}`} className="hover:bg-gray-50">
                    <td className="table-td">
                      <Link href={`/users/${u.id}`} className="font-medium text-emerald-700 hover:underline">{u.name}</Link>
                      <span className="block text-xs text-gray-400">{u.role}</span>
                    </td>
                    <td className="table-td text-sm">{r.title}</td>
                    <td className="table-td text-xs text-gray-500">{r.module}</td>
                    <td className="table-td">
                      <select name={`p_${u.id}_${r.key}`} defaultValue={stored} className="input max-w-[150px] py-1 text-sm">
                        {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td className="table-td text-xs">
                      {effective === "NONE" ? (
                        <span className="text-gray-400">No Access</span>
                      ) : effective === "READ_ONLY" ? (
                        <span className="text-gray-600">Read Only</span>
                      ) : (
                        <span className="font-semibold text-emerald-700">Read/Write</span>
                      )}
                      {/* the module permission still caps a report — say so rather than let a
                          grant look active when the module behind it is closed */}
                      {blocked && (
                        <span className="block text-amber-700">
                          blocked: {u.name} has no access to {r.fn}
                        </span>
                      )}
                      {capped && <span className="block text-amber-700">capped to Read Only by {r.fn} or the account</span>}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={5} className="p-8 text-center text-sm text-gray-500">
                  No users match these filters. Super Admins are never listed.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {rows.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn-primary" type="submit">💾 Save Permissions</button>
            <span className="text-xs text-gray-500">
              {rows.length} row(s) shown. Read Only and Read/Write do whatever the level rules above allow.
            </span>
          </div>
        )}
      </form>

      {/* -------------------------------------------------------- audit trail */}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-gray-700">Recent Permission Changes</h2>
      <div className="card divide-y divide-gray-100 p-0">
        {audit.map((a) => (
          <div key={a.id} className="px-3 py-2 text-sm">
            <p className="text-gray-700">{a.detail}</p>
            <p className="text-xs text-gray-400">{fmtDateTime(a.createdAt)} · changed by {a.actorName}</p>
          </div>
        ))}
        {!audit.length && <p className="p-6 text-center text-sm text-gray-500">No permission changes recorded yet.</p>}
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Export permission is enforced by the server as well as hidden in the page, so knowing the download URL gains
        nothing. Printing is a browser function and cannot be truly prevented by any application.
      </p>
    </div>
  );
}
