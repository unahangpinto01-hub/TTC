"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite, requireStaffWrite } from "@/lib/auth";
import { nextDocNumber } from "@/lib/numbering";
import { notifyRoles } from "@/lib/notify";
import { getActiveCompany } from "@/lib/company";
import { parseEffectiveDate } from "@/lib/stock";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One-click DR → SR conversion. Invoice date is editable (backdatable for encoding old
    transactions, defaults to the delivery date); due date = invoice date + term days. */
export async function convertDRtoSR(formData: FormData) {
  await requirePermWrite("invoicing");
  const drId = String(formData.get("drId"));
  const dr = await prisma.deliveryReceipt.findUniqueOrThrow({
    where: { id: drId },
    include: { lines: true, salesOrder: { include: { customer: true } }, salesReceipt: true },
  });
  const activeCo = await getActiveCompany();
  if (dr.companyId !== activeCo.id) redirect("/denied"); // company isolation
  if (dr.status !== "Delivered" || dr.salesReceipt) redirect(`/invoicing`);

  // freight from the sales order is billed in full on its (single) invoice
  const freightCharge = dr.salesOrder.freightCharge;
  const amount = round2(dr.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0) + freightCharge);
  const term = dr.salesOrder.term;
  const termDays = term === "COD" ? 0 : Number(term);
  const invoiceDate = parseEffectiveDate(String(formData.get("invoiceDate") || ""));
  const dueDate = new Date(invoiceDate);
  dueDate.setDate(dueDate.getDate() + termDays);

  const vatApplied = formData.get("applyVat") === "on";
  const srNumber = await nextDocNumber("SR", dr.companyId);
  const sr = await prisma.salesReceipt.create({
    data: {
      companyId: dr.companyId,
      srNumber,
      deliveryReceiptId: drId,
      customerId: dr.salesOrder.customerId,
      amount,
      freightCharge,
      term,
      vatApplied,
      invoiceDate,
      dueDate,
      status: "Open",
    },
  });
  await prisma.deliveryReceipt.update({ where: { id: drId }, data: { status: "Invoiced" } });
  await prisma.salesOrder.update({ where: { id: dr.salesOrderId }, data: { status: "Invoiced" } });
  await notifyRoles(["ADMIN", "SUPER_ADMIN"], "SR_CREATED", `${srNumber} issued to ${dr.salesOrder.customer.businessName} — due ${dueDate.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}`, `/invoices/${sr.id}`, dr.companyId);
  redirect(`/invoices/${sr.id}`);
}

/** Void an SR (Super Admin only, per spec). Reopens the DR for invoicing. */
export async function voidSR(formData: FormData) {
  await requireStaffWrite(["SUPER_ADMIN"]);
  const srId = String(formData.get("srId"));
  const reason = String(formData.get("reason") || "").trim();
  if (!reason) redirect(`/invoices/${srId}?error=reason`);
  const sr = await prisma.salesReceipt.findUniqueOrThrow({ where: { id: srId }, include: { payments: true, deliveryReceipt: true } });
  const voidCo = await getActiveCompany();
  if (sr.companyId !== voidCo.id) redirect("/denied"); // company isolation
  if (sr.payments.length) redirect(`/invoices/${srId}?error=haspayments`);
  await prisma.salesReceipt.update({ where: { id: srId }, data: { status: "Void", voidReason: reason } });
  await prisma.deliveryReceipt.update({ where: { id: sr.deliveryReceiptId }, data: { status: "Delivered" } });
  await prisma.salesOrder.update({ where: { id: sr.deliveryReceipt.salesOrderId }, data: { status: "Delivered" } });
  revalidatePath(`/invoices/${srId}`);
  redirect(`/invoices/${srId}`);
}
