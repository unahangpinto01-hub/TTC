import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { fmtDate, fmtDateTime, peso, termLabel } from "@/lib/format";
import { PrintDoc } from "@/components/print-doc";
import { getActiveCompany } from "@/lib/company";

export default async function IncomingOrderPrintPage({ params }: { params: { id: string } }) {
  await requirePerm("orders");
  const order = await prisma.incomingOrder.findUnique({
    where: { id: params.id },
    include: { customer: true, lines: { include: { product: true } }, salesOrders: true },
  });
  if (!order) notFound();
  const activeCompany = await getActiveCompany();
  if (order.companyId !== activeCompany.id) notFound(); // company isolation
  return (
    <PrintDoc
      docType="ORDER"
      title="Incoming Order"
      docNumber={order.orderNo ?? `ORD-${order.id.slice(-6).toUpperCase()}`}
      date={order.orderDate}
      meta={[
        ["Customer", order.customer.businessName],
        ["Region", `${order.customer.region} · ${order.customer.province}`],
        ["Contact", `${order.customer.contactPerson} · ${order.customer.mobile}`],
        ["Source", order.source],
        ["Order Date", fmtDate(order.orderDate)],
        ["Encoded", fmtDateTime(order.createdAt)],
        ["Payment Term", termLabel(order.term)],
        ["Status", order.status],
        ["Sales Order", order.salesOrders[0]?.soNumber ?? "—"],
      ]}
      lines={order.lines.map((l) => ({ name: l.product.name, qty: l.qty, unitPrice: l.unitPrice, unit: l.unit, baseQty: l.baseQty }))}
      extraCharges={[{ label: `Freight Charge (${peso(order.freightPerCarton)} / CTN)`, amount: order.freightTotal }]}
      signatures={[
        { label: "Encoded by (Admin Clerk)" },
        { label: "Approved by (Supervisor)" },
      ]}
      footnote={order.notes ? `Notes: ${order.notes}` : "Prices are VAT-inclusive and subject to stock availability upon conversion to Sales Order."}
    />
  );
}
