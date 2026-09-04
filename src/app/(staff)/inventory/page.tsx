import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { peso, fmtDate, daysUntil, EXPIRY_WARN_DAYS } from "@/lib/format";
import { displayCartonSize } from "@/lib/units";
import { CtnEquiv } from "@/components/qty";
import { getPage, pageCount, PAGE_SIZE } from "@/lib/paginate";
import { PageHeader, Pagination, StatusBadge, stockStatus } from "@/components/ui";
import { renameParentItem, ungroupParentItem } from "./actions";
import { InventorySearchBar } from "./search-bar";
import { getActiveCompany } from "@/lib/company";
import { getCategoryNames } from "@/lib/categories";


export default async function InventoryPage({ searchParams }: { searchParams: { q?: string; category?: string; class?: string; stock?: string; page?: string; renameParent?: string } }) {
  const user = await requirePerm("inventory");
  const company = await getActiveCompany(user);
  const categoryNames = await getCategoryNames();
  const { page, skip, take } = getPage(searchParams);
  const q = searchParams.q?.trim() || "";
  const category = searchParams.category || "";
  const itemClass = searchParams.class || "";
  const stockFilter = searchParams.stock || "";

  const where: any = { companyId: company.id };
  if (itemClass === "INVENTORY" || itemClass === "NON_INVENTORY") where.itemClass = itemClass;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { sku: { contains: q, mode: "insensitive" } },
      { activeIngredient: { contains: q, mode: "insensitive" } },
      { parentItem: { contains: q, mode: "insensitive" } },
      { packSize: { contains: q, mode: "insensitive" } },
    ];
  }
  if (category) where.category = category;
  if (stockFilter === "out") where.stockQty = { lte: 0 };

  // grouped ordering: parented products cluster under their parent label, standalone rows follow by SKU
  const orderBy: any = [{ parentItem: { sort: "asc", nulls: "last" } }, { sku: "asc" }];
  let products, total;
  if (q || stockFilter === "low") {
    // fetch all matches: "low" needs a cross-column filter, and search prioritizes SKU-prefix hits
    const all = await prisma.product.findMany({ where, orderBy, include: { supplier: true } });
    let filtered = stockFilter === "low" ? all.filter((p) => p.stockQty > 0 && p.stockQty <= p.reorderPoint) : all;
    if (q) {
      const ql = q.toLowerCase();
      filtered = [
        ...filtered.filter((p) => p.sku.toLowerCase().startsWith(ql)),
        ...filtered.filter((p) => !p.sku.toLowerCase().startsWith(ql)),
      ];
    }
    total = filtered.length;
    products = filtered.slice(skip, skip + take);
  } else {
    [products, total] = await Promise.all([
      prisma.product.findMany({ where, orderBy, skip, take, include: { supplier: true } }),
      prisma.product.count({ where }),
    ]);
  }

  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (category) params.category = category;
  if (stockFilter) params.stock = stockFilter;

  const canEdit = user.perm === "READ_WRITE";

  return (
    <div>
      <PageHeader title="Products / Inventory">
        {canEdit && (
          <>
            <Link href="/inventory/import" className="btn-secondary">⬆ Bulk Import</Link>
            <Link href="/inventory/new" className="btn-primary">+ New Product</Link>
          </>
        )}
      </PageHeader>

      <InventorySearchBar categories={categoryNames} />

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[800px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">SKU</th>
              <th className="table-th">Product</th>
              <th className="table-th">Category</th>
              <th className="table-th">Pack</th>
              <th className="table-th text-right">Dealer Price</th>
              <th className="table-th text-right">Stock (PCS)</th>
              <th className="table-th text-right">Equivalent (CTN)</th>
              <th className="table-th">Expiry</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {products.flatMap((p, i) => {
              const rows = [];
              const isSub = !!p.parentItem;
              // header row whenever a new parent group starts within this page
              if (isSub && p.parentItem !== products[i - 1]?.parentItem) {
                const count = products.filter((x) => x.parentItem === p.parentItem).length;
                const renaming = canEdit && searchParams.renameParent === p.parentItem;
                rows.push(
                  <tr key={`grp-${p.parentItem}`} className="bg-emerald-50/70">
                    <td colSpan={9} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-emerald-900">
                      {renaming ? (
                        <form action={renameParentItem} className="flex flex-wrap items-center gap-2 normal-case">
                          <span>📦</span>
                          <input type="hidden" name="from" value={p.parentItem!} />
                          <input name="to" defaultValue={p.parentItem!} required className="input w-56 py-1 text-xs font-normal" autoFocus />
                          <button className="btn-primary px-2 py-0.5 text-xs" type="submit">Save</button>
                          <Link href="/inventory" className="btn-secondary px-2 py-0.5 text-xs font-normal">Cancel</Link>
                        </form>
                      ) : (
                        <span className="flex flex-wrap items-center gap-2">
                          📦 {p.parentItem}
                          <span className="font-normal normal-case text-emerald-700">· {count} pack size{count > 1 ? "s" : ""}</span>
                          {canEdit && (
                            <span className="ml-2 flex items-center gap-2 font-normal normal-case">
                              <Link href={`/inventory?renameParent=${encodeURIComponent(p.parentItem!)}`} className="text-emerald-700 hover:underline">
                                ✎ edit
                              </Link>
                              <form action={ungroupParentItem} className="inline">
                                <input type="hidden" name="from" value={p.parentItem!} />
                                <button className="text-red-500 hover:underline" type="submit">ungroup</button>
                              </form>
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              }
              rows.push(
              <tr key={p.id} className="hover:bg-gray-50">
                <td className={`table-td font-mono text-xs ${isSub ? "pl-6" : ""}`}>{p.sku}</td>
                <td className="table-td">
                  <span className={isSub ? "pl-3 text-gray-400" : "hidden"}>↳ </span>
                  <Link href={`/inventory/${p.id}`} className="font-medium text-emerald-700 hover:underline">{p.name}</Link>
                  {p.itemClass === "NON_INVENTORY" && (
                    <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">PROMO</span>
                  )}
                  <p className={`text-xs text-gray-500 ${isSub ? "pl-7" : ""}`}>{p.activeIngredient}</p>
                </td>
                <td className="table-td text-sm text-gray-600">{p.category}</td>
                <td className="table-td">{p.packSize}</td>
                <td className="table-td text-right">{peso(p.dealerPrice)}</td>
                <td className="table-td text-right font-semibold">{p.stockQty.toLocaleString()}</td>
                <td className="table-td text-right text-sm">
                  <CtnEquiv basePcs={p.stockQty} ppc={displayCartonSize(p)} />
                </td>
                <td className="table-td">
                  {p.expDate ? (
                    (() => {
                      const days = daysUntil(p.expDate);
                      const danger = days < EXPIRY_WARN_DAYS;
                      return (
                        <div className={danger ? "font-semibold text-red-600" : "text-gray-600"}>
                          <p className="text-sm">{fmtDate(p.expDate)}</p>
                          <p className="text-xs">
                            {days < 0 ? `EXPIRED ${-days}d ago` : `${days}d left`}
                            {danger && days >= 0 ? " ⚠" : ""}
                          </p>
                        </div>
                      );
                    })()
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </td>
                <td className="table-td"><StatusBadge status={stockStatus(p.stockQty, p.reorderPoint)} /></td>
              </tr>
              );
              return rows;
            })}
            {!products.length && (
              <tr>
                <td colSpan={9} className="p-8 text-center text-sm text-gray-500">
                  {q ? <>No products found for &ldquo;{q}&rdquo;.</> : "No products match your filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={pageCount(total)} baseUrl="/inventory" params={params} />
      <p className="mt-2 text-xs text-gray-500">{total} products · showing {PAGE_SIZE} per page</p>
    </div>
  );
}
