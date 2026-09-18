"use client";

import { useState } from "react";
import { SearchSelect, type SearchHit } from "@/components/search-select";

export type DvItemRow = { glAccountId: string; account: string; description: string; amount: number };
type Row = DvItemRow & { key: number; picking: boolean };

const peso = (n: number) => (n < 0 ? "(" : "") + "₱" + Math.abs(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (n < 0 ? ")" : "");

/**
 * The voucher's own particulars — what it pays when there is no supplier bill behind it.
 * Each item is charged to an account from the Chart of Accounts (fuel to Fuel, a permit to
 * Taxes, Licenses and Permits…) and a negative amount is a deduction. These items are the
 * entry when the voucher is posted, so the account matters; the description is what prints.
 */
export function DvItems({ items, canEdit }: { items: DvItemRow[]; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>(items.map((it, i) => ({ ...it, key: i, picking: false })));
  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  const add = () => setRows((rs) => [...rs, { key: (rs[rs.length - 1]?.key ?? -1) + 1, glAccountId: "", account: "", description: "", amount: 0, picking: true }]);
  const pick = (key: number, h: SearchHit | null) => {
    const r = rows.find((x) => x.key === key);
    patch(key, { glAccountId: h?.id ?? "", account: h ? `${h.data?.code ?? ""} ${h.label}`.trim() : "", description: r?.description || (h ? h.label : ""), picking: false });
  };
  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr><th className="table-th">Charged to (account)</th><th className="table-th">Particulars (as printed)</th><th className="table-th text-right">Amount</th>{canEdit && <th className="table-th" />}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.key} data-item-label={r.description}>
                <td className="table-td">
                  <input type="hidden" name="itemAccountId" value={r.glAccountId} />
                  {canEdit && r.picking ? (
                    <SearchSelect entity="gl-accounts" placeholder="Type account code or name…" onSelect={(h) => pick(r.key, h)} />
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className={`text-sm ${r.account ? "" : "text-red-600"}`}>{r.account || "no account yet"}</span>
                      {canEdit && <button type="button" className="text-xs text-emerald-700 hover:underline" onClick={() => patch(r.key, { picking: true })}>change</button>}
                    </div>
                  )}
                </td>
                <td className="table-td">
                  {canEdit ? <input name="itemDescription" value={r.description} onChange={(e) => patch(r.key, { description: e.target.value })} placeholder="e.g. Fuel — trip to Davao" className="input w-full py-1" /> : <><span className="text-sm">{r.description}</span><input type="hidden" name="itemDescription" value={r.description} /></>}
                </td>
                <td className="table-td text-right">
                  {canEdit ? <input name="itemAmount" type="number" step="0.01" value={r.amount || ""} onChange={(e) => patch(r.key, { amount: Number(e.target.value) || 0 })} placeholder="0.00 (negative = deduction)" className={`input w-40 py-1 text-right ${r.amount < 0 ? "text-red-700" : ""}`} /> : <><span className={`font-semibold ${r.amount < 0 ? "text-red-700" : ""}`}>{peso(r.amount)}</span><input type="hidden" name="itemAmount" value={r.amount} /></>}
                </td>
                {canEdit && <td className="table-td"><button type="button" onClick={() => remove(r.key)} className="text-xs text-red-600 hover:underline">✕</button></td>}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="p-4 text-center text-sm text-gray-500">No items — use this when the voucher pays something with no supplier bill behind it (a liquidation, a permit, a reimbursement).</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <tr><td className="table-td" colSpan={2}>NET OF ITEMS {total < 0 && <span className="ml-2 text-xs font-normal text-red-600">deductions exceed the charges</span>}</td><td className="table-td text-right text-lg">{peso(total)}</td>{canEdit && <td />}</tr>
            </tfoot>
          )}
        </table>
      </div>
      {canEdit && <button type="button" className="btn-secondary mt-2" onClick={add}>+ Add item</button>}
    </div>
  );
}
