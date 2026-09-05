import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ImportForm } from "./import-form";

export default async function COAImportPage() {
  await requirePermWrite("coa");
  const codes = (await prisma.gLAccount.findMany({ select: { code: true } })).map((a) => a.code);
  return (
    <div className="max-w-4xl">
      <Link href="/finance/coa" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
        ← Back to Chart of Accounts
      </Link>
      <PageHeader title="Import Chart of Accounts" />
      <p className="mb-4 text-sm text-gray-600">
        Upload the masterlist Excel. Every row is validated (duplicate codes, missing fields, invalid BS/IS
        classification) and previewed before anything is written. Existing accounts are never overwritten unless you
        explicitly authorize it below.
      </p>
      <ImportForm existingCodes={codes} />
    </div>
  );
}
