import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { fmtDate, termLabel } from "@/lib/format";
import { lineGrossWeightKg, kgLabel } from "@/lib/units";
import { PrintDoc } from "@/components/print-doc";
import { FitOnePageLetter } from "@/components/print-fit";
import { getActiveCompany } from "@/lib/company";

export default async function DRPrintPage({ params }: { params: { id: string } }) {
  await requirePerm("deliveries");
  const dr = await prisma.deliveryReceipt.findUnique({
    where: { id: params.id },
    include: {
      lines: { include: { product: true } },
      salesOrder: { include: { customer: true, schedule: true } },
      preparedByEmp: { select: { name: true } },
      checkedByEmp: { select: { name: true } },
      approvedByEmp: { select: { name: true } },
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
    <>
      {/* US Letter portrait, slim 0.5in margins — overrides the app-wide A4 for this route only */}
      <style>{`@page { size: 8.5in 11in portrait; margin: 0.5in; }`}</style>
      <FitOnePageLetter>
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
        ruledTable
        receivingBox={{
          text: "Received the above goods in good order and condition.",
          caption: "Signature over printed name",
        }}
        // names come from the employee links on this receipt, so a rename in HR flows through
        // and nothing is hard-coded into the template
        signatures={[
          { label: "Prepared by", name: dr.preparedByEmp?.name ?? dr.preparedBy ?? undefined },
          { label: "Checked by", name: dr.checkedByEmp?.name ?? dr.checkedBy ?? undefined },
          { label: "Approved by", name: dr.approvedByEmp?.name ?? dr.approvedBy ?? undefined },
        ]}
      />
      </FitOnePageLetter>
    </>
  );
}
