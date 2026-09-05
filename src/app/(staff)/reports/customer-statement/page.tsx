import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { SearchSelect } from "@/components/search-select";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { PrintButton, BackButton } from "@/components/print-button";

/** Customer Statement of Account: invoices charged, payments received, running balance. */
export default async function CustomerStatementPage({
  searchParams,
}: {
  searchParams: { company?: string; customer?: string; from?: string; to?: string };
}) {
  const user = await requirePerm("reports");
  const scope = await resolveReportScope(user, searchParams.company);
  const year = new Date().getFullYear();
  const from = searchParams.from ? new Date(searchParams.from) : new Date(year, 0, 1);
  const to = searchParams.to ? new Date(searchParams.to) : new Date();
  to.setHours(23, 59, 59, 999);

  const customer = searchParams.customer
    ? await prisma.customer.findUnique({ where: { id: searchParams.customer }, select: { id: true, businessName: true, province: true, address: true } })
    : null;

  type Row = { date: Date; company: string; doc: string; detail: string; charge: number; payment: number };
  let rows: Row[] = [];
  let opening = 0;

  if (customer) {
    const srs = await prisma.salesReceipt.findMany({
      where: { customerId: customer.id, companyId: { in: scope.ids }, status: { not: "Void" } },
      include: { company: { select: { companyName: true } }, payments: { include: { application: { include: { receivePayment: { select: { prNumber: true } } } } } } },
    });
    for (const sr of srs) {
      const mk = (date: Date, doc: string, detail: string, charge: number, payment: number): Row => ({
        date, company: sr.company.companyName, doc, detail, charge, payment,
      });
      if (sr.invoiceDate < from) opening += sr.amount;
      else if (sr.invoiceDate <= to) rows.push(mk(sr.invoiceDate, sr.srNumber, `Invoice · due ${fmtDate(sr.dueDate)}`, sr.amount, 0));
      for (const p of sr.payments) {
        const label = p.application?.receivePayment?.prNumber ?? p.refNo ?? p.method;
        if (p.date < from) opening -= p.amount;
        else if (p.date <= to) rows.push(mk(p.date, label, `Payment on ${sr.srNumber} (${p.method})`, 0, p.amount));
      }
    }
    rows.sort((a, b) => a.date.getTime() - b.date.getTime());
  }
  let running = opening;
  const total = rows.reduce((s, r) => s + r.charge - r.payment, opening);

  return (
    <div className="print-page">
      <div className="no-print mb-3 flex items-center justify-between">
        <BackButton />
        <PrintButton />
      </div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">{scope.company.companyName}</h1>
        <p className="text-sm text-gray-600">Customer Statement of Account{scope.combined && " · Combined (All Companies)"}</p>
        <p className="text-xs text-gray-500">
          {customer ? `${customer.businessName} · ` : ""}{fmtDate(from)} – {fmtDate(to)} · generated {fmtDateTime(new Date())}
        </p>
      </div>

      <form method="GET" className="no-print card mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div className="w-64">
          <label className="label">Customer</label>
          <SearchSelect
            entity="customers"
            name="customer"
            placeholder="Type customer name…"
            submitOnSelect
            defaultValue={customer ? { id: customer.id, label: customer.businessName, sub: customer.province } : null}
          />
        </div>
        <div className="w-40"><label className="label">From</label><input type="date" name="from" defaultValue={from.toISOString().slice(0, 10)} className="input" /></div>
        <div className="w-40"><label className="label">To</label><input type="date" name="to" defaultValue={to.toISOString().slice(0, 10)} className="input" /></div>
        <button className="btn-primary" type="submit">Apply</button>
      </form>

      {!customer ? (
        <p className="card p-8 text-center text-sm text-gray-500">Pick a customer to build their statement.</p>
      ) : (
        <>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b-2 border-gray-300 bg-gray-50">
                <tr>
                  <th className="table-th">Date</th>
                  {scope.combined && <th className="table-th">Company</th>}
                  <th className="table-th">Document</th>
                  <th className="table-th">Particulars</th>
                  <th className="table-th text-right">Charges</th>
                  <th className="table-th text-right">Payments</th>
                  <th className="table-th text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr className="bg-gray-50">
                  <td className="table-td text-xs" colSpan={scope.combined ? 6 : 5}>Balance forwarded (before {fmtDate(from)})</td>
                  <td className="table-td text-right font-semibold">{peso(opening)}</td>
                </tr>
                {rows.map((r, i) => {
                  running += r.charge - r.payment;
                  return (
                    <tr key={i}>
                      <td className="table-td whitespace-nowrap text-sm">{fmtDate(r.date)}</td>
                      {scope.combined && <td className="table-td"><CompanyTag name={r.company} /></td>}
                      <td className="table-td font-mono text-xs font-semibold">{r.doc}</td>
                      <td className="table-td text-xs text-gray-600">{r.detail}</td>
                      <td className="table-td text-right">{r.charge ? peso(r.charge) : "—"}</td>
                      <td className="table-td text-right text-emerald-700">{r.payment ? peso(r.payment) : "—"}</td>
                      <td className="table-td text-right font-semibold">{peso(running)}</td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr><td colSpan={scope.combined ? 7 : 6} className="p-6 text-center text-sm text-gray-500">No transactions in this period.</td></tr>
                )}
              </tbody>
              <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                <tr>
                  <td colSpan={scope.combined ? 6 : 5} className="table-td">BALANCE DUE</td>
                  <td className={`table-td text-right ${total > 0.005 ? "text-red-600" : "text-emerald-700"}`}>{peso(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Charges are non-void invoices; payments include both direct invoice payments and posted Receive
            Payment applications (shown by their PR number). Unapplied customer credit is not deducted here until
            it is applied to an invoice.
          </p>
        </>
      )}
    </div>
  );
}
