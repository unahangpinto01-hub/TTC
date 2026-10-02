"use client";

import { useState } from "react";
import { SearchSelect, type SearchHit } from "@/components/search-select";

export type ReceiptLineRow = { glAccountId: string; accountCode: string; accountName: string; description: string; amount: number };
type Row = ReceiptLineRow & { key: number; picking: boolean };

const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * What the money settles or earns: each line credits an account from the Chart of Accounts
 * (a loan returned to Advances to BOD, a salary deduction to Salary Loan, bank interest to
 * Interest Income). The lines add up to the amount received — there is no separate amount box.
 */
export function ReceiptLines({ lines, canEdit }: { lines: ReceiptLineRow[]; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>(lines.length ? lines.map((l, i) => ({ ...l, key: i, picking: false })) : canEdit ? [{ key: 0, glAccountId: "", accountCode: "", accountName: "", description: "", amount: 0, picking: true }] : []);
  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  const add = () => setRows((rs) => [...rs, { key: (rs[rs.length - 1]?.key ?? -1) + 1, glAccountId: "", accountCode: "", accountName: "", description: "", amount: 0, picking: true }]);
  const pick = (key: number, h: SearchHit | null) => {
    const r = rows.find((x) => x.key === key);
    patch(key, { glAccountId: h?.id ?? "", accountCode: String(h?.data?.code ?? ""), accountName: h?.label ?? "", description: r?.description || (h ? h.label : ""), picking: false });
  };
  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr><th className="table-th">Credited to (account)</th><th className="table-th">Particulars</th><th className="table-th text-right">Amount</th>{canEdit && <th className="table-th" />}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="table-td">
                  <input type="hidden" name="lineAccountId" value={r.glAccountId} />
                  {canEdit && r.picking ? (
                    <SearchSelect entity="gl-accounts" placeholder="Type account code or name…" onSelect={(h) => pick(r.key, h)} />
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className={`text-sm ${r.glAccountId ? "" : "text-red-600"}`}>{r.glAccountId ? `${r.accountCode} ${r.accountName}`.trim() : "no account yet"}</span>
                      {canEdit && <button type="button" className="text-xs text-emerald-700 hover:underline" onClick={() => patch(r.key, { picking: true })}>change</button>}
                    </div>
                  )}
                </td>
                <td className="table-td">
                  {canEdit ? <input name="lineDescription" value={r.description} onChange={(e) => patch(r.key, { description: e.target.value })} placeholder="e.g. Return of loan — cheque 209969" className="input w-full py-1" /> : <><span className="text-sm">{r.description}</span><input type="hidden" name="lineDescription" value={r.description} /></>}
                </td>
                <td className="table-td text-right">
                  {canEdit ? <input name="lineAmount" type="number" min={0.01} step="0.01" value={r.amount || ""} onChange={(e) => patch(r.key, { amount: Number(e.target.value) || 0 })} placeholder="0.00" className="input w-40 py-1 text-right" /> : <><span className="font-semibold">{peso(r.amount)}</span><input type="hidden" name="lineAmount" value={r.amount} /></>}
                </td>
                {canEdit && <td className="table-td"><button type="button" onClick={() => remove(r.key)} className="text-xs text-red-600 hover:underline">✕</button></td>}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="p-4 text-center text-sm text-gray-500">No lines.</td></tr>}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
            <tr><td className="table-td" colSpan={2}>AMOUNT RECEIVED</td><td className="table-td text-right text-lg">{peso(total)}</td>{canEdit && <td />}</tr>
          </tfoot>
        </table>
      </div>
      {canEdit && <button type="button" className="btn-secondary mt-2" onClick={add}>+ Add line</button>}
    </div>
  );
}
