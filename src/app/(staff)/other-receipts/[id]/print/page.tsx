import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { fmtDate, peso } from "@/lib/format";
import { PrintDoc } from "@/components/print-doc";

/** The printable acknowledgement receipt — same letterhead engine as every other document. */
export default async function OtherReceiptPrintPage({ params }: { params: { id: string } }) {
  const user = await requirePerm("otherReceipts");
  const company = await getActiveCompany(user);
  const r = await prisma.otherReceipt.findUnique({
    where: { id: params.id },
    include: {
      cashAccount: { select: { name: true } },
      receivedBy: { select: { name: true } },
      lines: { include: { glAccount: { select: { code: true, description: true } } }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!r || r.companyId !== company.id) notFound();
  const refBits = [r.refNo && `Ref ${r.refNo}`, r.checkNo && `Check ${r.checkNo}${r.checkDate ? ` dtd ${fmtDate(r.checkDate)}` : ""}`].filter(Boolean).join(" · ");

  return (
    <PrintDoc
      title="Acknowledgement Receipt"
      docNumber={r.crNumber}
      date={r.date}
      docType="PR"
      meta={[
        ["Received From", r.payor],
        ["Payment Method", r.method],
        ["Reference", refBits || "—"],
        ["Cash/Bank Account", r.cashAccount?.name ?? "—"],
        ["Status", r.status],
        ["Amount Received", peso(r.amount)],
      ]}
      lines={r.lines.map((l) => ({ name: `${l.description} · ${l.glAccount.code} ${l.glAccount.description}`, qty: 1, unitPrice: l.amount }))}
      showVat={false}
      footnote={(r.remarks ? `Remarks: ${r.remarks}. ` : "") + "This acknowledges the money received above; only a Posted receipt is booked. Not valid as an official receipt."}
      signatures={[{ label: "Received By", name: r.receivedBy?.name ?? "" }, { label: "Payor" }]}
    />
  );
}
