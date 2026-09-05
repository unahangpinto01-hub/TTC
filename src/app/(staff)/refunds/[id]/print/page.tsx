import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { fmtDate, peso } from "@/lib/format";
import { PrintDoc } from "@/components/print-doc";
import { remainingOf } from "@/lib/refunds-credits";

/** Printable credit memo / refund voucher on the shared letterhead. */
export default async function RefundCreditPrintPage({ params }: { params: { id: string } }) {
  const user = await requirePerm("refundsCredits");
  const company = await getActiveCompany(user);
  const rc = await prisma.refundCredit.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { businessName: true } },
      salesReceipt: { select: { srNumber: true } },
      cashAccount: { select: { name: true } },
      createdBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      lines: { include: { product: { select: { name: true } } } },
      applications: { select: { amount: true } },
      refundsDrawn: { where: { status: "Posted" }, select: { amount: true, status: true } },
    },
  });
  if (!rc || rc.companyId !== company.id) notFound();

  const isCredit = rc.type === "Credit";
  const lines = rc.lines.length
    ? rc.lines.map((l) => ({
        name: `${l.product?.name ?? l.description ?? ""}${l.returnToStock ? " (returned to stock)" : ""}`,
        qty: l.qty,
        unitPrice: l.unitPrice,
      }))
    : [{ name: `${isCredit ? "Credit" : "Refund"} — ${rc.reason}`, qty: 1, unitPrice: rc.amount }];

  return (
    <PrintDoc
      title={isCredit ? "Credit Memo" : "Refund Voucher"}
      docNumber={rc.rcNumber}
      date={rc.date}
      docType="RC"
      meta={[
        ["Customer", rc.customer.businessName],
        ["Reason", rc.reason],
        ["Related Invoice", rc.salesReceipt?.srNumber ?? "—"],
        ["Status", rc.status],
        ...(isCredit
          ? ([["Remaining Credit", peso(remainingOf(rc))]] as [string, string][])
          : ([
              ["Refund Method", rc.refundMethod ?? "—"],
              ["Refund Date", rc.refundDate ? fmtDate(rc.refundDate) : "—"],
              ["Paid From", rc.cashAccount?.name ?? "—"],
              ["Reference", rc.refundRefNo ?? "—"],
            ] as [string, string][])),
      ]}
      lines={lines}
      showVat={false}
      footnote={`Remarks: ${rc.remarks}. ${isCredit
        ? "This credit memo reduces the customer's account when applied to an invoice; the remaining balance is available for future invoices."
        : "This voucher documents money returned to the customer under the approval above."}`}
      signatures={[
        { label: "Prepared By", name: rc.createdBy?.name ?? "" },
        { label: "Approved By", name: rc.approvedBy?.name ?? "" },
        { label: "Received By (Customer)" },
      ]}
    />
  );
}
