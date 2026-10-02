import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { PageHeader } from "@/components/ui";
import { createOtherReceipt } from "../actions";
import { ReceiptForm } from "../receipt-form";

export default async function NewOtherReceiptPage({ searchParams }: { searchParams: { error?: string } }) {
  const user = await requirePermWrite("otherReceipts");
  const company = await getActiveCompany(user);
  const accounts = await prisma.cashAccount.findMany({ where: { companyId: company.id, status: "Active" }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="max-w-5xl">
      <Link href="/other-receipts" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">← Back to Other Receipts</Link>
      <PageHeader title={`Other Receipt — ${company.companyName}`} />
      {searchParams.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">⚠ Not saved.</span> {searchParams.error}</p>}
      <ReceiptForm
        action={createOtherReceipt}
        accounts={accounts}
        submitLabel="Save as Draft"
        values={{ date: today, payor: "", employee: null, method: "Cash", cashAccountId: "", refNo: "", checkNo: "", checkDate: "", remarks: "", lines: [] }}
      />
    </div>
  );
}
