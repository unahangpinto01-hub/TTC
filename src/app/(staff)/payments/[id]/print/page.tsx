import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { fmtDate, peso } from "@/lib/format";
import { PrintDoc } from "@/components/print-doc";
import { unappliedOf, settledOf } from "@/lib/receive-payments";

/** The printable provisional receipt — same letterhead engine as every other document. */
export default async function PaymentPrintPage({ params }: { params: { id: string } }) {
  const user = await requirePerm("receivePayments");
  const company = await getActiveCompany(user);
  const rp = await prisma.receivePayment.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { businessName: true } },
      cashAccount: { select: { name: true } },
      receivedBy: { select: { name: true } },
      applications: { include: { salesReceipt: { select: { srNumber: true, invoiceDate: true, amount: true, payments: { select: { amount: true } } } }, otherDiscountReason: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      refunds: { where: { status: "Posted" }, select: { amount: true, status: true } },
    },
  });
  if (!rp || rp.companyId !== company.id) notFound();

  const unapplied = unappliedOf(rp);
  const ppdTotal = rp.applications.reduce((s, a) => s + a.ppdAmount, 0);
  const otherTotal = rp.applications.reduce((s, a) => s + a.otherDiscount, 0);
  const settled = rp.applications.reduce((s, a) => s + settledOf(a), 0);
  const hasDiscounts = ppdTotal > 0 || otherTotal > 0;
  const refBits = [
    rp.refNo && `Ref ${rp.refNo}`,
    rp.checkNo && `Check ${rp.checkNo}${rp.checkDate ? ` dtd ${fmtDate(rp.checkDate)}` : ""}`,
  ].filter(Boolean).join(" · ");

  return (
    <PrintDoc
      title="Provisional Receipt"
      docNumber={rp.prNumber}
      date={rp.date}
      docType="PR"
      meta={[
        ["Received From", rp.customer.businessName],
        ["Payment Method", rp.method],
        ["Reference", refBits || "—"],
        ["Cash/Bank Account", rp.cashAccount?.name ?? "—"],
        ["Status", rp.status],
        ["Actual Payment Received", peso(rp.amount)],
        ...(hasDiscounts ? ([["Total PPD", peso(ppdTotal)], ["Total Other Discount", peso(otherTotal)], ["Total AR Settled", peso(settled)]] as [string, string][]) : []),
      ]}
      lines={rp.applications.map((a) => {
        // the balance before this receipt settled it — what was outstanding when the payment was applied
        const paidAll = a.salesReceipt.payments.reduce((s, p) => s + p.amount, 0);
        const before = rp.status === "Posted" ? a.salesReceipt.amount - paidAll + settledOf(a) : a.salesReceipt.amount - paidAll;
        const bits = [`Applied to ${a.salesReceipt.srNumber} · invoice dated ${fmtDate(a.salesReceipt.invoiceDate)} · outstanding ${peso(Math.max(0, before))}`];
        if (a.ppdAmount > 0) bits.push(`PPD ${peso(a.ppdAmount)}${a.ppdRate ? ` (${(a.ppdRate * 100).toFixed(2)}%)` : ""}`);
        if (a.otherDiscount > 0) bits.push(`other discount ${peso(a.otherDiscount)} — ${a.otherDiscountReason?.name ?? ""}`);
        if (a.ppdAmount > 0 || a.otherDiscount > 0) bits.push(`total applied ${peso(settledOf(a))}`);
        return { name: bits.join(" · "), qty: 1, unitPrice: a.amount };
      })}
      extraCharges={unapplied > 0.005 ? [{ label: "Unapplied — held as customer credit", amount: unapplied }] : []}
      showVat={false}
      footnote={
        (rp.remarks ? `Remarks: ${rp.remarks}. ` : "") +
        "This provisional receipt acknowledges the money received above; discounts shown are granted on posting and are not cash received. Only a Posted payment is applied to the account. Not valid as an official receipt."
      }
      signatures={[
        { label: "Received By", name: rp.receivedBy?.name ?? "" },
        { label: "Customer / Payor" },
      ]}
    />
  );
}
