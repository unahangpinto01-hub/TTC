import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { FUNCTIONS, getStoredPerm } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { updateUserPerms } from "../actions";

const LEVELS = [
  ["NONE", "No Access"],
  ["READ_WRITE", "Read/Write"],
  ["READ_ONLY", "Read Only"],
] as const;

export default async function UserDetailPage({ params }: { params: { id: string } }) {
  await requirePerm("users");
  const target = await prisma.user.findUnique({ where: { id: params.id }, include: { customer: true } });
  if (!target) notFound();

  return (
    <div className="max-w-3xl">
      <Link href="/users" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
        ← Back to Users
      </Link>
      <PageHeader title={target.name} />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card py-3"><p className="text-xs text-gray-500">Email</p><p className="text-sm font-semibold">{target.email}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Role</p><p className="text-sm font-semibold">{target.role.replace("_", " ")}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Account</p><p className="text-sm font-semibold">{target.access === "NONE" ? "No Access" : target.access === "READ_ONLY" ? "Read Only (capped)" : "Enabled"}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">{target.role === "DEALER" ? "Dealer Account" : "Created"}</p><p className="text-sm font-semibold">{target.role === "DEALER" ? target.customer?.businessName ?? "—" : fmtDate(target.createdAt)}</p></div>
      </div>

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
