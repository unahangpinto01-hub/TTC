import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { peso, fmtDate, daysUntil, EXPIRY_WARN_DAYS } from "@/lib/format";
import { PageHeader, StatusBadge, stockStatus } from "@/components/ui";
import { adjustStock, updateBatchInfo } from "../actions";
import { ParentItemField } from "../parent-item-field";

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  const user = await requirePerm("inventory");
  const product = await prisma.product.findUnique({
    where: { id: params.id },
    include: { supplier: true },
  });
  if (!product) notFound();
  const moves = await prisma.stockMovement.findMany({
    where: { productId: product.id },
    orderBy: { date: "desc" },
    take: 100,
    include: { user: { select: { name: true } } },
  });
  const parentOptions = (
    await prisma.product.findMany({
      where: { parentItem: { not: null } },
      select: { parentItem: true },
      distinct: ["parentItem"],
      orderBy: { parentItem: "asc" },
    })
  ).map((p) => p.parentItem!);
  const canEdit = user.perm === "READ_WRITE";

  return (
    <div>
      <PageHeader title={product.name}>
        <StatusBadge status={stockStatus(product.stockQty, product.reorderPoint)} />
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["SKU", product.sku],
          ["Category", product.category],
          ["Active Ingredient", product.activeIngredient],
          ["Pack Size", product.packSize],
          ["Crops", product.cropTags.split(",").join(", ")],
          ["Supplier", product.supplier?.name ?? "—"],
          ["Unit Cost", peso(product.unitCost)],
          ["Dealer Price", peso(product.dealerPrice)],
          ["SRP", peso(product.srp)],
          ["Reorder Point", String(product.reorderPoint)],
          ["Stock on Hand", String(product.stockQty)],
          ["Batch Number", product.batchNo ?? "—"],
          ["Manufacturing Date", product.mfgDate ? fmtDate(product.mfgDate) : "—"],
          ["Parent Item", product.parentItem ?? "—"],
        ].map(([k, v]) => (
          <div key={k} className="card py-3">
            <p className="text-xs text-gray-500">{k}</p>
            <p className="text-sm font-semibold">{v}</p>
          </div>
        ))}
        {(() => {
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

      {canEdit && (
        <form action={updateBatchInfo} className="card mb-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="productId" value={product.id} />
          <div>
            <label className="label">Batch Number</label>
            <input name="batchNo" defaultValue={product.batchNo ?? ""} className="input w-36" placeholder="B26-0001" />
          </div>
          <div>
            <label className="label">Manufacturing Date</label>
            <input name="mfgDate" type="date" defaultValue={product.mfgDate ? product.mfgDate.toISOString().slice(0, 10) : ""} className="input" />
          </div>
          <div>
            <label className="label">Expiration Date</label>
            <input name="expDate" type="date" defaultValue={product.expDate ? product.expDate.toISOString().slice(0, 10) : ""} className="input" />
          </div>
          <div>
            <label className="label">Parent Item (grouping)</label>
            <ParentItemField options={parentOptions} defaultValue={product.parentItem} />
          </div>
          <button className="btn-secondary" type="submit">Save Details</button>
        </form>
      )}

      {canEdit && (
        <form action={adjustStock} className="card mb-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="productId" value={product.id} />
          <div>
            <label className="label">Adjust Stock (+/−)</label>
            <input name="delta" type="number" className="input w-32" placeholder="+10 or -5" required />
          </div>
          <div className="flex-1">
            <label className="label">Reason</label>
            <input name="reason" className="input" placeholder="Physical count correction" />
          </div>
          <button className="btn-secondary" type="submit">Apply Adjustment</button>
        </form>
      )}

      <h2 className="mb-2 text-lg font-semibold">Stock Card</h2>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[640px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Date</th>
              <th className="table-th">Type</th>
              <th className="table-th">Reference</th>
              <th className="table-th text-right">Qty</th>
              <th className="table-th text-right">Balance</th>
              <th className="table-th">User</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {moves.map((m) => (
              <tr key={m.id}>
                <td className="table-td">{fmtDate(m.date)}</td>
                <td className="table-td">
                  <span className={`font-semibold ${m.type === "IN" ? "text-emerald-700" : m.type === "OUT" ? "text-red-600" : "text-amber-600"}`}>{m.type}</span>
                </td>
                <td className="table-td text-sm text-gray-600">{m.refType === "ADJUST" ? m.refNo : `${m.refType ?? ""} ${m.refNo ?? ""}`}</td>
                <td className="table-td text-right">{m.type === "OUT" ? "−" : "+"}{m.qty}</td>
                <td className="table-td text-right font-semibold">{m.balanceAfter}</td>
                <td className="table-td text-sm text-gray-600">{m.user?.name ?? "—"}</td>
              </tr>
            ))}
            {!moves.length && <tr><td colSpan={6} className="p-8 text-center text-sm text-gray-500">No stock movements yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
