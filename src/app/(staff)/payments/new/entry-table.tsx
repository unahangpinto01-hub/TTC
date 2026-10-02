"use client";

import { useEffect, useRef, useState } from "react";

const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;
/** the PPD a payment earns at a rate — the same rule as the server (see lib/receive-payments ppdFor) */
const ppdFor = (payment: number, rate: number) => (payment <= 0 || rate <= 0 || rate >= 1 ? 0 : round2((payment * rate) / (1 - rate)));

export type OutstandingRow = {
  id: string;
  srNumber: string;
  kind: string;
  invoiceDate: string; // pre-formatted
  dueDate: string;
  amount: number;
  outstanding: number;
  /** yyyy-mm-dd of the last day PPD may be granted by rule; null = no window (manual PPD) */
  ppdDeadline: string | null;
};

export type InitialApp = { amount: number; ppdRatePct: number; ppd: number; other: number; reasonId: string; remarks: string; override: string };
export type ReasonOption = { id: string; name: string; requiresRemarks: boolean };

type RowState = { amount: string; rate: string; ppd: string; ppdManual: boolean; other: string; reasonId: string; remarks: string; override: string };

const blank = (): RowState => ({ amount: "", rate: "", ppd: "", ppdManual: false, other: "", reasonId: "", remarks: "", override: "" });
const num = (s: string) => Math.max(0, Number(s) || 0);

/**
 * The application grid: every outstanding invoice with Payment, PPD and Other Discount boxes,
 * the total each settles and what remains, plus the payment summary. PPD and Other Discount
 * are kept apart all the way down — management wants to see the cost of each.
 */
export function EntryTable({
  invoices,
  initial,
  initialPayment,
  canDiscount,
  canOverride,
  reasons,
  ppdDefaultRatePct,
  ppdMaxRatePct,
  ppdHasWindow,
}: {
  invoices: OutstandingRow[];
  /** prefill when editing a draft: invoice id -> what was applied */
  initial?: Record<string, InitialApp>;
  initialPayment?: number;
  canDiscount: boolean;
  canOverride: boolean;
  reasons: ReasonOption[];
  ppdDefaultRatePct: number;
  ppdMaxRatePct: number;
  ppdHasWindow: boolean;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      Object.entries(initial ?? {}).map(([k, v]) => [k, {
        amount: v.amount ? v.amount.toFixed(2) : "", rate: v.ppdRatePct ? String(v.ppdRatePct) : "", ppd: v.ppd ? v.ppd.toFixed(2) : "",
        ppdManual: v.ppd > 0 && !v.ppdRatePct, other: v.other ? v.other.toFixed(2) : "", reasonId: v.reasonId, remarks: v.remarks, override: v.override,
      }])
    )
  );
  const [paymentAmount, setPaymentAmount] = useState(initialPayment ? initialPayment.toFixed(2) : "");
  const [paymentDate, setPaymentDate] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // the payment date lives in the header above; PPD eligibility follows it as it is changed
  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) return;
    const read = () => setPaymentDate((form.elements.namedItem("date") as HTMLInputElement | null)?.value ?? "");
    read();
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    return () => { form.removeEventListener("input", read); form.removeEventListener("change", read); };
  }, []);

  const row = (id: string) => rows[id] ?? blank();
  const set = (id: string, patch: Partial<RowState>) => setRows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? blank()), ...patch } }));
  const setAmount = (id: string, amount: string) => {
    const r = row(id);
    const patch: Partial<RowState> = { amount };
    if (!r.ppdManual && num(r.rate) > 0) patch.ppd = ppdFor(num(amount), num(r.rate) / 100).toFixed(2);
    set(id, patch);
  };
  const setRate = (id: string, rate: string) => set(id, { rate, ppdManual: false, ppd: num(rate) > 0 ? ppdFor(num(row(id).amount), num(rate) / 100).toFixed(2) : "" });
  const setPpd = (id: string, ppd: string) => set(id, { ppd, ppdManual: true });

  const eligible = (i: OutstandingRow) => i.kind !== "OPENING" && (!i.ppdDeadline || !paymentDate || paymentDate <= i.ppdDeadline);
  const calc = (i: OutstandingRow) => {
    const r = row(i.id);
    const payment = num(r.amount), ppd = num(r.ppd), other = num(r.other);
    const total = round2(payment + ppd + other);
    const remaining = round2(i.outstanding - total);
    const reason = reasons.find((x) => x.id === r.reasonId);
    const problems: string[] = [];
    if (total > i.outstanding + 0.005) problems.push(`Total application exceeds the invoice outstanding balance. Maximum remaining discount: ${peso(Math.max(0, round2(i.outstanding - payment)))}.`);
    if (ppd > 0 && !eligible(i) && !canOverride) problems.push(i.kind === "OPENING" ? "An opening balance earns no PPD by rule — only a user with PPD Override may grant it." : "Outside the prompt payment window — only a user with PPD Override may grant it.");
    if (ppd > 0 && !eligible(i) && canOverride && r.override.trim().length < 5) problems.push("Outside the PPD window: an override reason (at least 5 characters) is required.");
    if (ppdMaxRatePct > 0 && num(r.rate) > ppdMaxRatePct + 0.0001) problems.push(`PPD rate above the ${ppdMaxRatePct}% ceiling.`);
    if (other > 0 && !reason) problems.push("Other Discount needs a reason.");
    if (other > 0 && reason?.requiresRemarks && !r.remarks.trim()) problems.push(`Reason "${reason.name}" needs remarks / explanation.`);
    return { payment, ppd, other, total, remaining, problems };
  };

  const payment = Number(paymentAmount) || 0;
  const totals = invoices.reduce((t, i) => {
    const c = calc(i);
    if (c.total > 0) t.outstandingSelected = round2(t.outstandingSelected + i.outstanding);
    t.payment = round2(t.payment + c.payment); t.ppd = round2(t.ppd + c.ppd); t.other = round2(t.other + c.other); t.total = round2(t.total + c.total);
    t.problems += c.problems.length;
    return t;
  }, { outstandingSelected: 0, payment: 0, ppd: 0, other: 0, total: 0, problems: 0 });
  const unapplied = round2(payment - totals.payment);
  const remainingAr = round2(totals.outstandingSelected - totals.total);

  const fillFrom = () => {
    // spread the money over the oldest invoices first; discounts are the user's call
    let left = payment;
    const next: Record<string, RowState> = {};
    for (const i of invoices) {
      const take = Math.min(left, i.outstanding);
      if (take > 0.005) next[i.id] = { ...blank(), amount: take.toFixed(2) };
      left -= take;
      if (left <= 0.005) break;
    }
    setRows(next);
  };

  return (
    <div ref={rootRef} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Amount Received (₱) <span className="font-normal text-gray-400">— actual money only, never a discount</span></label>
          <input name="amount" type="number" min={0} step="0.01" required value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="input w-44 font-semibold" />
        </div>
        <button type="button" onClick={fillFrom} disabled={payment <= 0} className="btn-secondary">Auto-apply oldest first</button>
        {canDiscount && (
          <p className="pb-2 text-xs text-gray-500">
            PPD {ppdDefaultRatePct > 0 ? `defaults to ${ppdDefaultRatePct}%` : "rate is typed per invoice"}{ppdHasWindow ? " and is granted by rule only inside the window shown under each invoice" : "; the company has set no window, so every PPD is entered by hand"}{ppdMaxRatePct > 0 ? `, ceiling ${ppdMaxRatePct}%` : ""}. PPD is computed on the gross invoice amount, pro-rated to what the payment settles.
          </p>
        )}
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1180px] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Invoice</th>
              <th className="table-th">Date</th>
              <th className="table-th">Due</th>
              <th className="table-th text-right">Original</th>
              <th className="table-th text-right">Outstanding</th>
              <th className="table-th text-right">Payment Applied</th>
              <th className="table-th text-right">PPD</th>
              <th className="table-th text-right">Other Discount</th>
              <th className="table-th text-right">Total Applied</th>
              <th className="table-th text-right">Remaining</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {invoices.map((i) => {
              const r = row(i.id);
              const c = calc(i);
              const ok = eligible(i);
              const reason = reasons.find((x) => x.id === r.reasonId);
              return (
                <tr key={i.id} className={c.problems.length ? "bg-red-50" : c.total > 0 ? "bg-emerald-50/50" : ""}>
                  <td className="table-td align-top">
                    <span className="font-mono text-xs font-semibold">{i.srNumber}</span>
                    {i.kind === "OPENING" && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">opening</span>}
                    {c.problems.map((p, k) => <p key={k} className="mt-1 max-w-[220px] text-[11px] font-semibold text-red-600">{p}</p>)}
                  </td>
                  <td className="table-td align-top text-xs">{i.invoiceDate}</td>
                  <td className="table-td align-top text-xs">{i.dueDate}</td>
                  <td className="table-td align-top text-right">{peso(i.amount)}</td>
                  <td className="table-td align-top text-right font-semibold">{peso(i.outstanding)}</td>
                  <td className="table-td align-top text-right">
                    <input type="hidden" name="appInvoiceId" value={i.id} />
                    <input name="appAmount" type="number" min={0} step="0.01" value={r.amount} placeholder="0.00" onChange={(e) => setAmount(i.id, e.target.value)} className="input w-28 text-right" />
                  </td>
                  <td className="table-td align-top text-right">
                    {canDiscount ? (
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-1">
                          <input name="appPpdRate" type="number" min={0} max={99} step="0.01" value={r.rate} placeholder={ppdDefaultRatePct ? String(ppdDefaultRatePct) : "%"} onChange={(e) => setRate(i.id, e.target.value)} title="PPD rate %" className="input w-16 px-1 text-right text-xs" />
                          <span className="text-xs text-gray-400">%</span>
                          <input name="appPpd" type="number" min={0} step="0.01" value={r.ppd} placeholder="0.00" onChange={(e) => setPpd(i.id, e.target.value)} className="input w-28 text-right" />
                        </div>
                        <p className={`text-[10px] ${ok ? "text-gray-400" : "text-amber-700"}`}>
                          {i.kind === "OPENING" ? "no PPD by rule" : i.ppdDeadline ? (ok ? `window to ${i.ppdDeadline}` : `window closed ${i.ppdDeadline}`) : "manual"}
                        </p>
                        {c.ppd > 0 && !ok && canOverride ? (
                          <input name="appOverride" value={r.override} onChange={(e) => set(i.id, { override: e.target.value })} placeholder="override reason (required)" className="input w-44 px-1 text-xs" />
                        ) : <input type="hidden" name="appOverride" value="" />}
                      </div>
                    ) : (
                      <>
                        <input type="hidden" name="appPpdRate" value="" /><input type="hidden" name="appPpd" value="" /><input type="hidden" name="appOverride" value="" />
                        <span className="text-xs text-gray-400">—</span>
                      </>
                    )}
                  </td>
                  <td className="table-td align-top text-right">
                    {canDiscount ? (
                      <div className="flex flex-col items-end gap-1">
                        <input name="appOther" type="number" min={0} step="0.01" value={r.other} placeholder="0.00" onChange={(e) => set(i.id, { other: e.target.value })} className="input w-28 text-right" />
                        {c.other > 0 ? (
                          <>
                            <select name="appOtherReason" value={r.reasonId} onChange={(e) => set(i.id, { reasonId: e.target.value })} className="input w-44 px-1 text-xs">
                              <option value="">— reason —</option>
                              {reasons.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                            </select>
                            <input name="appOtherRemarks" value={r.remarks} onChange={(e) => set(i.id, { remarks: e.target.value })} placeholder={reason?.requiresRemarks ? "remarks (required)" : "remarks"} className="input w-44 px-1 text-xs" />
                          </>
                        ) : (
                          <><input type="hidden" name="appOtherReason" value="" /><input type="hidden" name="appOtherRemarks" value="" /></>
                        )}
                      </div>
                    ) : (
                      <>
                        <input type="hidden" name="appOther" value="" /><input type="hidden" name="appOtherReason" value="" /><input type="hidden" name="appOtherRemarks" value="" />
                        <span className="text-xs text-gray-400">—</span>
                      </>
                    )}
                  </td>
                  <td className="table-td align-top text-right font-semibold">{c.total ? peso(c.total) : "—"}</td>
                  <td className={`table-td align-top text-right ${c.remaining < -0.005 ? "font-semibold text-red-600" : ""}`}>{peso(c.remaining)}</td>
                </tr>
              );
            })}
            {!invoices.length && (
              <tr><td colSpan={10} className="p-6 text-center text-sm text-gray-500">No outstanding invoices — the whole payment will be held as customer credit.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card max-w-md text-sm">
        <p className="mb-2 font-semibold">Payment Summary</p>
        <dl className="space-y-1">
          <Line k="Total Outstanding Selected" v={totals.outstandingSelected} />
          <Line k="Total Payment Applied" v={totals.payment} />
          <Line k="Total PPD" v={totals.ppd} />
          <Line k="Total Other Discount" v={totals.other} />
          <Line k="Total Discounts" v={round2(totals.ppd + totals.other)} />
          <Line k="Total AR Settled" v={totals.total} bold />
          <Line k="Remaining AR (on the invoices selected)" v={remainingAr} />
          <Line k="Unapplied (customer credit)" v={Math.max(0, unapplied)} warn={unapplied > 0.005} />
        </dl>
        {unapplied < -0.005 && <p className="mt-2 font-semibold text-red-600">Applied more than the amount received — reduce a payment application.</p>}
        {totals.problems > 0 && <p className="mt-2 font-semibold text-red-600">Fix the invoices marked in red before saving.</p>}
      </div>
    </div>
  );
}

function Line({ k, v, bold, warn }: { k: string; v: number; bold?: boolean; warn?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 border-b border-dotted border-gray-200 py-0.5 ${bold ? "font-bold" : ""}`}>
      <dt className="text-gray-600">{k}</dt>
      <dd className={warn ? "font-semibold text-amber-700" : ""}>{peso(v)}</dd>
    </div>
  );
}
