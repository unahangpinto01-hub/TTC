import { requirePerm } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { createPO } from "../actions";
import { POLinePicker } from "./line-picker";
import { getActiveCompany } from "@/lib/company";
import { SearchSelect } from "@/components/search-select";

export default async function NewPOPage() {
  const user = await requirePerm("purchaseOrders");
  const company = await getActiveCompany(user);
  return (
    <div className="max-w-3xl">
      <PageHeader title="New Purchase Order" />
      <form action={createPO} className="card space-y-4">
        <div className="flex flex-wrap gap-4">
          <div className="w-80">
            <label className="label">Supplier</label>
            <SearchSelect entity="suppliers" name="supplierId" required placeholder="Type supplier name…" />
          </div>
          <div>
            <label className="label">PO Date</label>
            <input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="input" />
          </div>
        </div>
        <POLinePicker companyId={company.id} />
        <button className="btn-primary" type="submit">Create PO (Draft)</button>
      </form>
    </div>
  );
}
