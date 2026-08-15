import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { peso, fmtDate, termLabel } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";

export default async function CustomerDetailPage({ params }: { params: { id: string } }) {
  await requireStaff();
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

  return (
    <div>
      <PageHeader title={customer.businessName}>
        <StatusBadge status={customer.status} />
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card py-3"><p className="text-xs text-gray-500">Contact</p><p className="text-sm font-semibold">{customer.contactPerson}</p><p className="text-xs text-gray-500">{customer.mobile}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Region</p><p className="text-sm font-semibold">{customer.region} · {customer.province}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Terms / Credit Limit</p><p className="text-sm font-semibold">{customer.allowedTerms.split(",").map(termLabel).join(", ")}</p><p className="text-xs text-gray-500">{peso(customer.creditLimit)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Outstanding Balance</p><p className={`text-lg font-bold ${balance > 0 ? "text-red-600" : "text-emerald-700"}`}>{peso(balance)}</p></div>
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
                <tr><th className="table-th">SR #</th><th className="table-th">Due</th><th className="table-th text-right">Amount</th><th className="table-th text-right">Paid</th><th className="table-th">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {customer.salesReceipts.map((sr) => {
                  const paid = sr.payments.reduce((s, p) => s + p.amount, 0);
                  return (
                    <tr key={sr.id}>
                      <td className="table-td"><Link href={`/invoices/${sr.id}`} className="font-mono text-xs text-emerald-700 hover:underline">{sr.srNumber}</Link></td>
                      <td className="table-td text-sm">{fmtDate(sr.dueDate)}</td>
                      <td className="table-td text-right text-sm">{peso(sr.amount)}</td>
                      <td className="table-td text-right text-sm">{peso(paid)}</td>
                      <td className="table-td"><StatusBadge status={sr.status} /></td>
                    </tr>
                  );
                })}
                {!customer.salesReceipts.length && <tr><td colSpan={5} className="p-6 text-center text-sm text-gray-500">No invoices yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
