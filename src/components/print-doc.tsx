import { peso, fmtDate, vatBreakdown } from "@/lib/format";
import { PrintButton } from "./print-button";

type Line = { name: string; qty: number; unitPrice: number };

export function PrintDoc({
  title,
  docNumber,
  date,
  meta,
  lines,
  signatures,
  footnote,
}: {
  title: string;
  docNumber: string;
  date: Date;
  meta: [string, string][];
  lines: Line[];
  signatures: { label: string; name?: string }[];
  footnote?: string;
}) {
  const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const { net, vat } = vatBreakdown(total);
  return (
    <div className="print-page mx-auto max-w-[210mm] rounded-xl border border-gray-200 bg-white p-10 shadow-sm">
      <div className="no-print mb-6 flex justify-end">
        <PrintButton />
      </div>

      <header className="mb-6 flex items-start justify-between border-b-2 border-emerald-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-800 text-xl font-bold text-white">T</div>
          <div>
            <h1 className="text-xl font-bold text-emerald-900">TEAMAGRO TRADING CORP.</h1>
            <p className="text-xs text-gray-500">Agricultural Chemicals & Foliar Fertilizers</p>
            <p className="text-xs text-gray-500">Philippines · VAT Reg. TIN 000-000-000-000</p>
          </div>
        </div>
        <div className="text-right">
          <h2 className="text-lg font-bold uppercase tracking-wide text-gray-800">{title}</h2>
          <p className="font-mono text-sm font-semibold text-emerald-800">{docNumber}</p>
          <p className="text-xs text-gray-500">{fmtDate(date)}</p>
        </div>
      </header>

      <dl className="mb-6 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
        {meta.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-dotted border-gray-200 py-1">
            <dt className="text-gray-500">{k}</dt>
            <dd className="font-semibold text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>

      <table className="mb-6 w-full text-sm">
        <thead>
          <tr className="border-b-2 border-gray-300 text-left">
            <th className="py-2">#</th>
            <th className="py-2">Item Description</th>
            <th className="py-2 text-right">Qty</th>
            <th className="py-2 text-right">Unit Price</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="py-1.5 text-gray-400">{i + 1}</td>
              <td className="py-1.5">{l.name}</td>
              <td className="py-1.5 text-right">{l.qty}</td>
              <td className="py-1.5 text-right">{peso(l.unitPrice)}</td>
              <td className="py-1.5 text-right">{peso(l.qty * l.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={4} className="py-1 text-right text-gray-500">VATable Sales (net)</td><td className="py-1 text-right">{peso(net)}</td></tr>
          <tr><td colSpan={4} className="py-1 text-right text-gray-500">VAT (12%)</td><td className="py-1 text-right">{peso(vat)}</td></tr>
          <tr className="border-t-2 border-gray-300 text-base font-bold">
            <td colSpan={4} className="py-2 text-right">TOTAL</td>
            <td className="py-2 text-right">{peso(total)}</td>
          </tr>
        </tfoot>
      </table>

      {footnote && <p className="mb-8 text-xs text-gray-500">{footnote}</p>}

      <div className={`mt-12 grid gap-8 ${signatures.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {signatures.map((s) => (
          <div key={s.label} className="text-center">
            <p className="mb-10 text-sm font-medium text-gray-700">{s.name || " "}</p>
            <div className="border-t border-gray-400 pt-1">
              <p className="text-xs text-gray-500">{s.label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
