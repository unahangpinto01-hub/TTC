import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate } from "@/lib/format";
import { BILL_STATUSES, outstandingOf } from "@/lib/bills";
import { PageHeader, StatusBadge } from "@/components/ui";
import { LiveSearch } from "@/components/live-search";

export default async function ExpenseBillsPage({ searchParams }: { searchParams: { status?: string; q?: string } }) {
  const user = await requirePerm("expenses");
  const company = await getActiveCompany(user);
  const canEdit = user.perm === "READ_WRITE";

  const where: any = { companyId: company.id, kind: "EXPENSE" };
  if ((BILL_STATUSES as readonly string[]).includes(searchParams.status ?? "")) where.status = searchParams.status;
  const q = searchParams.q?.trim();
  if (q) {
    where.OR = [
      { billNo: { contains: q, mode: "insensitive" } },
      { supplierInvoiceNo: { contains: q, mode: "insensitive" } },
      { memo: { contains: q, mode: "insensitive" } },
      { supplier: { name: { contains: q, mode: "insensitive" } } },
      { expenseLines: { some: { OR: [{ description: { contains: q, mode: "insensitive" } }, { glAccount: { description: { contains: q, mode: "insensitive" } } }] } } },
    ];
  }
  const bills = await prisma.supplierBill.findMany({
    where,
    orderBy: [{ billDate: "desc" }, { billNo: "desc" }],
    take: 150,
    include: { supplier: { select: { name: true } }, expenseLines: { include: { glAccount: { select: { description: true } } } } },
  });
  const today = Date.now();
  const openTotal = bills.reduce((s, b) => s + outstandingOf(b), 0);

  return (
    <div>
      <PageHeader title="Enter Bills — Non-Inventory">
        <Link href="/finance/ap" className="btn-secondary">AP Aging</Link>
        {canEdit && <Link href="/bills/expense/new" className="btn-primary">+ New Non-Inventory Bill</Link>}
      </PageHeader>
      <form method="GET" className="mb-4 flex flex-wrap gap-2">
        <LiveSearch placeholder="Bill no., supplier, reference, account or description…" />
        <select name="status" defaultValue={searchParams.status ?? ""} className="input max-w-[190px]">
          <option value="">All statuses</option>
          {BILL_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn-secondary" type="submit">Filter</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Bill #</th>
              <th className="table-th">Bill Date</th>
              <th className="table-th">Due</th>
              <th className="table-th">Supplier / Payee</th>
              <th className="table-th">Reference</th>
              <th className="table-th">Charged to</th>
              <th className="table-th text-right">Total</th>
              <th className="table-th text-right">Outstanding</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {bills.map((b) => {
              const outstanding = outstandingOf(b);
              const overdue = outstanding > 0 && b.dueDate.getTime() < today;
              return (
                <tr key={b.id} className={b.status === "Void" ? "opacity-50" : "hover:bg-gray-50"}>
                  <td className="table-td"><Link href={`/bills/${b.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{b.billNo}</Link></td>
                  <td className="table-td text-sm">{fmtDate(b.billDate)}</td>
                  <td className={`table-td text-sm ${overdue ? "font-semibold text-red-600" : ""}`}>{fmtDate(b.dueDate)}{overdue && <span className="block text-[10px] font-normal">overdue</span>}</td>
                  <td className="table-td text-sm">{b.supplier.name}</td>
                  <td className="table-td text-xs text-gray-600">{b.supplierInvoiceNo || (b.invoiceUnavailable ? <span className="italic text-gray-400">not available</span> : "—")}</td>
                  <td className="table-td text-xs text-gray-600">{[...new Set(b.expenseLines.map((l) => l.glAccount.description))].join(", ") || "—"}</td>
                  <td className="table-td text-right font-semibold">{peso(b.total)}</td>
                  <td className={`table-td text-right ${outstanding ? "font-semibold text-red-600" : "text-gray-400"}`}>{outstanding ? peso(outstanding) : "—"}</td>
                  <td className="table-td"><StatusBadge status={b.status} /></td>
                </tr>
              );
            })}
            {!bills.length && <tr><td colSpan={9} className="p-8 text-center text-sm text-gray-500">No non-inventory bills yet.</td></tr>}
          </tbody>
          {bills.length > 0 && (
            <tfoot className="border-t border-gray-200 bg-gray-50 font-bold"><tr><td className="table-td" colSpan={7}>OUTSTANDING ON THESE BILLS</td><td className="table-td text-right text-red-600">{peso(openTotal)}</td><td /></tr></tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        A non-inventory bill books the expense to the accounts chosen and raises the supplier&rsquo;s payable — Dr Expense, Dr Input VAT,
        Cr Accounts Payable. It never changes inventory. Nothing is booked while it is a <strong>Draft</strong>. Expense vouchers entered
        before this module remain under Finance → Expense Vouchers as history.
      </p>
    </div>
  );
}
