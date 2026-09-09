"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** Compact peso for axes — a full ₱12,345,678 label crowds every tick out. */
const short = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `₱${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `₱${Math.round(n / 1_000)}k`;
  return `₱${n}`;
};
const peso = (n: unknown) =>
  typeof n === "number" ? `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
/** recharts types the tooltip value loosely, so the formatter takes it loosely too */
const tip = (v: unknown, n: unknown): [string, string] => [peso(v), String(n ?? "")];

const GREEN = "#047857";
const LIGHT = "#a7f3d0";
const AMBER = "#d97706";
const GREY = "#cbd5e1";

/** Monthly net sales and gross profit, with last year's sales behind for comparison. */
export function SalesTrendChart({
  data,
  showPrior = true,
}: {
  data: { month: string; netSales: number; grossProfit: number; prior: number }[];
  /** drop the previous-year bars when there was no trading to show — an all-zero series
      still claims a legend entry and invites the reader to look for bars that cannot exist */
  showPrior?: boolean;
}) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#9ca3af" />
          <YAxis tickFormatter={short} tick={{ fontSize: 11 }} stroke="#9ca3af" width={58} />
          <Tooltip formatter={tip} contentStyle={{ fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {showPrior && <Bar dataKey="prior" name="Previous year" fill={GREY} radius={[3, 3, 0, 0]} />}
          <Bar dataKey="netSales" name="Net sales" fill={GREEN} radius={[3, 3, 0, 0]} />
          <Line dataKey="grossProfit" name="Gross profit" stroke={AMBER} strokeWidth={2} dot={{ r: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Forecast against actual, per salesperson — the bar pair the table below spells out. */
export function ForecastChart({
  data,
}: {
  data: { name: string; forecast: number; actual: number }[];
}) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#9ca3af" />
          <YAxis tickFormatter={short} tick={{ fontSize: 11 }} stroke="#9ca3af" width={58} />
          <Tooltip formatter={tip} contentStyle={{ fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="forecast" name="Forecast" fill={LIGHT} radius={[3, 3, 0, 0]} />
          <Bar dataKey="actual" name="Actual sales" fill={GREEN} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** One measure across the companies, for the comparison block. */
export function CompanyBars({
  data,
  label,
}: {
  data: { company: string; value: number }[];
  label: string;
}) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
          <XAxis type="number" tickFormatter={short} tick={{ fontSize: 11 }} stroke="#9ca3af" />
          <YAxis type="category" dataKey="company" tick={{ fontSize: 11 }} stroke="#9ca3af" width={120} />
          <Tooltip formatter={(v: unknown): [string, string] => [peso(v), label]} contentStyle={{ fontSize: 12 }} />
          <Bar dataKey="value" name={label} radius={[0, 3, 3, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={i === 0 ? GREEN : LIGHT} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
