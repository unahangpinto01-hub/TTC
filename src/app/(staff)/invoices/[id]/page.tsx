import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { fmtDate, peso, termLabel, vatBreakdown } from "@/lib/format";
import { lineCartonSize } from "@/lib/units";
import { LineQty } from "@/components/qty";
import { getPerm } from "@/lib/permissions";
import { PageHeader, StatusBadge } from "@/components/ui";
import { voidSR } from "../../invoicing/actions";
import { getActiveCompany } from "@/lib/company";
import { settlementHistory } from "@/lib/receive-payments";

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
  const history = await settlementHistory(sr.id);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-4xl">
      <PageHeader title={sr.kind === "OPENING" ? `Opening balance ${sr.srNumber}` : `Sales Receipt ${sr.srNumber}`}>
        <StatusBadge status={sr.status} />
        {sr.kind === "OPENING" && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Balance brought forward</span>}
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

      {sr.kind === "OPENING" ? (
        <div className="card mb-4 text-sm">
          <p className="font-semibold">Balance brought forward as of {fmtDate(sr.invoiceDate)}</p>
          <p className="mt-1 text-gray-600">What this customer owed before the BMS started, entered on Finance → Opening Balances. It has no products or delivery behind it: it is collected through Receive Payments like any invoice and is never counted as a sale.</p>
          {sr.memo && <p className="mt-1 text-xs text-gray-500">Reference: {sr.memo}</p>}
        </div>
      ) : (
      <div className="card mb-4 overflow-x-auto p-0">
        <table className="w-full min-w-[560px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr><th className="table-th">Product</th><th className="table-th text-right">Qty</th><th className="table-th text-right">Unit Price</th><th className="table-th text-right">Amount</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(sr.deliveryReceipt?.lines ?? []).map((l) => (
              <tr key={l.id}>
                <td className="table-td font-medium">{l.product.name}</td>
                <td className="table-td text-right">
                  <LineQty qty={l.qty} unit={l.unit} basePcs={l.baseQty} ppc={lineCartonSize(l, l.product)} />
                </td>
                <td className="table-td text-right">
                  {peso(l.unitPrice)}
                  <span className="text-xs text-gray-400"> / {l.unit === "CARTON" ? "CTN" : "PC"}</span>
                  {/* carton lines also show what that works out to per piece */}
                  {l.unit === "CARTON" && l.qty > 0 && l.baseQty > 0 && (
                    <p className="text-xs font-normal text-gray-400">= {peso(l.unitPrice / (l.baseQty / l.qty))} / PC</p>
                  )}
                </td>
                <td className="table-td text-right">{peso(l.qty * l.unitPrice)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50 text-sm">
            {sr.freightCharge > 0 && (
              <tr><td colSpan={2} className="px-3 py-1 text-right text-gray-500">Freight Charge</td><td colSpan={2} className="px-3 py-1 text-right">{peso(sr.freightCharge)}</td></tr>
            )}
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
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 font-semibold">Payment / Settlement History</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr><th className="table-th">Date</th><th className="table-th">Receipt</th><th className="table-th text-right">Payment</th><th className="table-th text-right">PPD</th><th className="table-th text-right">Other Discount</th><th className="table-th text-right">Total Applied</th><th className="table-th text-right">Remaining</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="table-td whitespace-nowrap text-sm">{fmtDate(r.date)}</td>
                    <td className="table-td text-xs">
                      {r.href ? <Link href={r.href} className="font-mono font-semibold text-emerald-700 hover:underline">{r.ref}</Link> : <span className="font-mono">{r.ref || "—"}</span>}
                      <span className="block text-gray-500">{r.source === "credit" ? "credit memo" : r.method}</span>
                    </td>
                    <td className="table-td text-right">{r.payment ? peso(r.payment) : "—"}</td>
                    <td className="table-td text-right text-red-700">{r.ppd ? peso(r.ppd) : <span className="text-gray-400">—</span>}</td>
                    <td className="table-td text-right text-red-700">{r.other ? <>{peso(r.other)}{r.otherReason && <span className="block text-[10px] text-gray-500">{r.otherReason}</span>}</> : <span className="text-gray-400">—</span>}</td>
                    <td className="table-td text-right font-semibold">{peso(r.total)}</td>
                    <td className="table-td text-right">{peso(r.remaining)}</td>
                  </tr>
                ))}
                {!history.rows.length && <tr><td colSpan={7} className="p-6 text-center text-sm text-gray-500">Nothing settled yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {canFinance && sr.status !== "Void" && sr.status !== "Paid" && (
          <div>
            <h2 className="mb-2 font-semibold">Receive Payment</h2>
            <div className="card space-y-3">
              <p className="text-sm text-gray-600">
                Balance: <span className="font-bold text-emerald-800">{peso(balance)}</span>
              </p>
              <p className="text-xs text-gray-500">
                Payments go through the Receive Payment module: a numbered provisional receipt, applied to one or
                several invoices, approved and posted before it touches the account.
              </p>
              <Link href={`/payments/new?invoice=${sr.id}`} className="btn-primary inline-block">
                💵 Receive Payment for this Customer
              </Link>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between">
        {sr.deliveryReceipt ? (
          <p className="text-xs text-gray-500">
            From <Link href={`/deliveries/${sr.deliveryReceiptId}`} className="font-mono text-emerald-700 hover:underline">{sr.deliveryReceipt.drNumber}</Link>{" "}
            / <Link href={`/sales-orders/${sr.deliveryReceipt.salesOrderId}`} className="font-mono text-emerald-700 hover:underline">{sr.deliveryReceipt.salesOrder.soNumber}</Link>
          </p>
        ) : (
          <p className="text-xs text-gray-500">Entered on <Link href="/finance/opening-balances" className="text-emerald-700 hover:underline">Opening Balances</Link>, where it can be withdrawn while nothing has been applied to it.</p>
        )}
        {user.role === "SUPER_ADMIN" && sr.status !== "Void" && !sr.payments.length && sr.kind !== "OPENING" && (
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
