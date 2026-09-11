"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite, requireStepUp } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { logAudit } from "@/lib/salespeople";
import { OPEN_BILL_STATUSES, round2 } from "@/lib/bills";
import { nextDvNo, dvEditBlocker, availableForVoucher } from "@/lib/dv";

const ADMINS = ["SUPER_ADMIN", "ADMIN"];

function formDate(raw: unknown): Date | null {
  const s = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function loadDv(id: string, companyId: string) {
  const dv = await prisma.disbursementVoucher.findUnique({ where: { id }, include: { supplier: true, bills: { include: { bill: { select: { billNo: true, total: true, paidAmount: true, status: true } } } } } });
  if (!dv || dv.companyId !== companyId) redirect("/dv");
  return dv;
}

/** Start a voucher for one payee. The bills it covers are allocated on its page. */
export async function createDV(formData: FormData) {
  const user = await requirePermWrite("dv");
  const company = await getActiveCompany(user);
  const supplierId = String(formData.get("supplierId") || "");
  const supplier = supplierId ? await prisma.supplier.findUnique({ where: { id: supplierId } }) : null;
  if (!supplier) redirect("/dv/new?error=supplier");
  const date = formDate(formData.get("date")) ?? new Date();
  const dvNo = await nextDvNo(company.id, date);
  const dv = await prisma.disbursementVoucher.create({
    data: {
      companyId: company.id, dvNo, supplierId: supplier.id, payee: String(formData.get("payee") || "").trim() || supplier.name,
      date, terms: String(formData.get("terms") || "").trim() || null, particulars: String(formData.get("particulars") || "").trim(),
      padRef: String(formData.get("padRef") || "").trim() || null, memo: String(formData.get("memo") || "").trim() || null,
      status: "Draft", preparedById: user.id,
    },
  });
  await logAudit({ entity: "DisbursementVoucher", entityId: dv.id, action: "CREATED", detail: `${dvNo} raised for ${supplier.name}`, actorName: user.name, actorEmail: user.email, companyId: company.id });
  redirect(`/dv/${dv.id}`);
}

/** Save a Draft: header, particulars and the amount allocated to each of the payee's open bills. */
export async function saveDV(formData: FormData) {
  const user = await requirePermWrite("dv");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const dv = await loadDv(id, company.id);
  if (dvEditBlocker(dv)) redirect(`/dv/${id}?error=locked`);

  const billIds = formData.getAll("billId").map(String);
  const amounts = formData.getAll("alloc").map((v) => round2(Math.max(0, Number(v) || 0)));
  const allocations: { billId: string; amount: number; billNo: string }[] = [];
  for (let i = 0; i < billIds.length; i++) {
    if (!billIds[i] || amounts[i] <= 0) continue;
    const bill = await prisma.supplierBill.findFirst({ where: { id: billIds[i], companyId: company.id, supplierId: dv.supplierId, status: { in: OPEN_BILL_STATUSES } }, select: { id: true, billNo: true } });
    if (!bill) redirect(`/dv/${id}?error=bill`);
    const { available } = await availableForVoucher(bill.id, id);
    if (amounts[i] > available + 0.005) redirect(`/dv/${id}?error=over&bill=${encodeURIComponent(bill.billNo)}`);
    allocations.push({ billId: bill.id, amount: amounts[i], billNo: bill.billNo });
  }
  const amount = round2(allocations.reduce((s, a) => s + a.amount, 0));
  const date = formDate(formData.get("date")) ?? dv.date;
  const changes: string[] = [];
  for (const a of allocations) {
    const before = dv.bills.find((b) => b.billId === a.billId);
    if (!before) changes.push(`${a.billNo}: ₱${a.amount.toFixed(2)} added`);
    else if (Math.abs(before.amount - a.amount) > 0.004) changes.push(`${a.billNo}: ₱${before.amount.toFixed(2)} → ₱${a.amount.toFixed(2)}`);
  }
  for (const b of dv.bills) if (!allocations.some((a) => a.billId === b.billId)) changes.push(`${b.bill.billNo}: removed`);
  if (Math.abs(dv.amount - amount) > 0.004) changes.push(`Amount: ₱${dv.amount.toFixed(2)} → ₱${amount.toFixed(2)}`);

  await prisma.$transaction(async (tx) => {
    await tx.dVBill.deleteMany({ where: { dvId: id } });
    if (allocations.length) await tx.dVBill.createMany({ data: allocations.map((a) => ({ dvId: id, billId: a.billId, amount: a.amount })) });
    await tx.disbursementVoucher.update({
      where: { id },
      data: {
        payee: String(formData.get("payee") || "").trim() || dv.supplier.name,
        date, terms: String(formData.get("terms") || "").trim() || null, particulars: String(formData.get("particulars") || "").trim(),
        padRef: String(formData.get("padRef") || "").trim() || null, memo: String(formData.get("memo") || "").trim() || null, amount,
      },
    });
  });
  await logAudit({ entity: "DisbursementVoucher", entityId: id, action: "EDITED", detail: changes.length ? `${dv.dvNo} — ${changes.join("; ")}` : `${dv.dvNo} saved`, actorName: user.name, actorEmail: user.email, companyId: company.id });
  revalidatePath(`/dv/${id}`);
  redirect(`/dv/${id}?saved=ok`);
}

/**
 * Walk the approval chain. Prepared = the clerk is done with it. Checked must be someone
 * other than the preparer. Approved and Posted need an Admin; Posted is the authorisation
 * to pay — the supplier is NOT paid until a Payment is recorded against the voucher.
 */
export async function advanceDV(formData: FormData) {
  const user = await requirePermWrite("dv");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const to = String(formData.get("to"));
  const dv = await loadDv(id, company.id);
  const now = new Date();
  const data: Record<string, unknown> = {};
  const order = ["Draft", "Prepared", "Checked", "Approved", "Posted"];
  const from = dv.status;

  if (to === "Draft") {
    if (!["Prepared", "Checked", "Approved"].includes(from)) redirect(`/dv/${id}?error=step`);
    Object.assign(data, { status: "Draft", checkedById: null, checkedAt: null, approvedById: null, approvedAt: null });
  } else {
    if (order.indexOf(to) !== order.indexOf(from) + 1) redirect(`/dv/${id}?error=step`);
    if (dv.amount <= 0 || !dv.bills.length) redirect(`/dv/${id}?error=empty`);
    if (to === "Prepared") Object.assign(data, { status: to, preparedById: user.id, preparedAt: now });
    if (to === "Checked") {
      if (dv.preparedById === user.id && user.role !== "SUPER_ADMIN") redirect(`/dv/${id}?error=samecheck`);
      Object.assign(data, { status: to, checkedById: user.id, checkedAt: now });
    }
    if (to === "Approved") {
      if (!ADMINS.includes(user.role)) redirect("/denied");
      Object.assign(data, { status: to, approvedById: user.id, approvedAt: now });
    }
    if (to === "Posted") {
      if (!ADMINS.includes(user.role)) redirect("/denied");
      // the bills must still be open and not already authorised elsewhere
      for (const b of dv.bills) {
        const { available } = await availableForVoucher(b.billId, id);
        if (b.amount > available + 0.005) redirect(`/dv/${id}?error=over&bill=${encodeURIComponent(b.bill.billNo)}`);
      }
      Object.assign(data, { status: to, postedById: user.id, postedAt: now });
    }
  }
  await prisma.disbursementVoucher.update({ where: { id }, data });
  await logAudit({ entity: "DisbursementVoucher", entityId: id, action: to === "Draft" ? "RETURNED" : to.toUpperCase(), detail: `${dv.dvNo}: ${from} → ${to}${to === "Posted" ? ` — ₱${dv.amount.toFixed(2)} authorised for payment to ${dv.payee}` : ""}`, actorName: user.name, actorEmail: user.email, companyId: company.id });
  revalidatePath(`/dv/${id}`);
  redirect(`/dv/${id}`);
}

/** "Noted by" is the fifth signature on the form — an Admin's acknowledgement, at any stage before payment. */
export async function noteDV(formData: FormData) {
  const user = await requirePermWrite("dv");
  if (!ADMINS.includes(user.role)) redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const dv = await loadDv(id, company.id);
  if (dv.status === "Void") redirect(`/dv/${id}?error=locked`);
  await prisma.disbursementVoucher.update({ where: { id }, data: { notedById: user.id, notedAt: new Date() } });
  await logAudit({ entity: "DisbursementVoucher", entityId: id, action: "NOTED", detail: `${dv.dvNo} noted`, actorName: user.name, actorEmail: user.email, companyId: company.id });
  revalidatePath(`/dv/${id}`);
  redirect(`/dv/${id}`);
}

/** Void a voucher. Not once a payment has been made against it — reverse the payment first. */
export async function voidDV(formData: FormData) {
  const user = await requirePermWrite("dv");
  if (!ADMINS.includes(user.role)) redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const reason = String(formData.get("voidReason") || "").trim();
  const dv = await loadDv(id, company.id);
  if (dv.status === "Void") redirect(`/dv/${id}?error=locked`);
  if (dv.paidAmount > 0) redirect(`/dv/${id}?error=paid`);
  if (reason.length < 5) redirect(`/dv/${id}?error=reason`);
  if (dv.status === "Posted") await requireStepUp(`/dv/${id}`);
  await prisma.disbursementVoucher.update({ where: { id }, data: { status: "Void", voidedById: user.id, voidedAt: new Date(), voidReason: reason } });
  await logAudit({ entity: "DisbursementVoucher", entityId: id, action: "VOIDED", detail: `${dv.dvNo} voided from ${dv.status} — ${reason}`, actorName: user.name, actorEmail: user.email, companyId: company.id, reason });
  revalidatePath(`/dv/${id}`);
  redirect(`/dv/${id}`);
}
