import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { PageHeader } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { eligibleBills, type EligibleFilters } from "@/lib/dv-eligible";
import { createDV } from "../actions";
import { BillPicker } from "./bill-picker";
import { peso } from "@/lib/format";

const ERRORS: Record<string, string> = {
  payee: "Name the payee — pick a supplier or an employee, or type the name.",
  bill: "A selected bill is not posted, not open, or not this payee's.",
  mixed: "A voucher pays one payee. The bills selected belong to more than one supplier.",
  over: "Voucher allocation exceeds the available bill balance.",
  empty: "Select at least one bill, or raise a voucher with no bill below.",
};

/**
 * New Disbursement Voucher. The primary path is SEARCH / SELECT BILLS: every posted bill
 * with an unvouchered balance, inventory and non-inventory alike, filtered and ticked; the
 * voucher is then filled from them. A voucher with no bill behind it (an employee's
 * liquidation, a permit) is the secondary path at the bottom.
 */
export default async function NewDvPage({ searchParams }: { searchParams: EligibleFilters & { error?: string; bill?: string; avail?: string; nobill?: string } }) {
  const user = await requirePerm("dv");
  if (user.perm !== "READ_WRITE") return <div className="card text-sm text-gray-600">You have read-only access to disbursement vouchers.</div>;
  const company = await getActiveCompany(user);
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const rows = await eligibleBills(company.id, searchParams);
  const supplierPicked = searchParams.supplier ? await prisma.supplier.findUnique({ where: { id: searchParams.supplier }, select: { id: true, name: true } }) : null;
  const filterKeys: (keyof EligibleFilters)[] = ["supplier", "billNo", "invoice", "from", "to", "dueFrom", "dueTo", "kind", "min", "max", "po", "grn"];
  const filtering = filterKeys.some((k) => searchParams[k]);

  return (
    <div>
      <Link href="/dv" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">← Back to Disbursement Vouchers</Link>
      <PageHeader title="New Disbursement Voucher" />
      {searchParams.error && ERRORS[searchParams.error] && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">⚠ {ERRORS[searchParams.error]}{searchParams.bill ? ` (${searchParams.bill})` : ""}{searchParams.avail ? ` Available for Voucher: ${peso(Number(searchParams.avail))}` : ""}</p>
      )}

      <div className="card mb-4">
        <p className="mb-1 text-sm font-semibold">Search / Select Bills</p>
        <p className="mb-3 text-xs text-gray-500">
          Every posted bill of <span className="font-semibold">{company.companyName}</span> that still has an unvouchered balance — entered through Enter Bills (inventory) or
          Enter Bills — Non-Inventory. Tick the bills to pay; the first one fixes the payee, and the voucher is filled from them.
        </p>
        <form method="GET" className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <div className="sm:col-span-2"><label className="label">Supplier / Payee</label><SearchSelect entity="suppliers" name="supplier" defaultValue={supplierPicked ? { id: supplierPicked.id, label: supplierPicked.name } : undefined} placeholder="Any supplier…" /></div>
          <div><label className="label">Bill No.</label><input name="billNo" defaultValue={searchParams.billNo ?? ""} className="input" /></div>
          <div><label className="label">Supplier Invoice No.</label><input name="invoice" defaultValue={searchParams.invoice ?? ""} className="input" /></div>
          <div><label className="label">Bill Type</label><select name="kind" defaultValue={searchParams.kind ?? ""} className="input"><option value="">All</option><option value="INVENTORY">Inventory</option><option value="EXPENSE">Non-inventory</option></select></div>
          <div><label className="label">Purchase Order</label><input name="po" defaultValue={searchParams.po ?? ""} className="input" placeholder="PO no." /></div>
          <div><label className="label">Bill Date from</label><input name="from" type="date" defaultValue={searchParams.from ?? ""} className="input" /></div>
          <div><label className="label">to</label><input name="to" type="date" defaultValue={searchParams.to ?? ""} className="input" /></div>
          <div><label className="label">Due from</label><input name="dueFrom" type="date" defaultValue={searchParams.dueFrom ?? ""} className="input" /></div>
          <div><label className="label">to</label><input name="dueTo" type="date" defaultValue={searchParams.dueTo ?? ""} className="input" /></div>
          <div><label className="label">Amount from</label><input name="min" type="number" step="0.01" defaultValue={searchParams.min ?? ""} className="input" /></div>
          <div><label className="label">to</label><input name="max" type="number" step="0.01" defaultValue={searchParams.max ?? ""} className="input" /></div>
          <div><label className="label">Receiving No.</label><input name="grn" defaultValue={searchParams.grn ?? ""} className="input" placeholder="GRN no." /></div>
          <div className="flex items-end gap-2 sm:col-span-2"><button className="btn-secondary" type="submit">Search</button>{filtering && <Link href="/dv/new" className="text-xs text-gray-500 hover:underline">clear filters</Link>}<span className="text-xs text-gray-500">{rows.length} eligible bill(s)</span></div>
        </form>
      </div>

      <form action={createDV} className="mb-6">
        <BillPicker rows={rows} today={ymd} canCreate />
      </form>

      <details className="card" open={searchParams.nobill === "1"}>
        <summary className="cursor-pointer text-sm font-semibold">Voucher with no supplier bill <span className="font-normal text-gray-500">— an employee&rsquo;s liquidation or reimbursement, a permit or government fee, a bank charge</span></summary>
        <form action={createDV} className="mt-3 space-y-3">
          <p className="text-xs text-gray-500">Use this only when there is no supplier bill to pay. The voucher&rsquo;s own items are typed on the next screen and are booked when it is posted.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Employee</label><SearchSelect entity="employees" name="employeeId" placeholder="Type employee name…" /></div>
            <div><label className="label">or Payee name as printed</label><input name="payee" className="input" placeholder="e.g. Bureau of Internal Revenue, Juan dela Cruz…" /></div>
            <div><label className="label">Date</label><input name="date" type="date" defaultValue={ymd} required className="input" /></div>
            <div><label className="label">Terms</label><input name="terms" className="input" placeholder="e.g. COD" /></div>
            <div><label className="label">Pad DVN <span className="font-normal text-gray-400">(if stamped)</span></label><input name="padRef" className="input" placeholder="e.g. 24251" /></div>
            <div><label className="label">Memo (internal)</label><input name="memo" className="input" /></div>
            <div className="sm:col-span-2"><label className="label">Particulars</label><textarea name="particulars" rows={2} className="input" placeholder="what this payment is for" /></div>
          </div>
          <button className="btn-secondary" type="submit">Create voucher with no bill (Draft)</button>
        </form>
      </details>
    </div>
  );
}
