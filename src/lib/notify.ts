import { prisma } from "./db";

/** Create an in-app notification for a role. companyId scopes it to a company's context;
    omit/null for global notices (security alerts, account events). */
export async function notifyRole(role: string, type: string, message: string, refLink?: string, companyId?: string | null) {
  await prisma.notification.create({ data: { role, type, message, refLink, companyId: companyId ?? null } });
}

export async function notifyUser(userId: string, type: string, message: string, refLink?: string, companyId?: string | null) {
  await prisma.notification.create({ data: { userId, type, message, refLink, companyId: companyId ?? null } });
}

/** Notify several roles at once. */
export async function notifyRoles(roles: string[], type: string, message: string, refLink?: string, companyId?: string | null) {
  await prisma.notification.createMany({
    data: roles.map((role) => ({ role, type, message, refLink, companyId: companyId ?? null })),
  });
}

/** Idempotent sweep for time-based alerts: stale pending orders, invoices due soon / overdue.
    Runs cheaply on dashboard load, scoped to the active company. */
export async function runNotificationSweep(companyId: string) {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const staleOrders = await prisma.incomingOrder.findMany({
    where: { companyId, status: "Pending", createdAt: { lt: dayAgo } },
    include: { customer: true },
  });
  for (const o of staleOrders) {
    const exists = await prisma.notification.findFirst({ where: { type: "ORDER_ESCALATION", refLink: `/orders/${o.id}` } });
    if (!exists) {
      await notifyRoles(["ADMIN", "SUPER_ADMIN"], "ORDER_ESCALATION", `⚠ Order from ${o.customer.businessName} pending for over 24 hours`, `/orders/${o.id}`, companyId);
    }
  }

  const dueSrs = await prisma.salesReceipt.findMany({
    where: { companyId, status: { in: ["Open", "Partial"] }, dueDate: { lt: in7days } },
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
        `/invoices/${sr.id}`,
        companyId
      );
    }
  }
}
