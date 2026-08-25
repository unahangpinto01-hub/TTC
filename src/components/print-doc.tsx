import { peso, fmtDate, vatBreakdown } from "@/lib/format";
import { getActiveCompany, getDocVisibility, type DocTypeKey } from "@/lib/company";
import { PrintButton, BackButton } from "./print-button";

type Line = { name: string; qty: number; unitPrice: number; unit?: string; baseQty?: number };

const unitTag = (unit?: string) => (unit === "CARTON" ? " CTN" : unit === "PCS" ? " PCS" : "");

export async function PrintDoc({
  title,
  docNumber,
  date,
  meta,
  lines,
  signatures,
  footnote,
  showPrices = true,
  vatApplied = true,
  showVat = true,
  docType = "SO",
}: {
  title: string;
  docNumber: string;
  date: Date;
  meta: [string, string][];
  lines: Line[];
  signatures: { label: string; name?: string }[];
  footnote?: string;
  /** false = goods-only document (e.g. Delivery Receipt): hides unit prices, amounts, and totals */
  showPrices?: boolean;
  /** false = VAT-exempt / non-VAT sale: totals show a VAT-exempt line instead of the 12% breakdown */
  vatApplied?: boolean;
  /** false = non-sales document (e.g. Purchase Order): totals show only the TOTAL row, no VAT lines */
  showVat?: boolean;
  /** which document this is — controls which company details print (Company Details matrix) */
  docType?: DocTypeKey;
}) {
  const company = await getActiveCompany(); // ACTIVE company's letterhead — pages verify the record belongs to it
  const vis = getDocVisibility(company, docType);
  const contactLine = [
    vis.mobileNo && company.mobileNo && `Mobile ${company.mobileNo}`,
    vis.telephoneNo && company.telephoneNo && `Tel ${company.telephoneNo}`,
    vis.email && company.email && company.email,
    vis.tin && company.tin && `TIN ${company.tin}`,
  ].filter(Boolean).join(" · ");
  const govLine = [
    vis.sssNo && company.sssNo && `SSS ${company.sssNo}`,
    vis.phicNo && company.phicNo && `PHIC ${company.phicNo}`,
    vis.hdmfNo && company.hdmfNo && `HDMF ${company.hdmfNo}`,
  ].filter(Boolean).join(" · ");
  const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const { net, vat } = vatBreakdown(total);
  return (
    <div className="print-page mx-auto max-w-[210mm] rounded-xl border border-gray-200 bg-white p-10 shadow-sm">
      <div className="no-print mb-6 flex justify-between">
        <BackButton />
        <PrintButton />
      </div>

      <header className="mb-6 flex items-start justify-between border-b-2 border-emerald-800 pb-4">
        <div className="flex items-center gap-3">
          {company.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logoDataUrl} alt="Company logo" className="h-14 w-14 shrink-0 object-contain" />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-xl font-bold text-white">
              {(company.companyName || "T").charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold uppercase text-emerald-900">{company.companyName}</h1>
            {vis.address && company.address && <p className="text-xs text-gray-500">{company.address}</p>}
            {contactLine && <p className="text-xs text-gray-500">{contactLine}</p>}
            {govLine && <p className="text-xs text-gray-500">{govLine}</p>}
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
            <th className={`py-2 text-right ${showPrices ? "" : "pr-16"}`}>Qty</th>
            {showPrices && <th className="py-2 text-right">Unit Price</th>}
            {showPrices && <th className="py-2 text-right">Amount</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="py-1.5 text-gray-400">{i + 1}</td>
              <td className="py-1.5">{l.name}</td>
              <td className={`py-1.5 text-right ${showPrices ? "" : "pr-16"}`}>
                {l.qty}{unitTag(l.unit)}
                {l.unit === "CARTON" && l.baseQty != null && <span className="text-xs text-gray-500"> ({l.baseQty} pcs)</span>}
              </td>
              {showPrices && <td className="py-1.5 text-right">{peso(l.unitPrice)}</td>}
              {showPrices && <td className="py-1.5 text-right">{peso(l.qty * l.unitPrice)}</td>}
            </tr>
          ))}
        </tbody>
        {showPrices ? (
          <tfoot>
            {showVat &&
              (vatApplied ? (
                <>
                  <tr><td colSpan={4} className="py-1 text-right text-gray-500">VATable Sales (net)</td><td className="py-1 text-right">{peso(net)}</td></tr>
                  <tr><td colSpan={4} className="py-1 text-right text-gray-500">VAT (12%)</td><td className="py-1 text-right">{peso(vat)}</td></tr>
                </>
              ) : (
                <tr><td colSpan={4} className="py-1 text-right text-gray-500">VAT-exempt Sales</td><td className="py-1 text-right">{peso(total)}</td></tr>
              ))}
            <tr className="border-t-2 border-gray-300 text-base font-bold">
              <td colSpan={4} className="py-2 text-right">TOTAL</td>
              <td className="py-2 text-right">{peso(total)}</td>
            </tr>
          </tfoot>
        ) : (
          <tfoot>
            <tr className="border-t-2 border-gray-300 font-bold">
              <td colSpan={2} className="py-2 text-right">TOTAL QTY{lines.some((l) => l.baseQty != null) ? " (PCS)" : ""}</td>
              <td className="py-2 pr-16 text-right">{lines.reduce((s, l) => s + (l.baseQty ?? l.qty), 0)}</td>
            </tr>
          </tfoot>
        )}
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
