"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function recordPayment(formData: FormData) {
  await requirePermWrite("ar");
  const srId = String(formData.get("srId"));
  const amount = round2(Number(formData.get("amount")) || 0);
  const method = String(formData.get("method") || "Cash");
  const refNo = String(formData.get("refNo") || "").trim() || null;
  const dateStr = String(formData.get("date") || "");
  if (amount <= 0) redirect(`/invoices/${srId}?error=amount`);

  const sr = await prisma.salesReceipt.findUniqueOrThrow({ where: { id: srId }, include: { payments: true } });
  const company = await getActiveCompany();
  if (sr.companyId !== company.id) redirect("/denied"); // company isolation
  if (sr.status === "Void" || sr.status === "Paid") redirect(`/invoices/${srId}`);

  await prisma.payment.create({
    data: { salesReceiptId: srId, amount, method, refNo, date: dateStr ? new Date(dateStr) : new Date() },
  });
  const paid = sr.payments.reduce((s, p) => s + p.amount, 0) + amount;
  await prisma.salesReceipt.update({
    where: { id: srId },
    data: { status: paid >= sr.amount - 0.005 ? "Paid" : "Partial" },
  });
  revalidatePath(`/invoices/${srId}`);
  revalidatePath("/finance/ar");
  redirect(`/invoices/${srId}`);
}

export async function createExpense(formData: FormData) {
  const user = await requirePermWrite("expenses");
  const company = await getActiveCompany(user);
  // book to a Chart of Accounts entry when one was picked
  const glAccountId = String(formData.get("glAccountId") || "") || null;
  if (glAccountId && !(await prisma.gLAccount.findFirst({ where: { id: glAccountId, status: "Active" } }))) {
    redirect("/finance/expenses");
  }
  await prisma.expense.create({
    data: {
      companyId: company.id,
      date: new Date(String(formData.get("date")) || Date.now()),
      category: String(formData.get("category")),
      amount: round2(Number(formData.get("amount")) || 0),
      notes: String(formData.get("notes") || "").trim() || null,
      userId: user.id,
      glAccountId,
    },
  });
  revalidatePath("/finance/expenses");
  redirect("/finance/expenses");
}
