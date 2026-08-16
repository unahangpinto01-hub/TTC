import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { peso, fmtDate, termLabel, daysUntil } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { updateCustomer } from "../actions";

export default async function CustomerDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { edit?: string } }) {
  const user = await requirePerm("customers");
  const customer = await prisma.customer.findUnique({
    where: { id: params.id },
    include: {
      salesOrders: { orderBy: { orderDate: "desc" }, take: 50, include: { lines: true } },
      salesReceipts: { orderBy: { invoiceDate: "desc" }, include: { payments: true } },
    },
  });
  if (!customer) notFound();

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

  return (
    <div>
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

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
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
