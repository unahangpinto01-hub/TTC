import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { peso, fmtDate, fmtDateTime, termLabel, daysUntil } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { updateCustomer, setCustomerSalesperson } from "../actions";
import { getSalespeople, getAuditTrail } from "@/lib/salespeople";
import { getActiveCompany, allowedCompanies } from "@/lib/company";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { edit?: string; salesperson?: string; error?: string; salesYear?: string };
}) {
  const user = await requirePerm("customers");
  // A customer is shared between companies, but its ORDERS and INVOICES are not: they follow
  // the company selector, exactly as AR/Aging and Invoices do. Without this the page would
  // both show figures the user has no access to and link to records that cannot be opened.
  const company = await getActiveCompany(user);
  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    include: {
      salesperson: { select: { id: true, name: true, position: true } },
      salesOrders: { where: { companyId: company.id }, orderBy: { orderDate: "desc" }, take: 50, include: { lines: true } },
      salesReceipts: { where: { companyId: company.id }, orderBy: { invoiceDate: "desc" }, include: { payments: true } },
    },
  });
  if (!customer) notFound();
  const [salespeople, auditTrail, myCompanies] = await Promise.all([
    getSalespeople(),
    getAuditTrail("Customer", params.id),
    allowedCompanies(user),
  ]);
  // does this customer also trade with another company the viewer may open?
  const elsewhere = myCompanies.filter((c) => c.id !== company.id);
  const alsoIn = elsewhere.length
    ? await prisma.company.findMany({
        where: {
          id: { in: elsewhere.map((c) => c.id) },
          OR: [
            { salesOrders: { some: { customerId: params.id } } },
            { salesReceipts: { some: { customerId: params.id } } },
          ],
        },
        select: { id: true, companyName: true },
      })
    : [];

  const invoiced = customer.salesReceipts.filter((sr) => sr.status !== "Void");
  const totalInvoiced = invoiced.reduce((s, sr) => s + sr.amount, 0);
  const totalPaid = invoiced.reduce((s, sr) => s + sr.payments.reduce((a, p) => a + p.amount, 0), 0);
  const balance = totalInvoiced - totalPaid;
  const srBalance = (sr: (typeof invoiced)[number]) => sr.amount - sr.payments.reduce((a, p) => a + p.amount, 0);
  const totalPastDue = invoiced
    .filter((sr) => sr.dueDate < new Date() && srBalance(sr) > 0)
    .reduce((s, sr) => s + srBalance(sr), 0);

  const canEdit = user.perm === "READ_WRITE";
  const editing = canEdit && searchParams.edit === "1";

  // monthly sales for one year, from the same invoices listed below (void excluded)
  const salesYears = [...new Set(invoiced.map((sr) => sr.invoiceDate.getUTCFullYear()))].sort((a, b) => b - a);
  const wantedYear = Number(searchParams.salesYear);
  const salesYear = salesYears.includes(wantedYear) ? wantedYear : salesYears[0] ?? new Date().getFullYear();
  const monthly = MONTHS.map((label, i) => {
    const rows = invoiced.filter(
      (sr) => sr.invoiceDate.getUTCFullYear() === salesYear && sr.invoiceDate.getUTCMonth() === i
    );
    return {
      label,
      count: rows.length,
      amount: rows.reduce((s, sr) => s + sr.amount, 0),
      paid: rows.reduce((s, sr) => s + sr.payments.reduce((a, pm) => a + pm.amount, 0), 0),
    };
  });
  const yearTotal = monthly.reduce((s, m) => s + m.amount, 0);
  const yearPaid = monthly.reduce((s, m) => s + m.paid, 0);
  const yearCount = monthly.reduce((s, m) => s + m.count, 0);
  const peak = Math.max(1, ...monthly.map((m) => m.amount));

  return (
    <div>
      <Link href="/customers" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
        ← Back to Customers
      </Link>
      <PageHeader title={customer.businessName}>
        <StatusBadge status={customer.status} />
        {canEdit && !editing && (
          <Link href={`/customers/${customer.id}?edit=1`} className="btn-secondary">✎ Edit</Link>
        )}
      </PageHeader>

      {editing && (
        <form action={updateCustomer} className="card mb-4 space-y-4 border-emerald-300 bg-emerald-50/40">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Edit Customer Details</h2>
            <Link href={`/customers/${customer.id}`} className="btn-secondary">Cancel</Link>
          </div>
          <input type="hidden" name="id" value={customer.id} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div><label className="label">Business Name</label><input name="businessName" defaultValue={customer.businessName} required className="input" /></div>
            <div><label className="label">Contact Person</label><input name="contactPerson" defaultValue={customer.contactPerson} className="input" /></div>
            <div><label className="label">Mobile</label><input name="mobile" defaultValue={customer.mobile} className="input" /></div>
            <div><label className="label">Messenger Handle</label><input name="messengerHandle" defaultValue={customer.messengerHandle ?? ""} className="input" /></div>
            <div className="lg:col-span-2"><label className="label">Address</label><input name="address" defaultValue={customer.address ?? ""} className="input" /></div>
            <div>
              <label className="label">Region</label>
              <select name="region" defaultValue={customer.region} className="input"><option>Luzon</option><option>Visayas</option><option>Mindanao</option></select>
            </div>
            <div><label className="label">Province</label><input name="province" defaultValue={customer.province} className="input" /></div>
            <div><label className="label">Credit Limit (₱)</label><input name="creditLimit" type="number" step="0.01" min="0" defaultValue={customer.creditLimit} className="input" /></div>
            <div>
              <label className="label">Allowed Payment Terms</label>
              <div className="flex gap-4 pt-1.5">
                {["COD", "30", "60", "90"].map((t) => (
                  <label key={t} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name={`term_${t}`} defaultChecked={customer.allowedTerms.split(",").includes(t)} /> {termLabel(t)}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Status</label>
              <select name="status" defaultValue={customer.status} className="input"><option>Active</option><option>Inactive</option></select>
            </div>
          </div>
          <button className="btn-primary" type="submit">💾 Save Changes</button>
        </form>
      )}

      <p className="mb-3 text-xs text-gray-500">
        Orders, invoices and monthly sales below are <strong>{company.companyName}</strong> only.
        {alsoIn.length > 0 && (
          <>
            {" "}This customer also trades with{" "}
            {alsoIn.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ", "}
                <strong>{c.companyName}</strong>
              </span>
            ))}
            {" "}— switch company at the top of the sidebar to see those.
          </>
        )}
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <div className="card py-3">
          <p className="text-xs text-gray-500">Salesperson</p>
          {customer.salesperson ? (
            <>
              <p className="text-sm font-semibold text-emerald-800">{customer.salesperson.name}</p>
              <p className="text-xs text-gray-500">{customer.salesperson.position}</p>
            </>
          ) : (
            <p className="text-sm font-semibold text-gray-400">Unassigned</p>
          )}
        </div>
        <div className="card py-3"><p className="text-xs text-gray-500">Contact</p><p className="text-sm font-semibold">{customer.contactPerson}</p><p className="text-xs text-gray-500">{customer.mobile}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Region</p><p className="text-sm font-semibold">{customer.region} · {customer.province}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Terms / Credit Limit</p><p className="text-sm font-semibold">{customer.allowedTerms.split(",").map(termLabel).join(", ")}</p><p className="text-xs text-gray-500">{peso(customer.creditLimit)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Outstanding Balance</p><p className={`text-lg font-bold ${balance > 0 ? "text-red-600" : "text-emerald-700"}`}>{peso(balance)}</p></div>
        <div className={`card py-3 ${totalPastDue > 0 ? "border-red-300 bg-red-50" : ""}`}>
          <p className="text-xs text-gray-500">Total Past Due</p>
          <p className={`text-lg font-bold ${totalPastDue > 0 ? "text-red-600" : "text-emerald-700"}`}>{peso(totalPastDue)}</p>
          {totalPastDue > 0 && <p className="text-xs text-red-500">beyond due date</p>}
        </div>
      </div>

      {searchParams.salesperson === "ok" && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          ✔ Salesperson updated and recorded in the audit trail. Existing forecasts keep the salesperson they were planned under.
        </p>
      )}
      {searchParams.error === "salesperson" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <span className="font-semibold">⚠ Not saved.</span> That employee is no longer flagged as a salesperson. Tick
          &ldquo;Salesperson&rdquo; on their HR record first.
        </p>
      )}

      {canEdit && (
        <form action={setCustomerSalesperson} className="card mb-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={customer.id} />
          <div className="min-w-[260px] flex-1">
            <label className="label">Assigned Salesperson</label>
            <select name="salespersonId" defaultValue={customer.salespersonId ?? ""} className="input">
              <option value="">— Unassigned —</option>
              {salespeople.map((sp) => (
                <option key={sp.id} value={sp.id}>{sp.name} · {sp.position}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              {salespeople.length
                ? "One salesperson may hold many customers. Changes are recorded in the audit trail below, and forecasts already planned keep the salesperson they were planned under."
                : "No salespeople yet — tick “Salesperson” on an employee in HR to add them to this list."}
            </p>
          </div>
          <button className="btn-secondary" type="submit">Save Salesperson</button>
        </form>
      )}

      {auditTrail.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 font-semibold">Audit Trail</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[560px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="table-th">When</th>
                  <th className="table-th">Change</th>
                  <th className="table-th">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {auditTrail.map((a) => (
                  <tr key={a.id}>
                    <td className="table-td whitespace-nowrap text-sm text-gray-600">{fmtDateTime(a.createdAt)}</td>
                    <td className="table-td text-sm font-medium">{a.detail}</td>
                    <td className="table-td text-xs text-gray-500">{a.actorName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {salesYears.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Monthly Sales</h2>
            {salesYears.map((y) => (
              <Link
                key={y}
                href={`/customers/${customer.id}?salesYear=${y}`}
                className={y === salesYear ? "btn-primary px-3 py-1 text-xs" : "btn-secondary px-3 py-1 text-xs"}
              >
                {y}
              </Link>
            ))}
          </div>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[520px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="table-th">Month</th>
                  <th className="table-th text-right">Invoices</th>
                  <th className="table-th text-right">Sales</th>
                  <th className="table-th text-right">Collected</th>
                  <th className="table-th text-right">Balance</th>
                  <th className="table-th w-32" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {monthly.map((m) => (
                  <tr key={m.label} className={m.amount ? "hover:bg-gray-50" : "text-gray-300"}>
                    <td className="table-td font-medium">{m.label}</td>
                    <td className="table-td text-right text-sm">{m.count || "—"}</td>
                    <td className={"table-td text-right " + (m.amount ? "font-semibold" : "")}>
                      {m.amount ? peso(m.amount) : "—"}
                    </td>
                    <td className="table-td text-right text-sm">{m.paid ? peso(m.paid) : "—"}</td>
                    <td className={"table-td text-right text-sm " + (m.amount - m.paid > 0.005 ? "font-semibold text-red-600" : "")}>
                      {m.amount ? peso(m.amount - m.paid) : "—"}
                    </td>
                    <td className="table-td">
                      {m.amount > 0 && (
                        <span className="block h-2 rounded bg-emerald-100">
                          <span
                            className="block h-2 rounded bg-emerald-600"
                            style={{ width: `${Math.max(3, (m.amount / peak) * 100)}%` }}
                          />
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                <tr>
                  <td className="table-td">TOTAL {salesYear}</td>
                  <td className="table-td text-right">{yearCount}</td>
                  <td className="table-td text-right">{peso(yearTotal)}</td>
                  <td className="table-td text-right">{peso(yearPaid)}</td>
                  <td className="table-td text-right text-red-600">{peso(yearTotal - yearPaid)}</td>
                  <td className="table-td" />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {company.companyName} invoiced sales by invoice date, voided invoices excluded — the same invoices listed
            below. Amounts include freight, so they tie to this customer&rsquo;s outstanding balance.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-lg font-semibold">Sales Orders</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[420px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr><th className="table-th">SO #</th><th className="table-th">Date</th><th className="table-th text-right">Amount</th><th className="table-th">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {customer.salesOrders.map((so) => (
                  <tr key={so.id}>
                    <td className="table-td"><Link href={`/sales-orders/${so.id}`} className="font-mono text-xs text-emerald-700 hover:underline">{so.soNumber}</Link></td>
                    <td className="table-td text-sm">{fmtDate(so.orderDate)}</td>
                    <td className="table-td text-right text-sm">{peso(so.lines.reduce((s, l) => s + l.lineTotal, 0))}</td>
                    <td className="table-td"><StatusBadge status={so.status} /></td>
                  </tr>
                ))}
                {!customer.salesOrders.length && <tr><td colSpan={4} className="p-6 text-center text-sm text-gray-500">No orders yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 className="mb-2 text-lg font-semibold">Invoices & Payments</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[460px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr><th className="table-th">SR #</th><th className="table-th">Due</th><th className="table-th text-right">Amount</th><th className="table-th text-right">Balance</th><th className="table-th text-right">Age</th><th className="table-th">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {customer.salesReceipts.map((sr) => {
                  const paid = sr.payments.reduce((s, p) => s + p.amount, 0);
                  const bal = sr.amount - paid;
                  const open = sr.status !== "Void" && bal > 0.005;
                  const overdueDays = -daysUntil(sr.dueDate); // positive = past due
                  return (
                    <tr key={sr.id}>
                      <td className="table-td"><Link href={`/invoices/${sr.id}`} className="font-mono text-xs text-emerald-700 hover:underline">{sr.srNumber}</Link></td>
                      <td className="table-td text-sm">{fmtDate(sr.dueDate)}</td>
                      <td className="table-td text-right text-sm">{peso(sr.amount)}</td>
                      <td className={`table-td text-right text-sm ${open ? "font-semibold" : "text-gray-400"}`}>{peso(bal)}</td>
                      <td className="table-td text-right text-xs">
                        {!open ? (
                          <span className="text-gray-400">—</span>
                        ) : overdueDays > 0 ? (
                          <span className="font-semibold text-red-600">{overdueDays}d overdue</span>
                        ) : (
                          <span className="text-gray-500">due in {-overdueDays}d</span>
                        )}
                      </td>
                      <td className="table-td"><StatusBadge status={sr.status} /></td>
                    </tr>
                  );
                })}
                {!customer.salesReceipts.length && <tr><td colSpan={6} className="p-6 text-center text-sm text-gray-500">No invoices yet.</td></tr>}
              </tbody>
              {totalPastDue > 0 && (
                <tfoot className="border-t-2 border-gray-300 bg-red-50 font-bold">
                  <tr>
                    <td className="table-td text-red-700" colSpan={3}>TOTAL PAST DUE</td>
                    <td className="table-td text-right text-red-600">{peso(totalPastDue)}</td>
                    <td className="table-td" colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
