import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { PageHeader, StatusBadge } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { LiveSearch } from "@/components/live-search";
import { fmtDateTime } from "@/lib/format";
import { createGLAccount } from "./actions";

/** The Chart of Accounts — master list and report in one. The filters produce every COA
    report: by financial statement, by group, active only, inactive only. */
export default async function COAPage({
  searchParams,
}: {
  searchParams: { q?: string; group?: string; statement?: string; status?: string; error?: string };
}) {
  const user = await requirePerm("coa");
  const q = searchParams.q?.trim() || "";
  const status = ["Active", "Inactive"].includes(searchParams.status || "") ? searchParams.status! : "";
  const statement = ["BS", "IS"].includes(searchParams.statement || "") ? searchParams.statement! : "";

  const groups = (await prisma.gLAccount.findMany({ distinct: ["group"], select: { group: true }, orderBy: { group: "asc" } })).map((g) => g.group);
  const group = groups.includes(searchParams.group || "") ? searchParams.group! : "";

  const accounts = await prisma.gLAccount.findMany({
    where: {
      ...(q ? { OR: [{ code: { startsWith: q, mode: "insensitive" } }, { description: { startsWith: q, mode: "insensitive" } }] } : {}),
      ...(group ? { group } : {}),
      ...(statement ? { statement } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { code: "asc" },
  });
  const canEdit = user.perm === "READ_WRITE";
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (group) qs.set("group", group);
  if (statement) qs.set("statement", statement);
  if (status) qs.set("status", status);

  let lastGroup = "";

  return (
    <div className="print-page">
      <PageHeader title="Chart of Accounts">
        {canEdit && <Link href="/finance/coa/import" className="btn-secondary no-print">⬆ Import Masterlist</Link>}
        <a href={`/api/export/coa?${qs.toString()}`} className="btn-secondary no-print">⬇ Excel</a>
        <span className="no-print"><PrintButton /></span>
      </PageHeader>

      {searchParams.error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">⚠</span> {searchParams.error}</p>
      )}

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <LiveSearch placeholder="Type an account code or description…" />
        <select name="statement" defaultValue={statement} className="input max-w-[190px]">
          <option value="">All statements</option>
          <option value="BS">Balance Sheet (BS)</option>
          <option value="IS">Income Statement (IS)</option>
        </select>
        <select name="group" defaultValue={group} className="input max-w-[220px]">
          <option value="">All account groups</option>
          {groups.map((g) => <option key={g}>{g}</option>)}
        </select>
        <select name="status" defaultValue={status} className="input max-w-[150px]">
          <option value="">Active + Inactive</option>
          <option>Active</option>
          <option>Inactive</option>
        </select>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <p className="mb-3 hidden text-sm text-gray-600 print:block">
        Chart of Accounts{statement ? ` · ${statement}` : ""}{group ? ` · ${group}` : ""}{status ? ` · ${status} only` : ""} ·{" "}
        {accounts.length} account(s) · generated {fmtDateTime(new Date())}
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className={canEdit ? "lg:col-span-2" : "lg:col-span-3"}>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[680px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="table-th">Code</th>
                  <th className="table-th">GL Account Description</th>
                  <th className="table-th">FS</th>
                  <th className="table-th">Normal</th>
                  <th className="table-th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {accounts.map((a) => {
                  const showGroup = a.group !== lastGroup;
                  lastGroup = a.group;
                  return (
                    <>
                      {showGroup && (
                        <tr key={`g-${a.id}`} className="bg-emerald-50/80">
                          <td colSpan={5} className="px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-900">
                            {a.statement} — {a.group}
                          </td>
                        </tr>
                      )}
                      <tr key={a.id} className={`hover:bg-gray-50 ${a.status === "Inactive" ? "opacity-50" : ""}`}>
                        <td className="table-td font-mono text-sm font-semibold">
                          <Link href={`/finance/coa/${a.id}`} className="text-emerald-700 hover:underline">{a.code}</Link>
                        </td>
                        <td className="table-td text-sm">
                          {a.description}
                          {a.isSystem && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">SYSTEM</span>}
                        </td>
                        <td className="table-td text-xs text-gray-500">{a.statement}</td>
                        <td className="table-td text-xs text-gray-500">{a.normalBalance}</td>
                        <td className="table-td"><StatusBadge status={a.status} /></td>
                      </tr>
                    </>
                  );
                })}
                {!accounts.length && (
                  <tr><td colSpan={5} className="p-8 text-center text-sm text-gray-500">No accounts match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="no-print mt-2 text-xs text-gray-500">
            The single source of truth for GL accounts across the BMS — cash/bank accounts and expenses book to
            these entries, and future accounting modules will pick from this list. Accounts in use are deactivated,
            never deleted.
          </p>
        </div>

        {canEdit && (
          <form action={createGLAccount} className="no-print card h-fit space-y-3">
            <h2 className="font-semibold">Add Account</h2>
            <div><label className="label">Account Code</label><input name="code" required className="input font-mono" placeholder="600049" /></div>
            <div><label className="label">GL Account Description</label><input name="description" required className="input" /></div>
            <div>
              <label className="label">Financial Statement</label>
              <select name="statement" className="input"><option value="BS">Balance Sheet (BS)</option><option value="IS">Income Statement (IS)</option></select>
            </div>
            <div>
              <label className="label">Account Group</label>
              <input name="group" required className="input" list="coa-groups" placeholder="e.g. Current Assets" />
              <datalist id="coa-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
            </div>
            <div>
              <label className="label">Normal Balance</label>
              <select name="normalBalance" className="input"><option>Debit</option><option>Credit</option></select>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allowManualEntry" defaultChecked /> Allow manual journal entry</label>
            {user.role === "SUPER_ADMIN" && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isSystem" /> System account (protected)</label>
            )}
            <button className="btn-primary" type="submit">Add Account</button>
          </form>
        )}
      </div>
    </div>
  );
}
