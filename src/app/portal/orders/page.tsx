import { prisma } from "@/lib/db";
import { requireDealer } from "@/lib/auth";
import { peso, fmtDate, termLabel } from "@/lib/format";

const STEPS = ["Pending", "Confirmed", "For Delivery", "Delivered", "Invoiced"];

function orderStep(orderStatus: string, soStatus?: string): number {
  if (orderStatus === "Cancelled") return -1;
  if (orderStatus === "Pending") return 0;
  // converted → follow the SO
  switch (soStatus) {
    case "Draft":
    case "Confirmed":
      return 1;
    case "Scheduled":
      return 2;
    case "Delivered":
      return 3;
    case "Invoiced":
    case "Closed":
      return 4;
    case "Cancelled":
      return -1;
    default:
      return 1;
  }
}

export default async function MyOrdersPage({ searchParams }: { searchParams: { placed?: string } }) {
  const user = await requireDealer();
  const [orders, receipts] = await Promise.all([
    prisma.incomingOrder.findMany({
      where: { customerId: user.customerId },
      orderBy: { createdAt: "desc" },
      include: { lines: { include: { product: true } }, salesOrders: { include: { schedule: true } } },
    }),
    prisma.salesReceipt.findMany({
      where: { customerId: user.customerId, status: { not: "Void" } },
      include: { payments: true },
    }),
  ]);

  const totalInvoiced = receipts.reduce((s, r) => s + r.amount, 0);
  const totalPaid = receipts.reduce((s, r) => s + r.payments.reduce((a, p) => a + p.amount, 0), 0);
  const balance = totalInvoiced - totalPaid;

  return (
    <div>
      {searchParams.placed && (
        <div className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
          ✔ Order placed! Our team has been notified and will confirm it shortly.
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">My Orders</h1>
        <div className="card px-4 py-2">
          <p className="text-xs text-gray-500">Outstanding Balance</p>
          <p className={`text-lg font-bold ${balance > 0 ? "text-red-600" : "text-emerald-700"}`}>{peso(balance)}</p>
        </div>
      </div>

      <div className="space-y-4">
        {orders.map((o) => {
          const so = o.salesOrders[0];
          const step = orderStep(o.status, so?.status);
          const total = o.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
          return (
            <div key={o.id} className="card">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    {fmtDate(o.createdAt)} · {o.lines.length} item(s) · {termLabel(o.term)}
                    {so && <span className="ml-2 font-mono text-xs text-gray-500">{so.soNumber}</span>}
                  </p>
                  <p className="text-xs text-gray-500">via {o.source.toLowerCase()}</p>
                </div>
                <p className="text-lg font-bold">{peso(total)}</p>
              </div>

              {step === -1 ? (
                <p className="rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-700">Cancelled</p>
              ) : (
                <div className="mb-3 flex items-center">
                  {STEPS.map((s, i) => (
                    <div key={s} className="flex flex-1 items-center">
                      <div className="flex flex-col items-center">
                        <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${i <= step ? "bg-emerald-600 text-white" : "bg-gray-200 text-gray-500"}`}>
                          {i < step ? "✔" : i + 1}
                        </div>
                        <p className={`mt-1 text-center text-[10px] ${i <= step ? "font-semibold text-emerald-700" : "text-gray-400"}`}>{s}</p>
                      </div>
                      {i < STEPS.length - 1 && <div className={`mx-1 h-0.5 flex-1 ${i < step ? "bg-emerald-500" : "bg-gray-200"}`} />}
                    </div>
                  ))}
                </div>
              )}

              <details className="text-sm">
                <summary className="cursor-pointer text-emerald-700">View items</summary>
                <ul className="mt-2 space-y-1 text-gray-600">
                  {o.lines.map((l) => (
                    <li key={l.id} className="flex justify-between">
                      <span>{l.product.name} × {l.qty}</span>
                      <span>{peso(l.qty * l.unitPrice)}</span>
                    </li>
                  ))}
                </ul>
                {so?.schedule && (
                  <p className="mt-2 text-xs text-gray-500">
                    Delivery: {fmtDate(so.schedule.date)} · {so.schedule.status}
                  </p>
                )}
              </details>
            </div>
          );
        })}
        {!orders.length && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
            No orders yet — browse the <a href="/portal" className="text-emerald-700 underline">catalog</a> to place your first order.
          </div>
        )}
      </div>
    </div>
  );
}
