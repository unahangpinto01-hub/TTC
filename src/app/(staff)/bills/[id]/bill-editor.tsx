"use client";

import { useState } from "react";
import { SearchSelect, type SearchHit } from "@/components/search-select";
import { computeBill, ALLOCATION_BASES, VAT_MODES, round2 } from "@/lib/bill-math";

export type EditorLine = {
  id: string;
  productId: string;
  name: string;
  sku: string;
  packSize: string;
  ppc: number | null;
  qty: number;
  unit: string;
  unitCost: number;
  discount: number;
  batchNo: string;
  expDate: string;
  /** batches previously received for this product — offered as suggestions */
  batches: string[];
  /** receipt-backed lines: what the receipt accepted and what earlier bills left to bill, in this line's unit */
  received?: number | null;
  remaining?: number | null;
};
export type EwtTypeOption = { id: string; code: string; name: string; rate: number; appliesTo: string };

type Row = EditorLine & { key: number; isNew: boolean };

const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (r: number) => `${Math.round(r * 10000) / 100}%`;

/**
 * The line table of a supplier bill, totalled as it is typed with the same arithmetic the
 * server posts. Every row submits one of each field, in order, so the action can read the
 * arrays back line by line — which is why a select is never disabled and a removed row is
 * gone from the DOM rather than hidden.
 */
export function BillEditor({
  lines,
  locked,
  canEdit,
  companyId,
  freight: freight0,
  otherCosts: other0,
  allocationBasis: basis0,
  vatMode: vatMode0,
  ewtTypeId: ewt0,
  ewtTypes,
}: {
  lines: EditorLine[];
  /** raised from a receipt: lines stay tied to the receipt's lines; the quantity is the invoice's own */
  locked: boolean;
  canEdit: boolean;
  companyId: string;
  freight: number;
  otherCosts: number;
  allocationBasis: string;
  vatMode: string;
  ewtTypeId: string;
  ewtTypes: EwtTypeOption[];
}) {
  const [rows, setRows] = useState<Row[]>(lines.map((l, i) => ({ ...l, key: i, isNew: false })));
  const [freight, setFreight] = useState(freight0);
  const [other, setOther] = useState(other0);
  const [basis, setBasis] = useState(basis0);
  const [vatMode, setVatMode] = useState(vatMode0);
  const [ewtId, setEwtId] = useState(ewt0);
  const ewt = ewtTypes.find((t) => t.id === ewtId) ?? null;

  const baseQtyOf = (r: Row) => (r.unit === "CARTON" && r.ppc ? r.qty * r.ppc : r.qty);
  const math = computeBill(
    rows.map((r) => ({ qty: r.qty, baseQty: baseQtyOf(r), unitCost: r.unitCost, discount: r.discount })),
    { freight, otherCosts: other, allocationBasis: basis, vatMode, ewtRate: ewt?.rate ?? 0 }
  );
  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  const add = () =>
    setRows((rs) => [
      ...rs,
      { key: (rs[rs.length - 1]?.key ?? -1) + 1, isNew: true, id: "", productId: "", name: "", sku: "", packSize: "", ppc: null, qty: 0, unit: "PCS", unitCost: 0, discount: 0, batchNo: "", expDate: "", batches: [] },
    ]);
  const pick = (key: number, h: SearchHit | null) => {
    if (!h) return patch(key, { productId: "", name: "", sku: "", packSize: "", ppc: null, unit: "PCS", unitCost: 0 });
    const d = h.data ?? {};
    const ppc = d.piecesPerCarton == null ? null : Number(d.piecesPerCarton);
    const cost = Number(d.unitCost ?? 0);
    patch(key, {
      productId: h.id, name: h.label, sku: String(d.sku ?? ""), packSize: String(d.packSize ?? ""), ppc,
      unit: ppc ? "CARTON" : "PCS", unitCost: ppc ? round2(cost * ppc) : cost,
    });
  };
  const editable = canEdit;
  const cell = "table-td align-top";
  const inp = "input w-full py-1 text-right";
  const inclusive = vatMode === "INCLUSIVE";
  const vatLabel = VAT_MODES.find(([k]) => k === vatMode)?.[1] ?? vatMode;

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[1180px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Product</th>
              <th className="table-th">Batch No.</th>
              <th className="table-th text-right">Qty</th>
              <th className="table-th">Unit</th>
              <th className="table-th text-right">Unit Cost{inclusive ? " (VAT-incl.)" : ""}</th>
              <th className="table-th text-right">Discount</th>
              <th className="table-th text-right">Freight / Other</th>
              <th className="table-th text-right">VAT</th>
              <th className="table-th text-right">Amount (net)</th>
              <th className="table-th text-right">Inventory Cost</th>
              {editable && <th className="table-th" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r, i) => {
              const m = math.lines[i];
              const base = baseQtyOf(r);
              const listId = `batches-${r.key}`;
              return (
                <tr key={r.key}>
                  <td className={cell}>
                    <input type="hidden" name="lineId" value={r.id} />
                    {r.isNew ? (
                      <SearchSelect entity="products" name="productId" params={{ company: companyId, active: "1" }} placeholder="Type product name or SKU…" onSelect={(h) => pick(r.key, h)} />
                    ) : (
                      <>
                        <input type="hidden" name="productId" value={r.productId} />
                        <p className="font-medium">{r.name}</p>
                        <p className="text-xs text-gray-500">{r.sku} · {r.packSize}</p>
                      </>
                    )}
                    {r.productId && (
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        {base.toLocaleString()} PCS{r.ppc ? ` · 1 CTN = ${r.ppc} PCS` : " · no carton conversion"}
                        {base > 0 && <> · {peso(m.inventoryCost / base)} / PC into stock</>}
                      </p>
                    )}
                  </td>
                  <td className={cell}>
                    {editable ? (
                      <>
                        <input name="batch" list={r.batches.length ? listId : undefined} value={r.batchNo} onChange={(e) => patch(r.key, { batchNo: e.target.value })} placeholder="batch" className="input w-28 py-1 font-mono text-xs" />
                        {r.batches.length > 0 && <datalist id={listId}>{r.batches.map((b) => <option key={b} value={b} />)}</datalist>}
                        <input name="exp" type="date" value={r.expDate} onChange={(e) => patch(r.key, { expDate: e.target.value })} className="input mt-1 w-36 py-1 text-xs" title="Expiry" />
                      </>
                    ) : (
                      <span className="font-mono text-xs">{r.batchNo || "—"}{r.expDate && <span className="block text-gray-400">exp {r.expDate}</span>}</span>
                    )}
                  </td>
                  <td className={cell}>
                    {editable ? (
                      <>
                        <input name="qty" type="number" min={0} value={r.qty || ""} onChange={(e) => patch(r.key, { qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className={`${inp} w-20 ${r.remaining != null && r.qty > r.remaining ? "border-red-400 bg-red-50" : ""}`} />
                        {r.remaining != null && (
                          <p className={`mt-0.5 whitespace-nowrap text-[10px] ${r.qty > r.remaining ? "font-semibold text-red-600" : r.qty < r.remaining ? "text-amber-700" : "text-gray-400"}`}>
                            {r.qty > r.remaining ? `⚠ over by ${(r.qty - r.remaining).toLocaleString()}` : r.qty < r.remaining ? `${(r.remaining - r.qty).toLocaleString()} left unbilled` : "matches receipt"}
                            <span className="block text-gray-400">received {r.received?.toLocaleString()} · to bill {r.remaining.toLocaleString()}</span>
                          </p>
                        )}
                      </>
                    ) : (
                      <span className="font-semibold">{r.qty.toLocaleString()}</span>
                    )}
                  </td>
                  <td className={cell}>
                    {editable && !locked ? (
                      <select name="unit" value={r.unit} onChange={(e) => patch(r.key, { unit: e.target.value })} className="input w-24 py-1">
                        <option value="PCS">PCS</option>
                        {r.ppc ? <option value="CARTON">CARTON</option> : null}
                      </select>
                    ) : (
                      <>
                        {editable && <input type="hidden" name="unit" value={r.unit} />}
                        <span className="text-sm">{r.unit === "CARTON" ? "CTN" : "PCS"}</span>
                      </>
                    )}
                  </td>
                  <td className={cell}>
                    {editable ? (
                      <input name="cost" type="number" min={0} step="0.01" value={r.unitCost || ""} onChange={(e) => patch(r.key, { unitCost: Math.max(0, Number(e.target.value) || 0) })} className={`${inp} w-28`} />
                    ) : (
                      <span>{peso(r.unitCost)}</span>
                    )}
                  </td>
                  <td className={cell}>
                    {editable ? (
                      <input name="disc" type="number" min={0} step="0.01" value={r.discount || ""} onChange={(e) => patch(r.key, { discount: Math.max(0, Number(e.target.value) || 0) })} placeholder="0.00" className={`${inp} w-24`} />
                    ) : (
                      <span className={r.discount ? "" : "text-gray-300"}>{r.discount ? peso(r.discount) : "—"}</span>
                    )}
                  </td>
                  <td className={`${cell} text-right text-sm ${m.freightAlloc ? "" : "text-gray-300"}`}>{m.freightAlloc ? peso(m.freightAlloc) : "—"}</td>
                  <td className={`${cell} text-right text-sm ${m.taxAmount ? "" : "text-gray-300"}`}>{m.taxAmount ? peso(m.taxAmount) : "—"}</td>
                  <td className={`${cell} text-right font-semibold`}>{peso(m.amount)}{inclusive && m.grossAmount !== m.amount && <span className="block text-[10px] font-normal text-gray-400">{peso(m.grossAmount)} incl. VAT</span>}</td>
                  <td className={`${cell} text-right font-semibold text-emerald-800`}>{peso(m.inventoryCost)}</td>
                  {editable && (
                    <td className={cell}>
                      <button type="button" onClick={() => remove(r.key)} className="text-xs text-red-600 hover:underline" title={locked ? "Not on the supplier's invoice" : "Remove line"}>✕</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={11} className="p-6 text-center text-sm text-gray-500">No lines yet. Add the inventory items on this bill.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {editable && !locked && (
        <button type="button" className="btn-secondary mt-2" onClick={add}>+ Add line</button>
      )}
      {locked && (
        <p className="mt-2 text-xs text-gray-500">
          The lines are the receipt&rsquo;s — those goods are already in stock. Enter the quantities, costs, discounts and
          batches exactly as the supplier&rsquo;s invoice shows them. A short invoice leaves the rest of the receipt to bill
          later; an invoice claiming more than was received is flagged and needs an Admin&rsquo;s approval. The receipt itself
          is never changed by a bill.
        </p>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-3 text-xs text-gray-500">
          <div>
            <label className="label">VAT</label>
            {editable ? (
              <select name="vatMode" value={vatMode} onChange={(e) => setVatMode(e.target.value)} className="input max-w-md">
                {VAT_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            ) : <p className="text-sm text-gray-700">{vatLabel}</p>}
            <p className="mt-1">{inclusive ? "The general rule: the unit costs, freight and other costs entered already include 12% VAT; the VAT is carved out of them." : vatMode === "EXCLUSIVE" ? "12% VAT is added on top of the amounts entered." : "No VAT on this bill — an exempt or non-VAT supplier."}</p>
          </div>
          <div>
            <label className="label">Expanded withholding tax (EWT)</label>
            {editable ? (
              <select name="ewtTypeId" value={ewtId} onChange={(e) => setEwtId(e.target.value)} className="input max-w-md">
                <option value="">None — nothing withheld</option>
                {ewtTypes.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name} · {pct(t.rate)}</option>)}
              </select>
            ) : <p className="text-sm text-gray-700">{ewt ? `${ewt.code} · ${ewt.name} · ${pct(ewt.rate)}` : "None"}</p>}
            <p className="mt-1">Withheld on the VAT-exclusive amount under BIR rules and remitted to the BIR; the supplier is paid the rest. Rates are kept under Finance → Withholding Tax Rates.</p>
          </div>
          <p>
            <span className="font-semibold text-gray-700">Inventory cost</span> = product cost + this bill&rsquo;s share of freight and other
            purchasing costs, all net of VAT. That is the cost each piece is carried in stock at and folds into the weighted average.
            Input VAT is a claim against the BIR, not a cost of the goods.
          </p>
        </div>
        <table className="w-full max-w-md justify-self-end text-sm">
          <tbody className="divide-y divide-gray-100">
            <tr><td className="py-1.5">Product cost (net of VAT)</td><td className="py-1.5 text-right font-semibold">{peso(math.subtotal)}</td></tr>
            <tr>
              <td className="py-1.5">Freight{inclusive ? " (VAT-incl.)" : ""}</td>
              <td className="py-1.5 text-right">
                {editable ? <input name="freight" type="number" min={0} step="0.01" value={freight || ""} onChange={(e) => setFreight(Math.max(0, Number(e.target.value) || 0))} placeholder="0.00" className={`${inp} w-32`} /> : peso(freight)}
              </td>
            </tr>
            <tr>
              <td className="py-1.5">Other purchasing costs{inclusive ? " (VAT-incl.)" : ""}</td>
              <td className="py-1.5 text-right">
                {editable ? <input name="otherCosts" type="number" min={0} step="0.01" value={other || ""} onChange={(e) => setOther(Math.max(0, Number(e.target.value) || 0))} placeholder="0.00" className={`${inp} w-32`} /> : peso(other)}
              </td>
            </tr>
            <tr>
              <td className="py-1.5 text-gray-600">Allocated to lines</td>
              <td className="py-1.5 text-right">
                {editable ? (
                  <select name="allocationBasis" value={basis} onChange={(e) => setBasis(e.target.value)} className="input w-40 py-1">
                    {ALLOCATION_BASES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                ) : (
                  ALLOCATION_BASES.find(([k]) => k === basis)?.[1] ?? basis
                )}
              </td>
            </tr>
            <tr className="border-t border-gray-300">
              <td className="py-1.5 font-semibold">Into inventory (net of VAT)</td>
              <td className="py-1.5 text-right font-bold text-emerald-800">{peso(math.inventoryTotal)}</td>
            </tr>
            <tr><td className="py-1.5">Input VAT {vatMode === "NONE" ? "(none)" : "12%"}</td><td className={`py-1.5 text-right ${math.inputVat ? "" : "text-gray-300"}`}>{math.inputVat ? peso(math.inputVat) : "—"}</td></tr>
            <tr className="border-t border-gray-300"><td className="py-1.5 font-semibold">Invoice total{inclusive ? " (as it reads)" : ""}</td><td className="py-1.5 text-right font-semibold">{peso(math.grossTotal)}</td></tr>
            <tr><td className="py-1.5">Less: EWT {ewt ? `${pct(ewt.rate)} of ${peso(math.ewtBase)}` : "(none)"}</td><td className={`py-1.5 text-right ${math.ewtAmount ? "text-red-700" : "text-gray-300"}`}>{math.ewtAmount ? `(${peso(math.ewtAmount)})` : "—"}</td></tr>
            <tr className="border-t-2 border-gray-400">
              <td className="py-2 font-bold">NET PAYABLE TO SUPPLIER</td>
              <td className="py-2 text-right text-lg font-bold">{peso(math.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
