import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { PageHeader, StatusBadge } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { getAuditTrail } from "@/lib/salespeople";
import { updateGLAccount, toggleGLAccount } from "../actions";

export default async function GLAccountPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string; saved?: string };
}) {
  const user = await requirePerm("coa");
  const a = await prisma.gLAccount.findUnique({
    where: { id: params.id },
    include: {
      cashAccounts: { select: { id: true, name: true } },
      _count: { select: { expenses: true } },
    },
  });
  if (!a) notFound();
  const canEdit = user.perm === "READ_WRITE" && (!a.isSystem || user.role === "SUPER_ADMIN");
  const inUse = a.cashAccounts.length > 0 || a._count.expenses > 0;
  const audit = await getAuditTrail("GLAccount", a.id, 30);
  const groups = (await prisma.gLAccount.findMany({ distinct: ["group"], select: { group: true }, orderBy: { group: "asc" } })).map((g) => g.group);

  return (
    <div className="max-w-3xl">
      <Link href="/finance/coa" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
        ← Back to Chart of Accounts
      </Link>
      <PageHeader title={`${a.code} — ${a.description}`}>
        <StatusBadge status={a.status} />
        {a.isSystem && <span className="rounded bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">SYSTEM ACCOUNT</span>}
      </PageHeader>

      {searchParams.error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">⚠</span> {searchParams.error}</p>
      )}
      {searchParams.saved && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✔ Saved.</p>}

      {inUse && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          In use: {a.cashAccounts.length > 0 && `${a.cashAccounts.length} cash/bank account(s) (${a.cashAccounts.map((c) => c.name).join(", ")})`}
          {a.cashAccounts.length > 0 && a._count.expenses > 0 && " · "}
          {a._count.expenses > 0 && `${a._count.expenses} expense(s)`} — this account can be deactivated but never deleted.
        </p>
      )}

      <form action={updateGLAccount} className="card space-y-3">
        <input type="hidden" name="id" value={a.id} />
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Account Code</label><input name="code" defaultValue={a.code} required disabled={!canEdit} className="input font-mono" /></div>
          <div>
            <label className="label">Financial Statement</label>
            <select name="statement" defaultValue={a.statement} disabled={!canEdit} className="input">
              <option value="BS">Balance Sheet (BS)</option>
              <option value="IS">Income Statement (IS)</option>
            </select>
          </div>
          <div className="col-span-2"><label className="label">GL Account Description</label><input name="description" defaultValue={a.description} required disabled={!canEdit} className="input" /></div>
          <div>
            <label className="label">Account Group</label>
            <input name="group" defaultValue={a.group} required disabled={!canEdit} className="input" list="coa-groups" />
            <datalist id="coa-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
          </div>
          <div>
            <label className="label">Normal Balance</label>
            <select name="normalBalance" defaultValue={a.normalBalance} disabled={!canEdit} className="input"><option>Debit</option><option>Credit</option></select>
          </div>
        </div>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="allowManualEntry" defaultChecked={a.allowManualEntry} disabled={!canEdit} /> Allow manual journal entry
          </label>
          <label className="flex items-center gap-2 text-sm" title="System accounts are used automatically by BMS modules; only the Super Admin can change them.">
            <input type="checkbox" name="isSystem" defaultChecked={a.isSystem} disabled={user.role !== "SUPER_ADMIN"} /> System account (protected)
          </label>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button className="btn-primary" type="submit">Save Changes</button>
          </div>
        )}
        {!canEdit && a.isSystem && (
          <p className="text-xs text-amber-700">System account — only the Super Admin can modify or deactivate it.</p>
        )}
      </form>

      {canEdit && (
        <form action={toggleGLAccount} className="mt-3">
          <input type="hidden" name="id" value={a.id} />
          <button
            className={a.status === "Active"
              ? "rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              : "btn-secondary"}
            type="submit"
          >
            {a.status === "Active" ? "Deactivate Account" : "Reactivate Account"}
          </button>
        </form>
      )}

      {audit.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 font-semibold">Audit Trail</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr><th className="table-th">When</th><th className="table-th">Action</th><th className="table-th">Detail</th><th className="table-th">By</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {audit.map((e) => (
                  <tr key={e.id}>
                    <td className="table-td whitespace-nowrap text-xs">{fmtDateTime(e.createdAt)}</td>
                    <td className="table-td text-xs font-semibold">{e.action}</td>
                    <td className="table-td text-xs">{e.detail}</td>
                    <td className="table-td text-xs text-gray-600">{e.actorName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
