import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { PageHeader, StatusBadge } from "@/components/ui";
import { saveDiscountReason } from "./actions";

const ERRORS: Record<string, string> = {
  fields: "A reason name is required.",
  account: "That account is not an active Chart of Accounts entry.",
  dupe: "That reason is already in the list.",
};

/** The reasons an Other Discount on a receive payment may be granted for, each with the account it is booked to. */
export default async function DiscountReasonsPage({ searchParams }: { searchParams: { error?: string; saved?: string } }) {
  const user = await requirePerm("coa");
  const canEdit = user.perm === "READ_WRITE";
  const [reasons, accounts] = await Promise.all([
    prisma.otherDiscountReason.findMany({ include: { glAccount: { select: { code: true, description: true } }, _count: { select: { applications: true } } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.gLAccount.findMany({ where: { status: "Active", statement: "IS" }, select: { id: true, code: true, description: true }, orderBy: { code: "asc" } }),
  ]);
  const AccountSelect = ({ name, value }: { name: string; value: string }) => (
    <select name={name} defaultValue={value} className="input w-72 py-1 text-xs">
      <option value="">— company default (Other Discount account) —</option>
      {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.description}</option>)}
    </select>
  );

  return (
    <div className="max-w-5xl">
      <PageHeader title="Other Discount Reasons" />
      {searchParams.error && ERRORS[searchParams.error] && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">⚠ {ERRORS[searchParams.error]}</p>}
      {searchParams.saved && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✔ Saved.</p>}
      <p className="mb-4 text-sm text-gray-600">
        An Other Discount on a receive payment is any approved discount that is not a prompt payment discount, and it must carry one of these reasons.
        Each reason books to its own account, or to the company&rsquo;s Other Discount account when none is set here; a reason marked
        <span className="font-semibold"> remarks required</span> cannot be used without an explanation. The prompt payment discount has its own
        account and policy on Company Details.
      </p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[860px]">
          <thead className="border-b border-gray-200 bg-gray-50"><tr><th className="table-th">Order</th><th className="table-th">Reason</th><th className="table-th">Booked to</th><th className="table-th">Remarks</th><th className="table-th">Status</th><th className="table-th text-right">Used</th>{canEdit && <th className="table-th" />}</tr></thead>
          <tbody className="divide-y divide-gray-100">
            {reasons.map((r) => (
              <tr key={r.id}>
                {canEdit ? (
                  <td colSpan={7} className="p-0">
                    <form action={saveDiscountReason} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <input type="hidden" name="id" value={r.id} />
                      <input name="sortOrder" type="number" defaultValue={r.sortOrder} className="input w-16 py-1 text-right" />
                      <input name="name" defaultValue={r.name} className="input w-60 py-1" />
                      <AccountSelect name="glAccountId" value={r.glAccountId ?? ""} />
                      <label className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" name="requiresRemarks" defaultChecked={r.requiresRemarks} /> remarks required</label>
                      <select name="status" defaultValue={r.status} className="input w-28 py-1"><option>Active</option><option>Inactive</option></select>
                      <span className="text-xs text-gray-500">{r._count.applications} use{r._count.applications === 1 ? "" : "s"}</span>
                      <button className="btn-secondary py-1" type="submit">Save</button>
                    </form>
                  </td>
                ) : (
                  <>
                    <td className="table-td text-sm text-gray-500">{r.sortOrder}</td>
                    <td className="table-td text-sm">{r.name}</td>
                    <td className="table-td text-sm">{r.glAccount ? `${r.glAccount.code} ${r.glAccount.description}` : "company default"}</td>
                    <td className="table-td text-xs text-gray-600">{r.requiresRemarks ? "required" : "optional"}</td>
                    <td className="table-td"><StatusBadge status={r.status} /></td>
                    <td className="table-td text-right text-sm">{r._count.applications}</td>
                  </>
                )}
              </tr>
            ))}
            {!reasons.length && <tr><td colSpan={7} className="p-6 text-center text-sm text-gray-500">No reasons yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <form action={saveDiscountReason} className="card mt-4 space-y-3">
          <h2 className="font-semibold">Add a reason</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div><label className="label">Reason</label><input name="name" required placeholder="e.g. Volume Rebate" className="input w-60" /></div>
            <div><label className="label">Booked to</label><AccountSelect name="glAccountId" value="" /></div>
            <div><label className="label">Order</label><input name="sortOrder" type="number" defaultValue={reasons.length + 1} className="input w-20 text-right" /></div>
            <label className="flex items-center gap-1 pb-2 text-xs text-gray-600"><input type="checkbox" name="requiresRemarks" /> remarks required</label>
            <button className="btn-primary" type="submit">Add</button>
          </div>
        </form>
      )}
    </div>
  );
}
