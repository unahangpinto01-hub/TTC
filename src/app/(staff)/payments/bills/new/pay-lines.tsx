"use client";

import { useState } from "react";

export type PayRow = { billId: string; billNo: string; dated: string; due: string; supplierInvoiceNo: string | null; outstanding: number; authorised: number | null; max: number; suggested: number };
const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** How much of each bill this payment settles, totalled as typed. */
export function PayLines({ rows, direct = null }: { rows: PayRow[]; direct?: { label: string; max: number } | null }) {
  const [pay, setPay] = useState<Record<string, number>>(Object.fromEntries(rows.map((r) => [r.billId, r.suggested])));
  const [payDirect, setPayDirect] = useState<number>(direct?.max ?? 0);
  const total = rows.reduce((s, r) => s + (pay[r.billId] || 0), 0) + (direct ? payDirect : 0);
  const hasAuth = rows.some((r) => r.authorised != null) || !!direct;
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full min-w-[720px]">
        <thead className="border-b border-gray-200 bg-gray-50">
          <tr><th className="table-th">Bill</th><th className="table-th">Dated / Due</th><th className="table-th">Supplier Invoice</th><th className="table-th text-right">Outstanding</th>{hasAuth && <th className="table-th text-right">Authorised (left)</th>}<th className="table-th text-right">Pay now</th></tr>
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
                {hasAuth && <td className="table-td text-right text-sm">{r.authorised == null ? "—" : peso(r.authorised)}</td>}
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
          {direct && (
            <tr className={payDirect > 0 ? "bg-emerald-50/40" : ""}>
              <td className="table-td" colSpan={3}><span className="text-sm font-semibold">{direct.label}</span><span className="block text-[10px] text-gray-500">booked when the voucher was posted: Dr its items&rsquo; accounts / Cr Accounts Payable</span></td>
              <td className="table-td text-right text-sm">{peso(direct.max)}</td>
              <td className="table-td text-right text-sm">{peso(direct.max)}</td>
              <td className="table-td text-right">
                <div className="flex items-center justify-end gap-1">
                  <input name="payDirect" type="number" min={0} step="0.01" value={payDirect || ""} onChange={(e) => setPayDirect(Math.max(0, Number(e.target.value) || 0))} placeholder="0.00" className={`input w-32 py-1 text-right ${payDirect > direct.max + 0.005 ? "border-red-400 bg-red-50" : ""}`} />
                  <button type="button" className="text-[10px] text-emerald-700 hover:underline" onClick={() => setPayDirect(direct.max)}>all</button>
                </div>
                {payDirect > direct.max + 0.005 && <p className="text-[10px] font-semibold text-red-600">more than authorised</p>}
              </td>
            </tr>
          )}
          {!rows.length && !direct && <tr><td colSpan={6} className="p-6 text-center text-sm text-gray-500">Nothing left to pay here.</td></tr>}
        </tbody>
        <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold"><tr><td className="table-td" colSpan={hasAuth ? 5 : 4}>TOTAL PAYMENT</td><td className="table-td text-right text-lg">{peso(total)}</td></tr></tfoot>
      </table>
    </div>
  );
}
