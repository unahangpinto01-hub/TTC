import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { getAuditTrail } from "@/lib/salespeople";
import { voidSupplierPayment } from "../actions";

const ERRORS: Record<string, string> = { locked: "This payment is already void.", reason: "Give a reason for voiding (at least 5 characters)." };

export default async function SupplierPaymentPage({ params, searchParams }: { params: { id: string }; searchParams: { posted?: string; error?: string } }) {
  const user = await requirePerm("payBills");
  const company = await getActiveCompany(user);
  const p = await prisma.supplierPayment.findUnique({
    where: { id: params.id },
    include: {
      supplier: true, cashAccount: { include: { glAccount: { select: { code: true, description: true } } } }, dv: { select: { id: true, dvNo: true, status: true } },
      createdBy: { select: { name: true } }, voidedBy: { select: { name: true } },
      lines: { include: { bill: { select: { id: true, billNo: true, kind: true, supplierInvoiceNo: true, total: true, paidAmount: true, status: true } } } },
    },
  });
  if (!p || p.companyId !== company.id) notFound();
  const audit = await getAuditTrail("SupplierPayment", params.id, 20);
  const isAdmin = ["SUPER_ADMIN", "ADMIN"].includes(user.role) && user.perm === "READ_WRITE";
  const cashTitle = p.cashAccount.glAccount ? `${p.cashAccount.glAccount.code} ${p.cashAccount.glAccount.description}` : p.cashAccount.name;

  return (
    <div>
      <Link href="/payments/bills" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">← Back to Pay Bills</Link>
      <PageHeader title={`Payment ${p.paymentNo}`}><StatusBadge status={p.status} /></PageHeader>
      {searchParams.posted === "ok" && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✔ Payment recorded. {peso(p.amount)} paid to {p.supplier.name} from {p.cashAccount.name}.</p>}
      {searchParams.error && ERRORS[searchParams.error] && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">⚠ {ERRORS[searchParams.error]}</p>}
      {p.status === "Void" && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Voided by {p.voidedBy?.name ?? "—"} · {fmtDateTime(p.voidedAt)}: {p.voidReason}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div className="card py-3"><p className="text-xs text-gray-500">Paid to</p><p className="font-semibold">{p.supplier.name}</p><p className="text-xs text-gray-500">{fmtDate(p.date)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Amount</p><p className="font-semibold">{peso(p.amount)}</p><p className="text-xs text-gray-500">{p.lines.length} bill(s)</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">From</p><p className="font-semibold">{p.cashAccount.name}</p><p className="text-xs text-gray-500">{p.method}{p.checkNo ? ` · cheque ${p.checkNo}${p.checkDate ? ` dated ${fmtDate(p.checkDate)}` : ""}` : ""}{p.refNo ? ` · ref ${p.refNo}` : ""}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Disbursement Voucher</p>{p.dv ? <Link href={`/dv/${p.dv.id}`} className="font-mono font-semibold text-emerald-700 hover:underline">{p.dv.dvNo}</Link> : <p className="text-gray-400">none — paid directly</p>}{p.dv && <p className="text-xs text-gray-500">{p.dv.status}</p>}</div>
      </div>

      <div className="card mb-4 overflow-x-auto p-0">
        <table className="w-full">
          <thead className="border-b border-gray-200 bg-gray-50"><tr><th className="table-th">Bill</th><th className="table-th">Supplier Invoice</th><th className="table-th text-right">Bill total</th><th className="table-th text-right">Paid by this</th><th className="table-th text-right">Paid to date</th><th className="table-th">Bill status</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {p.lines.map((l) => (
              <tr key={l.id}><td className="table-td"><Link href={`/bills/${l.bill.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{l.bill.billNo}</Link><span className="block text-[10px] text-gray-500">{l.bill.kind === "EXPENSE" ? "non-inventory" : "inventory"}</span></td><td className="table-td text-xs text-gray-600">{l.bill.supplierInvoiceNo ?? "—"}</td><td className="table-td text-right">{peso(l.bill.total)}</td><td className="table-td text-right font-semibold">{peso(l.amount)}</td><td className="table-td text-right text-sm">{peso(l.bill.paidAmount)}</td><td className="table-td"><StatusBadge status={l.bill.status} /></td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card mb-4 text-sm">
        <p className="mb-1 font-semibold">Accounting</p>
        <table className="w-full max-w-lg"><tbody className="divide-y divide-gray-100">
          {p.lines.map((l) => <tr key={l.id}><td className="py-1">Accounts Payable — {p.supplier.name} <span className="font-mono text-xs text-gray-500">{l.bill.billNo}</span></td><td className="py-1 text-right">{peso(l.amount)}</td><td className="py-1 text-right" /></tr>)}
          <tr><td className="py-1 pl-8">{cashTitle}</td><td className="py-1 text-right" /><td className="py-1 text-right">({peso(p.amount)})</td></tr>
        </tbody></table>
      </div>

      {isAdmin && p.status === "Posted" && (
        <form action={voidSupplierPayment} className="card mb-4 flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={p.id} />
          <span className="text-sm font-semibold">Void this payment</span>
          <input name="voidReason" placeholder="reason (required)" required minLength={5} className="input w-64 py-1 text-sm" />
          <button className="text-sm font-medium text-red-600 hover:underline" type="submit">Void</button>
          <span className="text-xs text-gray-500">The bills owe the money again and the voucher reopens. You will be asked to sign in again.</span>
        </form>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card text-sm">
          <p className="mb-2 font-semibold">Document</p>
          <dl className="space-y-1">
            {([["Company", company.companyName], ["Recorded by", `${p.createdBy?.name ?? "—"} · ${fmtDateTime(p.createdAt)}`], ["Remarks", p.remarks ?? "—"]] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-dotted border-gray-200 py-1"><dt className="text-gray-500">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
            ))}
          </dl>
        </div>
        <div>
          <h2 className="mb-2 font-semibold">Audit Trail</h2>
          <div className="card overflow-x-auto p-0"><table className="w-full"><thead className="border-b border-gray-200 bg-gray-50"><tr><th className="table-th">When</th><th className="table-th">Action</th><th className="table-th">By</th></tr></thead><tbody className="divide-y divide-gray-100">
            {audit.map((a) => <tr key={a.id}><td className="table-td whitespace-nowrap text-xs text-gray-600">{fmtDateTime(a.createdAt)}</td><td className="table-td text-sm"><span className="font-medium">{a.action}</span><p className="text-xs text-gray-500">{a.detail}</p></td><td className="table-td text-xs text-gray-500">{a.actorName}</td></tr>)}
          </tbody></table></div>
        </div>
      </div>
    </div>
  );
}
