import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { fmtDate, peso, termLabel } from "@/lib/format";
import { getPage, pageCount } from "@/lib/paginate";
import { PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { LiveSearch } from "@/components/live-search";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; page?: string; year?: string; month?: string };
}) {
  const user = await requirePerm("invoices");
  const company = await getActiveCompany(user);
  const { page, skip, take } = getPage(searchParams);
  const q = searchParams.q?.trim() || "";
  const status = searchParams.status || "";

  // period filter: a whole year, or one month within it
  const year = /^\d{4}$/.test(searchParams.year || "") ? Number(searchParams.year) : 0;
  const month = year && /^([1-9]|1[0-2])$/.test(searchParams.month || "") ? Number(searchParams.month) : 0;

  const where: any = { companyId: company.id };
  if (status) where.status = status;
  if (q) where.OR = [{ srNumber: { contains: q } }, { customer: { businessName: { contains: q } } }];
  if (year) {
    const from = month ? new Date(year, month - 1, 1) : new Date(year, 0, 1);
    const to = month ? new Date(year, month, 0, 23, 59, 59, 999) : new Date(year, 11, 31, 23, 59, 59, 999);
    where.invoiceDate = { gte: from, lte: to };
  }

  const [srs, total, totals, spanRows] = await Promise.all([
    prisma.salesReceipt.findMany({
      where,
      orderBy: { invoiceDate: "desc" },
      skip,
      take,
      include: { customer: true, payments: true },
    }),
    prisma.salesReceipt.count({ where }),
    // totals cover the whole filtered set, not just the page on screen
    prisma.salesReceipt.findMany({ where, select: { amount: true, payments: { select: { amount: true } } } }),
    // years that actually have invoices, so the picker only offers real periods
    prisma.salesReceipt.findMany({
      where: { companyId: company.id },
      select: { invoiceDate: true },
      orderBy: { invoiceDate: "asc" },
      take: 1,
    }),
  ]);

  const totalAmount = totals.reduce((s, x) => s + x.amount, 0);
  const totalBalance = totals.reduce((s, x) => s + x.amount - x.payments.reduce((p, y) => p + y.amount, 0), 0);

  const thisYear = new Date().getFullYear();
  const firstYear = spanRows.length ? spanRows[0].invoiceDate.getFullYear() : thisYear;
  const years: number[] = [];
  for (let y = thisYear; y >= Math.min(firstYear, thisYear); y--) years.push(y);

  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (status) params.status = status;
  if (year) params.year = String(year);
  if (month) params.month = String(month);

  const periodLabel = year ? `${month ? MONTHS[month - 1] + " " : ""}${year}` : "All dates";
  const now = new Date();

  return (
    <div>
      <PageHeader title="Invoices / Sales Receipts" />
      <form method="GET" className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="label">Search</label>
          <LiveSearch placeholder="SR # or customer…" />
        </div>
        <div>
          <label className="label">Year</label>
          <select name="year" defaultValue={year ? String(year) : ""} className="input max-w-[130px]">
            <option value="">All years</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Month</label>
          <select name="month" defaultValue={month ? String(month) : ""} className="input max-w-[150px]">
            <option value="">Whole year</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select name="status" defaultValue={status} className="input max-w-[140px]">
            <option value="">All statuses</option>
            <option>Open</option>
            <option>Partial</option>
            <option>Paid</option>
            <option>Void</option>
          </select>
        </div>
        <button className="btn-secondary" type="submit">Filter</button>
      </form>

      <p className="mb-3 text-sm text-gray-600">
        <span className="font-semibold">{periodLabel}</span> · {total} invoice{total === 1 ? "" : "s"} · Amount{" "}
        <span className="font-bold text-emerald-800">{peso(totalAmount)}</span> · Outstanding{" "}
        <span className={`font-bold ${totalBalance > 0 ? "text-red-600" : "text-gray-500"}`}>{peso(totalBalance)}</span>
      </p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Date</th>
              <th className="table-th">SR #</th>
              <th className="table-th">Customer</th>
              <th className="table-th">Term</th>
              <th className="table-th">Due Date</th>
              <th className="table-th text-right">Amount</th>
              <th className="table-th text-right">Balance</th>
              <th className="table-th">Aging</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {srs.map((sr) => {
              const paid = sr.payments.reduce((s, p) => s + p.amount, 0);
              const bal = sr.amount - paid;
              const overdueDays = Math.floor((now.getTime() - sr.dueDate.getTime()) / 86400000);
              const aging = sr.status === "Paid" || sr.status === "Void" ? "—" : overdueDays > 0 ? `${overdueDays}d overdue` : overdueDays > -7 ? "Due soon" : "Current";
              return (
                <tr key={sr.id} className="hover:bg-gray-50">
                  <td className="table-td text-sm">{fmtDate(sr.invoiceDate)}</td>
                  <td className="table-td">
                    <Link href={`/invoices/${sr.id}`} className="font-mono text-sm font-medium text-emerald-700 hover:underline">{sr.srNumber}</Link>
                  </td>
                  <td className="table-td">{sr.customer.businessName}</td>
                  <td className="table-td text-sm">{termLabel(sr.term)}</td>
                  <td className="table-td">{fmtDate(sr.dueDate)}</td>
                  <td className="table-td text-right">{peso(sr.amount)}</td>
                  <td className="table-td text-right font-semibold">{peso(bal)}</td>
                  <td className={`table-td text-xs font-semibold ${aging.includes("overdue") ? "text-red-600" : aging === "Due soon" ? "text-amber-600" : "text-gray-500"}`}>{aging}</td>
                  <td className="table-td"><StatusBadge status={sr.status} /></td>
                </tr>
              );
            })}
            {!srs.length && <tr><td colSpan={9} className="p-8 text-center text-sm text-gray-500">No invoices match.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={pageCount(total)} baseUrl="/invoices" params={params} />
    </div>
  );
}
