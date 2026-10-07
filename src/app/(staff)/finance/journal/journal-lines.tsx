"use client";

import { useState } from "react";
import { SearchSelect, type SearchHit } from "@/components/search-select";

export type JournalLineRow = { glAccountId: string; accountCode: string; accountName: string; cashAccountId: string; description: string; debit: number; credit: number };
export type CashAccountOption = { id: string; name: string; glAccountId: string | null };
type Row = JournalLineRow & { key: number; picking: boolean };

const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The lines of a journal voucher: an account, particulars, and a debit OR a credit. The
 * footer shows both totals and whether they balance. A line on an account that one of the
 * company's cash/bank accounts books to also names that cash account (filled in when only
 * one matches), so the bank balance and register carry the voucher.
 */
export function JournalLines({ lines, cashAccounts, canEdit }: { lines: JournalLineRow[]; cashAccounts: CashAccountOption[]; canEdit: boolean }) {
  const blank = (key: number): Row => ({ key, glAccountId: "", accountCode: "", accountName: "", cashAccountId: "", description: "", debit: 0, credit: 0, picking: true });
  const [rows, setRows] = useState<Row[]>(lines.length ? lines.map((l, i) => ({ ...l, key: i, picking: false })) : canEdit ? [blank(0), blank(1)] : []);
  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  const add = () => setRows((rs) => [...rs, blank((rs[rs.length - 1]?.key ?? -1) + 1)]);
  const pick = (key: number, h: SearchHit | null) => {
    const r = rows.find((x) => x.key === key);
    const matches = h ? cashAccounts.filter((c) => c.glAccountId === h.id) : [];
    patch(key, { glAccountId: h?.id ?? "", accountCode: String(h?.data?.code ?? ""), accountName: h?.label ?? "", cashAccountId: matches.length === 1 ? matches[0].id : "", description: r?.description || (h ? h.label : ""), picking: false });
  };
  const debit = round2(rows.reduce((s, r) => s + (r.debit || 0), 0));
  const credit = round2(rows.reduce((s, r) => s + (r.credit || 0), 0));
  const balanced = Math.abs(debit - credit) < 0.005 && debit > 0;

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[860px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr><th className="table-th">Account</th><th className="table-th">Particulars</th><th className="table-th text-right">Debit</th><th className="table-th text-right">Credit</th>{canEdit && <th className="table-th" />}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => {
              const matches = cashAccounts.filter((c) => c.glAccountId === r.glAccountId);
              return (
                <tr key={r.key}>
                  <td className="table-td align-top">
                    <input type="hidden" name="lineAccountId" value={r.glAccountId} />
                    {canEdit && r.picking ? (
                      <SearchSelect entity="gl-accounts" placeholder="Type account code or name…" onSelect={(h) => pick(r.key, h)} />
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className={`text-sm ${r.glAccountId ? "" : "text-red-600"}`}>{r.glAccountId ? `${r.accountCode} ${r.accountName}`.trim() : "no account yet"}</span>
                        {canEdit && <button type="button" className="text-xs text-emerald-700 hover:underline" onClick={() => patch(r.key, { picking: true })}>change</button>}
                      </div>
                    )}
                    {matches.length > 0 && (
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-gray-600">
                        <span>bank:</span>
                        {canEdit ? (
                          <select name="lineCashAccountId" value={r.cashAccountId} onChange={(e) => patch(r.key, { cashAccountId: e.target.value })} className="input w-auto px-1 py-0.5 text-[11px]">
                            {matches.length > 1 && <option value="">— pick which —</option>}
                            {matches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        ) : (
                          <><span>{matches.find((c) => c.id === r.cashAccountId)?.name ?? "—"}</span><input type="hidden" name="lineCashAccountId" value={r.cashAccountId} /></>
                        )}
                      </div>
                    )}
                    {!matches.length && <input type="hidden" name="lineCashAccountId" value="" />}
                  </td>
                  <td className="table-td align-top">
                    {canEdit ? <input name="lineDescription" value={r.description} onChange={(e) => patch(r.key, { description: e.target.value })} placeholder="e.g. Depreciation for September 2026" className="input w-full py-1" /> : <><span className="text-sm">{r.description}</span><input type="hidden" name="lineDescription" value={r.description} /></>}
                  </td>
                  <td className="table-td align-top text-right">
                    {canEdit ? <input name="lineDebit" type="number" min={0} step="0.01" value={r.debit || ""} onChange={(e) => patch(r.key, { debit: Number(e.target.value) || 0, credit: Number(e.target.value) > 0 ? 0 : r.credit })} placeholder="0.00" className="input w-36 py-1 text-right" /> : <><span className="font-semibold">{r.debit ? peso(r.debit) : ""}</span><input type="hidden" name="lineDebit" value={r.debit} /></>}
                  </td>
                  <td className="table-td align-top text-right">
                    {canEdit ? <input name="lineCredit" type="number" min={0} step="0.01" value={r.credit || ""} onChange={(e) => patch(r.key, { credit: Number(e.target.value) || 0, debit: Number(e.target.value) > 0 ? 0 : r.debit })} placeholder="0.00" className="input w-36 py-1 text-right" /> : <><span className="font-semibold">{r.credit ? peso(r.credit) : ""}</span><input type="hidden" name="lineCredit" value={r.credit} /></>}
                  </td>
                  {canEdit && <td className="table-td align-top"><button type="button" onClick={() => remove(r.key)} className="text-xs text-red-600 hover:underline">✕</button></td>}
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={5} className="p-4 text-center text-sm text-gray-500">No lines.</td></tr>}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
            <tr>
              <td className="table-td" colSpan={2}>TOTALS {rows.length > 0 && (balanced ? <span className="ml-2 text-xs font-semibold text-emerald-700">balanced</span> : <span className="ml-2 text-xs font-semibold text-red-600">out of balance by {peso(Math.abs(debit - credit))}</span>)}</td>
              <td className="table-td text-right text-lg">{peso(debit)}</td>
              <td className="table-td text-right text-lg">{peso(credit)}</td>
              {canEdit && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
      {canEdit && <button type="button" className="btn-secondary mt-2" onClick={add}>+ Add line</button>}
    </div>
  );
}
