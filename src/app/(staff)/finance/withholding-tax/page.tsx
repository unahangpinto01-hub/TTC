import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { PageHeader, StatusBadge } from "@/components/ui";
import { saveWithholdingTaxType } from "./actions";

const ERRORS: Record<string, string> = {
  fields: "A tax code and a name are required.",
  rate: "The rate must be a percentage above 0 and below 100.",
  dupe: "That tax code is already in the list.",
};
const APPLIES = [["GOODS", "Inventory bills (goods)"], ["SERVICES", "Non-inventory bills (services)"], ["ANY", "Either"]] as const;
const pct = (r: number) => (Math.round(r * 10000) / 100).toString();

/** The BIR expanded withholding tax rates the bills pick from — editable data, never fixed in the program. */
export default async function WithholdingTaxPage({ searchParams }: { searchParams: { error?: string; saved?: string } }) {
  const user = await requirePerm("coa");
  const canEdit = user.perm === "READ_WRITE";
  const types = await prisma.withholdingTaxType.findMany({ orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });

  return (
    <div className="max-w-4xl">
      <PageHeader title="Withholding Tax Rates (EWT)" />
      {searchParams.error && ERRORS[searchParams.error] && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">⚠ {ERRORS[searchParams.error]}</p>}
      {searchParams.saved && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✔ Saved.</p>}
      <p className="mb-4 text-sm text-gray-600">
        Expanded withholding tax under BIR rules is taken on the VAT-exclusive amount of a supplier&rsquo;s bill and remitted to the BIR; the supplier is
        paid the rest. A bill picks one of these types and keeps the rate it had at the time, so changing a rate here affects new bills only.
        Inventory bills default to the first active <span className="font-semibold">goods</span> type.
      </p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[760px]">
          <thead className="border-b border-gray-200 bg-gray-50"><tr><th className="table-th">Order</th><th className="table-th">BIR code</th><th className="table-th">Name</th><th className="table-th text-right">Rate %</th><th className="table-th">Default for</th><th className="table-th">Status</th>{canEdit && <th className="table-th" />}</tr></thead>
          <tbody className="divide-y divide-gray-100">
            {types.map((t) => (
              <tr key={t.id}>
                {canEdit ? (
                  <td colSpan={7} className="p-0">
                    <form action={saveWithholdingTaxType} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <input type="hidden" name="id" value={t.id} />
                      <input name="sortOrder" type="number" defaultValue={t.sortOrder} className="input w-16 py-1 text-right" />
                      <input name="code" defaultValue={t.code} className="input w-24 py-1 font-mono uppercase" />
                      <input name="name" defaultValue={t.name} className="input flex-1 py-1" />
                      <input name="ratePct" type="number" step="0.01" min={0.01} max={99.99} defaultValue={pct(t.rate)} className="input w-24 py-1 text-right" />
                      <select name="appliesTo" defaultValue={t.appliesTo} className="input w-56 py-1">{APPLIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                      <select name="status" defaultValue={t.status} className="input w-28 py-1"><option>Active</option><option>Inactive</option></select>
                      <button className="btn-secondary py-1" type="submit">Save</button>
                    </form>
                  </td>
                ) : (
                  <>
                    <td className="table-td text-sm text-gray-500">{t.sortOrder}</td>
                    <td className="table-td font-mono text-sm">{t.code}</td>
                    <td className="table-td text-sm">{t.name}</td>
                    <td className="table-td text-right font-semibold">{pct(t.rate)}%</td>
                    <td className="table-td text-sm text-gray-600">{APPLIES.find(([k]) => k === t.appliesTo)?.[1] ?? t.appliesTo}</td>
                    <td className="table-td"><StatusBadge status={t.status} /></td>
                  </>
                )}
              </tr>
            ))}
            {!types.length && <tr><td colSpan={7} className="p-6 text-center text-sm text-gray-500">No withholding tax types yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <form action={saveWithholdingTaxType} className="card mt-4 space-y-3">
          <h2 className="font-semibold">Add a type</h2>
          <div className="grid gap-3 sm:grid-cols-6">
            <div><label className="label">BIR code</label><input name="code" required placeholder="WC158" className="input font-mono uppercase" /></div>
            <div className="sm:col-span-2"><label className="label">Name</label><input name="name" required placeholder="Purchase of goods" className="input" /></div>
            <div><label className="label">Rate %</label><input name="ratePct" type="number" step="0.01" min={0.01} max={99.99} required placeholder="1" className="input text-right" /></div>
            <div><label className="label">Default for</label><select name="appliesTo" defaultValue="ANY" className="input">{APPLIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div><label className="label">Order</label><input name="sortOrder" type="number" defaultValue={types.length + 1} className="input text-right" /></div>
          </div>
          <button className="btn-primary" type="submit">Add</button>
        </form>
      )}
    </div>
  );
}
