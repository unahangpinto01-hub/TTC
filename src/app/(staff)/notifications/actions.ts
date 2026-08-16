"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireStaffWrite } from "@/lib/auth";

export async function markAllRead() {
  const user = await requireStaffWrite();
  await prisma.notification.updateMany({
    where: { readAt: null, OR: [{ userId: user.id }, { role: user.role }] },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
}

export async function markRead(formData: FormData) {
  await requireStaffWrite();
  const id = String(formData.get("id"));
  await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  revalidatePath("/notifications");
}
