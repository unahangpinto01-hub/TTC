import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { createUser, setUserAccess } from "./actions";
import { UserNotice } from "./notice";

const ACCESS_OPTIONS = [
  ["NONE", "No Access"],
  ["READ_WRITE", "Read/Write"],
  ["READ_ONLY", "Read Only"],
] as const;

function AccessBadge({ access }: { access: string }) {
  const cls =
    access === "READ_WRITE"
      ? "bg-emerald-100 text-emerald-800"
      : access === "READ_ONLY"
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-700";
  const label = ACCESS_OPTIONS.find(([k]) => k === access)?.[1] ?? access;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

export default async function UsersPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const me = await requirePerm("users");
  const [users, customers] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" }, include: { customer: true } }),
    prisma.customer.findMany({ where: { status: "Active" }, orderBy: { businessName: "asc" } }),
  ]);

  return (
    <div>
      <PageHeader title="User Management" />
      <UserNotice searchParams={searchParams} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[760px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="table-th">Name</th>
                  <th className="table-th">Email</th>
                  <th className="table-th">Role</th>
                  <th className="table-th">Account</th>
                  <th className="table-th">Permissions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((u) => (
                  <tr key={u.id} className={u.access === "NONE" ? "opacity-60" : ""}>
                    <td className="table-td font-medium">
                      <Link href={`/users/${u.id}`} className="text-emerald-700 hover:underline">{u.name}</Link>
                      {u.id === me.id && <span className="ml-1 text-xs text-gray-400">(you)</span>}
                      <p className="text-xs text-gray-400">{fmtDate(u.createdAt)}</p>
                    </td>
                    <td className="table-td text-sm">{u.email}</td>
                    <td className="table-td"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold">{u.role.replace("_", " ")}</span></td>
                    <td className="table-td">
                      {u.id === me.id ? (
                        <AccessBadge access={u.access} />
                      ) : (
                        <form action={setUserAccess} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="id" value={u.id} />
                          <select name="access" defaultValue={u.access} className="input w-auto px-2 py-1 text-xs">
                            {ACCESS_OPTIONS.map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                          <button className="btn-secondary px-2 py-0.5 text-xs" type="submit">Save</button>
                        </form>
                      )}
                    </td>
                    <td className="table-td">
                      {u.role === "SUPER_ADMIN" ? (
                        <span className="text-xs font-semibold text-emerald-700">👑 Full access</span>
                      ) : u.role === "DEALER" ? (
                        <span className="text-xs text-gray-400">portal only</span>
                      ) : (
                        <Link href={`/users/${u.id}`} className="text-sm font-medium text-emerald-700 hover:underline">
                          Configure →
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            <span className="font-semibold">Account</span> is the master switch (No Access blocks sign-in; Read Only caps every function to viewing).
            Click a user or <span className="font-semibold">Configure →</span> to set per-function permissions
            (No Access / Read-Write / Read Only for each function). Super Admin always has full access.
          </p>
        </div>
        <form action={createUser} className="card h-fit space-y-3">
          <h2 className="font-semibold">Add User</h2>
          <div><label className="label">Name</label><input name="name" required className="input" /></div>
          <div><label className="label">Email</label><input name="email" type="email" required className="input" /></div>
          <div><label className="label">Password</label><input name="password" type="text" required minLength={8} className="input" defaultValue="password123" /></div>
          <div>
            <label className="label">Role</label>
            <select name="role" className="input">
              <option value="CLERK">Clerk</option>
              <option value="ADMIN">Admin</option>
              <option value="SUPER_ADMIN">Super Admin</option>
              <option value="DEALER">Dealer</option>
            </select>
          </div>
          <div>
            <label className="label">Permission</label>
            <select name="access" className="input">
              <option value="READ_WRITE">Read/Write</option>
              <option value="READ_ONLY">Read Only</option>
              <option value="NONE">No Access</option>
            </select>
          </div>
          <div>
            <label className="label">Dealer account (for DEALER role)</label>
            <select name="customerId" className="input">
              <option value="">—</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.businessName}</option>)}
            </select>
          </div>
          <button className="btn-primary" type="submit">Create User</button>
        </form>
      </div>
    </div>
  );
}
