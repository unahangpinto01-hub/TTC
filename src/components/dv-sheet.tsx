/**
 * The Disbursement Voucher as it prints — the company's paper form, boxed the same way.
 * One component draws both the live preview under the voucher form and the print page, so
 * what the clerk sees while typing is exactly what comes off the printer. Pure: it renders
 * whatever it is given and reads nothing itself.
 *
 * Every box has a fixed height so the sheet always fills one Letter page the same way; when
 * more lines are given than the box holds, the type steps down rather than the box growing.
 */

export type DvSheetData = {
  companyName: string;
  dvNo: string | null;
  padRef: string | null;
  payee: string;
  date: string;
  terms: string;
  particulars: string;
  /** what the amount column lists — one line per bill covered and per item; a negative is a deduction */
  items: { label: string; amount: number }[];
  amount: number;
  amountInWords: string;
  lines: { title: string; debit: number; credit: number; ref?: string }[];
  signatures: { preparedBy?: string | null; checkedBy?: string | null; approvedBy?: string | null; notedBy?: string | null; postedBy?: string | null };
  payments: { checkNo: string; date: string; amount: number }[];
  paidTotal: number;
  status?: string;
};

const peso = (n: number) => (n < 0 ? "(" : "") + Math.abs(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (n < 0 ? ")" : "");
const cell = "border border-gray-800 px-2 py-1 align-top";
const head = `${cell} bg-white text-center text-[10px] font-semibold uppercase tracking-wide`;

export function DvSheet({ d, compact = false }: { d: DvSheetData; compact?: boolean }) {
  // more lines than the box comfortably holds → smaller type, never a taller box
  const lineText = d.lines.length > 8 ? "text-[9px] leading-tight" : d.lines.length > 5 ? "text-[11px] leading-snug" : "text-[13px]";
  const partText = d.particulars.length + d.items.length * 60 > 900 ? "text-[10px] leading-tight" : d.particulars.length + d.items.length * 60 > 450 ? "text-[11px] leading-snug" : "text-[13px]";
  const pay = d.payments.slice(0, 4);
  const sig: [string, string | null | undefined][] = [
    ["Prepared by", d.signatures.preparedBy], ["Checked by", d.signatures.checkedBy], ["Approved by", d.signatures.approvedBy], ["Noted by", d.signatures.notedBy], ["Posted by", d.signatures.postedBy],
  ];

  return (
    <div className={`dv-sheet mx-auto w-full max-w-[210mm] bg-white text-gray-900 ${compact ? "p-5 text-[12px]" : "p-8 text-[13px]"}`}>
      <h1 className="text-center text-xl font-semibold uppercase tracking-wide">{d.companyName}</h1>
      <h2 className="mb-4 mt-2 text-center text-base font-semibold uppercase tracking-wide underline">Disbursement Voucher</h2>

      <table className="mb-2 w-full table-fixed border-collapse">
        <tbody>
          <tr>
            <td className={`${cell} w-[60%] h-12`} rowSpan={2}>
              <span className="text-[10px] uppercase text-gray-600">Payee</span>
              <p className="truncate text-base font-semibold">{d.payee || " "}</p>
            </td>
            <td className={`${cell} h-6`}><span className="text-[10px] uppercase text-gray-600">Date</span> <span className="ml-3 font-semibold">{d.date}</span></td>
          </tr>
          <tr><td className={`${cell} h-6`}><span className="text-[10px] uppercase text-gray-600">Terms</span> <span className="ml-3 font-semibold">{d.terms}</span></td></tr>
        </tbody>
      </table>

      <table className="mb-2 w-full table-fixed border-collapse">
        <thead><tr><th className={head}>Particulars</th><th className={`${head} w-[22%]`}>Amount</th></tr></thead>
        <tbody>
          <tr>
            <td className={`${cell} h-[2.6in] overflow-hidden ${partText}`}>
              <div className="whitespace-pre-line">{d.particulars}</div>
              {d.items.length > 0 && (
                <div className="mt-1 text-gray-700">
                  {d.items.map((it, i) => <div key={i} className="truncate">{it.label}</div>)}
                </div>
              )}
            </td>
            <td className={`${cell} h-[2.6in] overflow-hidden text-right ${partText}`}>
              {d.items.length > 0 && <div className="invisible whitespace-pre-line">{d.particulars || " "}</div>}
              {d.items.map((it, i) => <div key={i} className={d.items.length ? "mt-0" : ""}>{peso(it.amount)}</div>)}
            </td>
          </tr>
          <tr><td className={`${cell} h-7 text-right text-[10px] uppercase text-gray-600`}>Total</td><td className={`${cell} text-right font-bold`}>{d.amount ? peso(d.amount) : " "}</td></tr>
        </tbody>
      </table>

      <table className="mb-2 w-full table-fixed border-collapse">
        <thead><tr><th className={head}>Account Title</th><th className={`${head} w-[22%]`}>Debit (Credit)</th></tr></thead>
        <tbody>
          <tr>
            <td className={`${cell} h-[2.2in] overflow-hidden ${lineText}`}>
              {d.lines.map((l, i) => (
                <div key={i} className={`truncate ${l.credit ? "pl-8" : ""}`}>{l.title}{l.ref ? <span className="ml-2 font-mono text-[9px] text-gray-500">{l.ref}</span> : null}</div>
              ))}
            </td>
            <td className={`${cell} h-[2.2in] overflow-hidden text-right ${lineText}`}>
              {d.lines.map((l, i) => <div key={i}>{l.debit ? peso(l.debit) : `(${peso(l.credit)})`}</div>)}
            </td>
          </tr>
        </tbody>
      </table>

      <table className="mb-2 w-full table-fixed border-collapse text-center">
        <thead><tr>{sig.map(([l]) => <th key={l} className={head}>{l}</th>)}</tr></thead>
        <tbody><tr>{sig.map(([l, n]) => <td key={l} className={`${cell} h-14`}><div className="mt-6 truncate border-b border-gray-800 text-[10px] font-semibold">{n || " "}</div></td>)}</tr></tbody>
      </table>

      <div className="flex gap-2">
        <table className="w-[57%] table-fixed border-collapse">
          <thead>
            <tr><th className={head} colSpan={3}>Details of Payment</th></tr>
            <tr><th className={head}>Check Number</th><th className={head}>Date</th><th className={head}>Amount</th></tr>
          </thead>
          <tbody>
            {pay.map((p, i) => <tr key={i}><td className={`${cell} h-6 truncate text-[11px]`}>{p.checkNo}</td><td className={`${cell} text-[11px]`}>{p.date}</td><td className={`${cell} text-right text-[11px]`}>₱ {peso(p.amount)}</td></tr>)}
            {Array.from({ length: Math.max(0, 4 - pay.length) }).map((_, i) => <tr key={`e${i}`}><td className={`${cell} h-6`} /><td className={cell} /><td className={`${cell} text-[11px]`}>₱</td></tr>)}
            <tr><td className={`${cell} text-[10px] uppercase`} colSpan={2}>Total</td><td className={`${cell} text-right text-[11px]`}>₱ {d.paidTotal ? peso(d.paidTotal) : ""}</td></tr>
          </tbody>
        </table>
        <div className="flex-1 pl-2 text-[11px] leading-5">
          Received from <span className="font-semibold underline">{d.companyName}</span> the amount of{" "}
          <span className="font-semibold underline">{d.amount ? d.amountInWords : "________________________________"}</span> ( ₱ <span className="font-semibold underline">{d.amount ? peso(d.amount) : "__________"}</span> ) in payment of the account described herein.
          <div className="mt-7 border-b border-gray-800" />
          <div className="text-center text-[9px] uppercase">Printed name over signature</div>
          <div className="mt-2">Date ______________________</div>
        </div>
      </div>

      <div className="mt-3 flex items-end justify-end gap-2">
        {d.status && d.status !== "Posted" && d.status !== "Paid" && d.status !== "Partially Paid" && <span className="mr-auto text-[10px] uppercase text-gray-400">{d.status}</span>}
        <span className="text-[10px] uppercase text-gray-600">DVN</span>
        <span className="font-mono text-lg font-bold text-red-600">{d.padRef || d.dvNo || "—"}</span>
        {d.padRef && d.dvNo && <span className="text-[10px] text-gray-500">({d.dvNo})</span>}
      </div>
    </div>
  );
}
