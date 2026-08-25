import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { fmtDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { markAllRead, markRead } from "./actions";

export default async function NotificationsPage() {
  const user = await requirePerm("notifications");
  const company = await getActiveCompany(user);
  const notifications = await prisma.notification.findMany({
    where: {
      OR: [{ userId: user.id }, { role: user.role }],
      AND: [{ OR: [{ companyId: company.id }, { companyId: null }] }],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="max-w-3xl">
      <PageHeader title={`Notifications${unread ? ` · ${unread} unread` : ""}`}>
        {unread > 0 && (
          <form action={markAllRead}>
            <button className="btn-secondary" type="submit">Mark all read</button>
          </form>
        )}
      </PageHeader>
      <div className="card divide-y divide-gray-100 p-0">
        {notifications.map((n) => (
          <div key={n.id} className={`flex items-start gap-3 p-3 ${n.readAt ? "opacity-60" : "bg-emerald-50/40"}`}>
            <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-gray-300" : "bg-emerald-500"}`} />
            <div className="min-w-0 flex-1">
              {n.refLink ? (
                <Link href={n.refLink} className="text-sm font-medium hover:underline">{n.message}</Link>
              ) : (
                <p className="text-sm font-medium">{n.message}</p>
              )}
              <p className="text-xs text-gray-400">{n.type.replace(/_/g, " ").toLowerCase()} · {fmtDateTime(n.createdAt)}</p>
            </div>
            {!n.readAt && (
              <form action={markRead}>
                <input type="hidden" name="id" value={n.id} />
                <button className="text-xs text-gray-400 hover:text-gray-600" type="submit">mark read</button>
              </form>
            )}
          </div>
        ))}
        {!notifications.length && <p className="p-8 text-center text-sm text-gray-500">No notifications for your role yet.</p>}
      </div>
    </div>
  );
}
