import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { fmtDate } from "@/lib/format";
import { voucherLines, amountInWords } from "@/lib/dv";
import { PrintButton, BackButton } from "@/components/print-button";
import { FitOnePageLetter } from "@/components/print-fit";
import { DvSheet } from "@/components/dv-sheet";

/** The company's Disbursement Voucher on one Letter sheet — the same drawing as the on-screen preview. */
export default async function DvPrintPage({ params }: { params: { id: string } }) {
  const user = await requirePerm("dv");
  const company = await getActiveCompany(user);
  const dv = await prisma.disbursementVoucher.findUnique({
    where: { id: params.id },
    include: {
      company: { select: { companyName: true, glPayablesId: true, glPayables: { select: { code: true, description: true } }, glInputVatId: true, glInputVat: { select: { code: true, description: true } } } },
      bills: { include: { bill: { select: { billNo: true, kind: true, total: true, inputVat: true, supplierInvoiceNo: true, billDate: true, supplier: { select: { name: true } }, expenseLines: { include: { glAccount: { select: { code: true, description: true } } } } } } } },
      accountLines: { orderBy: { sortOrder: "asc" } },
      preparedBy: { select: { name: true } }, checkedBy: { select: { name: true } }, approvedBy: { select: { name: true } },
      notedBy: { select: { name: true } }, postedBy: { select: { name: true } },
      payments: { where: { status: "Posted" }, include: { cashAccount: { include: { glAccount: { select: { code: true, description: true } } } } }, orderBy: { date: "asc" } },
    },
  });
  if (!dv || dv.companyId !== company.id) notFound();
  const lines = voucherLines(dv);

  return (
    <>
      <style>{`@page { size: 8.5in 11in portrait; margin: 0.5in; }`}</style>
      <FitOnePageLetter>
        <div className="print-page mx-auto max-w-[210mm] rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="no-print flex justify-between p-4 pb-0"><BackButton /><PrintButton /></div>
          <DvSheet
            d={{
              companyName: company.companyName, dvNo: dv.dvNo, padRef: dv.padRef, payee: dv.payee, date: fmtDate(dv.date), terms: dv.terms ?? "", particulars: dv.particulars,
              items: dv.bills.map((b) => ({ label: `${b.bill.billNo}${b.bill.supplierInvoiceNo ? ` · Inv ${b.bill.supplierInvoiceNo}` : ""} · ${fmtDate(b.bill.billDate)}`, amount: b.amount })),
              amount: dv.amount, amountInWords: amountInWords(dv.amount),
              lines: lines.map((l) => ({ title: l.title, debit: l.debit, credit: l.credit })),
              signatures: { preparedBy: dv.preparedBy?.name, checkedBy: dv.checkedBy?.name, approvedBy: dv.approvedBy?.name, notedBy: dv.notedBy?.name, postedBy: dv.postedBy?.name },
              payments: dv.payments.map((p) => ({ checkNo: p.checkNo ?? p.refNo ?? p.method, date: fmtDate(p.checkDate ?? p.date), amount: p.amount })),
              paidTotal: dv.paidAmount, status: dv.status,
            }}
          />
        </div>
      </FitOnePageLetter>
    </>
  );
}
