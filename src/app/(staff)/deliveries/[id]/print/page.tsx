import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { fmtDate, termLabel } from "@/lib/format";
import { lineGrossWeightKg, kgLabel } from "@/lib/units";
import { PrintDoc } from "@/components/print-doc";
import { getActiveCompany } from "@/lib/company";

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
  const activeCompany = await getActiveCompany();
  if (dr.companyId !== activeCompany.id) notFound(); // company isolation
  // delivered DRs use the weight snapshot taken at delivery; drafts compute live from the product master
  const totalKg = dr.lines.reduce(
    (s, l) => s + (dr.status === "Draft" ? lineGrossWeightKg(l.baseQty, l.product) ?? 0 : l.grossWeightKg),
    0
  );
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
        ...(totalKg > 0 ? ([["Total Gross Weight", kgLabel(totalKg)]] as [string, string][]) : []),
      ]}
      lines={dr.lines.map((l) => ({
        name: l.product.name,
        qty: l.qty,
        unitPrice: l.unitPrice,
        unit: l.unit,
        baseQty: l.baseQty,
        batchNo: l.batchNo,
      }))}
      showPrices={false}
      showBatch
      terms={{
        heading: "Terms and Conditions:",
        items: [
          "Goods are subject to our inspection upon arrival and also subject to our final acceptance.",
          "Goods delivered not in accordance with our specifications will be returned and cannot be replaced unless instructed to do so.",
        ],
      }}
      receivedBy
      // the printed copy is signed by hand, so the name line stays blank and the label
      // carries no job title — who signs is decided at the warehouse, not by the record
      signatures={[
        { label: "Prepared by" },
        { label: "Checked by" },
        { label: "Approved by" },
      ]}
      footnote="Received the above goods in good order and condition. Customer signature over printed name on delivery copy."
    />
  );
}
