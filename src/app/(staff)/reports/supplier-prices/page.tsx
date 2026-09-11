import { prisma } from "@/lib/db";
import { requireReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { parseRange } from "@/lib/reports";
import { getSupplierPriceHistory } from "@/lib/purchasing-reports";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { SearchSelect } from "@/components/search-select";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const p4 = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

export default async function SupplierPricesPage({ searchParams }: { searchParams: { from?: string; to?: string; company?: string; supplier?: string; product?: string } }) {
  const user = await requireReport("supplier-prices");
  const scope = await resolveReportScope(user, searchParams.company);
  const now = new Date();
  const range = parseRange({ from: searchParams.from ?? ymd(new Date(now.getFullYear() - 2, now.getMonth(), now.getDate())), to: searchParams.to });
  const supplier = searchParams.supplier ? await prisma.supplier.findUnique({ where: { id: searchParams.supplier }, select: { id: true, name: true } }) : null;
  const product = searchParams.product ? await prisma.product.findFirst({ where: { id: searchParams.product, companyId: { in: scope.ids } }, select: { id: true, name: true, sku: true } }) : null;
  const rep = await getSupplierPriceHistory(range, scope.ids, { supplierId: supplier?.id, productId: product?.id });
  const fromStr = ymd(range.from);
  const toStr = ymd(range.to);
  const qs = new URLSearchParams({ from: fromStr, to: toStr, company: scope.value });
  if (supplier) qs.set("supplier", supplier.id);
  if (product) qs.set("product", product.id);

  return (
    <div className="print-page">
      <PageHeader title="Supplier Price History">
        {user.canExport && <a href={`/api/export/supplier-prices?${qs.toString()}`} className="btn-secondary no-print">⬇ Excel</a>}
        {user.canPrint && <span className="no-print"><PrintButton /></span>}
      </PageHeader>
      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <div className="w-56"><label className="label">Supplier</label><SearchSelect entity="suppliers" name="supplier" placeholder="All suppliers" defaultValue={supplier ? { id: supplier.id, label: supplier.name } : null} submitOnSelect /></div>
        <div className="w-64"><label className="label">Product</label><SearchSelect entity="products" name="product" placeholder="All products" params={scope.combined ? {} : { company: scope.ids[0] }} defaultValue={product ? { id: product.id, label: product.name, sub: product.sku } : null} submitOnSelect /></div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>
      <p className="mb-4 text-sm text-gray-600"><span className="font-semibold">{scope.label}</span> · {fmtDate(range.from)} – {fmtDate(range.to)} · {rep.rows.length} product–supplier pair(s) · prices per PIECE, the invoiced price where there is one</p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1000px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Product</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Supplier</th>
              <th className="table-th text-right">First</th>
              <th className="table-th text-right">Last</th>
              <th className="table-th text-right">Change</th>
              <th className="table-th text-right">Lowest</th>
              <th className="table-th text-right">Highest</th>
              <th className="table-th">Last on</th>
              <th className="table-th">History (order · receipt · invoice)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rep.rows.map((r) => (
              <tr key={`${r.supplierId}:${r.productId}`} className="align-top hover:bg-gray-50">
                <td className="table-td text-sm">{r.product}<span className="block text-xs text-gray-500">{r.sku} · {r.packSize}</span></td>
                {scope.combined && <td className="table-td"><CompanyTag name={r.company} /></td>}
                <td className="table-td text-sm">{r.supplier}</td>
                <td className="table-td text-right text-sm">{p4(r.first)}</td>
                <td className="table-td text-right font-semibold">{p4(r.last)}</td>
                <td className={`table-td text-right text-sm ${r.changePct == null ? "text-gray-300" : r.changePct > 0 ? "text-red-600" : r.changePct < 0 ? "text-emerald-700" : ""}`}>{r.changePct == null ? "—" : `${r.changePct > 0 ? "+" : ""}${r.changePct.toFixed(1)}%`}</td>
                <td className="table-td text-right text-sm">{p4(r.lowest)}</td>
                <td className="table-td text-right text-sm">{p4(r.highest)}</td>
                <td className="table-td text-sm">{fmtDate(r.lastDate)}</td>
                <td className="table-td text-[11px] text-gray-600">
                  {r.events.map((e, i) => (
                    <span key={i} className="mr-2 inline-block whitespace-nowrap">
                      <span className={e.kind === "Bill" ? "font-semibold text-violet-700" : e.kind === "Receipt" ? "text-amber-700" : "text-gray-500"}>{e.kind === "PO" ? "order" : e.kind === "Receipt" ? "receipt" : "invoice"}</span>{" "}
                      {fmtDate(e.date)} {p4(e.costPerPcs)}{e.landedPerPcs != null && Math.abs(e.landedPerPcs - e.costPerPcs) > 0.004 ? ` (landed ${p4(e.landedPerPcs)})` : ""}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
            {!rep.rows.length && <tr><td colSpan={scope.combined ? 10 : 9} className="p-8 text-center text-sm text-gray-500">No purchases in this range.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
