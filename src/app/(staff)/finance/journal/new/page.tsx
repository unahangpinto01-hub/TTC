import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { PageHeader } from "@/components/ui";
import { createJournalVoucher } from "../actions";
import { JournalForm } from "../journal-form";

export default async function NewJournalVoucherPage({ searchParams }: { searchParams: { error?: string } }) {
  const user = await requirePermWrite("journal");
  const company = await getActiveCompany(user);
  const cashAccounts = await prisma.cashAccount.findMany({ where: { companyId: company.id, status: "Active" }, orderBy: { name: "asc" }, select: { id: true, name: true, glAccountId: true } });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="max-w-5xl">
      <Link href="/finance/journal" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">← Back to General Journal</Link>
      <PageHeader title={`Journal Voucher — ${company.companyName}`} />
      {searchParams.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">⚠ Not saved.</span> {searchParams.error}</p>}
      <JournalForm action={createJournalVoucher} cashAccounts={cashAccounts} submitLabel="Save as Draft" values={{ date: today, refNo: "", memo: "", lines: [] }} />
    </div>
  );
}
