import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { createUser } from "./actions";

export default async function UsersPage() {
  await requireStaff(["SUPER_ADMIN"]);
  const [users, customers] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" }, include: { customer: true } }),
    prisma.customer.findMany({ where: { status: "Active" }, orderBy: { businessName: "asc" } }),
  ]);

  return (
    <div>
      <PageHeader title="User Management" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[560px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="table-th">Name</th>
                  <th className="table-th">Email</th>
                  <th className="table-th">Role</th>
                  <th className="table-th">Dealer Account</th>
                  <th className="table-th">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="table-td font-medium">{u.name}</td>
                    <td className="table-td text-sm">{u.email}</td>
                    <td className="table-td"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold">{u.role.replace("_", " ")}</span></td>
                    <td className="table-td text-sm text-gray-600">{u.customer?.businessName ?? "—"}</td>
                    <td className="table-td text-sm">{fmtDate(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
