"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveForecast } from "../actions";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const CATEGORY_ORDER = ["Insecticide", "Herbicide", "Fungicide", "Molluscicide", "Foliar Fertilizer", "Others"];

export type GridRow = {
  parentItem: string;
  category: string;
  price: number; // average dealer price across the line's pack sizes
  packs: number;
  months: number[];
};

export type ParentOption = { name: string; category: string; price: number; packs: number };

function fmtPeso(n: number) {
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ForecastGrid({
  forecastId,
  initialTitle,
  initialYear,
  initialArea,
  initialRows,
  parents,
  readOnly,
}: {
  forecastId: string;
  initialTitle: string;
  initialYear: number;
  initialArea: string;
  initialRows: GridRow[];
  parents: ParentOption[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [year, setYear] = useState(initialYear);
  const [area, setArea] = useState(initialArea);
  const [rows, setRows] = useState<GridRow[]>(initialRows);
  const [pick, setPick] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const ca = CATEGORY_ORDER.indexOf(a.category);
      const cb = CATEGORY_ORDER.indexOf(b.category);
      if (ca !== cb) return ca - cb;
      return a.parentItem.localeCompare(b.parentItem);
    });
  }, [rows]);

  const available = parents.filter((p) => !rows.some((r) => r.parentItem === p.name));

  const setCell = (parentItem: string, mi: number, value: string) => {
    const v = Math.max(0, Math.floor(Number(value) || 0));
    setRows((prev) => prev.map((r) => (r.parentItem === parentItem ? { ...r, months: r.months.map((m, i) => (i === mi ? v : m)) } : r)));
  };

  const addRow = () => {
    const p = parents.find((x) => x.name === pick);
    if (!p) return;
    setRows((prev) => [...prev, { parentItem: p.name, category: p.category, price: p.price, packs: p.packs, months: Array(12).fill(0) }]);
    setPick("");
  };

  const removeRow = (parentItem: string) => setRows((prev) => prev.filter((r) => r.parentItem !== parentItem));

  const rowTotal = (r: GridRow) => r.months.reduce((s, m) => s + m, 0);
  const monthQty = (mi: number) => rows.reduce((s, r) => s + r.months[mi], 0);
  const monthAmount = (mi: number) => rows.reduce((s, r) => s + r.months[mi] * r.price, 0);
  const grandQty = rows.reduce((s, r) => s + rowTotal(r), 0);
  const grandAmount = rows.reduce((s, r) => s + rowTotal(r) * r.price, 0);

  const save = async () => {
    setSaving(true);
    await saveForecast({
      forecastId,
      title,
      year,
      area,
      rows: rows.map((r) => ({ parentItem: r.parentItem, months: r.months })),
    });
    setSaving(false);
    setSavedAt(new Date().toLocaleTimeString());
    router.refresh();
  };

  let lastCategory = "";

  return (
    <div>
      <div className="card mb-4 flex flex-wrap items-end gap-3">
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
          <label className="text-sm font-medium text-gray-700">Add product line:</label>
          <select value={pick} onChange={(e) => setPick(e.target.value)} className="input max-w-md">
            <option value="">— select a parent item —</option>
            {available.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} ({p.category}{p.packs > 1 ? ` · ${p.packs} packs` : ""})
              </option>
            ))}
          </select>
          <button onClick={addRow} disabled={!pick} className="btn-secondary" type="button">+ Add Row</button>
          <span className="text-xs text-gray-400">{rows.length} line(s) in this forecast</span>
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1100px] text-xs">
          <thead className="border-b-2 border-gray-300 bg-gray-50">
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 px-2 py-2 text-left font-semibold">PRODUCT</th>
              {MONTHS.map((m) => (
                <th key={m} className="px-1 py-2 text-right font-semibold">{m}</th>
              ))}
              <th className="px-2 py-2 text-right font-bold text-red-600">TOTAL</th>
              <th className="px-2 py-2 text-right font-bold">AMOUNT</th>
              {!readOnly && <th className="px-1 py-2" />}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const showCat = r.category !== lastCategory;
              lastCategory = r.category;
              return (
                <FragmentRow
                  key={r.parentItem}
                  row={r}
                  showCategory={showCat}
                  readOnly={readOnly}
                  onCell={setCell}
                  onRemove={removeRow}
                  total={rowTotal(r)}
                />
              );
            })}
            {!rows.length && (
              <tr><td colSpan={16} className="p-8 text-center text-sm text-gray-500">No product lines yet — add rows above to start forecasting.</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-gray-300 bg-gray-50">
              <tr className="font-bold">
                <td className="sticky left-0 bg-gray-50 px-2 py-1.5">TOTAL QTY</td>
                {MONTHS.map((_, mi) => (
                  <td key={mi} className="px-1 py-1.5 text-right">{monthQty(mi).toLocaleString()}</td>
                ))}
                <td className="bg-yellow-100 px-2 py-1.5 text-right text-red-600">{grandQty.toLocaleString()}</td>
                <td className="px-2 py-1.5" />
                {!readOnly && <td />}
              </tr>
              <tr className="font-semibold text-emerald-900">
                <td className="sticky left-0 bg-gray-50 px-2 py-1.5">AMOUNT (₱)</td>
                {MONTHS.map((_, mi) => (
                  <td key={mi} className="px-1 py-1.5 text-right">{monthAmount(mi).toLocaleString("en-PH", { maximumFractionDigits: 0 })}</td>
                ))}
                <td className="px-2 py-1.5" />
                <td className="bg-yellow-100 px-2 py-1.5 text-right font-bold">{fmtPeso(grandAmount)}</td>
                {!readOnly && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Rows are product lines (parent items). Amount = quantity × the line's dealer price (averaged across its pack sizes when there is more than one).
      </p>
    </div>
  );
}

function FragmentRow({
  row,
  showCategory,
  readOnly,
  onCell,
  onRemove,
  total,
}: {
  row: GridRow;
  showCategory: boolean;
  readOnly: boolean;
  onCell: (parentItem: string, mi: number, value: string) => void;
  onRemove: (parentItem: string) => void;
  total: number;
}) {
  return (
    <>
      {showCategory && (
        <tr className="bg-emerald-50/80">
          <td colSpan={16} className="sticky left-0 px-2 py-1 font-bold uppercase tracking-wide text-emerald-900">{row.category}</td>
        </tr>
      )}
      <tr className="border-b border-gray-100 hover:bg-gray-50">
        <td className="sticky left-0 z-10 max-w-[220px] truncate bg-white px-2 py-1 font-medium" title={`${row.parentItem} · avg price ₱${row.price.toFixed(2)}`}>
          {row.parentItem}
          {row.packs > 1 && <span className="ml-1 text-[10px] font-normal text-gray-400">({row.packs} packs)</span>}
        </td>
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
                onChange={(e) => onCell(row.parentItem, mi, e.target.value)}
                className="w-14 rounded border border-gray-200 px-1 py-0.5 text-right text-xs focus:border-emerald-600 focus:outline-none"
              />
            )}
          </td>
        ))}
        <td className="px-2 py-1 text-right font-semibold text-red-600">{total.toLocaleString()}</td>
        <td className="px-2 py-1 text-right font-semibold">{fmtPeso(total * row.price)}</td>
        {!readOnly && (
          <td className="px-1 py-1 text-center">
            <button onClick={() => onRemove(row.parentItem)} className="text-red-400 hover:text-red-600" title="Remove row" type="button">×</button>
          </td>
        )}
      </tr>
    </>
  );
}
