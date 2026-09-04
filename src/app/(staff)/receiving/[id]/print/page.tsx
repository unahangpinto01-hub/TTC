import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { qtyLabel, lineCartonSize, ctnLabel, ctnValue } from "@/lib/units";
import { PrintButton, BackButton } from "@/components/print-button";
import { FitOnePageLetter } from "@/components/print-fit";

export default async function GRNPrintPage({ params }: { params: { id: string } }) {
  const user = await requirePerm("purchaseOrders");
  const company = await getActiveCompany(user);
  const grn = await prisma.goodsReceipt.findUnique({
    where: { id: params.id },
    include: {
      purchaseOrder: { include: { supplier: true } },
      createdBy: { select: { name: true } },
      postedBy: { select: { name: true } },
      lines: { include: { product: true, poLine: true }, orderBy: { id: "asc" } },
    },
  });
  if (!grn || grn.companyId !== company.id) notFound(); // company isolation

  const accepted = grn.lines.reduce((s, l) => s + l.acceptedQty, 0);
  const rejected = grn.lines.reduce((s, l) => s + l.rejectedQty, 0);
  const value = grn.lines.reduce((s, l) => s + l.acceptedQty * l.unitCost, 0);
  const acceptedPcs = grn.lines.reduce((s, l) => s + l.acceptedBaseQty, 0);
  const acceptedCtn = grn.lines.reduce((s, l) => s + (ctnValue(l.acceptedBaseQty, lineCartonSize(l, l.product)) ?? 0), 0);

  const meta: [string, string][] = [
    ["Supplier", grn.purchaseOrder.supplier.name],
    ["Purchase Order", grn.purchaseOrder.poNumber],
    ["Receiving Date", fmtDate(grn.receivedDate)],
    ["Warehouse", grn.warehouse ?? "—"],
    ["Supplier DR No.", grn.deliveryRefNo ?? "—"],
    ["Supplier Invoice No.", grn.supplierInvoiceNo ?? "—"],
  ];

  return (
    <>
      {/* US Letter portrait, slim 0.5in margins — same sheet as the delivery receipt */}
      <style>{`@page { size: 8.5in 11in portrait; margin: 0.5in; }`}</style>
      <FitOnePageLetter>
        <div className="print-page mx-auto max-w-[210mm] rounded-xl border border-gray-200 bg-white p-10 shadow-sm">
          <div className="no-print mb-6 flex justify-between">
            <BackButton />
            <PrintButton />
          </div>

          <header className="mb-6 flex items-start justify-between border-b-2 border-emerald-800 pb-4">
            <div className="flex items-center gap-3">
              {company.logoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={company.logoDataUrl} alt="Company logo" className="h-14 w-14 shrink-0 object-contain" />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-xl font-bold text-white">
                  {(company.companyName || "T").charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <h1 className="text-xl font-bold uppercase text-emerald-900">{company.companyName}</h1>
                {company.address && <p className="text-xs text-gray-500">{company.address}</p>}
                {company.tin && <p className="text-xs text-gray-500">TIN {company.tin}</p>}
              </div>
            </div>
            <div className="text-right">
              <h2 className="text-lg font-bold uppercase tracking-wide text-gray-800">Goods Received Note</h2>
              <p className="font-mono text-sm font-semibold text-emerald-800">{grn.grnNumber}</p>
              <p className="text-xs text-gray-500">{fmtDate(grn.receivedDate)}</p>
              <p className="text-xs font-semibold uppercase text-gray-600">{grn.status}</p>
            </div>
          </header>

          <dl className="mb-6 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            {meta.map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-dotted border-gray-200 py-1">
                <dt className="text-gray-500">{k}</dt>
                <dd className="font-semibold text-gray-900">{v}</dd>
              </div>
            ))}
          </dl>

          <table className="mb-6 w-full border-2 border-gray-800 text-sm">
            <thead>
              <tr className="border-b-2 border-gray-800 text-left">
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">Item Description</th>
                <th className="px-2 py-2 text-right">Ordered</th>
                <th className="px-2 py-2 text-right">Received</th>
                <th className="px-2 py-2 text-right">Rejected</th>
                <th className="px-2 py-2 text-right">Accepted</th>
                <th className="px-2 py-2 text-right">Unit Cost</th>
                <th className="px-2 py-2 text-right">Total</th>
                <th className="px-2 py-2 text-left">Batch / Exp.</th>
              </tr>
            </thead>
            <tbody>
              {grn.lines.map((l, i) => (
                <tr key={l.id} className="border-b border-gray-300">
                  <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                  <td className="px-2 py-1.5">
                    {l.product.name}
                    <span className="block text-xs text-gray-500">{l.product.packSize}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right">{qtyLabel(l.poLine.qty, l.unit)}</td>
                  <td className="px-2 py-1.5 text-right">{l.qty}</td>
                  <td className="px-2 py-1.5 text-right">{l.rejectedQty || "—"}</td>
                  <td className="px-2 py-1.5 text-right font-semibold">
                    {l.acceptedQty}
                    <span className="block text-[10px] font-normal text-gray-500">
                      {l.acceptedBaseQty.toLocaleString()} PCS
                    </span>
                    <span className="block text-[10px] font-normal text-gray-500">
                      {ctnLabel(l.acceptedBaseQty, lineCartonSize(l, l.product)) ?? "N/A ⚠"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">{peso(l.unitCost)}</td>
                  <td className="px-2 py-1.5 text-right">{peso(l.acceptedQty * l.unitCost)}</td>
                  <td className="px-2 py-1.5 text-left font-mono text-xs">
                    {l.batchNo || "—"}
                    {l.expDate && <span className="block text-gray-500">{fmtDate(l.expDate)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-800 font-bold">
                <td colSpan={3} className="px-2 py-2 text-right">TOTAL</td>
                <td className="px-2 py-2 text-right">{grn.lines.reduce((s, l) => s + l.qty, 0)}</td>
                <td className="px-2 py-2 text-right">{rejected || "—"}</td>
                <td className="px-2 py-2 text-right">
                  {accepted}
                  <span className="block text-[10px] font-normal">{acceptedPcs.toLocaleString()} PCS</span>
                  <span className="block text-[10px] font-normal">
                    {acceptedCtn.toLocaleString("en-PH", { maximumFractionDigits: 2 })} CTN
                  </span>
                </td>
                <td />
                <td className="px-2 py-2 text-right">{peso(value)}</td>
                <td />
              </tr>
            </tfoot>
          </table>

          {grn.remarks && <p className="mb-4 text-xs text-gray-600"><span className="font-semibold">Remarks:</span> {grn.remarks}</p>}
          <p className="mb-6 text-xs text-gray-500">
            Accepted quantities only are taken into stock, valued at weighted average cost. Rejected or damaged
            quantities are recorded here and remain outstanding on the purchase order.
          </p>

          <div className="flex border-2 border-gray-800" style={{ breakInside: "avoid", height: "1.75in" }}>
            <div className="grid flex-1 grid-cols-2">
              {[
                ["Received by", grn.createdBy?.name],
                ["Inspected by", undefined],
                ["Posted by", grn.postedBy?.name],
                ["Supplier representative", undefined],
              ].map(([label, name]) => (
                <div key={label as string} className="flex flex-col justify-between px-4 py-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-800">{label}:</p>
                  <p className="border-b border-gray-800 text-center text-[11px] font-semibold text-gray-800">
                    {(name as string) || " "}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-2 text-[10px] text-gray-400">
            {grn.postedAt ? `Posted to inventory ${fmtDateTime(grn.postedAt)}` : "Not yet posted to inventory"} · printed{" "}
            {fmtDateTime(new Date())}
          </p>
        </div>
      </FitOnePageLetter>
    </>
  );
}
