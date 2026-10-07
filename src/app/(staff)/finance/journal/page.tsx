import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { LiveSearch } from "@/components/live-search";
import { JV_STATUSES, totalsOf } from "@/lib/journal";

/** The general journal — see lib/journal.ts. */
export default async function JournalListPage({ searchParams }: { searchParams: { q?: string; status?: string; from?: string; to?: string } }) {
  const user = await requirePerm("journal");
  const company = await getActiveCompany(user);
  const q = searchParams.q?.trim() || "";
  const status = (JV_STATUSES as readonly string[]).includes(searchParams.status || "") ? searchParams.status! : "";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.from || "") ? new Date(searchParams.from!) : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.to || "") ? new Date(searchParams.to! + "T23:59:59.999Z") : null;

  const vouchers = await prisma.journalVoucher.findMany({
    where: {
      companyId: company.id,
      ...(status ? { status } : {}),
      ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(q
        ? {
            OR: [
              { jvNumber: { contains: q, mode: "insensitive" } },
              { refNo: { contains: q, mode: "insensitive" } },
              { memo: { contains: q, mode: "insensitive" } },
              { lines: { some: { OR: [{ description: { contains: q, mode: "insensitive" } }, { glAccount: { description: { contains: q, mode: "insensitive" } } }, { glAccount: { code: { startsWith: q } } }] } } },
            ],
          }
        : {}),
    },
    include: {
      preparedBy: { select: { name: true } },
      lines: { select: { debit: true, credit: true, glAccount: { select: { code: true, description: true } } }, orderBy: { sortOrder: "asc" } },
    },
    orderBy: [{ date: "desc" }, { jvNumber: "desc" }],
    take: 300,
  });
  const canEdit = user.perm === "READ_WRITE";
  const posted = vouchers.filter((v) => v.status === "Posted").reduce((s, v) => s + totalsOf(v.lines).debit, 0);

  return (
    <div>
      <PageHeader title={`General Journal — ${company.companyName}`}>
        <Link href="/finance/ledger" className="btn-secondary">Ledger</Link>
        {canEdit && <Link href="/finance/journal/new" className="btn-primary">+ New Voucher</Link>}
      </PageHeader>
      <p className="mb-3 max-w-4xl text-sm text-gray-600">
        Journal vouchers for what no other document can carry: accruals, depreciation, bank charges and autodebits, dividends applied to a
        shareholder&rsquo;s account, intercompany settlements, reclassifications. Sales, collections, bills, cheques and receipts keep their own
        modules and reach the ledger from there.
      </p>

      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <LiveSearch placeholder="JV #, reference, memo, account…" />
        <input name="from" type="date" defaultValue={searchParams.from ?? ""} className="input max-w-[160px]" />
        <input name="to" type="date" defaultValue={searchParams.to ?? ""} className="input max-w-[160px]" />
        <select name="status" defaultValue={status} className="input max-w-[180px]">
          <option value="">All statuses</option>
          {JV_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[960px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">JV No.</th>
              <th className="table-th">Date</th>
              <th className="table-th">Reference</th>
              <th className="table-th">Explanation</th>
              <th className="table-th">Debits / Credits</th>
              <th className="table-th text-right">Amount</th>
              <th className="table-th">Prepared By</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {vouchers.map((v) => (
              <tr key={v.id} className={`hover:bg-gray-50 ${v.status === "Void" || v.status === "Cancelled" ? "opacity-50" : ""}`}>
                <td className="table-td"><Link href={`/finance/journal/${v.id}`} className="font-mono text-sm font-semibold text-emerald-700 hover:underline">{v.jvNumber}</Link></td>
                <td className="table-td whitespace-nowrap text-sm">{fmtDate(v.date)}</td>
                <td className="table-td text-xs text-gray-600">{v.refNo ?? "—"}</td>
                <td className="table-td text-sm">{v.memo}</td>
                <td className="table-td text-xs text-gray-600">
                  {[...new Set(v.lines.filter((l) => l.debit > 0).map((l) => l.glAccount.code))].join(", ")} / {[...new Set(v.lines.filter((l) => l.credit > 0).map((l) => l.glAccount.code))].join(", ")}
                </td>
                <td className="table-td text-right font-semibold">{peso(totalsOf(v.lines).debit)}</td>
                <td className="table-td text-xs text-gray-600">{v.preparedBy?.name ?? (v.source === "IMPORT" ? "from the books" : "—")}</td>
                <td className="table-td"><StatusBadge status={v.status} /></td>
              </tr>
            ))}
            {!vouchers.length && <tr><td colSpan={8} className="p-8 text-center text-sm text-gray-500">No journal vouchers yet.</td></tr>}
          </tbody>
          {vouchers.length > 0 && (
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <tr><td className="table-td" colSpan={5}>POSTED, IN THIS LIST</td><td className="table-td text-right">{peso(posted)}</td><td colSpan={2} /></tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">Draft → Pending Approval → Posted. Only a Posted voucher reaches the ledger and the bank balances; voiding takes it out again.</p>
    </div>
  );
}
