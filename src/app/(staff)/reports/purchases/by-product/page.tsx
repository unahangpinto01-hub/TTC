import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireReport } from "@/lib/report-access";
import { resolveReportScope } from "@/lib/report-scope";
import { parseRange } from "@/lib/reports";
import { getPurchaseByProduct } from "@/lib/ap-reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { SearchSelect } from "@/components/search-select";
import { PurchaseNav } from "../purchase-nav";

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const peso4 = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export default async function PurchaseByProductPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; company?: string; supplier?: string };
}) {
  const user = await requireReport("purchases-by-product");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const supplierId = searchParams.supplier ?? "";
  const supplier = supplierId ? await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true } }) : null;
  const { rows, totals } = await getPurchaseByProduct(range, scope.ids, { supplierId: supplier?.id });
  const fromStr = ymd(range.from);
  const toStr = ymd(range.to);
  const qs = new URLSearchParams({ from: fromStr, to: toStr, company: scope.value });
  if (supplier) qs.set("supplier", supplier.id);

  return (
    <div className="print-page">
      <PageHeader title="Purchase by Product">
        {user.canExport && <a href={`/api/export/purchases-by-product?${qs.toString()}`} className="btn-secondary no-print">⬇ Excel</a>}
        {user.canPrint && <span className="no-print"><PrintButton /></span>}
      </PageHeader>
      <PurchaseNav active="product" qs={qs.toString()} />

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <div className="w-60">
          <label className="label">Supplier</label>
          <SearchSelect entity="suppliers" name="supplier" placeholder="All suppliers" defaultValue={supplier ? { id: supplier.id, label: supplier.name } : null} submitOnSelect />
        </div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <p className="mb-4 text-sm text-gray-600">
        <span className="font-semibold">{scope.label}</span> · {fmtDate(range.from)} – {fmtDate(range.to)} · {rows.length} product(s) · {totals.pcs.toLocaleString()} PCS · Product cost{" "}
        <span className="font-bold text-emerald-800">{peso(totals.productCost)}</span> + freight/other {peso(totals.freight)} = landed{" "}
        <span className="font-bold">{peso(totals.inventoryCost)}</span>
      </p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1000px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Product</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Category</th>
              <th className="table-th text-right">Bills</th>
              <th className="table-th text-right">PCS</th>
              <th className="table-th text-right">CTN</th>
              <th className="table-th text-right">Product Cost</th>
              <th className="table-th text-right">Freight / Other</th>
              <th className="table-th text-right">Landed Cost</th>
              <th className="table-th text-right">Avg / PC</th>
              <th className="table-th text-right">Last / PC</th>
              <th className="table-th">Last Bought</th>
              <th className="table-th">Suppliers</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.productId} className="hover:bg-gray-50">
                <td className="table-td">
                  <Link href={`/inventory/${r.productId}`} className="font-medium text-emerald-700 hover:underline">{r.name}</Link>
                  <p className="text-xs text-gray-500">{r.sku} · {r.packSize}</p>
                </td>
                {scope.combined && <td className="table-td"><CompanyTag name={r.company} /></td>}
                <td className="table-td text-sm text-gray-600">{r.category}</td>
                <td className="table-td text-right text-sm">{r.bills}</td>
                <td className="table-td text-right font-semibold">{r.pcs.toLocaleString()}</td>
                <td className="table-td text-right text-sm text-gray-600">{r.ctn === null ? <span className="text-amber-600" title="no carton conversion">N/A</span> : r.ctn.toLocaleString("en-PH", { maximumFractionDigits: 2 })}</td>
                <td className="table-td text-right">{peso(r.productCost)}</td>
                <td className={`table-td text-right ${r.freight ? "" : "text-gray-300"}`}>{r.freight ? peso(r.freight) : "—"}</td>
                <td className="table-td text-right font-semibold">{peso(r.inventoryCost)}</td>
                <td className="table-td text-right text-sm">{peso4(r.avgCostPerPcs)}</td>
                <td className="table-td text-right text-sm">{peso4(r.lastCostPerPcs)}</td>
                <td className="table-td text-sm">{r.lastDate ? fmtDate(r.lastDate) : "—"}</td>
                <td className="table-td text-xs text-gray-600">{r.suppliers.join(", ")}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={scope.combined ? 13 : 12} className="p-8 text-center text-sm text-gray-500">No posted supplier bills in this range.</td></tr>}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50 font-bold">
            <tr>
              <td className="table-td" colSpan={scope.combined ? 4 : 3}>{scope.combined ? "COMBINED GRAND TOTAL" : "TOTAL"}</td>
              <td className="table-td text-right">{totals.pcs.toLocaleString()}</td>
              <td />
              <td className="table-td text-right">{peso(totals.productCost)}</td>
              <td className="table-td text-right">{peso(totals.freight)}</td>
              <td className="table-td text-right text-emerald-800">{peso(totals.inventoryCost)}</td>
              <td colSpan={4} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
