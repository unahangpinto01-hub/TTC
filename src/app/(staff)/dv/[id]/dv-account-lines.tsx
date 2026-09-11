"use client";

import { useState } from "react";
import { SearchSelect, type SearchHit } from "@/components/search-select";

export type AccountLineRow = { id: string; glAccountId: string; title: string; debit: number; credit: number };
type Row = AccountLineRow & { key: number; picking: boolean };

const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The Account Title / Debit (Credit) block, editable. Each title is picked from the Chart of
 * Accounts (or typed), with its debit or credit. Debits and credits are totalled so an
 * unbalanced voucher is obvious before it is signed. Every row submits one of each field, in
 * order, so the action reads them back line by line.
 */
export function DvAccountLines({ lines, canEdit }: { lines: AccountLineRow[]; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>(lines.map((l, i) => ({ ...l, key: i, picking: false })));
  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  const add = () => setRows((rs) => [...rs, { key: (rs[rs.length - 1]?.key ?? -1) + 1, id: "", glAccountId: "", title: "", debit: 0, credit: 0, picking: true }]);
  const pick = (key: number, h: SearchHit | null) => patch(key, { glAccountId: h?.id ?? "", title: h ? `${h.data?.code ?? ""} ${h.label}`.trim() : "", picking: false });
  const dr = rows.reduce((s, r) => s + (r.debit || 0), 0);
  const cr = rows.reduce((s, r) => s + (r.credit || 0), 0);
  const balanced = Math.abs(dr - cr) < 0.005;

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr><th className="table-th">Account Title</th><th className="table-th text-right">Debit</th><th className="table-th text-right">(Credit)</th>{canEdit && <th className="table-th" />}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="table-td">
                  <input type="hidden" name="lineId" value={r.id} />
                  <input type="hidden" name="lineAccountId" value={r.glAccountId} />
                  {canEdit && r.picking ? (
                    <div className="flex gap-2">
                      <SearchSelect entity="gl-accounts" placeholder="Type account code or name…" onSelect={(h) => pick(r.key, h)} className="flex-1" />
                      <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => patch(r.key, { picking: false })}>type instead</button>
                    </div>
                  ) : canEdit ? (
                    <div className="flex gap-2">
                      <input name="lineTitle" value={r.title} onChange={(e) => patch(r.key, { title: e.target.value, glAccountId: "" })} placeholder="account title as printed" className={`input flex-1 py-1 ${r.credit ? "pl-8" : ""}`} />
                      <button type="button" className="text-xs text-emerald-700 hover:underline" onClick={() => patch(r.key, { picking: true })}>pick from chart</button>
                    </div>
                  ) : (
                    <span className={r.credit ? "pl-8" : ""}>{r.title}</span>
                  )}
                  {canEdit && r.picking && <input type="hidden" name="lineTitle" value={r.title} />}
                </td>
                <td className="table-td text-right">
                  {canEdit ? <input name="lineDebit" type="number" min={0} step="0.01" value={r.debit || ""} onChange={(e) => patch(r.key, { debit: Math.max(0, Number(e.target.value) || 0), credit: 0 })} placeholder="0.00" className="input w-32 py-1 text-right" /> : <>{r.debit ? peso(r.debit) : ""}<input type="hidden" name="lineDebit" value={r.debit} /></>}
                </td>
                <td className="table-td text-right">
                  {canEdit ? <input name="lineCredit" type="number" min={0} step="0.01" value={r.credit || ""} onChange={(e) => patch(r.key, { credit: Math.max(0, Number(e.target.value) || 0), debit: 0 })} placeholder="0.00" className="input w-32 py-1 text-right" /> : <>{r.credit ? `(${peso(r.credit)})` : ""}<input type="hidden" name="lineCredit" value={r.credit} /></>}
                </td>
                {canEdit && <td className="table-td"><button type="button" onClick={() => remove(r.key)} className="text-xs text-red-600 hover:underline">✕</button></td>}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="p-4 text-center text-sm text-gray-500">No account lines yet — they are generated from the bills when the voucher is saved, or add them here.</td></tr>}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 text-sm font-bold">
            <tr><td className="table-td">TOTAL {balanced ? <span className="ml-2 text-xs font-normal text-emerald-700">balanced</span> : <span className="ml-2 text-xs font-normal text-red-600">debits and credits differ by {peso(Math.abs(dr - cr))}</span>}</td><td className="table-td text-right">{peso(dr)}</td><td className="table-td text-right">({peso(cr)})</td>{canEdit && <td />}</tr>
          </tfoot>
        </table>
      </div>
      {canEdit && <button type="button" className="btn-secondary mt-2" onClick={add}>+ Add account line</button>}
    </div>
  );
}
