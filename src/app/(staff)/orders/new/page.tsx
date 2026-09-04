import { requirePerm } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { encodeOrder } from "../actions";
import { EncodeLines } from "./encode-lines";
import { getActiveCompany } from "@/lib/company";
import { SearchSelect } from "@/components/search-select";

export default async function EncodeOrderPage({ searchParams }: { searchParams: { error?: string } }) {
  const user = await requirePerm("orders");
  const company = await getActiveCompany(user);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Encode Order (Messenger / Text)" />
      {searchParams.error === "empty" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Add at least one line with a quantity.</p>
      )}
      {searchParams.error === "nocarton" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          A line was set to CARTON for a product with no pieces-per-carton configured. Set it on the product first, or order in PCS.
        </p>
      )}
      <form action={encodeOrder} className="card space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label">Customer</label>
            <SearchSelect entity="customers" name="customerId" required placeholder="Type customer name…" />
          </div>
          <div>
            <label className="label">Source</label>
            <select name="source" className="input">
              <option value="MESSENGER">Messenger</option>
              <option value="TEXT">Text / SMS</option>
            </select>
          </div>
          <div>
            <label className="label">Order Date</label>
            <input
              name="orderDate"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              max={new Date().toISOString().slice(0, 10)}
              className="input"
              title="When the transaction actually happened — backdate this when encoding a previous transaction"
            />
          </div>
          <div>
            <label className="label">Payment Term</label>
            <select name="term" className="input">
              <option value="COD">COD</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
            </select>
          </div>
          <div>
            <label className="label">Freight Charge (₱ per carton)</label>
            <input name="freightPerCarton" type="number" min={0} step="0.01" placeholder="0.00" className="input" />
            <p className="mt-0.5 text-xs text-gray-500">Charged to the customer: rate × cartons on CARTON lines.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Notes</label>
            <input name="notes" className="input" placeholder="e.g. screenshot from FB dated Aug 14" />
          </div>
        </div>
        <EncodeLines companyId={company.id} />
        <button className="btn-primary" type="submit">Save Incoming Order</button>
      </form>
    </div>
  );
}
