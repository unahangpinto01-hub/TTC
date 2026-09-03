import { prisma } from "./db";

export type SalespersonOption = { id: string; name: string; position: string };

/**
 * Who counts as a salesperson, in one place so every picker, filter and validator agrees.
 *
 * Anyone active in the Sales department qualifies automatically — add an employee to Sales
 * in HR and they appear in the pickers straight away, no extra step. The isSalesperson flag
 * is an additive override for people outside Sales who still carry accounts.
 */
export const SALESPERSON_WHERE = {
  status: "Active",
  OR: [{ isSalesperson: true }, { department: { contains: "sales", mode: "insensitive" as const } }],
};

/** True when this employee record qualifies, by either route. */
export function isSalesperson(e: { status: string; isSalesperson: boolean; department: string }) {
  return e.status === "Active" && (e.isSalesperson || /sales/i.test(e.department));
}

export async function getSalespeople(): Promise<SalespersonOption[]> {
  const rows = await prisma.employee.findMany({
    where: SALESPERSON_WHERE,
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

/** Label for a forecast line planned before its area was split between customers. */
export const NO_CUSTOMER = "— No customer yet —";
