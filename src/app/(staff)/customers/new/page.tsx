import { requirePerm } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { createCustomer } from "../actions";
import { getSalespeople } from "@/lib/salespeople";

export default async function NewCustomerPage() {
  await requirePerm("customers");
  const salespeople = await getSalespeople();
  return (
    <div className="max-w-2xl">
      <PageHeader title="New Customer" />
      <form action={createCustomer} className="card space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label className="label">Business Name</label><input name="businessName" required className="input" /></div>
          <div><label className="label">Contact Person</label><input name="contactPerson" className="input" /></div>
          <div><label className="label">Mobile</label><input name="mobile" className="input" placeholder="0917-123-4567" /></div>
          <div><label className="label">Messenger Handle</label><input name="messengerHandle" className="input" /></div>
          <div className="sm:col-span-2"><label className="label">Address</label><input name="address" className="input" /></div>
          <div>
            <label className="label">Region</label>
            <select name="region" className="input"><option>Luzon</option><option>Visayas</option><option>Mindanao</option></select>
          </div>
          <div><label className="label">Province</label><input name="province" className="input" /></div>
          <div><label className="label">Credit Limit (₱)</label><input name="creditLimit" type="number" step="0.01" className="input" /></div>
          <div>
            <label className="label">Assigned Salesperson</label>
            <select name="salespersonId" className="input">
              <option value="">— Unassigned —</option>
              {salespeople.map((sp) => (
                <option key={sp.id} value={sp.id}>{sp.name} · {sp.position}</option>
              ))}
            </select>
            {!salespeople.length && (
              <p className="mt-1 text-xs text-gray-500">No salespeople yet — tick &ldquo;Salesperson&rdquo; on an employee in HR.</p>
            )}
          </div>
          <div>
            <label className="label">Allowed Payment Terms</label>
            <div className="flex gap-4 pt-1.5">
              {["COD", "30", "60", "90"].map((t) => (
                <label key={t} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" name={`term_${t}`} defaultChecked={t === "COD"} /> {t === "COD" ? "COD" : `${t} days`}
                </label>
              ))}
            </div>
          </div>
        </div>
        <button className="btn-primary" type="submit">Create Customer</button>
      </form>
    </div>
  );
}
