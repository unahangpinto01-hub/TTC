import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { PageHeader } from "@/components/ui";
import { updateJournalVoucher } from "../../actions";
import { JournalForm } from "../../journal-form";

export default async function EditJournalVoucherPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
  const user = await requirePermWrite("journal");
  const company = await getActiveCompany(user);
  const v = await prisma.journalVoucher.findUnique({
    where: { id: params.id },
    include: { lines: { include: { glAccount: { select: { code: true, description: true } } }, orderBy: { sortOrder: "asc" } } },
  });
  if (!v || v.companyId !== company.id) notFound();
  if (v.status !== "Draft") notFound(); // only drafts are editable
  const cashAccounts = await prisma.cashAccount.findMany({ where: { companyId: company.id, status: "Active" }, orderBy: { name: "asc" }, select: { id: true, name: true, glAccountId: true } });
  return (
    <div className="max-w-5xl">
      <Link href={`/finance/journal/${v.id}`} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">← Back to {v.jvNumber}</Link>
      <PageHeader title={`Edit Draft ${v.jvNumber}`} />
      {searchParams.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">⚠ Not saved.</span> {searchParams.error}</p>}
      <JournalForm
        action={updateJournalVoucher}
        cashAccounts={cashAccounts}
        submitLabel="Save Changes"
        values={{
          id: v.id, date: v.date.toISOString().slice(0, 10), refNo: v.refNo ?? "", memo: v.memo,
          lines: v.lines.map((l) => ({ glAccountId: l.glAccountId, accountCode: l.glAccount.code, accountName: l.glAccount.description, cashAccountId: l.cashAccountId ?? "", description: l.description, debit: l.debit, credit: l.credit })),
        }}
      />
    </div>
  );
}
