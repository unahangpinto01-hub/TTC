import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { fmtDate, peso } from "@/lib/format";
import { PrintDoc } from "@/components/print-doc";
import { unappliedOf } from "@/lib/receive-payments";

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
      applications: { include: { salesReceipt: { select: { srNumber: true, invoiceDate: true, amount: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!rp || rp.companyId !== company.id) notFound();

  const unapplied = unappliedOf(rp);
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
        ["Total Payment", peso(rp.amount)],
      ]}
      lines={rp.applications.map((a) => ({
        name: `Applied to ${a.salesReceipt.srNumber} · invoice dated ${fmtDate(a.salesReceipt.invoiceDate)} · invoice total ${peso(a.salesReceipt.amount)}`,
        qty: 1,
        unitPrice: a.amount,
      }))}
      extraCharges={unapplied > 0.005 ? [{ label: "Unapplied — held as customer credit", amount: unapplied }] : []}
      showVat={false}
      footnote={
        (rp.remarks ? `Remarks: ${rp.remarks}. ` : "") +
        "This provisional receipt acknowledges the payment above; only a Posted payment is applied to the account. Not valid as an official receipt."
      }
      signatures={[
        { label: "Received By", name: rp.receivedBy?.name ?? "" },
        { label: "Customer / Payor" },
      ]}
    />
  );
}
