import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { fmtDate, termLabel } from "@/lib/format";
import { PrintDoc } from "@/components/print-doc";

export default async function SRPrintPage({ params }: { params: { id: string } }) {
  await requirePerm("invoices");
  const sr = await prisma.salesReceipt.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      deliveryReceipt: { include: { lines: { include: { product: true } }, salesOrder: true } },
    },
  });
  if (!sr) notFound();
  return (
    <PrintDoc
      docType="SR"
      title="Sales Receipt / Charge Invoice"
      docNumber={sr.srNumber}
      date={sr.invoiceDate}
      meta={[
        ["Customer", sr.customer.businessName],
        ["TIN / Address", sr.customer.address ?? sr.customer.province],
        ["Delivery Receipt", sr.deliveryReceipt.drNumber],
        ["Sales Order", sr.deliveryReceipt.salesOrder.soNumber],
        ["Payment Term", termLabel(sr.term)],
        ["Due Date", fmtDate(sr.dueDate)],
        ["VAT Treatment", sr.vatApplied ? "VAT 12% (inclusive)" : "VAT-exempt / Non-VAT"],
      ]}
      lines={sr.deliveryReceipt.lines.map((l) => ({ name: l.product.name, qty: l.qty, unitPrice: l.unitPrice, unit: l.unit, baseQty: l.baseQty }))}
      vatApplied={sr.vatApplied}
      signatures={[
        { label: "Prepared by (Accounting)" },
        { label: "Received by (Customer)" },
      ]}
      footnote={`Payment due ${fmtDate(sr.dueDate)} (${termLabel(sr.term)}). Make checks payable to Teamagro Trading Corp.`}
    />
  );
}
