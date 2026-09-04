"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveForecast } from "../actions";
import { SearchSelect, type SearchHit } from "@/components/search-select";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export type GridRow = {
  /** null while an area forecast has not been split between customers yet */
  customerId: string | null;
  customer: string | null;
  /** the salesperson this row is planned under — a snapshot, not a live lookup */
  salespersonId: string | null;
  salesperson: string | null;
  productId: string;
  sku: string;
  name: string;
  category: string;
  companyId: string;
  company: string;
  /** the product's current active SRP — the fallback when this row has no own price */
  srp: number;
  /** planning price for this row only; null follows the SRP. Never written back to the product. */
  price: number | null;
  months: number[];
};

const ALL = "__all__";
/** sentinel id for adding a row with no customer — an area total covering all accounts */
const AREA_TOTAL = "__area__";
export const NO_SALESPERSON = "— Unassigned —";
export const NO_CUSTOMER = "— Area total (all customers) —";

function fmtPeso(n: number) {
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const keyOf = (r: { customerId: string | null; productId: string }) => `${r.customerId ?? ""}:${r.productId}`;

type CustomerGroup = { id: string; name: string; rows: GridRow[] };
type SpGroup = { key: string; name: string; rows: GridRow[]; customers: CustomerGroup[] };

export function ForecastGrid({
  forecastId,
  initialTitle,
  initialYear,
  initialArea,
  initialRows,
  salespeople,
  companies,
  readOnly,
  categoryOrder,
}: {
  forecastId: string;
  initialTitle: string;
  initialYear: number;
  initialArea: string;
  initialRows: GridRow[];
  salespeople: { id: string; name: string; position: string }[];
  /** companies the viewer may see, in display order */
  companies: { id: string; name: string }[];
  readOnly: boolean;
  categoryOrder: string[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [year, setYear] = useState(initialYear);
  const [area, setArea] = useState(initialArea);
  const [rows, setRows] = useState<GridRow[]>(initialRows);
  const [view, setView] = useState(ALL);
  const [spFilter, setSpFilter] = useState(ALL);
  const [pickSp, setPickSp] = useState("");
  const [pickCustomer, setPickCustomer] = useState<SearchHit | null>(null);
  const [pickProduct, setPickProduct] = useState<SearchHit | null>(null);
  // bumping this remounts the pickers, clearing their text after a row is added
  const [pickKey, setPickKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const companyRank = useMemo(
    () => Object.fromEntries(companies.map((c, i) => [c.id, i])) as Record<string, number>,
    [companies]
  );

  const sorted = useMemo(() => {
    let visible = view === ALL ? rows : rows.filter((r) => r.companyId === view);
    if (spFilter !== ALL) {
      visible = visible.filter((r) => (spFilter === "none" ? !r.salespersonId : r.salespersonId === spFilter));
    }
    return [...visible].sort((a, b) => {
      // unassigned accounts sink to the bottom so real salespeople read first
      const sa = a.salesperson ?? "￿";
      const sb = b.salesperson ?? "￿";
      if (sa !== sb) return sa.localeCompare(sb);
      const ca2 = a.customer ?? "￿";
      const cb2 = b.customer ?? "￿";
      if (ca2 !== cb2) return ca2.localeCompare(cb2);
      const ra = companyRank[a.companyId] ?? 99;
      const rb = companyRank[b.companyId] ?? 99;
      if (ra !== rb) return ra - rb;
      const ca = categoryOrder.indexOf(a.category);
      const cb = categoryOrder.indexOf(b.category);
      if (ca !== cb) return ca - cb;
      return a.name.localeCompare(b.name);
    });
  }, [rows, view, spFilter, companyRank, categoryOrder]);


  const setCell = (key: string, mi: number, value: string) => {
    const v = Math.max(0, Math.floor(Number(value) || 0));
    setRows((prev) =>
      prev.map((r) => (keyOf(r) === key ? { ...r, months: r.months.map((m, i) => (i === mi ? v : m)) } : r))
    );
  };

  // blank the box to go back to following the product's SRP
  const setPrice = (key: string, value: string) => {
    const raw = value.trim();
    const n = Number(raw);
    const price = raw === "" || !Number.isFinite(n) || n < 0 ? null : n;
    setRows((prev) => prev.map((r) => (keyOf(r) === key ? { ...r, price } : r)));
  };

  const addRow = () => {
    const c = pickCustomer;
    const p = pickProduct;
    if (!c || !p) return;
    // "Area total" adds the product with no customer — one combined figure for the area
    const isArea = c.id === AREA_TOTAL;
    const cid = isArea ? null : c.id;
    if (rows.some((r) => r.customerId === cid && r.productId === p.id)) return;
    const d = p.data ?? {};
    const cd = c.data ?? {};
    // an area row is stamped with the salesperson picked above (if any); a customer row
    // is stamped from the account's current owner, then fixed for this forecast
    const areaSp = pickSp && pickSp !== "none" ? salespeople.find((s) => s.id === pickSp) ?? null : null;
    setRows((prev) => [
      ...prev,
      {
        customerId: cid,
        customer: isArea ? null : c.label,
        salespersonId: isArea ? areaSp?.id ?? null : (cd.salespersonId as string | null) ?? null,
        salesperson: isArea ? areaSp?.name ?? null : (cd.salesperson as string | null) ?? null,
        productId: p.id,
        sku: String(d.sku ?? ""),
        name: p.label,
        category: String(d.category ?? ""),
        companyId: String(d.companyId ?? ""),
        company: String(d.company ?? ""),
        srp: Number(d.srp ?? 0),
        price: null,
        months: Array(12).fill(0),
      },
    ]);
    setPickProduct(null);
    setPickKey((k) => k + 1);
  };

  const removeRow = (key: string) => setRows((prev) => prev.filter((r) => keyOf(r) !== key));

  /** the price this row is actually valued at: its own planning price, else the product's SRP */
  const priceOf = (r: GridRow) => r.price ?? r.srp;
  const rowTotal = (r: GridRow) => r.months.reduce((s, m) => s + m, 0);
  const monthQty = (rs: GridRow[], mi: number) => rs.reduce((s, r) => s + r.months[mi], 0);
  const monthValue = (rs: GridRow[], mi: number) => rs.reduce((s, r) => s + r.months[mi] * priceOf(r), 0);
  const totalQty = (rs: GridRow[]) => rs.reduce((s, r) => s + rowTotal(r), 0);
  const totalValue = (rs: GridRow[]) => rs.reduce((s, r) => s + rowTotal(r) * priceOf(r), 0);

  // Salesperson -> Customer -> Product, with a subtotal at each level
  const bySalesperson = useMemo(() => {
    const groups: SpGroup[] = [];
    for (const r of sorted) {
      const key = r.salespersonId ?? "none";
      let g = groups.find((x) => x.key === key);
      if (!g) {
        g = { key, name: r.salesperson ?? NO_SALESPERSON, rows: [], customers: [] };
        groups.push(g);
      }
      g.rows.push(r);
      const cid = r.customerId ?? "none";
      let c = g.customers.find((x) => x.id === cid);
      if (!c) {
        c = { id: cid, name: r.customer ?? NO_CUSTOMER, rows: [] };
        g.customers.push(c);
      }
      c.rows.push(r);
    }
    return groups;
  }, [sorted]);

  const showCompanyColumn = companies.length > 1;
  const colCount = 1 + (showCompanyColumn ? 1 : 0) + 12 + 3 + (readOnly ? 0 : 1);

  const save = async () => {
    setSaving(true);
    await saveForecast({
      forecastId,
      title,
      year,
      area,
      rows: rows.map((r) => ({
        customerId: r.customerId,
        productId: r.productId,
        salespersonId: r.salespersonId,
        unitPrice: r.price,
        months: r.months,
      })),
    });
    setSaving(false);
    setSavedAt(new Date().toLocaleTimeString());
    router.refresh();
  };

  return (
    <div>
      <div className="no-print card mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <label className="label">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} className="input font-semibold" />
        </div>
        <div className="w-24">
          <label className="label">Year</label>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || year)} disabled={readOnly} className="input" />
        </div>
        <div className="w-40">
          <label className="label">Area</label>
          <input value={area} onChange={(e) => setArea(e.target.value)} disabled={readOnly} className="input" />
        </div>
        {showCompanyColumn && (
          <div className="w-48">
            <label className="label">Company</label>
            <select value={view} onChange={(e) => setView(e.target.value)} className="input">
              <option value={ALL}>Combined (All Companies)</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="w-48">
          <label className="label">Salesperson</label>
          <select value={spFilter} onChange={(e) => setSpFilter(e.target.value)} className="input">
            <option value={ALL}>All salespeople</option>
            <option value="none">{NO_SALESPERSON}</option>
            {salespeople.map((sp) => (
              <option key={sp.id} value={sp.id}>{sp.name}</option>
            ))}
          </select>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={saving} className="btn-primary" type="button">
              {saving ? "Saving…" : "💾 Save Forecast"}
            </button>
            {savedAt && !saving && <span className="text-xs text-emerald-700">✔ saved {savedAt}</span>}
          </div>
        )}
      </div>

      {!readOnly && (
        <div className="no-print card mb-4 space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-52">
              <label className="label">Salesperson</label>
              <select
                value={pickSp}
                onChange={(e) => {
                  setPickSp(e.target.value);
                  setPickCustomer(null);
                  setPickProduct(null);
                  setPickKey((k) => k + 1);
                }}
                className="input"
              >
                <option value="">All salespeople</option>
                <option value="none">{NO_SALESPERSON}</option>
                {salespeople.map((sp) => (
                  <option key={sp.id} value={sp.id}>{sp.name}</option>
                ))}
              </select>
            </div>
            <div className="w-60">
              <label className="label">Customer</label>
              <SearchSelect
                key={`cust-${pickSp}-${pickKey}`}
                entity="customers"
                pinned={[{ id: AREA_TOTAL, label: NO_CUSTOMER }]}
                params={pickSp ? { salesperson: pickSp } : undefined}
                placeholder="Type customer name…"
                defaultValue={pickCustomer}
                onSelect={(h) => {
                  setPickCustomer(h);
                  setPickProduct(null);
                }}
              />
            </div>
            <div className="min-w-[260px] flex-1">
              <label className="label">Product</label>
              <SearchSelect
                key={`prod-${pickKey}`}
                entity="products"
                params={view !== ALL ? { company: view } : undefined}
                placeholder={pickCustomer ? "Type product name or SKU…" : "Pick a customer first"}
                onSelect={setPickProduct}
              />
            </div>
            <button onClick={addRow} disabled={!pickCustomer || !pickProduct} className="btn-secondary" type="button">
              + Add Row
            </button>
          </div>
          <p className="text-xs text-gray-500">
            {pickCustomer?.id === AREA_TOTAL ? (
              <>
                <span className="font-semibold text-emerald-800">Area total — no single customer.</span>
                {" The row covers the whole area"}
                {pickSp && pickSp !== "none"
                  ? ` under ${salespeople.find((s) => s.id === pickSp)?.name ?? "the picked salesperson"}`
                  : ""}
                {"; its sales are measured across every account, like the imported area forecasts."}
              </>
            ) : pickCustomer ? (
              <>
                <span className="font-semibold text-emerald-800">
                  Salesperson: {(pickCustomer.data?.salesperson as string | null) ?? NO_SALESPERSON} &rarr; Customer: {pickCustomer.label}
                </span>
                {" — the row is stamped with this salesperson and keeps it even if the account is reassigned later."}
              </>
            ) : (
              <>Pick a salesperson to narrow the customer search, or type a customer name directly. {rows.length} line(s) in this forecast.</>
            )}
          </p>
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1250px] text-xs">
          <thead className="border-b-2 border-gray-300 bg-gray-50">
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 px-2 py-2 text-left font-semibold">PRODUCT</th>
              {showCompanyColumn && <th className="px-2 py-2 text-left font-semibold">COMPANY</th>}
              {MONTHS.map((m) => (
                <th key={m} className="px-1 py-2 text-right font-semibold">{m}</th>
              ))}
              <th className="px-2 py-2 text-right font-bold text-red-600">FORECAST QTY</th>
              <th className="no-print px-2 py-2 text-right font-semibold">UNIT PRICE</th>
              <th className="px-2 py-2 text-right font-bold">FORECAST VALUE</th>
              {!readOnly && <th className="no-print px-1 py-2" />}
            </tr>
          </thead>
          <tbody>
            {bySalesperson.map((g) => (
              <SalespersonGroup
                key={g.key}
                group={g}
                colCount={colCount}
                showCompany={showCompanyColumn}
                readOnly={readOnly}
                onCell={setCell}
                onPrice={setPrice}
                onRemove={removeRow}
                priceOf={priceOf}
                rowTotal={rowTotal}
                monthQty={monthQty}
                totalQty={totalQty}
                totalValue={totalValue}
              />
            ))}
            {!sorted.length && (
              <tr>
                <td colSpan={colCount} className="p-8 text-center text-sm text-gray-500">
                  No lines yet &mdash; pick a customer and a product above to start forecasting.
                </td>
              </tr>
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot className="border-t-2 border-gray-300 bg-gray-50">
              <tr className="font-bold">
                <td className="sticky left-0 bg-gray-50 px-2 py-1.5">TOTAL QTY</td>
                {showCompanyColumn && <td />}
                {MONTHS.map((_, mi) => (
                  <td key={mi} className="px-1 py-1.5 text-right">{monthQty(sorted, mi).toLocaleString()}</td>
                ))}
                <td className="bg-yellow-100 px-2 py-1.5 text-right text-red-600">{totalQty(sorted).toLocaleString()}</td>
                <td className="no-print" />
                <td className="px-2 py-1.5" />
                {!readOnly && <td className="no-print" />}
              </tr>
              <tr className="font-semibold text-emerald-900">
                <td className="sticky left-0 bg-gray-50 px-2 py-1.5">FORECAST VALUE (₱)</td>
                {showCompanyColumn && <td />}
                {MONTHS.map((_, mi) => (
                  <td key={mi} className="px-1 py-1.5 text-right">
                    {monthValue(sorted, mi).toLocaleString("en-PH", { maximumFractionDigits: 0 })}
                  </td>
                ))}
                <td className="px-2 py-1.5" />
                <td className="no-print" />
                <td className="bg-yellow-100 px-2 py-1.5 text-right font-bold">{fmtPeso(totalValue(sorted))}</td>
                {!readOnly && <td className="no-print" />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="no-print mt-2 text-xs text-gray-500">
        Rows are grouped Salesperson &rarr; Customer &rarr; Product. A line may instead be an <strong>area total</strong>
        &mdash; one combined figure covering several accounts in that area &mdash; in which case it carries the salesperson
        but no single customer. The salesperson on a line is stamped when the line is created and never changes afterwards,
        so reassigning an account leaves past forecasts exactly as they were.
        Forecast Value = Forecast Quantity &times; Unit Price, which starts at the product&rsquo;s current active SRP; type a
        different figure to plan at that price without touching the product, the price list or the dealer catalog.
      </p>
    </div>
  );
}

function SalespersonGroup({
  group,
  colCount,
  showCompany,
  readOnly,
  onCell,
  onPrice,
  onRemove,
  priceOf,
  rowTotal,
  monthQty,
  totalQty,
  totalValue,
}: {
  group: SpGroup;
  colCount: number;
  showCompany: boolean;
  readOnly: boolean;
  onCell: (key: string, mi: number, value: string) => void;
  onPrice: (key: string, value: string) => void;
  onRemove: (key: string) => void;
  priceOf: (r: GridRow) => number;
  rowTotal: (r: GridRow) => number;
  monthQty: (rs: GridRow[], mi: number) => number;
  totalQty: (rs: GridRow[]) => number;
  totalValue: (rs: GridRow[]) => number;
}) {
  const unassigned = group.key === "none";
  return (
    <>
      <tr className={unassigned ? "bg-gray-100" : "bg-emerald-100"}>
        <td
          colSpan={colCount}
          className={
            "sticky left-0 px-2 py-1.5 font-bold uppercase tracking-wide " +
            (unassigned ? "text-gray-500" : "text-emerald-900")
          }
        >
          👤 Salesperson: {group.name}
          <span className="ml-2 text-[10px] font-normal normal-case tracking-normal opacity-70">
            {group.customers.length} customer{group.customers.length === 1 ? "" : "s"} · {group.rows.length} line
            {group.rows.length === 1 ? "" : "s"}
          </span>
        </td>
      </tr>
      {group.customers.map((c) => (
        <CustomerBlock
          key={c.id}
          customer={c}
          colCount={colCount}
          showCompany={showCompany}
          readOnly={readOnly}
          onCell={onCell}
          onPrice={onPrice}
          onRemove={onRemove}
          priceOf={priceOf}
          rowTotal={rowTotal}
          monthQty={monthQty}
          totalQty={totalQty}
          totalValue={totalValue}
        />
      ))}
      <tr className="border-y border-emerald-200 bg-emerald-50 font-bold text-emerald-900">
        <td className="sticky left-0 bg-emerald-50 px-2 py-1.5">TOTAL &mdash; {group.name}</td>
        {showCompany && <td />}
        {MONTHS.map((_, mi) => (
          <td key={mi} className="px-1 py-1.5 text-right">{monthQty(group.rows, mi).toLocaleString()}</td>
        ))}
        <td className="px-2 py-1.5 text-right">{totalQty(group.rows).toLocaleString()}</td>
        <td className="no-print" />
        <td className="px-2 py-1.5 text-right">{fmtPeso(totalValue(group.rows))}</td>
        {!readOnly && <td className="no-print" />}
      </tr>
    </>
  );
}

function CustomerBlock({
  customer,
  colCount,
  showCompany,
  readOnly,
  onCell,
  onPrice,
  onRemove,
  priceOf,
  rowTotal,
  monthQty,
  totalQty,
  totalValue,
}: {
  customer: CustomerGroup;
  colCount: number;
  showCompany: boolean;
  readOnly: boolean;
  onCell: (key: string, mi: number, value: string) => void;
  onPrice: (key: string, value: string) => void;
  onRemove: (key: string) => void;
  priceOf: (r: GridRow) => number;
  rowTotal: (r: GridRow) => number;
  monthQty: (rs: GridRow[], mi: number) => number;
  totalQty: (rs: GridRow[]) => number;
  totalValue: (rs: GridRow[]) => number;
}) {
  return (
    <>
      <tr className="bg-emerald-50/70">
        <td colSpan={colCount} className="sticky left-0 px-2 py-1 pl-5 font-semibold text-emerald-800">
          🏢 Customer: {customer.name}
        </td>
      </tr>
      {customer.rows.map((r) => (
        <ProductRow
          key={keyOf(r)}
          row={r}
          showCompany={showCompany}
          readOnly={readOnly}
          onCell={onCell}
          onPrice={onPrice}
          onRemove={onRemove}
          total={rowTotal(r)}
          price={priceOf(r)}
        />
      ))}
      {customer.rows.length > 1 && (
        <tr className="border-b border-gray-200 text-gray-700">
          <td className="sticky left-0 bg-white px-2 py-1 pl-5 font-semibold">Subtotal &mdash; {customer.name}</td>
          {showCompany && <td />}
          {MONTHS.map((_, mi) => (
            <td key={mi} className="px-1 py-1 text-right">{monthQty(customer.rows, mi).toLocaleString()}</td>
          ))}
          <td className="px-2 py-1 text-right font-semibold">{totalQty(customer.rows).toLocaleString()}</td>
          <td className="no-print" />
          <td className="px-2 py-1 text-right font-semibold">{fmtPeso(totalValue(customer.rows))}</td>
          {!readOnly && <td className="no-print" />}
        </tr>
      )}
    </>
  );
}

function ProductRow({
  row,
  showCompany,
  readOnly,
  onCell,
  onPrice,
  onRemove,
  total,
  price,
}: {
  row: GridRow;
  showCompany: boolean;
  readOnly: boolean;
  onCell: (key: string, mi: number, value: string) => void;
  onPrice: (key: string, value: string) => void;
  onRemove: (key: string) => void;
  total: number;
  price: number;
}) {
  const key = keyOf(row);
  const overridden = row.price !== null && row.price !== row.srp;
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td
        className="sticky left-0 z-10 max-w-[240px] truncate bg-white px-2 py-1 pl-8 font-medium"
        title={`${row.sku} · ${row.name}`}
      >
        {row.name}
        <span className="ml-1 text-[10px] font-normal text-gray-400">{row.sku}</span>
      </td>
      {showCompany && <td className="whitespace-nowrap px-2 py-1 text-[11px] text-gray-500">{row.company}</td>}
      {row.months.map((m, mi) => (
        <td key={mi} className="px-0.5 py-0.5 text-right">
          {readOnly ? (
            <span className="pr-1">{m || "-"}</span>
          ) : (
            <input
              type="number"
              min={0}
              value={m || ""}
              placeholder="-"
              onChange={(e) => onCell(key, mi, e.target.value)}
              className="w-14 rounded border border-gray-200 px-1 py-0.5 text-right text-xs focus:border-emerald-600 focus:outline-none"
            />
          )}
        </td>
      ))}
      <td className="px-2 py-1 text-right font-semibold text-red-600">{total.toLocaleString()}</td>
      <td className="no-print px-2 py-1 text-right">
        {readOnly ? (
          <span className={overridden ? "font-semibold text-amber-700" : "text-gray-600"}>{fmtPeso(price)}</span>
        ) : (
          <input
            type="number"
            min={0}
            step="0.01"
            value={row.price ?? ""}
            placeholder={row.srp.toFixed(2)}
            onChange={(e) => onPrice(key, e.target.value)}
            title={
              overridden
                ? `Forecast price. Product SRP is ${fmtPeso(row.srp)} — clear the box to follow it.`
                : "Following the product's current SRP"
            }
            className={
              "w-24 rounded border px-1 py-0.5 text-right text-xs focus:outline-none " +
              (overridden
                ? "border-amber-400 bg-amber-50 font-semibold text-amber-800 focus:border-amber-600"
                : "border-gray-200 text-gray-600 focus:border-emerald-600")
            }
          />
        )}
        {overridden && <p className="text-[10px] text-amber-600">SRP {fmtPeso(row.srp)}</p>}
      </td>
      <td className="px-2 py-1 text-right font-semibold">{fmtPeso(total * price)}</td>
      {!readOnly && (
        <td className="no-print px-1 py-1 text-center">
          <button onClick={() => onRemove(key)} className="text-red-400 hover:text-red-600" title="Remove row" type="button">
            &times;
          </button>
        </td>
      )}
    </tr>
  );
}
