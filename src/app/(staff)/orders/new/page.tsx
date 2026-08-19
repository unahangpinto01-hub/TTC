import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { encodeOrder } from "../actions";
import { EncodeLines } from "./encode-lines";

export default async function EncodeOrderPage({ searchParams }: { searchParams: { error?: string } }) {
  await requirePerm("orders");
  const [customers, products] = await Promise.all([
    prisma.customer.findMany({ where: { status: "Active" }, orderBy: { businessName: "asc" } }),
    prisma.product.findMany({
      where: { status: "Active" },
      orderBy: { name: "asc" },
      select: { id: true, sku: true, name: true, dealerPrice: true, cartonDealerPrice: true, piecesPerCarton: true, stockQty: true },
    }),
  ]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Encode Order (Messenger / Text)" />
      {searchParams.error === "empty" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Add at least one line with a quantity.</p>
      )}
      {searchParams.error === "nocarton" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          A line was set to CARTON for a product with no pieces-per-carton configured. Set it on the product first, or order in PCS.
        </p>
      )}
      <form action={encodeOrder} className="card space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label">Customer</label>
            <select name="customerId" required className="input">
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.businessName} ({c.region})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Source</label>
            <select name="source" className="input">
              <option value="MESSENGER">Messenger</option>
              <option value="TEXT">Text / SMS</option>
            </select>
          </div>
          <div>
            <label className="label">Payment Term</label>
            <select name="term" className="input">
              <option value="COD">COD</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Notes</label>
            <input name="notes" className="input" placeholder="e.g. screenshot from FB dated Aug 14" />
          </div>
        </div>
        <EncodeLines products={products} />
        <button className="btn-primary" type="submit">Save Incoming Order</button>
      </form>
    </div>
  );
}
