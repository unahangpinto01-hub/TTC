import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { peso, fmtDate, daysUntil, EXPIRY_WARN_DAYS } from "@/lib/format";
import { unitDealerPrice, CARTON, displayCartonSize, ctnLabel, ctnLooseLabel, conversionNote } from "@/lib/units";
import { PageHeader, StatusBadge, stockStatus } from "@/components/ui";
import { ProductEditForm } from "./product-edit-form";
import { AdjustStockForm } from "./adjust-stock-form";
import { getActiveCompany } from "@/lib/company";
import { getCategoryNames } from "@/lib/categories";
import { CtnEquiv } from "@/components/qty";

export default async function ProductDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
  const user = await requirePerm("inventory");
  const company = await getActiveCompany(user);
  const product = await prisma.product.findUnique({
    where: { id: params.id },
    include: { supplier: true },
  });
  // company isolation: a record from another company is denied even via direct URL
  if (!product || product.companyId !== company.id) notFound();
  const moves = await prisma.stockMovement.findMany({
    where: { productId: product.id },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: 100,
    include: { user: { select: { name: true } } },
  });
  const parentOptions = (
    await prisma.product.findMany({
      where: { companyId: company.id, parentItem: { not: null } },
      select: { parentItem: true },
      distinct: ["parentItem"],
      orderBy: { parentItem: "asc" },
    })
  ).map((p) => p.parentItem!);
  const canEdit = user.perm === "READ_WRITE";
  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const suppliers = isSuperAdmin
    ? await prisma.supplier.findMany({ where: { status: "Active" }, orderBy: { name: "asc" }, select: { id: true, name: true } })
    : [];
  const categories = isSuperAdmin ? await getCategoryNames() : [];
  const ppc = displayCartonSize(product); // one conversion for the whole stock card

  return (
    <div>
      <Link href="/inventory" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
        ← Back to Products
      </Link>
      <PageHeader title={product.name}>
        <StatusBadge status={stockStatus(product.stockQty, product.reorderPoint)} />
      </PageHeader>

      {searchParams.error === "negative" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          ⚠ Adjustment rejected — it would make stock negative. Stock is {product.stockQty} PCS.
        </p>
      )}
      {searchParams.error === "nocarton" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          ⚠ This product has no pieces-per-carton configured — set it before adjusting in CARTON.
        </p>
      )}
      {searchParams.error === "noreason" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          ⚠ Adjustment rejected — a reason is required.
        </p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Classification", product.itemClass === "NON_INVENTORY" ? "Non-Inventory (promo)" : "Inventory item"],
          ["Category", product.category],
          ["SKU", product.sku],
          ["Active Ingredient", product.activeIngredient],
          ["Pack Size", product.packSize],
          ["Crops", product.cropTags.split(",").join(", ")],
          ["Supplier", product.supplier?.name ?? "—"],
          [
            "Unit Cost",
            // show extra decimals when the stored cost isn't clean at 2dp, so full precision is visible
            Math.round(product.unitCost * 100) / 100 === product.unitCost
              ? peso(product.unitCost)
              : `₱${product.unitCost.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`,
          ],
          ["Dealer Price (PCS)", peso(product.dealerPrice)],
          [
            "Packaging Conversion",
            conversionNote(product.piecesPerCarton) ?? "N/A — packaging setup incomplete ⚠",
          ],
          [
            "Dealer Price (Carton)",
            product.piecesPerCarton
              ? `${peso(unitDealerPrice(product, CARTON))}${product.cartonDealerPrice == null ? " (auto)" : ""}`
              : "—",
          ],
          [
            "Gross Weight per Pack",
            product.packGrossWeightKg ? `${product.packGrossWeightKg} kg` : "— (not set)",
          ],
          ["SRP", product.itemClass === "NON_INVENTORY" ? "— (promo item)" : peso(product.srp)],
          ["Reorder Point", `${product.reorderPoint} PCS`],
          ["Stock on Hand (PCS)", `${product.stockQty.toLocaleString()} PCS`],
          [
            "Equivalent (CTN)",
            (() => {
              const ppc = displayCartonSize(product);
              const label = ctnLabel(product.stockQty, ppc);
              if (!label) return "N/A — packaging setup incomplete ⚠";
              const loose = ctnLooseLabel(product.stockQty, ppc);
              return loose ? `${label}  (${loose})` : label;
            })(),
          ],
          ["Batch Number", product.batchNo ?? "—"],
          ["Manufacturing Date", product.mfgDate ? fmtDate(product.mfgDate) : "—"],
          ["Parent Item", product.parentItem ?? "—"],
        ].filter(
          ([k]) =>
            product.itemClass !== "NON_INVENTORY" ||
            // promo materials show only the basics
            ["Classification", "Category", "SKU", "Unit Cost", "Pack Size", "Reorder Point", "Stock on Hand (PCS)", "Equivalent (CTN)", "Packaging Conversion", "Gross Weight per Pack", "Batch Number", "Supplier"].includes(k as string)
        ).map(([k, v]) => (
          <div key={k} className="card py-3">
            <p className="text-xs text-gray-500">{k}</p>
            <p className="text-sm font-semibold">{v}</p>
          </div>
        ))}
        {product.itemClass !== "NON_INVENTORY" && (() => {
          if (!product.expDate) {
            return (
              <div className="card py-3">
                <p className="text-xs text-gray-500">Expiration Date</p>
                <p className="text-sm font-semibold">—</p>
              </div>
            );
          }
          const days = daysUntil(product.expDate);
          const danger = days < EXPIRY_WARN_DAYS;
          return (
            <div className={`card py-3 ${danger ? "border-red-300 bg-red-50" : ""}`}>
              <p className="text-xs text-gray-500">Expiration Date</p>
              <p className={`text-sm font-semibold ${danger ? "text-red-700" : ""}`}>{fmtDate(product.expDate)}</p>
              <p className={`text-xs font-semibold ${danger ? "text-red-600" : "text-gray-500"}`}>
                {days < 0 ? `EXPIRED ${-days} day(s) ago` : `${days} day(s) before expiration`}
                {danger && days >= 0 ? " ⚠ under 6 months" : ""}
              </p>
            </div>
          );
        })()}
      </div>

      {isSuperAdmin && (
        <ProductEditForm
          product={{
            id: product.id,
            sku: product.sku,
            name: product.name,
            activeIngredient: product.activeIngredient,
            category: product.category,
            itemClass: product.itemClass,
            cropTags: product.cropTags,
            packSize: product.packSize,
            unitCost: product.unitCost,
            dealerPrice: product.dealerPrice,
            srp: product.srp,
            reorderPoint: product.reorderPoint,
            piecesPerCarton: product.piecesPerCarton,
            cartonDealerPrice: product.cartonDealerPrice,
            packGrossWeightKg: product.packGrossWeightKg,
            supplierId: product.supplierId,
            batchNo: product.batchNo,
            mfgDate: product.mfgDate ? product.mfgDate.toISOString().slice(0, 10) : "",
            expDate: product.expDate ? product.expDate.toISOString().slice(0, 10) : "",
            parentItem: product.parentItem,
          }}
          suppliers={suppliers}
          parentOptions={parentOptions}
          categories={categories}
        />
      )}

      {canEdit && <AdjustStockForm productId={product.id} hasCarton={!!product.piecesPerCarton} />}

      <h2 className="mb-2 text-lg font-semibold">
        Stock Card
        {conversionNote(ppc) && <span className="ml-2 text-xs font-normal text-gray-500">({conversionNote(ppc)})</span>}
      </h2>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[820px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Date</th>
              <th className="table-th">Type</th>
              <th className="table-th">Reference</th>
              <th className="table-th text-right">Qty (PCS)</th>
              <th className="table-th text-right">Equivalent (CTN)</th>
              <th className="table-th text-right">Balance (PCS)</th>
              <th className="table-th text-right">Balance (CTN)</th>
              <th className="table-th">User</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {moves.map((m) => (
              <tr key={m.id}>
                <td className="table-td">
                  {fmtDate(m.date)}
                  {m.createdAt.toDateString() !== m.date.toDateString() && (
                    <p className="text-xs text-gray-400">entered {fmtDate(m.createdAt)}</p>
                  )}
                </td>
                <td className="table-td">
                  <span className={`font-semibold ${m.type === "IN" ? "text-emerald-700" : m.type === "OUT" ? "text-red-600" : "text-amber-600"}`}>{m.type}</span>
                </td>
                <td className="table-td text-sm text-gray-600">
                  {m.refType === "ADJUST" ? m.refNo : `${m.refType ?? ""} ${m.refNo ?? ""}`}
                  {m.supplierRef && <p className="text-xs text-gray-400">ref {m.supplierRef}</p>}
                </td>
                <td className="table-td text-right">
                  {m.type === "OUT" || m.qty < 0 ? "−" : "+"}{Math.abs(m.qty).toLocaleString()}
                </td>
                <td className="table-td text-right text-sm">
                  {/* a movement entered in cartons carries its own conversion, so a historical
                      row keeps the packaging that applied on the day it was posted */}
                  {(() => {
                    const moved = Math.abs(m.qty);
                    const historic =
                      m.enteredUnit === "CARTON" && m.enteredQty ? moved / m.enteredQty : ppc;
                    return <CtnEquiv basePcs={moved} ppc={historic} />;
                  })()}
                </td>
                <td className="table-td text-right font-semibold">{m.balanceAfter.toLocaleString()}</td>
                <td className="table-td text-right text-sm text-gray-600">
                  <CtnEquiv basePcs={m.balanceAfter} ppc={ppc} showLoose={false} />
                </td>
                <td className="table-td text-sm text-gray-600">{m.user?.name ?? "—"}</td>
              </tr>
            ))}
            {!moves.length && <tr><td colSpan={8} className="p-8 text-center text-sm text-gray-500">No stock movements yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
