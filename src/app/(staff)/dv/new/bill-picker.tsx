"use client";

import { useMemo, useState } from "react";
import type { EligibleBill } from "@/lib/dv-eligible";
import { defaultParticulars } from "@/lib/dv-text";

const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Search / Select Bills: the primary way a voucher starts. Tick the bills to pay; the first
 * one fixes the payee and the rest must be that supplier's. Each ticked bill carries an
 * allocation — the whole unvouchered balance unless typed otherwise — and the voucher
 * amount, payee and particulars follow. Nothing already on the bill is typed again.
 */
export function BillPicker({ rows, today, canCreate }: { rows: EligibleBill[]; today: string; canCreate: boolean }) {
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [particulars, setParticulars] = useState("");
  const [touched, setTouched] = useState(false);
  const selected = rows.filter((r) => alloc[r.id] != null);
  const supplierId = selected[0]?.supplierId ?? null;
  const payee = selected[0]?.supplierName ?? "";
  const total = selected.reduce((s, r) => s + (alloc[r.id] || 0), 0);
  const auto = useMemo(() => defaultParticulars(selected), [selected]);
  const text = touched ? particulars : auto;

  const toggle = (r: EligibleBill) => {
    setAlloc((a) => {
      const next = { ...a };
      if (next[r.id] != null) delete next[r.id];
      else next[r.id] = r.available;
      return next;
    });
  };
  const set = (id: string, v: number) => setAlloc((a) => ({ ...a, [id]: Math.max(0, v) }));
  const over = selected.filter((r) => (alloc[r.id] || 0) > r.available + 0.005);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[1100px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th w-8" />
              <th className="table-th">Type</th><th className="table-th">Bill No.</th><th className="table-th">Supplier Invoice</th><th className="table-th">Bill Date</th><th className="table-th">Due</th>
              <th className="table-th">Supplier / Payee</th><th className="table-th">Particulars</th>
              <th className="table-th text-right">Invoice Amount</th><th className="table-th text-right">Paid / Vouchered</th><th className="table-th text-right">Available for Voucher</th><th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => {
              const on = alloc[r.id] != null;
              const blocked = !!supplierId && r.supplierId !== supplierId;
              return (
                <tr key={r.id} className={on ? "bg-emerald-50/50" : blocked ? "opacity-40" : "hover:bg-gray-50"} title={blocked ? `A voucher pays one payee — this bill is ${r.supplierName}'s` : undefined}>
                  <td className="table-td"><input type="checkbox" checked={on} disabled={blocked || !canCreate} onChange={() => toggle(r)} className="h-4 w-4" aria-label={`Select ${r.billNo}`} /></td>
                  <td className="table-td text-xs">{r.kind === "EXPENSE" ? "Non-inventory" : r.kind === "OPENING" ? "Opening balance" : "Inventory"}</td>
                  <td className="table-td"><a href={`/bills/${r.id}`} target="_blank" rel="noreferrer" className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{r.billNo}</a>{r.poNumber && <span className="block font-mono text-[10px] text-gray-400">{r.poNumber}{r.grnNumber ? ` · ${r.grnNumber}` : ""}</span>}</td>
                  <td className="table-td text-xs text-gray-600">{r.supplierInvoiceNo ?? "—"}</td>
                  <td className="table-td whitespace-nowrap text-xs">{r.billDate}</td>
                  <td className="table-td whitespace-nowrap text-xs">{r.dueDate}</td>
                  <td className="table-td text-sm">{r.supplierName}</td>
                  <td className="table-td max-w-xs truncate text-xs text-gray-600">{r.particulars}</td>
                  <td className="table-td text-right text-sm">{peso(r.grossTotal)}</td>
                  <td className={`table-td text-right text-sm ${r.onOtherVouchers ? "text-amber-700" : "text-gray-300"}`}>{r.onOtherVouchers ? peso(r.onOtherVouchers) : "—"}</td>
                  <td className="table-td text-right font-semibold">{peso(r.available)}</td>
                  <td className="table-td text-xs">{r.status === "Partially Paid" ? "Partially paid" : "Available"}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={12} className="p-8 text-center text-sm text-gray-500">No eligible bill matches. A bill must be posted, unpaid, and not already fully covered by another voucher.</td></tr>}
          </tbody>
        </table>
      </div>

      {selected.length > 0 && (
        <div className="card space-y-3 border-emerald-200">
          <p className="text-sm font-semibold">Selected bills <span className="font-normal text-gray-500">— payee {payee}</span></p>
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500"><tr><th className="py-1 text-left font-medium">Bill</th><th className="py-1 text-left font-medium">Invoice</th><th className="py-1 text-right font-medium">Available</th><th className="py-1 text-right font-medium">Allocate on this voucher</th><th /></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {selected.map((r) => {
                const v = alloc[r.id] || 0;
                const bad = v > r.available + 0.005;
                return (
                  <tr key={r.id}>
                    <td className="py-1 font-mono text-xs font-semibold">{r.billNo}<input type="hidden" name="billId" value={r.id} /></td>
                    <td className="py-1 text-xs text-gray-600">{r.supplierInvoiceNo ?? "—"}</td>
                    <td className="py-1 text-right">{peso(r.available)}</td>
                    <td className="py-1 text-right">
                      <input name="alloc" type="number" min={0} step="0.01" value={v || ""} onChange={(e) => set(r.id, Number(e.target.value) || 0)} className={`input w-36 py-1 text-right ${bad ? "border-red-400 bg-red-50" : ""}`} />
                      {bad && <p className="text-[10px] font-semibold text-red-600">exceeds available {peso(r.available)}</p>}
                    </td>
                    <td className="py-1 text-right"><button type="button" onClick={() => toggle(r)} className="text-xs text-red-600 hover:underline">remove</button></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-gray-300 font-bold"><tr><td colSpan={3} className="py-1">VOUCHER AMOUNT</td><td className="py-1 text-right text-lg">{peso(total)}</td><td /></tr></tfoot>
          </table>
          <input type="hidden" name="supplierId" value={supplierId ?? ""} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-4"><label className="label">Particulars <span className="font-normal text-gray-400">(generated from the bills; edit if needed — the bill references stay on the voucher)</span></label><textarea name="particulars" rows={2} value={text} onChange={(e) => { setTouched(true); setParticulars(e.target.value); }} className="input" /></div>
            <div><label className="label">Voucher Date</label><input name="date" type="date" defaultValue={today} required className="input" /></div>
            <div><label className="label">Terms</label><input name="terms" className="input" placeholder="e.g. 30 days, COD" /></div>
            <div><label className="label">Pad DVN <span className="font-normal text-gray-400">(if stamped)</span></label><input name="padRef" className="input" placeholder="e.g. 24251" /></div>
            <div><label className="label">Memo (internal)</label><input name="memo" className="input" /></div>
          </div>
          <div className="flex items-center gap-3">
            <button className="btn-primary" type="submit" disabled={!canCreate || total <= 0 || over.length > 0}>Create Voucher (Draft)</button>
            <p className="text-xs text-gray-500">The payee, particulars, amount and account titles are filled from the bills. The allocations are reserved for this voucher the moment it is created.</p>
          </div>
        </div>
      )}
    </div>
  );
}
