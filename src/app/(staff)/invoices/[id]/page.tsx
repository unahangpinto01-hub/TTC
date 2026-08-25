import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { fmtDate, peso, termLabel, vatBreakdown } from "@/lib/format";
import { qtyLabel } from "@/lib/units";
import { getPerm } from "@/lib/permissions";
import { PageHeader, StatusBadge } from "@/components/ui";
import { recordPayment } from "../../finance/actions";
import { voidSR } from "../../invoicing/actions";
import { getActiveCompany } from "@/lib/company";

export default async function SRDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
  const user = await requirePerm("invoices");
  const company = await getActiveCompany(user);
  const sr = await prisma.salesReceipt.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      payments: { orderBy: { date: "asc" } },
      deliveryReceipt: { include: { lines: { include: { product: true } }, salesOrder: true } },
    },
  });
  if (!sr || sr.companyId !== company.id) notFound(); // company isolation
  const paid = sr.payments.reduce((s, p) => s + p.amount, 0);
  const balance = sr.amount - paid;
  const { net, vat } = vatBreakdown(sr.amount);
  const canFinance = getPerm(user, "ar") === "READ_WRITE";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-4xl">
      <PageHeader title={`Sales Receipt ${sr.srNumber}`}>
        <StatusBadge status={sr.status} />
        <Link href={`/invoices/${sr.id}/print`} className="btn-secondary">🖨 Print / PDF</Link>
      </PageHeader>

      {searchParams.error === "reason" && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">A void reason is required.</p>}
      {searchParams.error === "haspayments" && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Cannot void — payments already recorded.</p>}
      {searchParams.error === "amount" && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Payment amount must be greater than zero.</p>}
      {sr.status === "Void" && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">Voided: {sr.voidReason}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="card py-3"><p className="text-xs text-gray-500">Customer</p>
          <Link href={`/customers/${sr.customerId}`} className="text-sm font-semibold text-emerald-700 hover:underline">{sr.customer.businessName}</Link>
        </div>
        <div className="card py-3"><p className="text-xs text-gray-500">Invoice Date</p><p className="text-sm font-semibold">{fmtDate(sr.invoiceDate)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Term / Due</p><p className="text-sm font-semibold">{termLabel(sr.term)}</p><p className="text-xs text-gray-500">{fmtDate(sr.dueDate)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Amount</p><p className="text-sm font-semibold">{peso(sr.amount)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Balance</p><p className={`text-sm font-bold ${balance > 0 ? "text-red-600" : "text-emerald-700"}`}>{peso(balance)}</p></div>
      </div>

      <div className="card mb-4 overflow-x-auto p-0">
        <table className="w-full min-w-[560px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr><th className="table-th">Product</th><th className="table-th text-right">Qty</th><th className="table-th text-right">Unit Price</th><th className="table-th text-right">Amount</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sr.deliveryReceipt.lines.map((l) => (
              <tr key={l.id}>
                <td className="table-td font-medium">{l.product.name}</td>
                <td className="table-td text-right">
                  {qtyLabel(l.qty, l.unit)}
                  {l.unit === "CARTON" && <p className="text-xs font-normal text-gray-400">= {l.baseQty.toLocaleString()} PCS</p>}
                </td>
                <td className="table-td text-right">
                  {peso(l.unitPrice)}
                  <span className="text-xs text-gray-400"> / {l.unit === "CARTON" ? "CTN" : "PC"}</span>
                </td>
                <td className="table-td text-right">{peso(l.qty * l.unitPrice)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50 text-sm">
            {sr.vatApplied ? (
              <>
                <tr><td colSpan={2} className="px-3 py-1 text-right text-gray-500">VAT-exclusive</td><td colSpan={2} className="px-3 py-1 text-right">{peso(net)}</td></tr>
                <tr><td colSpan={2} className="px-3 py-1 text-right text-gray-500">VAT 12%</td><td colSpan={2} className="px-3 py-1 text-right">{peso(vat)}</td></tr>
              </>
            ) : (
              <tr><td colSpan={2} className="px-3 py-1 text-right text-gray-500">VAT-exempt / Non-VAT sale</td><td colSpan={2} className="px-3 py-1 text-right">{peso(sr.amount)}</td></tr>
            )}
            <tr className="font-bold"><td colSpan={2} className="px-3 py-2 text-right">TOTAL</td><td colSpan={2} className="px-3 py-2 text-right">{peso(sr.amount)}</td></tr>
          </tfoot>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 font-semibold">Payments</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr><th className="table-th">Date</th><th className="table-th">Method</th><th className="table-th">Ref</th><th className="table-th text-right">Amount</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sr.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="table-td text-sm">{fmtDate(p.date)}</td>
                    <td className="table-td text-sm">{p.method}</td>
                    <td className="table-td text-xs text-gray-500">{p.refNo ?? "—"}</td>
                    <td className="table-td text-right">{peso(p.amount)}</td>
                  </tr>
                ))}
                {!sr.payments.length && <tr><td colSpan={4} className="p-6 text-center text-sm text-gray-500">No payments recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {canFinance && sr.status !== "Void" && sr.status !== "Paid" && (
          <div>
            <h2 className="mb-2 font-semibold">Record Payment</h2>
            <form action={recordPayment} className="card space-y-3">
              <input type="hidden" name="srId" value={sr.id} />
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Amount (balance {peso(balance)})</label>
                  <input name="amount" type="number" step="0.01" max={balance} defaultValue={balance.toFixed(2)} required className="input" /></div>
                <div><label className="label">Date</label><input name="date" type="date" defaultValue={today} className="input" /></div>
                <div><label className="label">Method</label>
                  <select name="method" className="input"><option>Cash</option><option>Check</option><option>Bank Transfer</option><option>GCash</option></select></div>
                <div><label className="label">Reference #</label><input name="refNo" className="input" placeholder="OR / check #" /></div>
              </div>
              <button className="btn-primary" type="submit">Record Payment</button>
            </form>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-gray-500">
          From <Link href={`/deliveries/${sr.deliveryReceiptId}`} className="font-mono text-emerald-700 hover:underline">{sr.deliveryReceipt.drNumber}</Link>{" "}
          / <Link href={`/sales-orders/${sr.deliveryReceipt.salesOrderId}`} className="font-mono text-emerald-700 hover:underline">{sr.deliveryReceipt.salesOrder.soNumber}</Link>
        </p>
        {user.role === "SUPER_ADMIN" && sr.status !== "Void" && !sr.payments.length && (
          <form action={voidSR} className="flex gap-2">
            <input type="hidden" name="srId" value={sr.id} />
            <input name="reason" placeholder="Void reason (required)" className="input w-52" />
            <button className="btn-danger" type="submit">Void SR</button>
          </form>
        )}
      </div>
    </div>
  );
}
