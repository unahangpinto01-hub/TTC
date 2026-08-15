import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { termLabel } from "@/lib/format";
import { PrintDoc } from "@/components/print-doc";

export default async function SOPrintPage({ params }: { params: { id: string } }) {
  await requireStaff();
  const so = await prisma.salesOrder.findUnique({
    where: { id: params.id },
    include: { customer: true, preparedBy: true, lines: { include: { product: true } } },
  });
  if (!so) notFound();
  return (
    <PrintDoc
      title="Sales Order"
      docNumber={so.soNumber}
      date={so.orderDate}
      meta={[
        ["Customer", so.customer.businessName],
        ["Region", `${so.customer.region} · ${so.customer.province}`],
        ["Payment Term", termLabel(so.term)],
        ["Status", so.status],
      ]}
      lines={so.lines.map((l) => ({ name: `${l.product.name}`, qty: l.qty, unitPrice: l.unitPrice }))}
      signatures={[
        { label: "Prepared by (Admin Clerk)", name: so.preparedBy?.name },
        { label: "Approved by (Supervisor)" },
      ]}
      footnote="Prices are VAT-inclusive. This sales order is subject to stock availability at time of delivery."
    />
  );
}
