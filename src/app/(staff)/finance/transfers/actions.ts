"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { nextDocNumber } from "@/lib/numbering";
import { logAudit } from "@/lib/salespeople";
import { canApprovePayments } from "@/lib/receive-payments";

const round2 = (n: number) => Math.round(n * 100) / 100;

function err(message: string): never {
  redirect(`/finance/transfers?error=${encodeURIComponent(message)}`);
}

export async function createTransfer(formData: FormData) {
  const user = await requirePermWrite("receivePayments");
  const company = await getActiveCompany(user);
  const amount = round2(Number(formData.get("amount")) || 0);
  const fromAccountId = String(formData.get("fromAccountId") || "");
  const toAccountId = String(formData.get("toAccountId") || "");
  const remarks = String(formData.get("remarks") || "").trim();
  const date = formData.get("date") ? new Date(String(formData.get("date"))) : new Date();
  if (amount <= 0) err("The transfer amount must be more than zero.");
  if (!fromAccountId || !toAccountId) err("Pick both accounts.");
  if (fromAccountId === toAccountId) err("A transfer needs two DIFFERENT accounts.");
  if (!remarks) err("Remarks are required — say what this transfer is (deposit, withdrawal, …).");
  // both accounts must be this company's active accounts — money never crosses companies here
  const accounts = await prisma.cashAccount.findMany({
    where: { id: { in: [fromAccountId, toAccountId] }, companyId: company.id, status: "Active" },
  });
  if (accounts.length !== 2) err("Both accounts must be active accounts of this company.");

  const trNumber = await nextDocNumber("TR", company.id, date);
  const tr = await prisma.accountTransfer.create({
    data: {
      companyId: company.id,
      trNumber,
      date,
      amount,
      fromAccountId,
      toAccountId,
      refNo: String(formData.get("refNo") || "").trim() || null,
      remarks,
      createdById: user.id,
      status: "Draft",
    },
  });
  await logAudit({
    entity: "AccountTransfer", entityId: tr.id, action: "CREATED",
    detail: `${trNumber} drafted: ₱${amount.toFixed(2)} ${accounts.find((a) => a.id === fromAccountId)!.name} → ${accounts.find((a) => a.id === toAccountId)!.name}`,
    actorName: user.name, actorEmail: user.email,
  });
  revalidatePath("/finance/transfers");
  redirect("/finance/transfers");
}

export async function submitTransfer(formData: FormData) {
  const user = await requirePermWrite("receivePayments");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const tr = await prisma.accountTransfer.findUniqueOrThrow({ where: { id } });
  if (tr.companyId !== company.id) redirect("/denied");
  if (tr.status !== "Draft") err("Only a Draft can be submitted.");
  await prisma.accountTransfer.update({ where: { id }, data: { status: "Pending Approval" } });
  await logAudit({ entity: "AccountTransfer", entityId: id, action: "SUBMITTED", detail: `${tr.trNumber} submitted for approval`, actorName: user.name, actorEmail: user.email });
  revalidatePath("/finance/transfers");
  redirect("/finance/transfers");
}

export async function postTransfer(formData: FormData) {
  const user = await requirePermWrite("receivePayments");
  if (!canApprovePayments(user)) redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const tr = await prisma.accountTransfer.findUniqueOrThrow({ where: { id }, include: { fromAccount: true, toAccount: true } });
  if (tr.companyId !== company.id) redirect("/denied");
  if (tr.status !== "Draft" && tr.status !== "Pending Approval") err(`Cannot post a ${tr.status} transfer.`);
  await prisma.accountTransfer.update({ where: { id }, data: { status: "Posted", postedAt: new Date() } });
  await logAudit({
    entity: "AccountTransfer", entityId: id, action: "POSTED",
    detail: `${tr.trNumber} posted: ₱${tr.amount.toFixed(2)} ${tr.fromAccount.name} → ${tr.toAccount.name}`,
    actorName: user.name, actorEmail: user.email,
  });
  revalidatePath("/finance/transfers");
  revalidatePath("/finance/accounts");
  redirect("/finance/transfers");
}

export async function cancelTransfer(formData: FormData) {
  const user = await requirePermWrite("receivePayments");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const tr = await prisma.accountTransfer.findUniqueOrThrow({ where: { id } });
  if (tr.companyId !== company.id) redirect("/denied");
  if (tr.status !== "Draft" && tr.status !== "Pending Approval") err("Only a Draft or Pending transfer can be cancelled.");
  if (tr.status === "Pending Approval" && !canApprovePayments(user)) redirect("/denied");
  await prisma.accountTransfer.update({ where: { id }, data: { status: "Cancelled" } });
  await logAudit({ entity: "AccountTransfer", entityId: id, action: "CANCELLED", detail: `${tr.trNumber} cancelled`, actorName: user.name, actorEmail: user.email });
  revalidatePath("/finance/transfers");
  redirect("/finance/transfers");
}

export async function voidTransfer(formData: FormData) {
  const user = await requirePermWrite("receivePayments");
  if (!canApprovePayments(user)) redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const reason = String(formData.get("reason") || "").trim();
  if (reason.length < 5) err("Give a void reason (at least 5 characters).");
  const tr = await prisma.accountTransfer.findUniqueOrThrow({ where: { id } });
  if (tr.companyId !== company.id) redirect("/denied");
  if (tr.status !== "Posted") err("Only a Posted transfer can be voided.");
  await prisma.accountTransfer.update({ where: { id }, data: { status: "Void", voidReason: reason } });
  await logAudit({ entity: "AccountTransfer", entityId: id, action: "VOIDED", detail: `${tr.trNumber} voided (${reason})`, actorName: user.name, actorEmail: user.email });
  revalidatePath("/finance/transfers");
  revalidatePath("/finance/accounts");
  redirect("/finance/transfers");
}
