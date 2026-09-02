import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { getSalesJournal, parseRange } from "@/lib/reports";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";

type SP = {
  from?: string; to?: string; company?: string;
  customer?: string; product?: string; salesperson?: string; tx?: string; q?: string;
};

export default async function SalesJournalPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePerm("reports");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const fromStr = range.from.toISOString().slice(0, 10);
  const toStr = range.to.toISOString().slice(0, 10);

  const txStatus = ["Posted", "Void"].includes(searchParams.tx || "") ? searchParams.tx! : "";
  const q = searchParams.q?.trim() || "";

  const [customers, products, staff] = await Promise.all([
    prisma.customer.findMany({ orderBy: { businessName: "asc" }, select: { id: true, businessName: true } }),
    prisma.product.findMany({
      where: { companyId: { in: scope.ids } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, sku: true },
    }),
    prisma.user.findMany({ where: { role: { not: "DEALER" } }, orderBy: { name: "asc" }, select: { name: true } }),
  ]);
  const customerId = customers.some((c) => c.id === searchParams.customer) ? searchParams.customer! : "";
  const productId = products.some((p) => p.id === searchParams.product) ? searchParams.product! : "";
  const salesperson = staff.some((s) => s.name === searchParams.salesperson) ? searchParams.salesperson! : "";

  const j = await getSalesJournal(range, scope.ids, {
    customerId: customerId || undefined,
    productId: productId || undefined,
    salesperson: salesperson || undefined,
    txStatus: txStatus || undefined,
    q: q || undefined,
  });

  const qs = new URLSearchParams({ from: fromStr, to: toStr, company: scope.value });
  if (customerId) qs.set("customer", customerId);
  if (productId) qs.set("product", productId);
  if (salesperson) qs.set("salesperson", salesperson);
  if (txStatus) qs.set("tx", txStatus);
  if (q) qs.set("q", q);

  const summaryName = scope.combined ? "Combined" : scope.company.companyName.replace(/\s*(Trading Corp\.?|Corporation)\s*$/i, "").trim();

  return (
    <div className="print-page">
      <PageHeader title="Sales Journal">
        <a href={`/api/export/sales-journal?${qs.toString()}`} className="btn-secondary no-print">⬇ Excel</a>
        <span className="no-print"><PrintButton /></span>
      </PageHeader>

      <form method="GET" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div><label className="label">From</label><input type="date" name="from" defaultValue={fromStr} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={toStr} className="input" /></div>
        <div>
          <label className="label">Customer</label>
          <select name="customer" defaultValue={customerId} className="input max-w-[190px]">
            <option value="">All customers</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.businessName}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Product</label>
          <select name="product" defaultValue={productId} className="input max-w-[200px]">
            <option value="">All products</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Salesperson</label>
          <select name="salesperson" defaultValue={salesperson} className="input max-w-[170px]">
            <option value="">All salespersons</option>
            {staff.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Transaction</label>
          <select name="tx" defaultValue={txStatus} className="input max-w-[130px]">
            <option value="">All</option>
            <option>Posted</option>
            <option>Void</option>
          </select>
        </div>
        <div>
          <label className="label">Search</label>
          <input name="q" defaultValue={q} placeholder="Invoice # or customer…" className="input max-w-[190px]" />
        </div>
        <button className="btn-secondary" type="submit">Apply</button>
      </form>

      <p className="mb-3 text-sm text-gray-600">
        <span className="font-semibold">{scope.label}</span> · {fmtDate(range.from)} – {fmtDate(range.to)} ·{" "}
        {j.invoiceCount} invoice{j.invoiceCount === 1 ? "" : "s"} · {j.rows.length} entr{j.rows.length === 1 ? "y" : "ies"}
        {j.voidedCount > 0 && <span className="text-red-600"> · {j.voidedCount} voided entr{j.voidedCount === 1 ? "y" : "ies"} excluded from totals</span>}
      </p>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1240px] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Date</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Invoice No.</th>
              <th className="table-th">Customer</th>
              <th className="table-th">Reference</th>
              <th className="table-th">Product</th>
              <th className="table-th text-right">Qty</th>
              <th className="table-th text-right">Unit Price</th>
              <th className="table-th text-right">Gross Sales</th>
              <th className="table-th text-right">Freight</th>
              <th className="table-th text-right">Net Sales</th>
              <th className="table-th">Payment</th>
              <th className="table-th">Salesperson</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {j.rows.map((r) => (
              <tr key={r.key} className={r.transactionStatus === "Void" ? "bg-red-50/60 text-gray-500 line-through" : "hover:bg-gray-50"}>
                <td className="table-td whitespace-nowrap text-sm">{fmtDate(r.date)}</td>
                {scope.combined && <td className="table-td"><CompanyTag name={r.company} /></td>}
                <td className="table-td">
                  <Link href={`/invoices/${r.invoiceId}`} className="font-mono text-sm font-medium text-emerald-700 hover:underline">{r.invoiceNo}</Link>
                </td>
                <td className="table-td text-sm">{r.customer}</td>
                <td className="table-td font-mono text-xs text-gray-500">{r.reference}</td>
                <td className={`table-td text-sm ${r.productId ? "" : "italic text-gray-500"}`}>{r.product}</td>
                <td className="table-td whitespace-nowrap text-right text-sm">{r.qty || "—"}</td>
                <td className="table-td text-right text-sm">{r.unitPrice != null ? peso(r.unitPrice) : "—"}</td>
                <td className="table-td text-right">{peso(r.gross)}</td>
                <td className="table-td text-right text-gray-600">{r.freight ? peso(r.freight) : "—"}</td>
                <td className="table-td text-right font-semibold">{peso(r.net)}</td>
                <td className="table-td text-xs">{r.paymentStatus}</td>
                <td className="table-td text-xs text-gray-600">{r.salesperson}</td>
                <td className="table-td"><StatusBadge status={r.transactionStatus} /></td>
              </tr>
            ))}
            {!j.rows.length && (
              <tr><td colSpan={scope.combined ? 14 : 13} className="p-8 text-center text-sm text-gray-500">No sales in this period for the selected filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ------------------------------------------------- sales summary */}
      <div className="mt-4 flex justify-end">
        <table className="w-full max-w-md text-sm">
          <tbody>
            {scope.combined &&
              j.byCompany.map((c) => (
                <tr key={c.name} className="border-b border-gray-100">
                  <td className="py-1.5 pr-4 text-gray-600">{c.name} Net Sales</td>
                  <td className="py-1.5 text-right">{peso(c.net)}</td>
                </tr>
              ))}
            <tr className="border-b border-gray-200">
              <td className="py-2 pr-4 font-semibold">{summaryName} Gross Sales</td>
              <td className="py-2 text-right font-semibold">{peso(j.totals.gross)}</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-2 pr-4 text-gray-600">Less: Freight Charge</td>
              <td className="py-2 text-right text-gray-600">({peso(j.totals.freight)})</td>
            </tr>
            <tr className="border-t-2 border-emerald-800">
              <td className="py-2 pr-4 text-base font-bold">{summaryName} Net Sales</td>
              <td className="py-2 text-right text-base font-bold text-emerald-800">{peso(j.totals.net)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-gray-500">
        Entries are generated from posted Sales Invoices and update automatically when an invoice changes or is voided.
        The journal cannot be edited directly.
      </p>
    </div>
  );
}
