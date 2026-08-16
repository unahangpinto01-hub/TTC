import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { PageHeader, StatusBadge } from "@/components/ui";
import { updateScheduleStatus } from "../deliveries/actions";

const TARGET_PER_DAY = 5;

// All board buckets use calendar-date strings (YYYY-MM-DD). Schedule dates are
// stored as UTC midnights (from <input type="date">), so bucket by UTC date;
// "today" is computed in Manila local time.
function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default async function SchedulePage({ searchParams }: { searchParams: { start?: string } }) {
  await requirePerm("schedule");
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const startStr = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.start || "") ? searchParams.start! : todayKey;
  const start = new Date(startStr + "T00:00:00Z");
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });
  const end = new Date(days[6]);
  end.setUTCDate(end.getUTCDate() + 1);

  const schedules = await prisma.deliverySchedule.findMany({
    where: { date: { gte: start, lt: end } },
    include: { salesOrder: { include: { customer: true, deliveryReceipts: { where: { status: { not: "Void" } } } } } },
    orderBy: { date: "asc" },
  });

  const prev = new Date(start); prev.setUTCDate(prev.getUTCDate() - 7);
  const next = new Date(start); next.setUTCDate(next.getUTCDate() + 7);

  return (
    <div>
      <PageHeader title="Delivery Schedule Board">
        <Link href={`/schedule?start=${dayKey(prev)}`} className="btn-secondary">← Prev week</Link>
        <Link href="/schedule" className="btn-secondary">Today</Link>
        <Link href={`/schedule?start=${dayKey(next)}`} className="btn-secondary">Next week →</Link>
      </PageHeader>
      <p className="mb-3 text-sm text-gray-500">Target capacity: <span className="font-semibold">{TARGET_PER_DAY} deliveries/day</span></p>

      <div className="grid gap-3 md:grid-cols-4 lg:grid-cols-7">
        {days.map((d) => {
          const key = dayKey(d);
          const items = schedules.filter((s) => dayKey(s.date) === key);
          const count = items.length;
          const isToday = key === todayKey;
          return (
            <div key={key} className={`rounded-xl border bg-white p-2 ${isToday ? "border-emerald-500 ring-1 ring-emerald-300" : "border-gray-200"}`}>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold">
                  {d.toLocaleDateString("en-PH", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })}
                  {isToday && <span className="ml-1 text-emerald-600">·today</span>}
                </p>
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${count > TARGET_PER_DAY ? "bg-red-100 text-red-700" : count === TARGET_PER_DAY ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                  {count}/{TARGET_PER_DAY}
                </span>
              </div>
              <div className="space-y-2">
                {items.map((s) => {
                  const dr = s.salesOrder.deliveryReceipts[0];
                  return (
                    <div key={s.id} className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs">
                      <Link href={`/sales-orders/${s.salesOrderId}`} className="font-mono font-semibold text-emerald-700 hover:underline">
                        {s.salesOrder.soNumber}
                      </Link>
                      <p className="truncate font-medium">{s.salesOrder.customer.businessName}</p>
                      <p className="text-[10px] text-gray-500">{s.truck || "no truck"} · {s.driver || "no driver"}</p>
                      <div className="mt-1"><StatusBadge status={s.status} /></div>
                      {s.status !== "Delivered" && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {s.status === "Scheduled" && (
                            <form action={updateScheduleStatus}>
                              <input type="hidden" name="scheduleId" value={s.id} />
                              <input type="hidden" name="status" value="Loading" />
                              <button className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-200">→ Loading</button>
                            </form>
                          )}
                          {s.status === "Loading" && (
                            <form action={updateScheduleStatus}>
                              <input type="hidden" name="scheduleId" value={s.id} />
                              <input type="hidden" name="status" value="In Transit" />
                              <button className="rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] font-medium text-cyan-800 hover:bg-cyan-200">→ In Transit</button>
                            </form>
                          )}
                          {dr ? (
                            <Link href={`/deliveries/${dr.id}`} className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 hover:bg-emerald-200">
                              DR →
                            </Link>
                          ) : (
                            <Link href={`/sales-orders/${s.salesOrderId}`} className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-700 hover:bg-gray-300">
                              make DR
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {!items.length && <p className="py-4 text-center text-[10px] text-gray-400">no deliveries</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
