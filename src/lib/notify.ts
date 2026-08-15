import { prisma } from "./db";

/** Create an in-app notification for a role (all users of that role see it) or a specific user. */
export async function notifyRole(role: string, type: string, message: string, refLink?: string) {
  await prisma.notification.create({ data: { role, type, message, refLink } });
}

export async function notifyUser(userId: string, type: string, message: string, refLink?: string) {
  await prisma.notification.create({ data: { userId, type, message, refLink } });
}

/** Notify several roles at once. */
export async function notifyRoles(roles: string[], type: string, message: string, refLink?: string) {
  await prisma.notification.createMany({
    data: roles.map((role) => ({ role, type, message, refLink })),
  });
}

/** Idempotent sweep for time-based alerts: stale pending orders, invoices due soon / overdue.
    Runs cheaply on dashboard load. */
export async function runNotificationSweep() {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const staleOrders = await prisma.incomingOrder.findMany({
    where: { status: "Pending", createdAt: { lt: dayAgo } },
    include: { customer: true },
  });
  for (const o of staleOrders) {
    const exists = await prisma.notification.findFirst({ where: { type: "ORDER_ESCALATION", refLink: `/orders/${o.id}` } });
    if (!exists) {
      await notifyRoles(["ADMIN", "SUPER_ADMIN"], "ORDER_ESCALATION", `⚠ Order from ${o.customer.businessName} pending for over 24 hours`, `/orders/${o.id}`);
    }
  }

  const dueSrs = await prisma.salesReceipt.findMany({
    where: { status: { in: ["Open", "Partial"] }, dueDate: { lt: in7days } },
    include: { customer: true },
  });
  for (const sr of dueSrs) {
    const overdue = sr.dueDate < now;
    const type = overdue ? "INVOICE_OVERDUE" : "INVOICE_DUE_SOON";
    const exists = await prisma.notification.findFirst({ where: { type, refLink: `/invoices/${sr.id}` } });
    if (!exists) {
      await notifyRoles(
        ["ADMIN", "SUPER_ADMIN"],
        type,
        overdue
          ? `🔴 ${sr.srNumber} (${sr.customer.businessName}) is overdue`
          : `🟠 ${sr.srNumber} (${sr.customer.businessName}) due within 7 days`,
        `/invoices/${sr.id}`
      );
    }
  }
}
