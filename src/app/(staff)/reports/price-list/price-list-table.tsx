"use client";

import { Fragment, useState } from "react";

type Row = {
  id: string;
  company: string;
  sku: string;
  name: string;
  size: string;
  srp: number;
  srpLabel: string;
  category: string;
  inactive: boolean;
};

/** Price list table. Every product is included by default; unticking rows drops them from
    the printed sheet and the PDF, so a short list can be sent without changing the filters. */
export function PriceListTable({ rows, groupByCategory }: { rows: Row[]; groupByCategory: boolean }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rows.map((r) => r.id)));
  const allOn = picked.size === rows.length;

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  let lastCategory = "";

  return (
    <>
      <div className="no-print mb-2 flex items-center gap-3 text-sm text-gray-600">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={allOn}
            onChange={() => setPicked(allOn ? new Set() : new Set(rows.map((r) => r.id)))}
          />
          {allOn ? "All products included" : `${picked.size} of ${rows.length} selected`}
        </label>
        <span className="text-xs text-gray-400">Untick a product to leave it off the printed list.</span>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-gray-300 text-left">
            <th className="no-print w-8 py-2" />
            {rows.some((r) => r.company) && <th className="py-2 pr-2 w-32">Company</th>}
            <th className="py-2 pr-2">Product Name</th>
            <th className="py-2 pr-2 w-40">Size</th>
            <th className="py-2 w-32 text-right">SRP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const on = picked.has(r.id);
            const showCat = groupByCategory && r.category !== lastCategory;
            if (groupByCategory) lastCategory = r.category;
            return (
              <Fragment key={r.id}>
                {showCat && (
                  <tr className={on ? "" : "no-print"}>
                    <td className="no-print" />
                    <td colSpan={rows.some((x) => x.company) ? 4 : 3} className="bg-gray-100 py-1 pl-1 text-xs font-bold uppercase tracking-wide text-emerald-900 print:bg-gray-100">
                      {r.category}
                    </td>
                  </tr>
                )}
                <tr className={`border-b border-gray-200 ${on ? "" : "no-print opacity-40"}`}>
                  <td className="no-print py-1.5">
                    <input type="checkbox" checked={on} onChange={() => toggle(r.id)} aria-label={`Include ${r.name}`} />
                  </td>
                  {r.company && <td className="py-1.5 pr-2 text-xs text-gray-600">{r.company}</td>}
                  <td className="py-1.5 pr-2">
                    {r.name}
                    {r.inactive && <span className="ml-1.5 rounded bg-gray-200 px-1 py-0.5 text-[10px] font-semibold text-gray-600">INACTIVE</span>}
                  </td>
                  <td className="py-1.5 pr-2 text-gray-600">{r.size}</td>
                  <td className="py-1.5 text-right font-semibold">{r.srpLabel}</td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <p className="mt-3 text-xs text-gray-500">
        {picked.size} product{picked.size === 1 ? "" : "s"} listed
      </p>
    </>
  );
}
