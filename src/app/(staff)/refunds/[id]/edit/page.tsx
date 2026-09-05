import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { PageHeader } from "@/components/ui";
import { RC_REASONS } from "@/lib/refunds-credits";
import { peso, fmtDate } from "@/lib/format";
import { updateRefundCredit } from "../../actions";
import { LinesEditor } from "../../lines-editor";

export default async function EditRefundCreditPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string };
}) {
  const user = await requirePermWrite("refundsCredits");
  const company = await getActiveCompany(user);
  const rc = await prisma.refundCredit.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { businessName: true } },
      lines: { include: { product: { select: { name: true, sku: true, packSize: true } } } },
    },
  });
  if (!rc || rc.companyId !== company.id || rc.status !== "Draft") notFound();

  const invoices = await prisma.salesReceipt.findMany({
    where: { customerId: rc.customerId, companyId: company.id, status: { not: "Void" } },
    select: { id: true, srNumber: true, invoiceDate: true, amount: true, status: true },
    orderBy: { invoiceDate: "desc" },
    take: 60,
  });

  return (
    <div className="max-w-5xl">
      <Link href={`/refunds/${rc.id}`} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
        ← Back to {rc.rcNumber}
      </Link>
      <PageHeader title={`Edit Draft ${rc.rcNumber} — ${rc.customer.businessName}`} />
      {searchParams.error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">⚠ Not saved.</span> {searchParams.error}</p>
      )}

      <form action={updateRefundCredit} className="space-y-4">
        <input type="hidden" name="id" value={rc.id} />
        <input type="hidden" name="customerId" value={rc.customerId} />
        <input type="hidden" name="type" value={rc.type} />
        <div className="card grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <label className="label">Type</label>
            <input className="input bg-gray-100" value={rc.type === "Credit" ? "Customer Credit" : "Customer Refund"} disabled />
          </div>
          <div>
            <label className="label">Date</label>
            <input name="date" type="date" defaultValue={rc.date.toISOString().slice(0, 10)} required className="input" />
          </div>
          <div>
            <label className="label">Reason</label>
            <select name="reason" defaultValue={rc.reason} className="input">
              {RC_REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Related Invoice (optional)</label>
            <select name="salesReceiptId" defaultValue={rc.salesReceiptId ?? ""} className="input">
              <option value="">— none —</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>{i.srNumber} · {fmtDate(i.invoiceDate)} · {peso(i.amount)} · {i.status}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2 md:col-span-4">
            <label className="label">Remarks (required)</label>
            <input name="remarks" required defaultValue={rc.remarks} className="input" />
          </div>
        </div>

        <div className="card">
          <LinesEditor
            companyId={company.id}
            initial={rc.lines.map((l) => ({
              productId: l.productId,
              productLabel: l.product?.name ?? null,
              productSub: l.product ? [l.product.sku, l.product.packSize].filter(Boolean).join(" · ") : null,
              description: l.description,
              qty: l.qty,
              unitPrice: l.unitPrice,
              returnToStock: l.returnToStock,
            }))}
          />
        </div>

        <button className="btn-primary" type="submit">Save Changes</button>
      </form>
    </div>
  );
}
