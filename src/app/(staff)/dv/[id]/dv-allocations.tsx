"use client";

import { useState } from "react";

export type OpenBillRow = {
  billId: string; billNo: string; kind: string; billDate: string; dueDate: string; supplierInvoiceNo: string | null;
  total: number; outstanding: number; onOtherVouchers: number; available: number; allocated: number;
};

const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The payee's open bills with how much of each this voucher authorises — totalled as typed. */
export function DvAllocations({ rows, canEdit }: { rows: OpenBillRow[]; canEdit: boolean }) {
  const [alloc, setAlloc] = useState<Record<string, number>>(Object.fromEntries(rows.map((r) => [r.billId, r.allocated])));
  const total = rows.reduce((s, r) => s + (alloc[r.billId] || 0), 0);
  const set = (id: string, v: number) => setAlloc((a) => ({ ...a, [id]: Math.max(0, v) }));

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[820px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Bill</th>
              <th className="table-th">Dated / Due</th>
              <th className="table-th">Supplier Invoice</th>
              <th className="table-th text-right">Bill total</th>
              <th className="table-th text-right">Outstanding</th>
              <th className="table-th text-right">On other DVs</th>
              <th className="table-th text-right">Available</th>
              <th className="table-th text-right">This voucher</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => {
              const v = alloc[r.billId] || 0;
              const over = v > r.available + 0.005;
              return (
                <tr key={r.billId} className={v > 0 ? "bg-emerald-50/40" : ""}>
                  <td className="table-td">
                    <input type="hidden" name="billId" value={r.billId} />
                    <a href={`/bills/${r.billId}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{r.billNo}</a>
                    <span className="block text-[10px] text-gray-500">{r.kind === "EXPENSE" ? "non-inventory" : "inventory"}</span>
                  </td>
                  <td className="table-td text-xs text-gray-600">{r.billDate}<span className="block">due {r.dueDate}</span></td>
                  <td className="table-td text-xs text-gray-600">{r.supplierInvoiceNo ?? "—"}</td>
                  <td className="table-td text-right text-sm">{peso(r.total)}</td>
                  <td className="table-td text-right text-sm">{peso(r.outstanding)}</td>
                  <td className={`table-td text-right text-sm ${r.onOtherVouchers ? "text-amber-700" : "text-gray-300"}`}>{r.onOtherVouchers ? peso(r.onOtherVouchers) : "—"}</td>
                  <td className="table-td text-right text-sm font-semibold">{peso(r.available)}</td>
                  <td className="table-td text-right">
                    {canEdit ? (
                      <div className="flex items-center justify-end gap-1">
                        <input name="alloc" type="number" min={0} step="0.01" value={v || ""} onChange={(e) => set(r.billId, Number(e.target.value) || 0)} placeholder="0.00" className={`input w-32 py-1 text-right ${over ? "border-red-400 bg-red-50" : ""}`} />
                        <button type="button" className="text-[10px] text-emerald-700 hover:underline" onClick={() => set(r.billId, r.available)} title="Authorise the whole available balance">all</button>
                      </div>
                    ) : (
                      <>
                        <input type="hidden" name="alloc" value={v} />
                        <span className={`font-semibold ${v ? "" : "text-gray-300"}`}>{v ? peso(v) : "—"}</span>
                      </>
                    )}
                    {over && <p className="text-[10px] font-semibold text-red-600">exceeds available</p>}
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={8} className="p-6 text-center text-sm text-gray-500">This payee has no posted, unpaid bill to authorise.</td></tr>}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
            <tr><td className="table-td" colSpan={7}>AMOUNT AUTHORISED</td><td className="table-td text-right text-lg">{peso(total)}</td></tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
