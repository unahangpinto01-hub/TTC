"use client";

import { useState } from "react";

const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type OutstandingRow = {
  id: string;
  srNumber: string;
  invoiceDate: string; // pre-formatted
  dueDate: string;
  amount: number;
  previousPayments: number;
  creditApplied: number;
  outstanding: number;
};

/** The application grid: outstanding invoices with an Amount-to-Apply box each, plus a
    live running total of Applied / Unapplied against the payment amount typed above. */
export function EntryTable({
  invoices,
  initialAmounts,
  initialPayment,
}: {
  invoices: OutstandingRow[];
  /** prefill when editing a draft: invoice id -> amount already applied */
  initialAmounts?: Record<string, number>;
  initialPayment?: number;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initialAmounts ?? {}).map(([k, v]) => [k, v.toFixed(2)]))
  );
  const [paymentAmount, setPaymentAmount] = useState(initialPayment ? initialPayment.toFixed(2) : "");

  const appliedOf = (id: string) => Math.max(0, Number(amounts[id]) || 0);
  const applied = invoices.reduce((s, i) => s + appliedOf(i.id), 0);
  const payment = Number(paymentAmount) || 0;
  const unapplied = payment - applied;
  const over = invoices.find((i) => appliedOf(i.id) > i.outstanding + 0.005);

  const fillFrom = () => {
    // spread the payment over the oldest invoices first
    let left = payment;
    const next: Record<string, string> = {};
    for (const i of invoices) {
      const take = Math.min(left, i.outstanding);
      if (take > 0.005) next[i.id] = take.toFixed(2);
      left -= take;
      if (left <= 0.005) break;
    }
    setAmounts(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Payment Amount (₱)</label>
          <input
            name="amount"
            type="number"
            min={0}
            step="0.01"
            required
            value={paymentAmount}
            onChange={(e) => setPaymentAmount(e.target.value)}
            className="input w-40 font-semibold"
          />
        </div>
        <button type="button" onClick={fillFrom} disabled={payment <= 0} className="btn-secondary">
          Auto-apply oldest first
        </button>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Invoice</th>
              <th className="table-th">Date</th>
              <th className="table-th">Due</th>
              <th className="table-th text-right">Original</th>
              <th className="table-th text-right">Prev. Payments</th>
              <th className="table-th text-right">Credit Applied</th>
              <th className="table-th text-right">Outstanding</th>
              <th className="table-th text-right">Amount to Apply</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {invoices.map((i) => {
              const a = appliedOf(i.id);
              const overThis = a > i.outstanding + 0.005;
              return (
                <tr key={i.id} className={overThis ? "bg-red-50" : a > 0 ? "bg-emerald-50/50" : ""}>
                  <td className="table-td font-mono text-xs font-semibold">{i.srNumber}</td>
                  <td className="table-td text-xs">{i.invoiceDate}</td>
                  <td className="table-td text-xs">{i.dueDate}</td>
                  <td className="table-td text-right">{peso(i.amount)}</td>
                  <td className="table-td text-right text-gray-500">{i.previousPayments ? peso(i.previousPayments) : "—"}</td>
                  <td className="table-td text-right text-gray-500">{i.creditApplied ? peso(i.creditApplied) : "—"}</td>
                  <td className="table-td text-right font-semibold">{peso(i.outstanding)}</td>
                  <td className="table-td text-right">
                    <input type="hidden" name="appInvoiceId" value={i.id} />
                    <input
                      name="appAmount"
                      type="number"
                      min={0}
                      max={i.outstanding}
                      step="0.01"
                      value={amounts[i.id] ?? ""}
                      placeholder="0.00"
                      onChange={(e) => setAmounts((prev) => ({ ...prev, [i.id]: e.target.value }))}
                      className={`input w-32 text-right ${overThis ? "border-red-400 bg-red-50" : ""}`}
                    />
                    {overThis && <p className="text-[10px] text-red-600">more than the balance</p>}
                  </td>
                </tr>
              );
            })}
            {!invoices.length && (
              <tr><td colSpan={8} className="p-6 text-center text-sm text-gray-500">No outstanding invoices — the whole payment will be held as customer credit.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-6 text-sm">
        <p>Applied: <span className="font-bold">{peso(applied)}</span></p>
        <p>
          Unapplied (customer credit):{" "}
          <span className={`font-bold ${unapplied < -0.005 ? "text-red-600" : unapplied > 0.005 ? "text-amber-700" : ""}`}>
            {peso(Math.max(0, unapplied))}
          </span>
        </p>
        {unapplied < -0.005 && <p className="font-semibold text-red-600">Applied more than the payment amount — reduce an application.</p>}
        {over && <p className="font-semibold text-red-600">An application exceeds its invoice balance.</p>}
      </div>
    </div>
  );
}
