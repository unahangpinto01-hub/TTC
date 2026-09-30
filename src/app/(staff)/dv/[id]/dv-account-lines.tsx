"use client";

import { useEffect, useRef, useState } from "react";
import { SearchSelect, type SearchHit } from "@/components/search-select";
import { generateAccountLines, type DvForLines } from "@/lib/dv-lines";

export type AccountLineRow = { id: string; glAccountId: string; title: string; debit: number; credit: number };
type Row = AccountLineRow & { key: number; picking: boolean };

/** What the page knows about the bills on offer and the voucher, so the block can be drawn as the form is typed. */
export type LiveLinesContext = {
  bills: Record<string, { billNo: string; kind: string; total: number; inputVat: number; supplierName: string; expenseLines: { glAccountId: string; code: string; description: string; amount: number }[] }>;
  payee: string;
  company: DvForLines["company"];
  payments: NonNullable<DvForLines["payments"]>;
};

const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The Account Title / Debit (Credit) block. While the office has not touched it, it FOLLOWS the
 * form: allocate a bill or type an item and the matching lines appear at once — the bill's
 * own expense accounts and VAT, or Accounts Payable for an inventory bill, the deduction and
 * payable lines for items, the bank of any cheque already issued. Edit a line, add one or
 * remove one and the block becomes the office's own: it stops following and is saved exactly
 * as shown. "Follow the bills and items again" hands it back.
 */
export function DvAccountLines({ lines, canEdit, formId, customised: initialCustomised, ctx }: { lines: AccountLineRow[]; canEdit: boolean; formId: string; customised: boolean; ctx: LiveLinesContext }) {
  const [rows, setRows] = useState<Row[]>(lines.map((l, i) => ({ ...l, key: i, picking: false })));
  const [customised, setCustomised] = useState(initialCustomised);
  const customisedRef = useRef(initialCustomised);
  customisedRef.current = customised;
  const nextKey = useRef(lines.length);

  // derive the block from the form whenever it changes, until the office takes it over
  useEffect(() => {
    if (!canEdit) return;
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const derive = () => {
      if (customisedRef.current) return;
      const bills: DvForLines["bills"] = [];
      form.querySelectorAll<HTMLInputElement>("input[name=billId]").forEach((inp) => {
        const tr = inp.closest("tr");
        const amount = Number(tr?.querySelector<HTMLInputElement>("input[name=alloc]")?.value) || 0;
        const meta = ctx.bills[inp.value];
        if (amount > 0 && meta) bills.push({ amount, bill: { billNo: meta.billNo, kind: meta.kind, total: meta.total, inputVat: meta.inputVat, supplier: { name: meta.supplierName }, expenseLines: meta.expenseLines.map((l) => ({ amount: l.amount, glAccountId: l.glAccountId, glAccount: { code: l.code, description: l.description } })) } });
      });
      const items: NonNullable<DvForLines["items"]> = [];
      form.querySelectorAll<HTMLInputElement>("input[name=itemAmount]").forEach((inp) => {
        const tr = inp.closest("tr");
        const get = (n: string) => tr?.querySelector<HTMLInputElement>(`input[name=${n}]`)?.value ?? "";
        const amount = Number(inp.value) || 0;
        const glAccountId = get("itemAccountId") || null;
        if (amount === 0 && !glAccountId) return;
        items.push({ amount, description: get("itemDescription"), glAccountId, glAccount: glAccountId ? { code: get("itemAccountCode"), description: get("itemAccountName") } : null });
      });
      const payee = (form.querySelector<HTMLInputElement>("input[name=payee]")?.value || ctx.payee).trim();
      const gen = generateAccountLines({ bills, items, payee, company: ctx.company, payments: ctx.payments });
      setRows((prev) => {
        const same = prev.length === gen.length && prev.every((r, i) => r.title === gen[i].title && r.debit === gen[i].debit && r.credit === gen[i].credit && r.glAccountId === (gen[i].glAccountId ?? ""));
        if (same) return prev;
        return gen.map((l, i) => ({ id: "", glAccountId: l.glAccountId ?? "", title: l.title, debit: l.debit, credit: l.credit, key: i, picking: false }));
      });
    };
    derive();
    form.addEventListener("input", derive);
    form.addEventListener("change", derive);
    const t = setInterval(derive, 500); // search boxes fill hidden inputs without an event
    return () => { form.removeEventListener("input", derive); form.removeEventListener("change", derive); clearInterval(t); };
  }, [formId, canEdit, ctx]);

  const takeOver = () => setCustomised(true);
  const patch = (key: number, p: Partial<Row>) => { takeOver(); setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r))); };
  const remove = (key: number) => { takeOver(); setRows((rs) => rs.filter((r) => r.key !== key)); };
  const add = () => { takeOver(); setRows((rs) => [...rs, { key: nextKey.current++, id: "", glAccountId: "", title: "", debit: 0, credit: 0, picking: true }]); };
  const pick = (key: number, h: SearchHit | null) => patch(key, { glAccountId: h?.id ?? "", title: h ? `${h.data?.code ?? ""} ${h.label}`.trim() : "", picking: false });
  const follow = () => { setCustomised(false); customisedRef.current = false; };
  const dr = rows.reduce((s, r) => s + (r.debit || 0), 0);
  const cr = rows.reduce((s, r) => s + (r.credit || 0), 0);
  const balanced = Math.abs(dr - cr) < 0.005;

  return (
    <div>
      <input type="hidden" name="linesCustomised" value={customised ? "1" : "0"} />
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
            {!rows.length && <tr><td colSpan={4} className="p-4 text-center text-sm text-gray-500">{canEdit ? "Allocate a bill or add an item above and its account lines appear here." : "No account lines."}</td></tr>}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 text-sm font-bold">
            <tr><td className="table-td">TOTAL {balanced ? <span className="ml-2 text-xs font-normal text-emerald-700">balanced</span> : <span className="ml-2 text-xs font-normal text-red-600">debits and credits differ by {peso(Math.abs(dr - cr))}</span>}</td><td className="table-td text-right">{peso(dr)}</td><td className="table-td text-right">({peso(cr)})</td>{canEdit && <td />}</tr>
          </tfoot>
        </table>
      </div>
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="button" className="btn-secondary" onClick={add}>+ Add account line</button>
          {customised ? (
            <span className="text-xs text-amber-700">Edited by hand — saved exactly as shown. <button type="button" className="font-semibold underline" onClick={follow}>Follow the bills and items again</button></span>
          ) : (
            <span className="text-xs text-gray-500">Follows the bills and items as you type. Edit any line to take it over.</span>
          )}
        </div>
      )}
    </div>
  );
}
