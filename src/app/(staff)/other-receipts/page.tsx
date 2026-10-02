import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { LiveSearch } from "@/components/live-search";
import { OR_STATUSES } from "@/lib/other-receipts";

/** Money in that is not a customer collection — see lib/other-receipts.ts. */
export default async function OtherReceiptsListPage({ searchParams }: { searchParams: { q?: string; status?: string } }) {
  const user = await requirePerm("otherReceipts");
  const company = await getActiveCompany(user);
  const q = searchParams.q?.trim() || "";
  const status = (OR_STATUSES as readonly string[]).includes(searchParams.status || "") ? searchParams.status! : "";

  const receipts = await prisma.otherReceipt.findMany({
    where: {
      companyId: company.id,
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { crNumber: { contains: q, mode: "insensitive" } },
              { refNo: { contains: q, mode: "insensitive" } },
              { checkNo: { contains: q, mode: "insensitive" } },
              { payor: { contains: q, mode: "insensitive" } },
              { lines: { some: { OR: [{ description: { contains: q, mode: "insensitive" } }, { glAccount: { description: { contains: q, mode: "insensitive" } } }] } } },
            ],
          }
        : {}),
    },
    include: {
      cashAccount: { select: { name: true } },
      receivedBy: { select: { name: true } },
      lines: { select: { amount: true, glAccount: { select: { code: true, description: true } } }, orderBy: { sortOrder: "asc" } },
    },
    orderBy: [{ date: "desc" }, { crNumber: "desc" }],
    take: 200,
  });
  const canEdit = user.perm === "READ_WRITE";
  const posted = receipts.filter((r) => r.status === "Posted").reduce((s, r) => s + r.amount, 0);

  return (
    <div>
      <PageHeader title={`Other Receipts — ${company.companyName}`}>
        <Link href="/reports/cash-receipts" className="btn-secondary">Cash Receipts Journal</Link>
        {canEdit && <Link href="/other-receipts/new" className="btn-primary">+ New Receipt</Link>}
      </PageHeader>
      <p className="mb-3 max-w-4xl text-sm text-gray-600">
        Money received that is not a customer paying an invoice: an employee repaying an advance or a salary loan, a director returning a
        loan, an affiliate settling advances, bank interest, a refund from a supplier. Customer collections go through Receive Payments.
      </p>

      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <LiveSearch placeholder="CR #, payor, reference, account…" />
        <select name="status" defaultValue={status} className="input max-w-[180px]">
          <option value="">All statuses</option>
          {OR_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[960px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">CR No.</th>
              <th className="table-th">Date</th>
              <th className="table-th">Payor</th>
              <th className="table-th">Credited to</th>
              <th className="table-th">Method</th>
              <th className="table-th">Bank / Cash</th>
              <th className="table-th text-right">Amount</th>
              <th className="table-th">Received By</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {receipts.map((r) => (
              <tr key={r.id} className={`hover:bg-gray-50 ${r.status === "Void" || r.status === "Cancelled" ? "opacity-50" : ""}`}>
                <td className="table-td"><Link href={`/other-receipts/${r.id}`} className="font-mono text-sm font-semibold text-emerald-700 hover:underline">{r.crNumber}</Link></td>
                <td className="table-td whitespace-nowrap text-sm">{fmtDate(r.date)}</td>
                <td className="table-td text-sm">{r.payor}</td>
                <td className="table-td text-xs text-gray-600">{[...new Set(r.lines.map((l) => `${l.glAccount.code} ${l.glAccount.description}`))].join(", ")}</td>
                <td className="table-td text-sm">{r.method}{r.checkNo ? ` · ${r.checkNo}` : ""}</td>
                <td className="table-td text-sm">{r.cashAccount?.name ?? "—"}</td>
                <td className="table-td text-right font-semibold">{peso(r.amount)}</td>
                <td className="table-td text-xs text-gray-600">{r.receivedBy?.name ?? "—"}</td>
                <td className="table-td"><StatusBadge status={r.status} /></td>
              </tr>
            ))}
            {!receipts.length && <tr><td colSpan={9} className="p-8 text-center text-sm text-gray-500">No other receipts yet.</td></tr>}
          </tbody>
          {receipts.length > 0 && (
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <tr><td className="table-td" colSpan={6}>POSTED, IN THIS LIST</td><td className="table-td text-right">{peso(posted)}</td><td colSpan={2} /></tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">Draft → Pending Approval → Posted. Only a Posted receipt reaches the cash/bank balance and the ledger; voiding takes it out again.</p>
    </div>
  );
}
