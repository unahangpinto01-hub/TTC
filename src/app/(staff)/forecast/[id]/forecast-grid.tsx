"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveForecast } from "../actions";
import type { ForecastProduct } from "../parents";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export type GridRow = {
  productId: string;
  sku: string;
  name: string;
  category: string;
  companyId: string;
  company: string;
  /** current active SRP — forecast value never uses unit cost or dealer price */
  srp: number;
  months: number[];
};

const ALL = "__all__";

function fmtPeso(n: number) {
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ForecastGrid({
  forecastId,
  initialTitle,
  initialYear,
  initialArea,
  initialRows,
  products,
  companies,
  readOnly,
  categoryOrder,
}: {
  forecastId: string;
  initialTitle: string;
  initialYear: number;
  initialArea: string;
  initialRows: GridRow[];
  products: ForecastProduct[];
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
  const [pick, setPick] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const companyRank = useMemo(
    () => Object.fromEntries(companies.map((c, i) => [c.id, i])) as Record<string, number>,
    [companies]
  );

  const sorted = useMemo(() => {
    const visible = view === ALL ? rows : rows.filter((r) => r.companyId === view);
    return [...visible].sort((a, b) => {
      const ra = companyRank[a.companyId] ?? 99;
      const rb = companyRank[b.companyId] ?? 99;
      if (ra !== rb) return ra - rb;
      const ca = categoryOrder.indexOf(a.category);
      const cb = categoryOrder.indexOf(b.category);
      if (ca !== cb) return ca - cb;
      return a.name.localeCompare(b.name);
    });
  }, [rows, view, companyRank, categoryOrder]);

  const available = products.filter(
    (p) => !rows.some((r) => r.productId === p.id) && (view === ALL || p.companyId === view)
  );

  const setCell = (productId: string, mi: number, value: string) => {
    const v = Math.max(0, Math.floor(Number(value) || 0));
    setRows((prev) =>
      prev.map((r) => (r.productId === productId ? { ...r, months: r.months.map((m, i) => (i === mi ? v : m)) } : r))
    );
  };

  const addRow = () => {
    const p = products.find((x) => x.id === pick);
    if (!p) return;
    setRows((prev) => [
      ...prev,
      {
        productId: p.id, sku: p.sku, name: p.name, category: p.category,
        companyId: p.companyId, company: p.company, srp: p.srp, months: Array(12).fill(0),
      },
    ]);
    setPick("");
  };

  const removeRow = (productId: string) => setRows((prev) => prev.filter((r) => r.productId !== productId));

  const rowTotal = (r: GridRow) => r.months.reduce((s, m) => s + m, 0);
  const monthQty = (rs: GridRow[], mi: number) => rs.reduce((s, r) => s + r.months[mi], 0);
  const monthValue = (rs: GridRow[], mi: number) => rs.reduce((s, r) => s + r.months[mi] * r.srp, 0);
  const totalQty = (rs: GridRow[]) => rs.reduce((s, r) => s + rowTotal(r), 0);
  const totalValue = (rs: GridRow[]) => rs.reduce((s, r) => s + rowTotal(r) * r.srp, 0);

  // one subtotal line per company that actually has rows in the current view
  const perCompany = companies
    .map((c) => ({ ...c, rows: sorted.filter((r) => r.companyId === c.id) }))
    .filter((c) => c.rows.length > 0);
  const showCompanyColumn = companies.length > 1;
  const colCount = 1 + (showCompanyColumn ? 1 : 0) + 12 + 3 + (readOnly ? 0 : 1);

  const save = async () => {
    setSaving(true);
    await saveForecast({
      forecastId,
      title,
      year,
      area,
      rows: rows.map((r) => ({ productId: r.productId, months: r.months })),
    });
    setSaving(false);
    setSavedAt(new Date().toLocaleTimeString());
    router.refresh();
  };

  let lastGroup = "";

  return (
    <div>
      <div className="no-print card mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[280px] flex-1">
          <label className="label">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} className="input font-semibold" />
        </div>
        <div className="w-28">
          <label className="label">Year</label>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || year)} disabled={readOnly} className="input" />
        </div>
        <div className="w-44">
          <label className="label">Area</label>
          <input value={area} onChange={(e) => setArea(e.target.value)} disabled={readOnly} className="input" />
        </div>
        {showCompanyColumn && (
          <div className="w-52">
            <label className="label">View</label>
            <select value={view} onChange={(e) => setView(e.target.value)} className="input">
              <option value={ALL}>Combined (All Companies)</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
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
        <div className="no-print card mb-4 flex flex-wrap items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Add product:</label>
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="input max-w-lg">
            <option value="">&mdash; select a product &mdash;</option>
            {companies.map((c) => {
              const opts = available.filter((p) => p.companyId === c.id);
              if (!opts.length) return null;
              return (
                <optgroup key={c.id} label={c.name}>
                  {opts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} &middot; {p.category} &middot; SRP {p.srp.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          <button onClick={addRow} disabled={!pick} className="btn-secondary" type="button">+ Add Row</button>
          <span className="text-xs text-gray-400">{rows.length} product(s) in this forecast</span>
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
              <th className="px-2 py-2 text-right font-semibold">UNIT SRP</th>
              <th className="px-2 py-2 text-right font-bold">FORECAST VALUE</th>
              {!readOnly && <th className="no-print px-1 py-2" />}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const group = showCompanyColumn ? `${r.company} — ${r.category}` : r.category;
              const showGroup = group !== lastGroup;
              lastGroup = group;
              return (
                <ProductRow
                  key={r.productId}
                  row={r}
                  groupLabel={showGroup ? group : null}
                  colCount={colCount}
                  showCompany={showCompanyColumn}
                  readOnly={readOnly}
                  onCell={setCell}
                  onRemove={removeRow}
                  total={rowTotal(r)}
                />
              );
            })}
            {!sorted.length && (
              <tr><td colSpan={colCount} className="p-8 text-center text-sm text-gray-500">
                No products yet &mdash; add rows above to start forecasting.
              </td></tr>
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot className="border-t-2 border-gray-300 bg-gray-50">
              {perCompany.length > 1 &&
                perCompany.map((c) => (
                  <tr key={c.id} className="border-b border-gray-200 text-gray-700">
                    <td className="sticky left-0 bg-gray-50 px-2 py-1.5 font-semibold">SUBTOTAL &mdash; {c.name}</td>
                    {showCompanyColumn && <td />}
                    {MONTHS.map((_, mi) => (
                      <td key={mi} className="px-1 py-1.5 text-right">{monthQty(c.rows, mi).toLocaleString()}</td>
                    ))}
                    <td className="px-2 py-1.5 text-right font-semibold">{totalQty(c.rows).toLocaleString()}</td>
                    <td />
                    <td className="px-2 py-1.5 text-right font-semibold">{fmtPeso(totalValue(c.rows))}</td>
                    {!readOnly && <td className="no-print" />}
                  </tr>
                ))}
              <tr className="font-bold">
                <td className="sticky left-0 bg-gray-50 px-2 py-1.5">TOTAL QTY</td>
                {showCompanyColumn && <td />}
                {MONTHS.map((_, mi) => (
                  <td key={mi} className="px-1 py-1.5 text-right">{monthQty(sorted, mi).toLocaleString()}</td>
                ))}
                <td className="bg-yellow-100 px-2 py-1.5 text-right text-red-600">{totalQty(sorted).toLocaleString()}</td>
                <td />
                <td className="px-2 py-1.5" />
                {!readOnly && <td className="no-print" />}
              </tr>
              <tr className="font-semibold text-emerald-900">
                <td className="sticky left-0 bg-gray-50 px-2 py-1.5">FORECAST VALUE (₱)</td>
                {showCompanyColumn && <td />}
                {MONTHS.map((_, mi) => (
                  <td key={mi} className="px-1 py-1.5 text-right">{monthValue(sorted, mi).toLocaleString("en-PH", { maximumFractionDigits: 0 })}</td>
                ))}
                <td className="px-2 py-1.5" />
                <td />
                <td className="bg-yellow-100 px-2 py-1.5 text-right font-bold">{fmtPeso(totalValue(sorted))}</td>
                {!readOnly && <td className="no-print" />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        One row per product. Forecast Value = Forecast Quantity &times; the product&rsquo;s current active SRP &mdash; unit cost and dealer price are never used.
      </p>
    </div>
  );
}

function ProductRow({
  row,
  groupLabel,
  colCount,
  showCompany,
  readOnly,
  onCell,
  onRemove,
  total,
}: {
  row: GridRow;
  groupLabel: string | null;
  colCount: number;
  showCompany: boolean;
  readOnly: boolean;
  onCell: (productId: string, mi: number, value: string) => void;
  onRemove: (productId: string) => void;
  total: number;
}) {
  return (
    <>
      {groupLabel && (
        <tr className="bg-emerald-50/80">
          <td colSpan={colCount} className="sticky left-0 px-2 py-1 font-bold uppercase tracking-wide text-emerald-900">{groupLabel}</td>
        </tr>
      )}
      <tr className="border-b border-gray-100 hover:bg-gray-50">
        <td className="sticky left-0 z-10 max-w-[240px] truncate bg-white px-2 py-1 font-medium" title={`${row.sku} · ${row.name}`}>
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
                onChange={(e) => onCell(row.productId, mi, e.target.value)}
                className="w-14 rounded border border-gray-200 px-1 py-0.5 text-right text-xs focus:border-emerald-600 focus:outline-none"
              />
            )}
          </td>
        ))}
        <td className="px-2 py-1 text-right font-semibold text-red-600">{total.toLocaleString()}</td>
        <td className="px-2 py-1 text-right text-gray-600">{fmtPeso(row.srp)}</td>
        <td className="px-2 py-1 text-right font-semibold">{fmtPeso(total * row.srp)}</td>
        {!readOnly && (
          <td className="no-print px-1 py-1 text-center">
            <button onClick={() => onRemove(row.productId)} className="text-red-400 hover:text-red-600" title="Remove row" type="button">&times;</button>
          </td>
        )}
      </tr>
    </>
  );
}
