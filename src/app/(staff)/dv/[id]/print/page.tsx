import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate } from "@/lib/format";
import { accountingLines, amountInWords } from "@/lib/dv";
import { PrintButton, BackButton } from "@/components/print-button";
import { FitOnePageLetter } from "@/components/print-fit";

/** The company's Disbursement Voucher, laid out like the paper pad. */
export default async function DvPrintPage({ params }: { params: { id: string } }) {
  const user = await requirePerm("dv");
  const company = await getActiveCompany(user);
  const dv = await prisma.disbursementVoucher.findUnique({
    where: { id: params.id },
    include: {
      supplier: true,
      company: { select: { companyName: true, glPayables: { select: { code: true, description: true } } } },
      bills: { include: { bill: { select: { billNo: true, supplierInvoiceNo: true, billDate: true, total: true, supplier: { select: { name: true } } } } } },
      preparedBy: { select: { name: true } }, checkedBy: { select: { name: true } }, approvedBy: { select: { name: true } },
      notedBy: { select: { name: true } }, postedBy: { select: { name: true } },
      payments: { where: { status: "Posted" }, include: { cashAccount: { include: { glAccount: { select: { code: true, description: true } } } } }, orderBy: { date: "asc" } },
    },
  });
  if (!dv || dv.companyId !== company.id) notFound();
  const lines = accountingLines(dv);
  const cell = "border border-gray-800 px-2 py-1 align-top";
  const sig: [string, string | undefined][] = [
    ["Prepared by", dv.preparedBy?.name], ["Checked by", dv.checkedBy?.name], ["Approved by", dv.approvedBy?.name], ["Noted by", dv.notedBy?.name], ["Posted by", dv.postedBy?.name],
  ];

  return (
    <>
      <style>{`@page { size: 8.5in 11in portrait; margin: 0.5in; }`}</style>
      <FitOnePageLetter>
        <div className="print-page mx-auto max-w-[210mm] rounded-xl border border-gray-200 bg-white p-8 shadow-sm text-[13px] text-gray-900">
          <div className="no-print mb-4 flex justify-between"><BackButton /><PrintButton /></div>

          <h1 className="text-center text-xl font-semibold uppercase tracking-wide">{company.companyName}</h1>
          <h2 className="mb-5 mt-3 text-center text-base font-semibold uppercase tracking-wide underline">Disbursement Voucher</h2>

          <table className="mb-2 w-full border-collapse">
            <tbody>
              <tr>
                <td className={`${cell} w-[60%]`} rowSpan={2}><span className="text-xs uppercase text-gray-600">Payee</span><p className="text-base font-semibold">{dv.payee}</p></td>
                <td className={cell}><span className="text-xs uppercase text-gray-600">Date</span> <span className="ml-3 font-semibold">{fmtDate(dv.date)}</span></td>
              </tr>
              <tr><td className={cell}><span className="text-xs uppercase text-gray-600">Terms</span> <span className="ml-3 font-semibold">{dv.terms ?? ""}</span></td></tr>
            </tbody>
          </table>

          <table className="mb-2 w-full border-collapse">
            <thead><tr><th className={`${cell} text-center text-xs uppercase font-semibold`}>Particulars</th><th className={`${cell} w-[22%] text-center text-xs uppercase font-semibold`}>Amount</th></tr></thead>
            <tbody>
              <tr>
                <td className={`${cell} h-40 whitespace-pre-line`}>
                  {dv.particulars}
                  {dv.bills.length > 0 && (
                    <div className="mt-2 text-xs text-gray-700">
                      {dv.bills.map((b) => <div key={b.id}>{b.bill.billNo}{b.bill.supplierInvoiceNo ? ` · Inv ${b.bill.supplierInvoiceNo}` : ""} · {fmtDate(b.bill.billDate)} — {peso(b.amount)}</div>)}
                    </div>
                  )}
                </td>
                <td className={`${cell} text-right`}>{dv.bills.map((b) => <div key={b.id}>{peso(b.amount)}</div>)}</td>
              </tr>
              <tr><td className={`${cell} text-right text-xs uppercase text-gray-600`}>Total</td><td className={`${cell} text-right font-bold`}>{peso(dv.amount)}</td></tr>
            </tbody>
          </table>

          <table className="mb-2 w-full border-collapse">
            <thead><tr><th className={`${cell} text-center text-xs uppercase font-semibold`}>Account Title</th><th className={`${cell} w-[22%] text-center text-xs uppercase font-semibold`}>Debit (Credit)</th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}><td className={cell}>{l.credit ? <span className="pl-8">{l.title}</span> : l.title}{l.ref ? <span className="ml-2 font-mono text-[10px] text-gray-500">{l.ref}</span> : null}</td><td className={`${cell} text-right`}>{l.debit ? peso(l.debit) : `(${peso(l.credit)})`}</td></tr>
              ))}
              {lines.length < 6 && Array.from({ length: 6 - lines.length }).map((_, i) => <tr key={`e${i}`}><td className={`${cell} h-6`} /><td className={cell} /></tr>)}
            </tbody>
          </table>

          <table className="mb-2 w-full border-collapse text-center">
            <thead><tr>{sig.map(([l]) => <th key={l} className={`${cell} text-xs uppercase font-semibold`}>{l}</th>)}</tr></thead>
            <tbody><tr>{sig.map(([l, n]) => <td key={l} className={`${cell} h-14`}><div className="mt-6 border-b border-gray-800 text-[11px] font-semibold">{n ?? " "}</div></td>)}</tr></tbody>
          </table>

          <div className="flex gap-2">
            <table className="w-[57%] border-collapse">
              <thead>
                <tr><th className={`${cell} text-center text-xs uppercase font-semibold`} colSpan={3}>Details of Payment</th></tr>
                <tr><th className={`${cell} text-xs uppercase font-semibold`}>Check Number</th><th className={`${cell} text-xs uppercase font-semibold`}>Date</th><th className={`${cell} text-xs uppercase font-semibold`}>Amount</th></tr>
              </thead>
              <tbody>
                {dv.payments.map((p) => (
                  <tr key={p.id}><td className={cell}>{p.checkNo ?? p.refNo ?? p.method}</td><td className={cell}>{fmtDate(p.checkDate ?? p.date)}</td><td className={cell}>₱ {peso(p.amount).replace("₱", "")}</td></tr>
                ))}
                {dv.payments.length < 3 && Array.from({ length: 3 - dv.payments.length }).map((_, i) => <tr key={`p${i}`}><td className={`${cell} h-7`} /><td className={cell} /><td className={cell}>₱</td></tr>)}
                <tr><td className={`${cell} text-xs uppercase`} colSpan={2}>Total</td><td className={cell}>₱ {dv.paidAmount ? peso(dv.paidAmount).replace("₱", "") : ""}</td></tr>
              </tbody>
            </table>
            <div className="flex-1 pl-2 text-[12px] leading-6">
              Received from <span className="font-semibold underline">{company.companyName}</span> the amount of{" "}
              <span className="font-semibold underline">{amountInWords(dv.amount)}</span> ( ₱ <span className="font-semibold underline">{peso(dv.amount).replace("₱", "")}</span> ) in payment of the account described herein.
              <div className="mt-8 border-b border-gray-800" />
              <div className="text-center text-[10px] uppercase">Printed name over signature</div>
              <div className="mt-3">Date ______________________</div>
            </div>
          </div>

          <div className="mt-3 flex items-end justify-end gap-2">
            <span className="text-xs uppercase text-gray-600">DVN</span>
            <span className="font-mono text-lg font-bold text-red-600">{dv.dvNo}</span>
            {dv.padRef && <span className="text-xs text-gray-500">(pad {dv.padRef})</span>}
          </div>
        </div>
      </FitOnePageLetter>
    </>
  );
}
