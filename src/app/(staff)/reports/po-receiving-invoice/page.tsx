import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { parseRange } from "@/lib/reports";
import { getThreeWayMatch } from "@/lib/purchasing-reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { SearchSelect } from "@/components/search-select";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const tone: Record<string, string> = {
  "Not received": "text-gray-500", "Partly received": "text-amber-700", "Received, unbilled": "text-amber-700",
  "Partly billed": "text-amber-700", Billed: "text-emerald-700", "Over-billed": "text-red-600",
};

export default async function ThreeWayMatchPage({ searchParams }: { searchParams: { from?: string; to?: string; company?: string; supplier?: string; open?: string } }) {
  const user = await requireReport("po-receiving-invoice");
  const scope = await resolveReportScope(user, searchParams.company);
  const now = new Date();
  const range = parseRange({ from: searchParams.from ?? ymd(new Date(now.getFullYear(), 0, 1)), to: searchParams.to });
  const supplier = searchParams.supplier ? await prisma.supplier.findUnique({ where: { id: searchParams.supplier }, select: { id: true, name: true } }) : null;
  const onlyOpen = searchParams.open === "1";
  const rep = await getThreeWayMatch(range, scope.ids, { supplierId: supplier?.id, onlyOpen });
  const fromStr = ymd(range.from);
  const toStr = ymd(range.to);
  const qs = new URLSearchParams({ from: fromStr, to: toStr, company: scope.value });
  if (supplier) qs.set("supplier", supplier.id);
  if (onlyOpen) qs.set("open", "1");

  return (
    <div className="print-page">
      <PageHeader title="PO vs Receiving vs Invoice">
        {user.canExport && <a href={`/api/export/po-receiving-invoice?${qs.toString()}`} className="btn-secondary no-print">⬇ Excel</a>}
        {user.canPrint && <span className="no-print"><PrintButton /></span>}
      </PageHeader>
      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">PO date from</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <div className="w-60"><label className="label">Supplier</label><SearchSelect entity="suppliers" name="supplier" placeholder="All suppliers" defaultValue={supplier ? { id: supplier.id, label: supplier.name } : null} submitOnSelect /></div>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="open" value="1" defaultChecked={onlyOpen} /> only lines not fully billed</label>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>
      <p className="mb-4 text-sm text-gray-600">
        <span className="font-semibold">{scope.label}</span> · orders dated {fmtDate(range.from)} – {fmtDate(range.to)} · {rep.rows.length} line(s) · Ordered {peso(rep.totals.ordered)} · Received {peso(rep.totals.received)} · Invoiced{" "}
        {peso(rep.totals.billed)} (landed {peso(rep.totals.landed)})
      </p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1200px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">PO</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Supplier</th>
              <th className="table-th">Product</th>
              <th className="table-th text-right">Ordered</th>
              <th className="table-th text-right">@</th>
              <th className="table-th text-right">Received</th>
              <th className="table-th text-right">Value</th>
              <th className="table-th text-right">Invoiced</th>
              <th className="table-th text-right">Value</th>
              <th className="table-th text-right">Qty var.</th>
              <th className="table-th text-right">Cost var.</th>
              <th className="table-th">Documents</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rep.rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="table-td"><Link href={`/purchase-orders/${r.poId}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{r.poNumber}</Link><span className="block text-xs text-gray-500">{fmtDate(r.poDate)}</span></td>
                {scope.combined && <td className="table-td"><CompanyTag name={r.company} /></td>}
                <td className="table-td text-sm">{r.supplier}</td>
                <td className="table-td text-sm">{r.product}<span className="block text-xs text-gray-500">{r.sku}</span></td>
                <td className="table-td text-right">{r.orderedQty.toLocaleString()} <span className="text-xs text-gray-400">{r.unit === "CARTON" ? "CTN" : "PCS"}</span></td>
                <td className="table-td text-right text-sm">{peso(r.orderedCost)}</td>
                <td className="table-td text-right">{r.receivedQty.toLocaleString()}</td>
                <td className="table-td text-right text-sm">{peso(r.receivedValue)}</td>
                <td className="table-td text-right">{r.billedQty.toLocaleString()}</td>
                <td className="table-td text-right text-sm">{peso(r.billedValue)}</td>
                <td className={`table-td text-right ${r.qtyVariance > 0 ? "font-semibold text-red-600" : r.qtyVariance < 0 ? "text-amber-700" : "text-gray-300"}`}>{r.qtyVariance ? (r.qtyVariance > 0 ? "+" : "") + r.qtyVariance : "—"}</td>
                <td className={`table-td text-right text-sm ${Math.abs(r.costVariance) > 0.004 ? (r.costVariance > 0 ? "text-red-600" : "text-emerald-700") : "text-gray-300"}`}>{Math.abs(r.costVariance) > 0.004 ? peso(r.costVariance) : "—"}</td>
                <td className="table-td font-mono text-[11px] text-gray-600">{[...r.receipts, ...r.bills].join(", ") || "—"}</td>
                <td className={`table-td text-xs font-semibold ${tone[r.status]}`}>{r.status}</td>
              </tr>
            ))}
            {!rep.rows.length && <tr><td colSpan={scope.combined ? 14 : 13} className="p-8 text-center text-sm text-gray-500">No purchase order lines in this range.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">Qty variance = invoiced − received. Cost variance = invoiced product cost − (invoiced qty × PO unit cost); freight is shown in the landed total, not here.</p>
    </div>
  );
}
