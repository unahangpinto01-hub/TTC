import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { PageHeader } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { createDV } from "../actions";

export default async function NewDvPage({ searchParams }: { searchParams: { error?: string } }) {
  const user = await requirePerm("dv");
  if (user.perm !== "READ_WRITE") return <div className="card text-sm text-gray-600">You have read-only access to disbursement vouchers.</div>;
  const company = await getActiveCompany(user);
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return (
    <div className="max-w-3xl">
      <Link href="/dv" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">← Back to Disbursement Vouchers</Link>
      <PageHeader title="New Disbursement Voucher" />
      {searchParams.error === "supplier" && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">⚠ Choose the payee.</p>}
      <form action={createDV} className="card space-y-4">
        <p className="text-xs text-gray-500">
          One voucher per payee. On the next screen you choose which of the payee&rsquo;s posted bills it authorises paying and how
          much of each. The voucher then goes Prepared → Checked → Approved → Posted; payment is recorded separately against it.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><label className="label">Payee (supplier)</label><SearchSelect entity="suppliers" name="supplierId" required placeholder="Type supplier name…" /></div>
          <div><label className="label">Payee name as printed <span className="font-normal text-gray-400">(blank = supplier name)</span></label><input name="payee" className="input" /></div>
          <div><label className="label">Date</label><input name="date" type="date" defaultValue={ymd} required className="input" /></div>
          <div><label className="label">Terms</label><input name="terms" className="input" placeholder="e.g. 30 days, COD" /></div>
          <div><label className="label">Pad DVN <span className="font-normal text-gray-400">(if stamped)</span></label><input name="padRef" className="input" placeholder="e.g. 24251" /></div>
          <div className="sm:col-span-2"><label className="label">Particulars</label><textarea name="particulars" rows={3} className="input" placeholder="what this payment is for" /></div>
          <div className="sm:col-span-2"><label className="label">Memo (internal)</label><input name="memo" className="input" /></div>
        </div>
        <div className="flex items-center gap-3"><button className="btn-primary" type="submit">Create Voucher (Draft)</button><p className="text-xs text-gray-500">Company: <span className="font-semibold">{company.companyName}</span></p></div>
      </form>
    </div>
  );
}
