import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { getMovements, parseRange } from "@/lib/reports";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { displayCartonSize, ctnValue } from "@/lib/units";
import { CtnEquiv } from "@/components/qty";

export default async function InventoryReportPage({ searchParams }: { searchParams: { from?: string; to?: string; company?: string } }) {
  const user = await requirePerm("reports");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const moves = await getMovements(range, scope.ids);
  const fromStr = range.from.toISOString().slice(0, 10);
  const toStr = range.to.toISOString().slice(0, 10);
  const totalIn = moves.filter((m) => m.type === "IN").reduce((s, m) => s + m.qty, 0);
  const totalOut = moves.filter((m) => m.type === "OUT").reduce((s, m) => s + m.qty, 0);
  // each movement converts at its own product's packaging, never one blanket divisor
  const ctnOf = (rows: typeof moves) =>
    rows.reduce((s, x) => s + (ctnValue(Math.abs(x.qty), displayCartonSize(x.product)) ?? 0), 0);
  const inCtn = ctnOf(moves.filter((x) => x.type === "IN"));
  const outCtn = ctnOf(moves.filter((x) => x.type === "OUT"));
  const ctn = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 2 });

  return (
    <div className="print-page">
      <PageHeader title="Inventory Movement Report">
        <a href={`/api/export/inventory-movement?from=${fromStr}&to=${toStr}&company=${scope.value}`} className="btn-secondary no-print">⬇ Movements Excel</a>
        <a href={`/api/export/stock-on-hand?company=${scope.value}`} className="btn-secondary no-print">⬇ Stock on Hand Excel</a>
        <span className="no-print"><PrintButton /></span>
      </PageHeader>

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <p className="mb-4 text-sm text-gray-600">
        {fmtDate(range.from)} – {fmtDate(range.to)} · IN:{" "}
        <span className="font-bold text-emerald-700">+{totalIn.toLocaleString()} PCS ({ctn(inCtn)} CTN)</span> · OUT:{" "}
        <span className="font-bold text-red-600">−{totalOut.toLocaleString()} PCS ({ctn(outCtn)} CTN)</span> ·{" "}
        {moves.length} movement(s) shown (max 500)
      </p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[940px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Date</th>
              <th className="table-th">Product</th>
              <th className="table-th">Type</th>
              <th className="table-th text-right">Qty (PCS)</th>
              <th className="table-th text-right">Equivalent (CTN)</th>
              <th className="table-th text-right">Balance (PCS)</th>
              <th className="table-th text-right">Balance (CTN)</th>
              <th className="table-th">Ref</th>
              <th className="table-th">User</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {moves.map((m) => (
              <tr key={m.id}>
                <td className="table-td text-sm">{fmtDate(m.date)}</td>
                <td className="table-td text-sm"><span className="font-mono text-xs text-gray-400">{m.product.sku}</span> {m.product.name}</td>
                <td className={`table-td font-semibold ${m.type === "IN" ? "text-emerald-700" : m.type === "OUT" ? "text-red-600" : "text-amber-600"}`}>{m.type}</td>
                <td className="table-td text-right">
                  {m.type === "OUT" || m.qty < 0 ? "−" : "+"}{Math.abs(m.qty).toLocaleString()}
                </td>
                <td className="table-td text-right text-sm">
                  {/* a carton-entered movement keeps the conversion it was posted under */}
                  <CtnEquiv
                    basePcs={Math.abs(m.qty)}
                    ppc={m.enteredUnit === "CARTON" && m.enteredQty ? Math.abs(m.qty) / m.enteredQty : displayCartonSize(m.product)}
                  />
                </td>
                <td className="table-td text-right">{m.balanceAfter.toLocaleString()}</td>
                <td className="table-td text-right text-sm text-gray-600">
                  <CtnEquiv basePcs={m.balanceAfter} ppc={displayCartonSize(m.product)} showLoose={false} />
                </td>
                <td className="table-td text-xs text-gray-500">{`${m.refType ?? ""} ${m.refNo ?? ""}`.trim()}</td>
                <td className="table-td text-sm text-gray-600">{m.user?.name ?? "—"}</td>
              </tr>
            ))}
            {!moves.length && <tr><td colSpan={9} className="p-8 text-center text-sm text-gray-500">No movements in range.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
