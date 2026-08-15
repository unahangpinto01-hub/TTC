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
