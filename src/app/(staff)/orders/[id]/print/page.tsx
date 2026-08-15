import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { fmtDateTime, termLabel } from "@/lib/format";
import { PrintDoc } from "@/components/print-doc";

export default async function IncomingOrderPrintPage({ params }: { params: { id: string } }) {
  await requireStaff();
  const order = await prisma.incomingOrder.findUnique({
    where: { id: params.id },
    include: { customer: true, lines: { include: { product: true } }, salesOrders: true },
  });
  if (!order) notFound();
  return (
    <PrintDoc
      title="Incoming Order"
      docNumber={`ORD-${order.id.slice(-6).toUpperCase()}`}
      date={order.createdAt}
      meta={[
        ["Customer", order.customer.businessName],
        ["Region", `${order.customer.region} · ${order.customer.province}`],
        ["Contact", `${order.customer.contactPerson} · ${order.customer.mobile}`],
        ["Source", order.source],
        ["Received", fmtDateTime(order.createdAt)],
        ["Payment Term", termLabel(order.term)],
        ["Status", order.status],
        ["Sales Order", order.salesOrders[0]?.soNumber ?? "—"],
      ]}
      lines={order.lines.map((l) => ({ name: l.product.name, qty: l.qty, unitPrice: l.unitPrice }))}
      signatures={[
        { label: "Encoded by (Admin Clerk)" },
        { label: "Approved by (Supervisor)" },
      ]}
      footnote={order.notes ? `Notes: ${order.notes}` : "Prices are VAT-inclusive and subject to stock availability upon conversion to Sales Order."}
    />
  );
}
