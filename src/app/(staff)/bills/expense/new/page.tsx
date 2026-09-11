import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { TERMS, DEFAULT_TERMS } from "@/lib/bills";
import { PageHeader } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { createExpenseBill } from "../../actions";

const ERRORS: Record<string, string> = { supplier: "Choose the supplier or payee this bill is from." };

export default async function NewExpenseBillPage({ searchParams }: { searchParams: { error?: string } }) {
  const user = await requirePerm("expenses");
  if (user.perm !== "READ_WRITE") return <div className="card text-sm text-gray-600">You have read-only access to bills.</div>;
  const company = await getActiveCompany(user);
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <div className="max-w-3xl">
      <Link href="/bills/expense" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">← Back to Non-Inventory Bills</Link>
      <PageHeader title="New Non-Inventory Bill" />
      {searchParams.error && ERRORS[searchParams.error] && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">⚠</span> {ERRORS[searchParams.error]}</p>}
      <form action={createExpenseBill} className="card space-y-4">
        <p className="text-xs text-gray-500">
          For utilities, rent, repairs, professional fees, supplies, advertising and other supplier charges that are not stock.
          The bill goes to the expense accounts you choose and raises the supplier&rsquo;s payable; it never touches inventory.
          It is paid later through a Disbursement Voucher and Payment.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><label className="label">Supplier / Payee</label><SearchSelect entity="suppliers" name="supplierId" required placeholder="Type supplier name…" /></div>
          <div>
            <label className="label">Supplier Invoice / Reference No.</label>
            <input name="supplierInvoiceNo" className="input" placeholder="invoice, SOA or bill number" />
            <label className="mt-1 flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" name="invoiceUnavailable" /> No reference number available</label>
          </div>
          <div><label className="label">Bill Date</label><input name="billDate" type="date" defaultValue={ymd} required className="input" /></div>
          <div><label className="label">Terms</label><select name="terms" defaultValue={DEFAULT_TERMS} className="input">{TERMS.map((t) => <option key={t}>{t}</option>)}</select></div>
          <div><label className="label">Due Date <span className="font-normal text-gray-400">(blank = bill date + terms)</span></label><input name="dueDate" type="date" className="input" /></div>
          <div className="sm:col-span-2"><label className="label">Memo / Remarks</label><input name="memo" className="input" /></div>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary" type="submit">Create Bill (Draft)</button>
          <p className="text-xs text-gray-500">Company: <span className="font-semibold">{company.companyName}</span>. The expense lines are entered on the next screen.</p>
        </div>
      </form>
    </div>
  );
}
