"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite, requireStepUp } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { logAudit } from "@/lib/salespeople";
import { nextSeriesNo } from "@/lib/vouchers";
import { OPEN_BILL_STATUSES, statusForPayment, round2 } from "@/lib/bills";

const PAYMENT_METHODS = ["Cash", "Check", "Bank Transfer", "E-Wallet"] as const;

function formDate(raw: unknown): Date | null {
  const s = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Bring a bill's paid figure and status in line with its live payments. */
async function settleBill(tx: Pick<typeof prisma, "supplierPaymentLine" | "supplierBill">, billId: string) {
  const bill = await tx.supplierBill.findUniqueOrThrow({ where: { id: billId }, select: { total: true, status: true } });
  const agg = await tx.supplierPaymentLine.aggregate({ where: { billId, payment: { status: "Posted" } }, _sum: { amount: true } });
  const paid = round2(agg._sum.amount ?? 0);
  const status = ["Void", "Draft"].includes(bill.status) ? bill.status : statusForPayment(bill.total, paid);
  await tx.supplierBill.update({ where: { id: billId }, data: { paidAmount: paid, status } });
  return { paid, status };
}

/** The same for a voucher: Posted → Partially Paid → Paid as its payments come in. */
async function settleVoucher(tx: Pick<typeof prisma, "supplierPayment" | "disbursementVoucher">, dvId: string) {
  const dv = await tx.disbursementVoucher.findUniqueOrThrow({ where: { id: dvId }, select: { amount: true, status: true } });
  const agg = await tx.supplierPayment.aggregate({ where: { dvId, status: "Posted" }, _sum: { amount: true } });
  const paid = round2(agg._sum.amount ?? 0);
  if (!["Posted", "Partially Paid", "Paid"].includes(dv.status)) { await tx.disbursementVoucher.update({ where: { id: dvId }, data: { paidAmount: paid } }); return; }
  const status = paid <= 0 ? "Posted" : paid + 0.005 >= dv.amount ? "Paid" : "Partially Paid";
  await tx.disbursementVoucher.update({ where: { id: dvId }, data: { paidAmount: paid, status } });
}

/**
 * Record a payment. It posts at once — the Disbursement Voucher is the authorisation, so
 * the payment is the fact of money leaving. Each bill paid must be open, must belong to the
 * payee, and must not be paid beyond what is owed (or, under a voucher, beyond what the
 * voucher authorised for it). The same cheque number cannot be recorded twice on one account.
 *
 *   Dr Accounts Payable (per bill)  /  Cr Cash or Bank (the account chosen)
 */
export async function recordSupplierPayment(formData: FormData) {
  const user = await requirePermWrite("payBills");
  const company = await getActiveCompany(user);
  const dvId = String(formData.get("dvId") || "") || null;
  const date = formDate(formData.get("date")) ?? new Date();
  const method = String(formData.get("method") || "Cash");
  const cashAccountId = String(formData.get("cashAccountId") || "");
  const checkNo = method === "Check" ? String(formData.get("checkNo") || "").trim() || null : null;
  const checkDate = method === "Check" ? formDate(formData.get("checkDate")) : null;
  const refNo = String(formData.get("refNo") || "").trim() || null;
  const remarks = String(formData.get("remarks") || "").trim() || null;
  const back = dvId ? `/payments/bills/new?dv=${dvId}` : "/payments/bills/new";

  if (!(PAYMENT_METHODS as readonly string[]).includes(method)) redirect(`${back}&error=method`);
  const cashAccount = await prisma.cashAccount.findFirst({ where: { id: cashAccountId, companyId: company.id, status: "Active" } });
  if (!cashAccount) redirect(`${back}&error=account`);
  if (method === "Check" && !checkNo) redirect(`${back}&error=check`);

  const dv = dvId ? await prisma.disbursementVoucher.findUnique({ where: { id: dvId }, include: { bills: true, supplier: true } }) : null;
  if (dvId && (!dv || dv.companyId !== company.id)) redirect("/payments/bills/new?error=dv");
  if (dv && !["Posted", "Partially Paid"].includes(dv.status)) redirect(`${back}&error=dvstatus`);

  const billIds = formData.getAll("billId").map(String);
  const amounts = formData.getAll("pay").map((v) => round2(Math.max(0, Number(v) || 0)));
  const lines: { billId: string; amount: number; billNo: string }[] = [];
  let supplierId = dv?.supplierId ?? String(formData.get("supplierId") || "");
  for (let i = 0; i < billIds.length; i++) {
    if (!billIds[i] || amounts[i] <= 0) continue;
    const bill = await prisma.supplierBill.findFirst({ where: { id: billIds[i], companyId: company.id, status: { in: OPEN_BILL_STATUSES } }, select: { id: true, billNo: true, supplierId: true, total: true, paidAmount: true } });
    if (!bill) redirect(`${back}&error=bill`);
    if (!supplierId) supplierId = bill.supplierId;
    if (bill.supplierId !== supplierId) redirect(`${back}&error=payee`);
    const outstanding = round2(bill.total - bill.paidAmount);
    if (amounts[i] > outstanding + 0.005) redirect(`${back}&error=over&bill=${encodeURIComponent(bill.billNo)}`);
    if (dv) {
      const alloc = dv.bills.find((b) => b.billId === bill.id);
      if (!alloc) redirect(`${back}&error=notondv&bill=${encodeURIComponent(bill.billNo)}`);
      const paidUnderDv = await prisma.supplierPaymentLine.aggregate({ where: { billId: bill.id, payment: { dvId: dv.id, status: "Posted" } }, _sum: { amount: true } });
      const left = round2(alloc.amount - (paidUnderDv._sum.amount ?? 0));
      if (amounts[i] > left + 0.005) redirect(`${back}&error=overdv&bill=${encodeURIComponent(bill.billNo)}`);
    }
    lines.push({ billId: bill.id, amount: amounts[i], billNo: bill.billNo });
  }
  if (!lines.length) redirect(`${back}&error=empty`);
  const amount = round2(lines.reduce((s, l) => s + l.amount, 0));
  if (checkNo) {
    const dupe = await prisma.supplierPayment.findFirst({ where: { cashAccountId, checkNo: { equals: checkNo, mode: "insensitive" }, status: "Posted" }, select: { paymentNo: true } });
    if (dupe) redirect(`${back}&error=dupecheck&bill=${encodeURIComponent(dupe.paymentNo)}`);
  }

  const paymentNo = await nextSeriesNo("PY", company.id, date);
  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.supplierPayment.create({
      data: {
        companyId: company.id, paymentNo, date, supplierId, dvId: dv?.id ?? null, cashAccountId, method, checkNo, checkDate, refNo, amount, remarks,
        status: "Posted", createdById: user.id, lines: { create: lines.map((l) => ({ billId: l.billId, amount: l.amount })) },
      },
    });
    for (const l of lines) await settleBill(tx, l.billId);
    if (dv) await settleVoucher(tx, dv.id);
    return p;
  });
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { name: true } });
  await logAudit({
    entity: "SupplierPayment", entityId: payment.id, action: "PAID",
    detail: `${paymentNo} · ₱${amount.toFixed(2)} to ${supplier?.name ?? "supplier"} from ${cashAccount.name} by ${method}${checkNo ? ` cheque ${checkNo}` : ""}${dv ? ` under ${dv.dvNo}` : ""} · ${lines.map((l) => `${l.billNo} ₱${l.amount.toFixed(2)}`).join(", ")} · Dr Accounts Payable / Cr ${cashAccount.name}`,
    actorName: user.name, actorEmail: user.email, companyId: company.id,
  });
  for (const l of lines) await logAudit({ entity: "SupplierBill", entityId: l.billId, action: "PAID", detail: `₱${l.amount.toFixed(2)} paid by ${paymentNo}${dv ? ` under ${dv.dvNo}` : ""}`, actorName: user.name, actorEmail: user.email, companyId: company.id });
  if (dv) await logAudit({ entity: "DisbursementVoucher", entityId: dv.id, action: "PAID", detail: `₱${amount.toFixed(2)} paid by ${paymentNo}`, actorName: user.name, actorEmail: user.email, companyId: company.id });
  revalidatePath("/payments/bills");
  if (dv) revalidatePath(`/dv/${dv.id}`);
  redirect(`/payments/bills/${payment.id}?posted=ok`);
}

/** Void a payment: the bills owe the money again, the voucher is open again. Fresh sign-in and a reason. */
export async function voidSupplierPayment(formData: FormData) {
  const user = await requirePermWrite("payBills");
  if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const reason = String(formData.get("voidReason") || "").trim();
  const payment = await prisma.supplierPayment.findUnique({ where: { id }, include: { lines: true } });
  if (!payment || payment.companyId !== company.id) redirect("/payments/bills");
  if (payment.status === "Void") redirect(`/payments/bills/${id}?error=locked`);
  if (reason.length < 5) redirect(`/payments/bills/${id}?error=reason`);
  await requireStepUp(`/payments/bills/${id}`);
  await prisma.$transaction(async (tx) => {
    await tx.supplierPayment.update({ where: { id }, data: { status: "Void", voidedById: user.id, voidedAt: new Date(), voidReason: reason } });
    for (const l of payment.lines) await settleBill(tx, l.billId);
    if (payment.dvId) await settleVoucher(tx, payment.dvId);
  });
  await logAudit({ entity: "SupplierPayment", entityId: id, action: "VOIDED", detail: `${payment.paymentNo} voided — ${reason} · ₱${payment.amount.toFixed(2)} back onto the bills`, actorName: user.name, actorEmail: user.email, companyId: company.id, reason });
  revalidatePath(`/payments/bills/${id}`);
  revalidatePath("/payments/bills");
  redirect(`/payments/bills/${id}`);
}
