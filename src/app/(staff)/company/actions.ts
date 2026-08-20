"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";

const MAX_LOGO_BYTES = 300 * 1024; // stored inline; 160x160 PNG is far below this

export async function updateCompany(formData: FormData) {
  await requirePermWrite("company");

  const data: Record<string, string> = {};
  for (const key of ["companyName", "address", "contactNo", "tin", "sssNo", "phicNo", "hdmfNo"]) {
    data[key] = String(formData.get(key) || "").trim();
  }
  if (!data.companyName) redirect("/company?error=name");

  const logo = String(formData.get("logoDataUrl") || "");
  const removeLogo = formData.get("removeLogo") === "1";
  const update: Record<string, string | null> = { ...data };
  if (removeLogo) {
    update.logoDataUrl = null;
  } else if (logo) {
    if (!/^data:image\/(png|jpeg);base64,/.test(logo)) redirect("/company?error=logo");
    if (logo.length > MAX_LOGO_BYTES * 1.4) redirect("/company?error=logosize");
    update.logoDataUrl = logo;
  }

  await prisma.companySetting.upsert({
    where: { id: "company" },
    create: { id: "company", ...update } as never,
    update,
  });
  revalidatePath("/company");
  redirect("/company?saved=1");
}
