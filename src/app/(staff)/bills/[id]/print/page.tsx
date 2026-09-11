import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { qtyLabel, lineCartonSize, ctnLabel } from "@/lib/units";
import { PrintButton, BackButton } from "@/components/print-button";
import { FitOnePageLetter } from "@/components/print-fit";

export default async function BillPrintPage({ params }: { params: { id: string } }) {
  const kindRow = await prisma.supplierBill.findUnique({ where: { id: params.id }, select: { kind: true } });
  const user = await requirePerm(kindRow?.kind === "EXPENSE" ? "expenses" : "bills");
  const company = await getActiveCompany(user);
  const bill = await prisma.supplierBill.findUnique({
    where: { id: params.id },
    include: {
      expenseLines: { include: { glAccount: { select: { code: true, description: true } } }, orderBy: { id: "asc" } },
      supplier: true,
      purchaseOrder: { select: { poNumber: true } },
      goodsReceipt: { select: { grnNumber: true, deliveryRefNo: true } },
      createdBy: { select: { name: true } },
      postedBy: { select: { name: true } },
      lines: { include: { product: true }, orderBy: { id: "asc" } },
    },
  });
  if (!bill || bill.companyId !== company.id) notFound(); // company isolation

  const pcs = bill.lines.reduce((s, l) => s + l.baseQty, 0);
  const meta: [string, string][] = [
    ["Supplier", bill.supplier.name],
    ["Supplier Invoice No.", bill.supplierInvoiceNo ?? (bill.invoiceUnavailable ? "not available" : "—")],
    ["Bill Date", fmtDate(bill.billDate)],
    ["Due Date", `${fmtDate(bill.dueDate)} (${bill.terms})`],
    ["Purchase Order", bill.purchaseOrder?.poNumber ?? "—"],
    ["Receiving Report", bill.goodsReceipt ? `${bill.goodsReceipt.grnNumber}${bill.goodsReceipt.deliveryRefNo ? ` · DR ${bill.goodsReceipt.deliveryRefNo}` : ""}` : "—"],
  ];
  if (bill.supplier.address) meta.splice(1, 0, ["Supplier Address", bill.supplier.address]);

  return (
    <>
      {/* US Letter portrait, slim 0.5in margins — same sheet as the goods received note */}
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
              <h2 className="text-lg font-bold uppercase tracking-wide text-gray-800">Bill Voucher</h2>
              <p className="text-[10px] uppercase tracking-wide text-gray-500">{bill.kind === "EXPENSE" ? "Enter Bills — Non-Inventory" : "Enter Bills Against Inventory"}</p>
              <p className="font-mono text-sm font-semibold text-emerald-800">{bill.billNo}</p>
              <p className="text-xs text-gray-500">{fmtDate(bill.billDate)}</p>
              <p className="text-xs font-semibold uppercase text-gray-600">{bill.status}</p>
            </div>
          </header>

          <dl className="mb-6 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            {meta.map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-dotted border-gray-200 py-1">
                <dt className="text-gray-500">{k}</dt>
                <dd className="text-right font-semibold text-gray-900">{v}</dd>
              </div>
            ))}
          </dl>

          {bill.kind === "EXPENSE" ? (
            <table className="mb-4 w-full border-2 border-gray-800 text-sm">
              <thead>
                <tr className="border-b-2 border-gray-800 text-left">
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">Account</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th className="px-2 py-2 text-right">Tax</th>
                  <th className="px-2 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {bill.expenseLines.map((l, i) => (
                  <tr key={l.id} className="border-b border-gray-300">
                    <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                    <td className="px-2 py-1.5"><span className="font-mono text-xs">{l.glAccount.code}</span> {l.glAccount.description}</td>
                    <td className="px-2 py-1.5">{l.description}</td>
                    <td className="px-2 py-1.5 text-right">{peso(l.amount)}</td>
                    <td className="px-2 py-1.5 text-right">{l.taxAmount ? peso(l.taxAmount) : "—"}</td>
                    <td className="px-2 py-1.5 text-right font-semibold">{peso(l.amount + l.taxAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-800 font-bold">
                  <td colSpan={3} className="px-2 py-2 text-right">TOTAL</td>
                  <td className="px-2 py-2 text-right">{peso(bill.subtotal)}</td>
                  <td className="px-2 py-2 text-right">{bill.inputVat ? peso(bill.inputVat) : "—"}</td>
                  <td className="px-2 py-2 text-right">{peso(bill.total)}</td>
                </tr>
              </tfoot>
            </table>
          ) : (
          <table className="mb-4 w-full border-2 border-gray-800 text-sm">
            <thead>
              <tr className="border-b-2 border-gray-800 text-left">
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">Item Description</th>
                <th className="px-2 py-2">Batch No.</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Unit Cost</th>
                <th className="px-2 py-2 text-right">Discount</th>
                <th className="px-2 py-2 text-right">Freight / Other</th>
                <th className="px-2 py-2 text-right">Tax</th>
                <th className="px-2 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((l, i) => (
                <tr key={l.id} className="border-b border-gray-300">
                  <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                  <td className="px-2 py-1.5">
                    {l.product.name}
                    <span className="block text-xs text-gray-500">{l.product.sku} · {l.product.packSize}</span>
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs">
                    {l.batchNo || "—"}
                    {l.expDate && <span className="block text-gray-500">exp {fmtDate(l.expDate)}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {qtyLabel(l.qty, l.unit)}
                    <span className="block text-[10px] text-gray-500">{l.baseQty.toLocaleString()} PCS</span>
                    <span className="block text-[10px] text-gray-500">{ctnLabel(l.baseQty, lineCartonSize(l, l.product)) ?? "N/A ⚠"}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right">{peso(l.unitCost)}</td>
                  <td className="px-2 py-1.5 text-right">{l.discount ? peso(l.discount) : "—"}</td>
                  <td className="px-2 py-1.5 text-right">{l.freightAlloc ? peso(l.freightAlloc) : "—"}</td>
                  <td className="px-2 py-1.5 text-right">{l.taxAmount ? peso(l.taxAmount) : "—"}</td>
                  <td className="px-2 py-1.5 text-right font-semibold">{peso(l.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-800 font-bold">
                <td colSpan={3} className="px-2 py-2 text-right">TOTAL</td>
                <td className="px-2 py-2 text-right">{pcs.toLocaleString()} PCS</td>
                <td />
                <td className="px-2 py-2 text-right">{bill.lines.reduce((s, l) => s + l.discount, 0) ? peso(bill.lines.reduce((s, l) => s + l.discount, 0)) : "—"}</td>
                <td className="px-2 py-2 text-right">{bill.freight + bill.otherCosts ? peso(bill.freight + bill.otherCosts) : "—"}</td>
                <td className="px-2 py-2 text-right">{bill.inputVat ? peso(bill.inputVat) : "—"}</td>
                <td className="px-2 py-2 text-right">{peso(bill.subtotal)}</td>
              </tr>
            </tfoot>
          </table>
          )}

          <div className="mb-6 flex justify-end">
            <table className="w-72 text-sm">
              <tbody>
                {bill.kind === "EXPENSE" ? (
                  <tr><td className="py-0.5 text-gray-600">Subtotal (ex-VAT)</td><td className="py-0.5 text-right">{peso(bill.subtotal)}</td></tr>
                ) : (
                  <>
                <tr><td className="py-0.5 text-gray-600">Product cost</td><td className="py-0.5 text-right">{peso(bill.subtotal)}</td></tr>
                <tr><td className="py-0.5 text-gray-600">Freight</td><td className="py-0.5 text-right">{peso(bill.freight)}</td></tr>
                <tr><td className="py-0.5 text-gray-600">Other purchasing costs</td><td className="py-0.5 text-right">{peso(bill.otherCosts)}</td></tr>
                <tr className="border-t border-gray-400"><td className="py-0.5 font-semibold">Inventory cost</td><td className="py-0.5 text-right font-semibold">{peso(bill.subtotal + bill.freight + bill.otherCosts)}</td></tr>
                  </>
                )}
                <tr><td className="py-0.5 text-gray-600">Input VAT {bill.vatRate ? "12%" : "(none)"}</td><td className="py-0.5 text-right">{bill.inputVat ? peso(bill.inputVat) : "—"}</td></tr>
                <tr className="border-t-2 border-gray-800"><td className="py-1 font-bold">TOTAL PAYABLE</td><td className="py-1 text-right text-base font-bold">{peso(bill.total)}</td></tr>
              </tbody>
            </table>
          </div>

          {bill.memo && <p className="mb-4 text-xs text-gray-600"><span className="font-semibold">Memo:</span> {bill.memo}</p>}
          <p className="mb-6 text-xs text-gray-500">
            Terms: {bill.terms}. {bill.kind === "EXPENSE"
              ? "On posting this bill debits the accounts listed, debits Input VAT, and credits Accounts Payable for the total. It does not affect inventory."
              : "On posting this bill debits Inventory for the product cost plus allocated freight and other purchasing costs, debits Input VAT, and credits Accounts Payable for the total. Goods are carried at weighted average cost."}{" "}
            Payment is recorded separately through Pay Bills.
          </p>

          <div className="flex border-2 border-gray-800" style={{ breakInside: "avoid", height: "1.6in" }}>
            <div className="grid flex-1 grid-cols-3">
              {[
                ["Prepared by", bill.createdBy?.name],
                ["Checked by", undefined],
                ["Approved by", bill.postedBy?.name],
              ].map(([label, name]) => (
                <div key={label as string} className="flex flex-col justify-between px-4 py-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-800">{label}:</p>
                  <p className="border-b border-gray-800 text-center text-[11px] font-semibold text-gray-800">{(name as string) || " "}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-2 text-[10px] text-gray-400">
            {bill.postedAt ? `Posted ${fmtDateTime(bill.postedAt)}` : "Draft — not yet posted"} · printed {fmtDateTime(new Date())}
          </p>
        </div>
      </FitOnePageLetter>
    </>
  );
}
