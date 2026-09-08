import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { PageHeader } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { EncodeLines, type InitialLine } from "../../new/encode-lines";
import { updateIncomingOrder } from "../../actions";
import { orderEditBlocker } from "@/lib/orders";

/**
 * Amend an order still sitting in the inbox — the same form used to encode one, prefilled.
 *
 * The customer is deliberately fixed: an order raised against the wrong account is a
 * different transaction, not a correction, and should be encoded afresh.
 */
export default async function EditOrderPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string };
}) {
  const user = await requirePerm("orders");
  const company = await getActiveCompany(user);
  if (user.perm !== "READ_WRITE") redirect(`/orders/${params.id}`);

  const order = await prisma.incomingOrder.findUnique({
    where: { id: params.id },
    include: {
      customer: { select: { businessName: true } },
      lines: { include: { product: true }, orderBy: { id: "asc" } },
      salesOrders: { select: { soNumber: true } },
    },
  });
  if (!order || order.companyId !== company.id) notFound();

  // the same rule the action enforces — a converted order never reaches this form
  const blocker = orderEditBlocker(order);
  if (blocker) redirect(`/orders/${params.id}?error=locked`);

  const initial: InitialLine[] = order.lines.map((l) => ({
    id: l.productId,
    sku: l.product.sku,
    name: l.product.name,
    dealerPrice: l.product.dealerPrice,
    cartonDealerPrice: l.product.cartonDealerPrice,
    piecesPerCarton: l.product.piecesPerCarton,
    stockQty: l.product.stockQty,
    qty: l.qty,
    unit: l.unit,
  }));

  return (
    <div className="max-w-3xl">
      <Link href={`/orders/${order.id}`} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
        ← Back to the order
      </Link>
      <PageHeader title={`Edit Order ${order.orderNo ?? ""}`} />

      {searchParams.error === "empty" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          ⚠ Keep at least one line with a quantity — to remove the order entirely, cancel or delete it instead.
        </p>
      )}
      {searchParams.error === "nocarton" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          ⚠ A line was set to CARTON for a product with no pieces-per-carton configured. Set it on the product first, or
          order that line in PCS.
        </p>
      )}

      <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Prices are re-read from the product master when you save, exactly as encoding does. Negotiated pricing belongs on
        the sales order, which allows a price override while it is still a Draft.
      </p>

      <form action={updateIncomingOrder} className="card space-y-4">
        <input type="hidden" name="orderId" value={order.id} />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label">Customer</label>
            {/* fixed: re-pointing an order at a different account makes it a different
                transaction, so that is an encode, not an edit */}
            <SearchSelect
              entity="customers"
              defaultValue={{ id: order.customerId, label: order.customer.businessName }}
              placeholder={order.customer.businessName}
            />
            <p className="mt-0.5 text-xs text-gray-500">
              The customer cannot be changed here — encode a new order against the right account instead.
            </p>
          </div>
          <div>
            <label className="label">Source</label>
            <select name="source" defaultValue={order.source} className="input">
              <option value="MESSENGER">Messenger</option>
              <option value="TEXT">Text / SMS</option>
              <option value="PORTAL">Portal</option>
            </select>
          </div>
          <div>
            <label className="label">Order Date</label>
            <input
              name="orderDate"
              type="date"
              defaultValue={order.orderDate.toISOString().slice(0, 10)}
              max={new Date().toISOString().slice(0, 10)}
              className="input"
              title="When the transaction actually happened"
            />
          </div>
          <div>
            <label className="label">Payment Term</label>
            <select name="term" defaultValue={order.term} className="input">
              <option value="COD">COD</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
            </select>
          </div>
          <div>
            <label className="label">Freight Charge (₱ per carton)</label>
            <input
              name="freightPerCarton"
              type="number"
              min={0}
              step="0.01"
              defaultValue={order.freightPerCarton || ""}
              placeholder="0.00"
              className="input"
            />
            <p className="mt-0.5 text-xs text-gray-500">Recalculated on save: rate × cartons on CARTON lines.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Notes</label>
            <input name="notes" defaultValue={order.notes ?? ""} className="input" />
          </div>
        </div>

        <EncodeLines companyId={company.id} initial={initial} />

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" type="submit">Save Changes</button>
          <Link href={`/orders/${order.id}`} className="btn-secondary">Cancel</Link>
          <p className="text-xs text-gray-500">The change is recorded in the audit trail against your name.</p>
        </div>
      </form>
    </div>
  );
}
