import { prisma } from "./db";

export type SalespersonOption = { id: string; name: string; position: string };

/**
 * The Salesperson picker list. Membership is the explicit isSalesperson flag on the
 * employee record, not their department — a supervisor or manager may carry accounts
 * without being moved into Sales.
 */
export async function getSalespeople(): Promise<SalespersonOption[]> {
  const rows = await prisma.employee.findMany({
    where: { isSalesperson: true, status: "Active" },
    select: { id: true, name: true, position: true },
    orderBy: { name: "asc" },
  });
  return rows;
}

/** Label for a line whose salesperson was never set. Used consistently in grids and reports. */
export const NO_SALESPERSON = "— Unassigned —";

/** Write one business-audit entry. Separate from the user security log. */
export async function logAudit(opts: {
  entity: string;
  entityId: string;
  action: string;
  detail: string;
  actorName: string;
  actorEmail: string;
}) {
  await prisma.auditLog.create({ data: opts });
}

export async function getAuditTrail(entity: string, entityId: string, take = 20) {
  return prisma.auditLog.findMany({
    where: { entity, entityId },
    orderBy: { createdAt: "desc" },
    take,
  });
}
