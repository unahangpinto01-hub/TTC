import Link from "next/link";
import { Fragment } from "react";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { SearchSelect } from "@/components/search-select";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { parseRange } from "@/lib/reports";
import { PrintButton, BackButton } from "@/components/print-button";
import { PAYMENT_METHODS, unappliedOf } from "@/lib/receive-payments";

const STATUSES = ["Posted", "Draft", "Pending Approval", "Cancelled", "Void"];

/** Receive Payment Register — doubles as the Daily Collection Report (rows are grouped
    per day with subtotals) and, filtered to one customer, the Customer Payment History. */
export default async function PaymentRegisterPage({
  searchParams,
}: {
  searchParams: { company?: string; from?: string; to?: string; customer?: string; method?: string; status?: string };
}) {
  const user = await requirePerm("reports");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const method = (PAYMENT_METHODS as readonly string[]).includes(searchParams.method || "") ? searchParams.method! : "";
  const status = STATUSES.includes(searchParams.status || "") ? searchParams.status! : "Posted";

  const pickedCustomer = searchParams.customer
    ? await prisma.customer.findUnique({ where: { id: searchParams.customer }, select: { id: true, businessName: true } })
    : null;

  const payments = await prisma.receivePayment.findMany({
    where: {
      companyId: { in: scope.ids },
      status,
      date: { gte: range.from, lte: range.to },
      ...(method ? { method } : {}),
      ...(pickedCustomer ? { customerId: pickedCustomer.id } : {}),
    },
    include: {
      company: { select: { companyName: true } },
      customer: { select: { businessName: true } },
      cashAccount: { select: { name: true } },
      receivedBy: { select: { name: true } },
      applications: { select: { amount: true } },
      refunds: { where: { status: "Posted" }, select: { amount: true, status: true } },
    },
    orderBy: [{ date: "asc" }, { prNumber: "asc" }],
  });

  const byDay = new Map<string, typeof payments>();
  for (const p of payments) {
    const k = p.date.toISOString().slice(0, 10);
    byDay.set(k, [...(byDay.get(k) ?? []), p]);
  }
  const total = payments.reduce((s, p) => s + p.amount, 0);
  const applied = payments.reduce((s, p) => s + p.applications.reduce((x, a) => x + a.amount, 0), 0);
  const byMethod = new Map<string, number>();
  for (const p of payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amount);

  const fromStr = range.from.toISOString().slice(0, 10);
  const toStr = range.to.toISOString().slice(0, 10);

  return (
    <div className="print-page">
      <div className="no-print mb-3 flex items-center justify-between">
        <BackButton />
        <PrintButton />
      </div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">{scope.company.companyName}</h1>
        <p className="text-sm text-gray-600">Receive Payment Register / Collection Report{scope.combined && " · Combined (All Companies)"}</p>
        <p className="text-xs text-gray-500">
          {fmtDate(range.from)} – {fmtDate(range.to)} · {status} payments
          {pickedCustomer ? ` · ${pickedCustomer.businessName}` : ""} · generated {fmtDateTime(new Date())}
        </p>
      </div>

      <form method="GET" className="no-print card mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div className="w-40"><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div className="w-40"><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <div className="w-52">
          <label className="label">Customer</label>
          <SearchSelect
            entity="customers"
            name="customer"
            placeholder="All customers"
            submitOnSelect
            defaultValue={pickedCustomer ? { id: pickedCustomer.id, label: pickedCustomer.businessName } : null}
          />
        </div>
        <div className="w-40">
          <label className="label">Method</label>
          <select name="method" defaultValue={method} className="input">
            <option value="">All methods</option>
            {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div className="w-44">
          <label className="label">Status</label>
          <select name="status" defaultValue={status} className="input">
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <button className="btn-primary" type="submit">Apply</button>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card py-3"><p className="text-xs text-gray-500">Payments</p><p className="text-lg font-bold">{payments.length}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Total Collected</p><p className="text-lg font-bold text-emerald-800">{peso(total)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Applied to Invoices</p><p className="text-lg font-bold">{peso(applied)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Unapplied (credit)</p><p className="text-lg font-bold text-amber-700">{peso(total - applied)}</p></div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        {[...byMethod.entries()].map(([m, v]) => (
          <span key={m} className="rounded-full bg-gray-100 px-3 py-1">{m}: <span className="font-bold">{peso(v)}</span></span>
        ))}
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="border-b-2 border-gray-300 bg-gray-50">
            <tr>
              <th className="table-th">PR No.</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Customer</th>
              <th className="table-th">Method</th>
              <th className="table-th">Reference</th>
              <th className="table-th">Account</th>
              <th className="table-th text-right">Amount</th>
              <th className="table-th text-right">Applied</th>
              <th className="table-th text-right">Unapplied</th>
              <th className="table-th">Received By</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {[...byDay.entries()].map(([day, rows]) => (
              <Fragment key={day}>
                <tr className="bg-emerald-50/80">
                  <td colSpan={scope.combined ? 10 : 9} className="px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-900">
                    {fmtDate(rows[0].date)} — {rows.length} payment(s), {peso(rows.reduce((s, p) => s + p.amount, 0))}
                  </td>
                </tr>
                {rows.map((p) => {
                  const app = p.applications.reduce((s, a) => s + a.amount, 0);
                  return (
                    <tr key={p.id}>
                      <td className="table-td">
                        <Link href={`/payments/${p.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{p.prNumber}</Link>
                      </td>
                      {scope.combined && <td className="table-td"><CompanyTag name={p.company.companyName} /></td>}
                      <td className="table-td text-sm">{p.customer.businessName}</td>
                      <td className="table-td text-sm">{p.method}</td>
                      <td className="table-td text-xs text-gray-500">{[p.refNo, p.checkNo && `Chk ${p.checkNo}`].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="table-td text-xs text-gray-500">{p.cashAccount?.name ?? "—"}</td>
                      <td className="table-td text-right font-semibold">{peso(p.amount)}</td>
                      <td className="table-td text-right">{peso(app)}</td>
                      <td className={`table-td text-right ${unappliedOf(p) > 0.005 ? "font-semibold text-amber-700" : "text-gray-400"}`}>
                        {unappliedOf(p) > 0.005 ? peso(unappliedOf(p)) : "—"}
                      </td>
                      <td className="table-td text-xs text-gray-600">{p.receivedBy?.name ?? "—"}</td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
            {!payments.length && (
              <tr><td colSpan={scope.combined ? 10 : 9} className="p-8 text-center text-sm text-gray-500">No payments in this period.</td></tr>
            )}
          </tbody>
          {payments.length > 0 && (
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <tr>
                <td colSpan={scope.combined ? 6 : 5} className="table-td">TOTAL</td>
                <td className="table-td text-right text-emerald-800">{peso(total)}</td>
                <td className="table-td text-right">{peso(applied)}</td>
                <td className="table-td text-right text-amber-700">{total - applied > 0.005 ? peso(total - applied) : "—"}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
