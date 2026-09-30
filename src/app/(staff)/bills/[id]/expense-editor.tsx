"use client";

import { useState } from "react";
import { SearchSelect, type SearchHit } from "@/components/search-select";
import { computeExpenseBill, VAT_MODES } from "@/lib/bill-math";
import type { EwtTypeOption } from "./bill-editor";

/** amount = the figure as typed: VAT-inclusive under the general rule */
export type ExpenseEditorLine = { id: string; glAccountId: string; account: string; description: string; amount: number };
type Row = ExpenseEditorLine & { key: number; isNew: boolean };

const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (r: number) => `${Math.round(r * 10000) / 100}%`;

/**
 * The lines of a non-inventory bill — an account, what for, how much — totalled as typed.
 * Every row submits one of each field in order, so the action reads the arrays line by line.
 */
export function ExpenseEditor({ lines, canEdit, vatMode: vatMode0, ewtTypeId: ewt0, ewtTypes }: { lines: ExpenseEditorLine[]; canEdit: boolean; vatMode: string; ewtTypeId: string; ewtTypes: EwtTypeOption[] }) {
  const [rows, setRows] = useState<Row[]>(lines.map((l, i) => ({ ...l, key: i, isNew: false })));
  const [vatMode, setVatMode] = useState(vatMode0);
  const [ewtId, setEwtId] = useState(ewt0);
  const ewt = ewtTypes.find((t) => t.id === ewtId) ?? null;
  const math = computeExpenseBill(rows.map((r) => ({ amount: r.amount })), { vatMode, ewtRate: ewt?.rate ?? 0 });
  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  const add = () => setRows((rs) => [...rs, { key: (rs[rs.length - 1]?.key ?? -1) + 1, isNew: true, id: "", glAccountId: "", account: "", description: "", amount: 0 }]);
  const pick = (key: number, h: SearchHit | null) => patch(key, { glAccountId: h?.id ?? "", account: h ? `${h.data?.code ?? ""} ${h.label}` : "" });
  const inclusive = vatMode === "INCLUSIVE";
  const vatLabel = VAT_MODES.find(([k]) => k === vatMode)?.[1] ?? vatMode;

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[820px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Expense / Account</th>
              <th className="table-th">Description</th>
              <th className="table-th text-right">Amount{inclusive ? " (VAT-incl.)" : ""}</th>
              <th className="table-th text-right">VAT</th>
              <th className="table-th text-right">Charged to account (net)</th>
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
                <td className="table-td align-top text-right font-semibold">{peso(math.lines[i]?.amount ?? 0)}</td>
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

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-3 text-xs text-gray-500">
          <div>
            <label className="label">VAT</label>
            {canEdit ? (
              <select name="vatMode" value={vatMode} onChange={(e) => setVatMode(e.target.value)} className="input max-w-md">
                {VAT_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            ) : <p className="text-sm text-gray-700">{vatLabel}</p>}
            <p className="mt-1">{inclusive ? "The general rule: the amounts entered already include 12% VAT; each account is charged the net and the VAT is claimed as input VAT." : vatMode === "EXCLUSIVE" ? "12% VAT is added on top of the amounts entered." : "No VAT on this bill — an exempt or non-VAT supplier."}</p>
          </div>
          <div>
            <label className="label">Expanded withholding tax (EWT)</label>
            {canEdit ? (
              <select name="ewtTypeId" value={ewtId} onChange={(e) => setEwtId(e.target.value)} className="input max-w-md">
                <option value="">None — nothing withheld</option>
                {ewtTypes.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name} · {pct(t.rate)}</option>)}
              </select>
            ) : <p className="text-sm text-gray-700">{ewt ? `${ewt.code} · ${ewt.name} · ${pct(ewt.rate)}` : "None"}</p>}
            <p className="mt-1">Withheld on the VAT-exclusive amount and remitted to the BIR; the supplier is paid the rest.</p>
          </div>
        </div>
        <table className="w-full max-w-md justify-self-end text-sm">
          <tbody className="divide-y divide-gray-100">
            <tr><td className="py-1.5">Charged to accounts (net of VAT)</td><td className="py-1.5 text-right font-semibold">{peso(math.subtotal)}</td></tr>
            <tr><td className="py-1.5">Input VAT {vatMode === "NONE" ? "(none)" : "12%"}</td><td className={`py-1.5 text-right ${math.inputVat ? "" : "text-gray-300"}`}>{math.inputVat ? peso(math.inputVat) : "—"}</td></tr>
            <tr className="border-t border-gray-300"><td className="py-1.5 font-semibold">Invoice total{inclusive ? " (as it reads)" : ""}</td><td className="py-1.5 text-right font-semibold">{peso(math.grossTotal)}</td></tr>
            <tr><td className="py-1.5">Less: EWT {ewt ? `${pct(ewt.rate)} of ${peso(math.ewtBase)}` : "(none)"}</td><td className={`py-1.5 text-right ${math.ewtAmount ? "text-red-700" : "text-gray-300"}`}>{math.ewtAmount ? `(${peso(math.ewtAmount)})` : "—"}</td></tr>
            <tr className="border-t-2 border-gray-400"><td className="py-2 font-bold">NET PAYABLE TO SUPPLIER</td><td className="py-2 text-right text-lg font-bold">{peso(math.total)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
