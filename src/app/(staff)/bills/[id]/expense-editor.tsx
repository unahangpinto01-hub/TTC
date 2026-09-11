"use client";

import { useState } from "react";
import { SearchSelect, type SearchHit } from "@/components/search-select";
import { computeExpenseBill } from "@/lib/bill-math";

export type ExpenseEditorLine = { id: string; glAccountId: string; account: string; description: string; amount: number };
type Row = ExpenseEditorLine & { key: number; isNew: boolean };

const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The lines of a non-inventory bill — an account, what for, how much — totalled as typed.
 * Every row submits one of each field in order, so the action reads the arrays line by line.
 */
export function ExpenseEditor({ lines, canEdit, applyVat: vat0 }: { lines: ExpenseEditorLine[]; canEdit: boolean; applyVat: boolean }) {
  const [rows, setRows] = useState<Row[]>(lines.map((l, i) => ({ ...l, key: i, isNew: false })));
  const [vat, setVat] = useState(vat0);
  const math = computeExpenseBill(rows.map((r) => ({ amount: r.amount })), vat ? 0.12 : 0);
  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  const add = () => setRows((rs) => [...rs, { key: (rs[rs.length - 1]?.key ?? -1) + 1, isNew: true, id: "", glAccountId: "", account: "", description: "", amount: 0 }]);
  const pick = (key: number, h: SearchHit | null) => patch(key, { glAccountId: h?.id ?? "", account: h ? `${h.data?.code ?? ""} ${h.label}` : "" });

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[820px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Expense / Account</th>
              <th className="table-th">Description</th>
              <th className="table-th text-right">Amount</th>
              <th className="table-th text-right">Tax</th>
              <th className="table-th text-right">Total</th>
              {canEdit && <th className="table-th" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td className="table-td align-top">
                  <input type="hidden" name="lineId" value={r.id} />
                  {canEdit && r.isNew ? (
                    <SearchSelect entity="gl-accounts" name="glAccountId" placeholder="Type account code or name…" onSelect={(h) => pick(r.key, h)} />
                  ) : (
                    <>
                      {canEdit && <input type="hidden" name="glAccountId" value={r.glAccountId} />}
                      <p className="text-sm font-medium">{r.account}</p>
                    </>
                  )}
                </td>
                <td className="table-td align-top">
                  {canEdit ? (
                    <input name="description" value={r.description} onChange={(e) => patch(r.key, { description: e.target.value })} placeholder="what this is for" className="input w-full py-1" />
                  ) : (
                    <span className="text-sm">{r.description}</span>
                  )}
                </td>
                <td className="table-td align-top text-right">
                  {canEdit ? (
                    <input name="amount" type="number" min={0} step="0.01" value={r.amount || ""} onChange={(e) => patch(r.key, { amount: Math.max(0, Number(e.target.value) || 0) })} placeholder="0.00" className="input w-32 py-1 text-right" />
                  ) : (
                    <span className="font-semibold">{peso(r.amount)}</span>
                  )}
                </td>
                <td className={`table-td align-top text-right text-sm ${math.lines[i]?.taxAmount ? "" : "text-gray-300"}`}>{math.lines[i]?.taxAmount ? peso(math.lines[i].taxAmount) : "—"}</td>
                <td className="table-td align-top text-right font-semibold">{peso(r.amount + (math.lines[i]?.taxAmount ?? 0))}</td>
                {canEdit && (
                  <td className="table-td align-top">
                    <button type="button" onClick={() => remove(r.key)} className="text-xs text-red-600 hover:underline" title="Remove line">✕</button>
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="p-6 text-center text-sm text-gray-500">No lines yet. Add what the supplier is charging for.</td></tr>}
          </tbody>
        </table>
      </div>
      {canEdit && <button type="button" className="btn-secondary mt-2" onClick={add}>+ Add line</button>}

      <div className="mt-4 flex justify-end">
        <table className="w-full max-w-sm text-sm">
          <tbody className="divide-y divide-gray-100">
            <tr><td className="py-1.5">Subtotal (ex-VAT)</td><td className="py-1.5 text-right font-semibold">{peso(math.subtotal)}</td></tr>
            <tr>
              <td className="py-1.5">
                {canEdit ? (
                  <label className="flex items-center gap-2"><input type="checkbox" name="applyVat" checked={vat} onChange={(e) => setVat(e.target.checked)} /> Input VAT 12%</label>
                ) : (
                  `Input VAT${vat ? " 12%" : " (none)"}`
                )}
              </td>
              <td className={`py-1.5 text-right ${math.inputVat ? "" : "text-gray-300"}`}>{math.inputVat ? peso(math.inputVat) : "—"}</td>
            </tr>
            <tr className="border-t-2 border-gray-400"><td className="py-2 font-bold">TOTAL PAYABLE</td><td className="py-2 text-right text-lg font-bold">{peso(math.total)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
