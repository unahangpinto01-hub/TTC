"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { getPerm } from "@/lib/permissions";
import { checkVoucherDate } from "@/lib/vouchers";
import { createCustomerOpening, createSupplierOpening, voidOpening } from "@/lib/opening-balances";

const BASE = "/finance/opening-balances";
const sideOf = (v: unknown): "customer" | "supplier" => (String(v) === "supplier" ? "supplier" : "customer");
const dateOf = (v: unknown): Date | null => {
  const s = String(v || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Enter one opening balance. A customer balance needs AR write access, a supplier balance AP
 * write access — the same people who collect and pay them. The as-of date decides the
 * document's period, so a locked period is refused unless the user may adjust prior periods.
 */
export async function addOpeningBalance(formData: FormData) {
  const side = sideOf(formData.get("side"));
  const user = await requirePermWrite(side === "customer" ? "ar" : "ap");
  const company = await getActiveCompany(user);
  const partyId = String(formData.get("partyId") || "");
  const asOf = dateOf(formData.get("asOf"));
  const dueDate = dateOf(formData.get("dueDate"));
  const amount = Math.round((Number(formData.get("amount")) || 0) * 100) / 100;
  const memo = String(formData.get("memo") || "").trim().slice(0, 300);
  const back: (error: string) => never = (error) => redirect(`${BASE}?side=${side}&error=${error}`);
  if (!partyId) back("party");
  if (!asOf) back("date");
  if (asOf > new Date()) back("future");
  if (!(amount > 0)) back("amount");
  if (dueDate && dueDate < asOf) back("due");
  const period = await checkVoucherDate({ companyId: company.id, voucherDate: asOf, canPriorPeriod: getPerm(user, "priorPeriod") !== "NONE", noun: "opening balance" });
  if (!period.ok) back("period");

  const input = { companyId: company.id, partyId, asOf, dueDate, amount, memo, actor: { id: user.id, name: user.name, email: user.email } };
  let docNo = "";
  try {
    docNo = side === "customer" ? (await createCustomerOpening(input)).srNumber : (await createSupplierOpening(input)).billNo;
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    back(m === "party" || m === "amount" ? m : "failed");
  }
  revalidatePath(BASE);
  revalidatePath(side === "customer" ? "/finance/ar" : "/finance/ap");
  redirect(`${BASE}?side=${side}&saved=${encodeURIComponent(docNo)}`);
}

/** Withdraw an opening balance nothing has been applied to. */
export async function voidOpeningBalance(formData: FormData) {
  const side = sideOf(formData.get("side"));
  const user = await requirePermWrite(side === "customer" ? "ar" : "ap");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id") || "");
  const reason = String(formData.get("reason") || "").trim();
  if (reason.length < 5) redirect(`${BASE}?side=${side}&error=reason`);
  try {
    await voidOpening(side, id, company.id, reason, { id: user.id, name: user.name, email: user.email });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    redirect(`${BASE}?side=${side}&error=${m === "touched" ? "touched" : "missing"}`);
  }
  revalidatePath(BASE);
  revalidatePath(side === "customer" ? "/finance/ar" : "/finance/ap");
  redirect(`${BASE}?side=${side}&voided=1`);
}
