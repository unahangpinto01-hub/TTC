import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { FUNCTIONS, getStoredPerm } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { updateUserPerms, resetUserPassword, setUserCompanies } from "../actions";
import { getPrimaryCompany } from "@/lib/company";

const LEVELS = [
  ["NONE", "No Access"],
  ["READ_WRITE", "Read/Write"],
  ["READ_ONLY", "Read Only"],
] as const;

export default async function UserDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; reset?: string } }) {
  const viewer = await requirePerm("users");
  const target = await prisma.user.findUnique({ where: { id: params.id }, include: { customer: true } });
  if (!target) notFound();
  const [companies, primary] = await Promise.all([
    prisma.company.findMany({ where: { status: "Active" }, orderBy: { createdAt: "asc" } }),
    getPrimaryCompany(),
  ]);
  let targetCompanyIds: string[] = [primary.id];
  if (target.companyIdsJson) {
    try { targetCompanyIds = JSON.parse(target.companyIdsJson); } catch {}
  }

  return (
    <div className="max-w-3xl">
      <Link href="/users" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
        ← Back to Users
      </Link>
      <PageHeader title={target.name} />

      {searchParams.error === "weakpw" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Password rejected — minimum 12 characters and not a common password.</p>
      )}
      {searchParams.reset === "ok" && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✔ Password reset. The user was signed out everywhere. Their 2FA (if enabled) still applies.</p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card py-3"><p className="text-xs text-gray-500">Email</p><p className="text-sm font-semibold">{target.email}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Role</p><p className="text-sm font-semibold">{target.role.replace("_", " ")}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Account</p><p className="text-sm font-semibold">{target.access === "NONE" ? "No Access" : target.access === "READ_ONLY" ? "Read Only (capped)" : "Enabled"}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">{target.role === "DEALER" ? "Dealer Account" : "Created"}</p><p className="text-sm font-semibold">{target.role === "DEALER" ? target.customer?.businessName ?? "—" : fmtDate(target.createdAt)}</p></div>
      </div>

      {viewer.role === "SUPER_ADMIN" && viewer.access === "READ_WRITE" && target.role !== "DEALER" && (
        <form action={setUserCompanies} className="card mb-4">
          <input type="hidden" name="id" value={target.id} />
          <p className="mb-2 font-semibold">Company Access</p>
          <p className="mb-3 text-xs text-gray-500">
            Which companies this user can work in. Access is explicit — nobody gets a company automatically.
            {searchParams.error === "selfco" && <span className="ml-2 font-semibold text-red-600">You cannot remove your own access to every company.</span>}
            {(searchParams as Record<string, string>).companies === "ok" && <span className="ml-2 font-semibold text-emerald-700">✔ Saved.</span>}
          </p>
          <div className="mb-3 flex flex-wrap gap-4">
            {companies.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={`co_${c.id}`} defaultChecked={targetCompanyIds.includes(c.id)} className="h-4 w-4 accent-emerald-700" />
                {c.companyName}
                {c.isPrimary && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">PRIMARY</span>}
              </label>
            ))}
          </div>
          <button className="btn-secondary" type="submit">Save Company Access</button>
        </form>
      )}

      {viewer.role === "SUPER_ADMIN" && viewer.access === "READ_WRITE" && (
        <form action={resetUserPassword} className="card mb-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={target.id} />
          <div className="flex-1">
            <label className="label">Reset Password (min. 12 characters)</label>
            <input name="password" type="password" required minLength={12} autoComplete="new-password" className="input" />
          </div>
          <button className="btn-secondary" type="submit">Reset Password</button>
        </form>
      )}

      {target.role === "SUPER_ADMIN" ? (
        <div className="card border-emerald-300 bg-emerald-50/50 p-6 text-sm text-emerald-900">
          👑 <span className="font-semibold">Super Admin has full access to every function.</span> Permissions cannot be
          restricted for this account.
        </div>
      ) : target.role === "DEALER" ? (
        <div className="card p-6 text-sm text-gray-600">
          This is a dealer portal account — it can only browse the catalog and manage its own orders. Function
          permissions do not apply.
        </div>
      ) : (
        <form action={updateUserPerms}>
          <input type="hidden" name="id" value={target.id} />
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[560px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="table-th">Function</th>
                  {LEVELS.map(([, label]) => (
                    <th key={label} className="table-th text-center">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {FUNCTIONS.map(([key, label]) => {
                  const current = getStoredPerm(target, key);
                  return (
                    <tr key={key} className="hover:bg-gray-50">
                      <td className="table-td font-medium">{label}</td>
                      {LEVELS.map(([value]) => (
                        <td key={value} className="table-td text-center">
                          <input
                            type="radio"
                            name={`perm_${key}`}
                            value={value}
                            defaultChecked={current === value}
                            className="h-4 w-4 accent-emerald-700"
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button className="btn-primary" type="submit">💾 Save Permissions</button>
            <Link href="/users" className="btn-secondary">Cancel</Link>
            <p className="text-xs text-gray-500">Changes take effect on the user's next page load.</p>
          </div>
        </form>
      )}
    </div>
  );
}
