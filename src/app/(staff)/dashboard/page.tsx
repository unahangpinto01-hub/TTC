import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { peso, fmtDateTime } from "@/lib/format";
import { runNotificationSweep } from "@/lib/notify";
import { getPerm } from "@/lib/permissions";
import { getSalesReport, getPnl } from "@/lib/reports";
import { getActiveCompany } from "@/lib/company";
import { SalesChart } from "./sales-chart";

const TARGET = 5;

export default async function DashboardPage() {
  const user = await requirePerm("dashboard");
  const company = await getActiveCompany(user);
  await runNotificationSweep(company.id);

  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
  const canFinance = getPerm(user, "ar") !== "NONE";

  // last 6 months of invoiced sales — everything scoped to the active company
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const [todaySchedules, pendingOrders, lowStock, notifications, srsForChart, openSrs, invoicingQueue] = await Promise.all([
    prisma.deliverySchedule.findMany({ where: { date: { gte: todayStart, lt: todayEnd }, salesOrder: { companyId: company.id } }, include: { salesOrder: { include: { customer: true } } } }),
    prisma.incomingOrder.count({ where: { companyId: company.id, status: "Pending" } }),
    prisma.product.findMany({ where: { companyId: company.id, stockQty: { lte: 30 } }, orderBy: { stockQty: "asc" }, take: 50 }),
    prisma.notification.findMany({
      where: { OR: [{ userId: user.id }, { role: user.role }], AND: [{ OR: [{ companyId: company.id }, { companyId: null }] }] },
      orderBy: { createdAt: "desc" }, take: 8,
    }),
    canFinance ? prisma.salesReceipt.findMany({ where: { companyId: company.id, status: { not: "Void" }, invoiceDate: { gte: sixMonthsAgo } }, select: { invoiceDate: true, amount: true } }) : Promise.resolve([]),
    canFinance ? prisma.salesReceipt.findMany({ where: { companyId: company.id, status: { in: ["Open", "Partial"] } }, include: { payments: true } }) : Promise.resolve([]),
    prisma.deliveryReceipt.count({ where: { companyId: company.id, status: "Delivered", salesReceipt: null } }),
  ]);

  const lowItems = lowStock.filter((p) => p.stockQty > 0 && p.stockQty <= p.reorderPoint);
  const outItems = lowStock.filter((p) => p.stockQty <= 0);
  const deliveredToday = todaySchedules.filter((s) => s.status === "Delivered").length;

  const months: { month: string; sales: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = d.toLocaleDateString("en-PH", { month: "short" });
    const total = srsForChart
      .filter((sr) => sr.invoiceDate.getMonth() === d.getMonth() && sr.invoiceDate.getFullYear() === d.getFullYear())
      .reduce((s, sr) => s + sr.amount, 0);
    months.push({ month: label, sales: Math.round(total * 100) / 100 });
  }
  const thisMonth = months[5]?.sales ?? 0;
  const lastMonth = months[4]?.sales ?? 0;
  const momPct = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null;

  const arOverdue = openSrs
    .filter((sr) => sr.dueDate < now)
    .reduce((s, sr) => s + sr.amount - sr.payments.reduce((a, p) => a + p.amount, 0), 0);

  let salesData: Awaited<ReturnType<typeof getSalesReport>> | null = null;
  let ytd: Awaited<ReturnType<typeof getPnl>> | null = null;
  if (canFinance) {
    salesData = await getSalesReport({ from: new Date(now.getFullYear(), now.getMonth() - 2, 1), to: now }, company.id);
    ytd = await getPnl({ from: new Date(now.getFullYear(), 0, 1), to: now }, company.id);
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Dashboard</h1>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/schedule" className="card transition-shadow hover:shadow-md">
          <p className="text-xs text-gray-500">Today's Deliveries</p>
          <p className="text-2xl font-bold">{deliveredToday}<span className="text-sm font-normal text-gray-400"> done</span> · {todaySchedules.length}/{TARGET}</p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, (todaySchedules.length / TARGET) * 100)}%` }} />
          </div>
        </Link>
        <Link href="/orders?status=Pending" className="card transition-shadow hover:shadow-md">
          <p className="text-xs text-gray-500">Pending Orders</p>
          <p className={`text-2xl font-bold ${pendingOrders > 0 ? "text-amber-600" : ""}`}>{pendingOrders}</p>
          <p className="text-xs text-gray-400">need action</p>
        </Link>
        {canFinance ? (
          <Link href="/invoicing" className="card transition-shadow hover:shadow-md">
            <p className="text-xs text-gray-500">For Invoicing</p>
            <p className={`text-2xl font-bold ${invoicingQueue > 0 ? "text-purple-700" : ""}`}>{invoicingQueue}</p>
            <p className="text-xs text-gray-400">delivered DRs waiting</p>
          </Link>
        ) : (
          <Link href="/inventory?stock=low" className="card transition-shadow hover:shadow-md">
            <p className="text-xs text-gray-500">Stock Alerts</p>
            <p className="text-2xl font-bold text-amber-600">{lowItems.length + outItems.length}</p>
            <p className="text-xs text-gray-400">{outItems.length} out · {lowItems.length} low</p>
          </Link>
        )}
        {canFinance ? (
          <Link href="/finance/ar" className="card transition-shadow hover:shadow-md">
            <p className="text-xs text-gray-500">AR Overdue</p>
            <p className={`text-2xl font-bold ${arOverdue > 0 ? "text-red-600" : "text-emerald-700"}`}>{peso(arOverdue)}</p>
            <p className="text-xs text-gray-400">past due date</p>
          </Link>
        ) : (
          <Link href="/notifications" className="card transition-shadow hover:shadow-md">
            <p className="text-xs text-gray-500">Notifications</p>
            <p className="text-2xl font-bold">{notifications.filter((n) => !n.readAt).length}</p>
            <p className="text-xs text-gray-400">recent unread</p>
          </Link>
        )}
      </div>

      {canFinance && ytd && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Link href={`/reports/sales?from=${now.getFullYear()}-01-01&to=${now.toISOString().slice(0, 10)}`} className="card transition-shadow hover:shadow-md">
            <p className="text-xs text-gray-500">YTD Sales ({now.getFullYear()})</p>
            <p className="text-2xl font-bold text-emerald-800">{peso(ytd.revenue)}</p>
            <p className="text-xs text-gray-400">invoiced sales since Jan 1</p>
          </Link>
          <Link href={`/finance/expenses?from=${now.getFullYear()}-01-01&to=${now.toISOString().slice(0, 10)}`} className="card transition-shadow hover:shadow-md">
            <p className="text-xs text-gray-500">YTD Expenses</p>
            <p className="text-2xl font-bold text-gray-800">{peso(ytd.totalExpenses)}</p>
            <p className="text-xs text-gray-400">operating expenses since Jan 1</p>
          </Link>
          <Link href={`/reports/pnl?from=${now.getFullYear()}-01-01&to=${now.toISOString().slice(0, 10)}`} className="card transition-shadow hover:shadow-md">
            <p className="text-xs text-gray-500">YTD Net Income</p>
            <p className={`text-2xl font-bold ${ytd.netIncome >= 0 ? "text-emerald-700" : "text-red-600"}`}>{peso(ytd.netIncome)}</p>
            <p className="text-xs text-gray-400">sales − COGS − expenses</p>
          </Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {canFinance && (
            <div className="card mb-4">
              <div className="mb-1 flex items-baseline justify-between">
                <h2 className="font-semibold">Sales — last 6 months</h2>
                <p className="text-sm text-gray-500">
                  This month: <span className="font-bold text-gray-900">{peso(thisMonth)}</span>
                  {momPct !== null && (
                    <span className={`ml-2 font-semibold ${momPct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {momPct >= 0 ? "▲" : "▼"} {Math.abs(momPct)}% vs last
                    </span>
                  )}
                </p>
              </div>
              <SalesChart data={months} />
            </div>
          )}

          {canFinance && salesData && (
            <div className="mb-4 grid gap-4 sm:grid-cols-2">
              <div className="card">
                <h2 className="mb-2 font-semibold">Top 10 Products <span className="text-xs font-normal text-gray-400">(90 days)</span></h2>
                <div className="space-y-1.5">
                  {salesData.byProduct.slice(0, 10).map((p) => {
                    const max = salesData!.byProduct[0]?.amount || 1;
                    return (
                      <div key={p.sku} className="text-xs">
                        <div className="flex justify-between"><span className="truncate pr-2">{p.name}</span><span className="font-semibold">{peso(p.amount)}</span></div>
                        <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(p.amount / max) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  {!salesData.byProduct.length && <p className="text-sm text-gray-400">No sales yet.</p>}
                </div>
              </div>
              <div className="card">
                <h2 className="mb-2 font-semibold">Sales by Region <span className="text-xs font-normal text-gray-400">(90 days)</span></h2>
                <div className="space-y-2">
                  {salesData.byRegion.map((r) => {
                    const max = salesData!.byRegion[0]?.amount || 1;
                    return (
                      <div key={r.region} className="text-sm">
                        <div className="flex justify-between"><span>{r.region}</span><span className="font-semibold">{peso(r.amount)}</span></div>
                        <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full bg-emerald-600" style={{ width: `${(r.amount / max) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                  {!salesData.byRegion.length && <p className="text-sm text-gray-400">No sales yet.</p>}
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <h2 className="mb-2 font-semibold">Today's Delivery Runs</h2>
            {todaySchedules.length ? (
              <ul className="divide-y divide-gray-100 text-sm">
                {todaySchedules.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2">
                    <span>
                      <Link href={`/sales-orders/${s.salesOrderId}`} className="font-mono text-xs text-emerald-700 hover:underline">{s.salesOrder.soNumber}</Link>{" "}
                      {s.salesOrder.customer.businessName}
                    </span>
                    <span className="text-xs text-gray-500">{s.truck || "—"} · {s.status}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400">No deliveries scheduled today. <Link href="/schedule" className="text-emerald-700 underline">Open the board</Link></p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">Stock Alerts</h2>
              <Link href="/inventory?stock=low" className="text-xs text-emerald-700 hover:underline">view all</Link>
            </div>
            <ul className="space-y-1.5 text-sm">
              {outItems.slice(0, 4).map((p) => (
                <li key={p.id} className="flex items-center justify-between">
                  <Link href={`/inventory/${p.id}`} className="truncate pr-2 hover:underline">{p.name}</Link>
                  <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">OUT</span>
                </li>
              ))}
              {lowItems.slice(0, 6).map((p) => (
                <li key={p.id} className="flex items-center justify-between">
                  <Link href={`/inventory/${p.id}`} className="truncate pr-2 hover:underline">{p.name}</Link>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{p.stockQty} left</span>
                </li>
              ))}
              {!outItems.length && !lowItems.length && <p className="text-sm text-gray-400">All stock levels healthy. ✔</p>}
            </ul>
          </div>

          <div className="card">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">Recent Activity</h2>
              <Link href="/notifications" className="text-xs text-emerald-700 hover:underline">all notifications</Link>
            </div>
            <ul className="space-y-2 text-sm">
              {notifications.map((n) => (
                <li key={n.id} className="border-l-2 border-emerald-200 pl-2">
                  {n.refLink ? (
                    <Link href={n.refLink} className="hover:underline">{n.message}</Link>
                  ) : (
                    n.message
                  )}
                  <p className="text-[10px] text-gray-400">{fmtDateTime(n.createdAt)}</p>
                </li>
              ))}
              {!notifications.length && <p className="text-sm text-gray-400">Nothing yet.</p>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
