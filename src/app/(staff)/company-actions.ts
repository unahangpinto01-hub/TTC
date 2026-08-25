"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { allowedCompanyIds, COMPANY_COOKIE_NAME } from "@/lib/company";

/** Switch the active company. Server-validated: the user must have explicit access to the target. */
export async function switchCompany(companyId: string) {
  const user = await requireStaff(undefined, { allowUnenrolled: true });
  const allowed = await allowedCompanyIds(user);
  if (!allowed.includes(companyId)) redirect("/denied");
  cookies().set(COMPANY_COOKIE_NAME, companyId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/dashboard"); // refresh every company-specific module in the new context
}
