import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { PageHeader } from "@/components/ui";
import { updateOtherReceipt } from "../../actions";
import { ReceiptForm } from "../../receipt-form";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default async function EditOtherReceiptPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
  const user = await requirePermWrite("otherReceipts");
  const company = await getActiveCompany(user);
  const r = await prisma.otherReceipt.findUnique({
    where: { id: params.id },
    include: { employee: { select: { id: true, name: true, position: true } }, lines: { include: { glAccount: { select: { code: true, description: true } } }, orderBy: { sortOrder: "asc" } } },
  });
  if (!r || r.companyId !== company.id) notFound();
  if (r.status !== "Draft") notFound(); // only drafts are editable
  const accounts = await prisma.cashAccount.findMany({ where: { companyId: company.id, status: "Active" }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } });

  return (
    <div className="max-w-5xl">
      <Link href={`/other-receipts/${r.id}`} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">← Back to {r.crNumber}</Link>
      <PageHeader title={`Edit Draft ${r.crNumber} — ${r.payor}`} />
      {searchParams.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">⚠ Not saved.</span> {searchParams.error}</p>}
      <ReceiptForm
        action={updateOtherReceipt}
        accounts={accounts}
        submitLabel="Save Changes"
        values={{
          id: r.id, date: ymd(r.date), payor: r.employee && r.payor === r.employee.name ? "" : r.payor, employee: r.employee, method: r.method,
          cashAccountId: r.cashAccountId ?? "", refNo: r.refNo ?? "", checkNo: r.checkNo ?? "", checkDate: r.checkDate ? ymd(r.checkDate) : "", remarks: r.remarks ?? "",
          lines: r.lines.map((l) => ({ glAccountId: l.glAccountId, accountCode: l.glAccount.code, accountName: l.glAccount.description, description: l.description, amount: l.amount })),
        }}
      />
    </div>
  );
}
