import { Fragment } from "react";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { peso, fmtDateTime } from "@/lib/format";
import { getCategoryNames } from "@/lib/categories";
import { PrintButton, BackButton } from "@/components/print-button";
import { PriceListTable } from "./price-list-table";

type SP = {
  company?: string;
  category?: string;
  q?: string;
  sort?: string;
  inactive?: string;
};

const SORTS: Record<string, { label: string; order: any }> = {
  name: { label: "Product Name", order: [{ name: "asc" }] },
  category: { label: "Category", order: [{ category: "asc" }, { name: "asc" }] },
  srp: { label: "SRP (highest first)", order: [{ srp: "desc" }, { name: "asc" }] },
};

export default async function PriceListPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePerm("reports");
  const scope = await resolveReportScope(user, searchParams.company);
  const company = scope.company;

  const categories = await getCategoryNames();
  const category = searchParams.category || "";
  const q = searchParams.q?.trim() || "";
  const sortKey = SORTS[searchParams.sort ?? ""] ? searchParams.sort! : "name";
  const showInactive = searchParams.inactive === "1";

  const where: any = { companyId: { in: scope.ids } };
  if (!showInactive) where.status = "Active"; // discontinued products are out unless asked for
  if (category) where.category = category;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      { packSize: { contains: q, mode: "insensitive" } },
      { activeIngredient: { contains: q, mode: "insensitive" } },
    ];
  }
  const products = await prisma.product.findMany({
    where,
    orderBy: SORTS[sortKey].order,
    select: { id: true, sku: true, name: true, packSize: true, srp: true, category: true, status: true, itemClass: true, company: { select: { companyName: true } } },
  });

  const params = new URLSearchParams();
  params.set("company", scope.value);
  if (category) params.set("category", category);
  if (q) params.set("q", q);
  if (sortKey !== "name") params.set("sort", sortKey);
  if (showInactive) params.set("inactive", "1");

  const filters = [
    category || "All Categories",
    q ? `Search: "${q}"` : "All Products",
    `Sorted by ${SORTS[sortKey].label}`,
    showInactive ? "Including inactive" : "Active products only",
  ].join(" · ");

  const contact = [
    company.mobileNo && `Mobile ${company.mobileNo}`,
    company.telephoneNo && `Tel ${company.telephoneNo}`,
    company.email,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="print-page mx-auto max-w-[210mm]">
      {/* ---------------------------------------------------------- controls */}
      <div className="no-print mb-4 flex flex-wrap items-end justify-between gap-3">
        <BackButton />
        <div className="flex flex-wrap items-end gap-2">
          <form method="GET" className="flex flex-wrap items-end gap-2">
            <CompanyFilter scope={scope} className="max-w-[190px]" />
            <div>
              <label className="label">Category</label>
              <select name="category" defaultValue={category} className="input max-w-[170px]">
                <option value="">All categories</option>
                {categories.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Search Product</label>
              <input name="q" defaultValue={q} placeholder="Name, SKU, size…" className="input max-w-[180px]" />
            </div>
            <div>
              <label className="label">Sort by</label>
              <select name="sort" defaultValue={sortKey} className="input max-w-[160px]">
                {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <label className="mb-2 flex items-center gap-1.5 whitespace-nowrap text-sm text-gray-600">
              <input type="checkbox" name="inactive" value="1" defaultChecked={showInactive} />
              Include inactive
            </label>
            <button className="btn-secondary" type="submit">Apply</button>
          </form>
          <a href={`/api/export/price-list?${params.toString()}`} className="btn-secondary">⬇ Excel</a>
          <PrintButton />
        </div>
      </div>

      {/* ------------------------------------------------------- letterhead */}
      <header className="mb-5 flex items-start justify-between border-b-2 border-emerald-800 pb-4">
        <div className="flex items-center gap-3">
          {company.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logoDataUrl} alt="" className="h-16 w-16 shrink-0 object-contain" />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-800 text-2xl font-bold text-white">
              {(company.companyName || "T").charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-xl font-bold uppercase text-emerald-900">{scope.combined ? "All Companies" : company.companyName}</h1>
            {company.address && <p className="text-xs text-gray-500">{company.address}</p>}
            {contact && <p className="text-xs text-gray-500">{contact}</p>}
          </div>
        </div>
        <div className="text-right">
          <h2 className="text-lg font-bold uppercase tracking-wide text-gray-800">Product Price List</h2>
          <p className="text-xs text-gray-500">Generated {fmtDateTime(new Date())}</p>
          <p className="text-xs text-gray-500">{filters}</p>
        </div>
      </header>

      {products.length ? (
        <PriceListTable
          rows={products.map((p) => ({
            id: p.id,
            company: scope.combined ? p.company.companyName : "",
            sku: p.sku,
            name: p.name,
            size: p.packSize || "—",
            srp: p.srp,
            srpLabel: p.itemClass === "NON_INVENTORY" ? "—" : peso(p.srp),
            category: p.category,
            inactive: p.status !== "Active",
          }))}
          groupByCategory={!category && sortKey === "category"}
        />
      ) : (
        <p className="py-10 text-center text-sm text-gray-500">No products match these filters.</p>
      )}

      <footer className="mt-8 flex items-end justify-between border-t border-gray-200 pt-3 text-xs text-gray-500">
        <p>Prices are the current suggested retail price and are subject to change without prior notice.</p>
        <p className="whitespace-nowrap">Page 1 of 1</p>
      </footer>
    </div>
  );
}
