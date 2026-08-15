"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";

export async function markAllRead() {
  const user = await requireStaff();
  await prisma.notification.updateMany({
    where: { readAt: null, OR: [{ userId: user.id }, { role: user.role }] },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
}

export async function markRead(formData: FormData) {
  await requireStaff();
  const id = String(formData.get("id"));
  await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  revalidatePath("/notifications");
}
