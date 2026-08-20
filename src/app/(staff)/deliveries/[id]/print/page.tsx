import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { fmtDate, termLabel } from "@/lib/format";
import { PrintDoc } from "@/components/print-doc";

export default async function DRPrintPage({ params }: { params: { id: string } }) {
  await requirePerm("deliveries");
  const dr = await prisma.deliveryReceipt.findUnique({
    where: { id: params.id },
    include: {
      lines: { include: { product: true } },
      salesOrder: { include: { customer: true, schedule: true } },
    },
  });
  if (!dr) notFound();
  return (
    <PrintDoc
      docType="DR"
      title="Delivery Receipt"
      docNumber={dr.drNumber}
      date={dr.date}
      meta={[
        ["Customer", dr.salesOrder.customer.businessName],
        ["Address", dr.salesOrder.customer.address ?? `${dr.salesOrder.customer.province}`],
        ["Sales Order", dr.salesOrder.soNumber],
        ["Payment Term", termLabel(dr.salesOrder.term)],
        ["Delivery Date", dr.salesOrder.schedule ? fmtDate(dr.salesOrder.schedule.date) : fmtDate(dr.date)],
        ["Truck / Driver", `${dr.salesOrder.schedule?.truck ?? "—"} / ${dr.salesOrder.schedule?.driver ?? "—"}`],
      ]}
      lines={dr.lines.map((l) => ({ name: l.product.name, qty: l.qty, unitPrice: l.unitPrice, unit: l.unit, baseQty: l.baseQty }))}
      showPrices={false}
      signatures={[
        { label: "Prepared by (Admin Clerk)", name: dr.preparedBy ?? undefined },
        { label: "Checked by (Inventory Controller)", name: dr.checkedBy ?? undefined },
        { label: "Approved by (Supervisor)", name: dr.approvedBy ?? undefined },
      ]}
      footnote="Received the above goods in good order and condition. Customer signature over printed name on delivery copy."
    />
  );
}
