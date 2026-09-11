"use client";

import { useState } from "react";

export type PayRow = { billId: string; billNo: string; dated: string; due: string; supplierInvoiceNo: string | null; outstanding: number; authorised: number | null; max: number; suggested: number };
const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** How much of each bill this payment settles, totalled as typed. */
export function PayLines({ rows }: { rows: PayRow[] }) {
  const [pay, setPay] = useState<Record<string, number>>(Object.fromEntries(rows.map((r) => [r.billId, r.suggested])));
  const total = rows.reduce((s, r) => s + (pay[r.billId] || 0), 0);
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full min-w-[720px]">
        <thead className="border-b border-gray-200 bg-gray-50">
          <tr><th className="table-th">Bill</th><th className="table-th">Dated / Due</th><th className="table-th">Supplier Invoice</th><th className="table-th text-right">Outstanding</th>{rows.some((r) => r.authorised != null) && <th className="table-th text-right">Authorised (left)</th>}<th className="table-th text-right">Pay now</th></tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => {
            const v = pay[r.billId] || 0;
            const over = v > r.max + 0.005;
            return (
              <tr key={r.billId} className={v > 0 ? "bg-emerald-50/40" : ""}>
                <td className="table-td"><input type="hidden" name="billId" value={r.billId} /><span className="font-mono text-xs font-semibold">{r.billNo}</span></td>
                <td className="table-td text-xs text-gray-600">{r.dated}<span className="block">due {r.due}</span></td>
                <td className="table-td text-xs text-gray-600">{r.supplierInvoiceNo ?? "—"}</td>
                <td className="table-td text-right text-sm">{peso(r.outstanding)}</td>
                {rows.some((x) => x.authorised != null) && <td className="table-td text-right text-sm">{r.authorised == null ? "—" : peso(r.authorised)}</td>}
                <td className="table-td text-right">
                  <div className="flex items-center justify-end gap-1">
                    <input name="pay" type="number" min={0} step="0.01" value={v || ""} onChange={(e) => setPay((p) => ({ ...p, [r.billId]: Math.max(0, Number(e.target.value) || 0) }))} placeholder="0.00" className={`input w-32 py-1 text-right ${over ? "border-red-400 bg-red-50" : ""}`} />
                    <button type="button" className="text-[10px] text-emerald-700 hover:underline" onClick={() => setPay((p) => ({ ...p, [r.billId]: r.max }))}>all</button>
                  </div>
                  {over && <p className="text-[10px] font-semibold text-red-600">more than can be paid</p>}
                </td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={6} className="p-6 text-center text-sm text-gray-500">Nothing left to pay here.</td></tr>}
        </tbody>
        <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold"><tr><td className="table-td" colSpan={rows.some((r) => r.authorised != null) ? 5 : 4}>TOTAL PAYMENT</td><td className="table-td text-right text-lg">{peso(total)}</td></tr></tfoot>
      </table>
    </div>
  );
}
