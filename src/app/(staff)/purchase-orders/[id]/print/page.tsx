import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { PrintDoc } from "@/components/print-doc";
import { getActiveCompany } from "@/lib/company";

export default async function POPrintPage({ params }: { params: { id: string } }) {
  await requirePerm("purchaseOrders");
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.id },
    include: { supplier: true, lines: { include: { product: true } } },
  });
  if (!po) notFound();
  const activeCompany = await getActiveCompany();
  if (po.companyId !== activeCompany.id) notFound(); // company isolation
  return (
    <PrintDoc
      docType="PO"
      title="Purchase Order"
      docNumber={po.poNumber}
      date={po.date}
      meta={[
        ["Supplier", po.supplier.name],
        ["Supplier Contact", po.supplier.contact ?? "—"],
        ["Supplier Address", po.supplier.address ?? "—"],
        ["Status", po.status],
      ]}
      lines={po.lines.map((l) => ({ name: l.product.name, qty: l.qty, unitPrice: l.unitCost, unit: l.unit, baseQty: l.baseQty }))}
      showVat={false}
      signatures={[
        { label: "Prepared by (Purchasing)" },
        { label: "Approved by (Super Admin)" },
        { label: "Received by (Supplier)" },
      ]}
      footnote="Please confirm receipt of this purchase order and indicate the expected delivery date. Quantities in CTN show the PCS equivalent in parentheses."
    />
  );
}
