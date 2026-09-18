"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite, requireStepUp } from "@/lib/auth";
import { getPerm } from "@/lib/permissions";
import { getActiveCompany } from "@/lib/company";
import { logAudit } from "@/lib/salespeople";
import { OPEN_BILL_STATUSES, round2 } from "@/lib/bills";
import { checkVoucherDate, periodOf } from "@/lib/vouchers";
import { nextDvNo, dvEditBlocker, availableForVoucher, generateAccountLines, directPostBlockers } from "@/lib/dv";

const ADMINS = ["SUPER_ADMIN", "ADMIN"];

function formDate(raw: unknown): Date | null {
  const s = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function loadDv(id: string, companyId: string) {
  const dv = await prisma.disbursementVoucher.findUnique({
    where: { id },
    include: { supplier: true, employee: { select: { name: true } }, items: { orderBy: { sortOrder: "asc" } }, bills: { include: { bill: { select: { billNo: true, total: true, paidAmount: true, status: true } } } } },
  });
  if (!dv || dv.companyId !== companyId) redirect("/dv");
  return dv;
}

/**
 * Start a voucher for one payee — a supplier, an employee, or just a name. What it pays
 * (the payee's posted bills, or its own itemised particulars) is filled in on its page.
 */
export async function createDV(formData: FormData) {
  const user = await requirePermWrite("dv");
  const company = await getActiveCompany(user);
  const supplierId = String(formData.get("supplierId") || "");
  const employeeId = String(formData.get("employeeId") || "");
  const supplier = supplierId ? await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true } }) : null;
  const employee = !supplier && employeeId ? await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, name: true } }) : null;
  const payee = String(formData.get("payee") || "").trim() || supplier?.name || employee?.name || "";
  if (!payee) redirect("/dv/new?error=payee");
  const date = formDate(formData.get("date")) ?? new Date();
  const dvNo = await nextDvNo(company.id, date);
  const dv = await prisma.disbursementVoucher.create({
    data: {
      companyId: company.id, dvNo, supplierId: supplier?.id ?? null, employeeId: employee?.id ?? null, payee,
      date, terms: String(formData.get("terms") || "").trim() || null, particulars: String(formData.get("particulars") || "").trim(),
      padRef: String(formData.get("padRef") || "").trim() || null, memo: String(formData.get("memo") || "").trim() || null,
      status: "Draft", preparedById: user.id,
    },
  });
  const who = supplier ? `supplier ${supplier.name}` : employee ? `employee ${employee.name}` : payee;
  await logAudit({ entity: "DisbursementVoucher", entityId: dv.id, action: "CREATED", detail: `${dvNo} raised for ${who}`, actorName: user.name, actorEmail: user.email, companyId: company.id });
  redirect(`/dv/${dv.id}`);
}

/**
 * Save a Draft: header, particulars, the amount allocated to each of the payee's open bills,
 * the voucher's own items (each charged to an account; a negative is a deduction), and the
 * Account Title block as the office wants it printed.
 */
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
    if (!dv.supplierId) redirect(`/dv/${id}?error=bill`);
    const bill = await prisma.supplierBill.findFirst({ where: { id: billIds[i], companyId: company.id, supplierId: dv.supplierId, status: { in: OPEN_BILL_STATUSES } }, select: { id: true, billNo: true } });
    if (!bill) redirect(`/dv/${id}?error=bill`);
    const { available } = await availableForVoucher(bill.id, id);
    if (amounts[i] > available + 0.005) redirect(`/dv/${id}?error=over&bill=${encodeURIComponent(bill.billNo)}`);
    allocations.push({ billId: bill.id, amount: amounts[i], billNo: bill.billNo });
  }

  // the voucher's own items
  const itemAccounts = formData.getAll("itemAccountId").map(String);
  const itemDescs = formData.getAll("itemDescription").map((v) => String(v || "").trim());
  const itemAmounts = formData.getAll("itemAmount").map((v) => round2(Number(v) || 0));
  const items: { glAccountId: string | null; description: string; amount: number }[] = [];
  for (let i = 0; i < itemDescs.length; i++) {
    if (!itemDescs[i] && !itemAmounts[i] && !itemAccounts[i]) continue;
    let glAccountId: string | null = itemAccounts[i] || null;
    let accountName = "";
    if (glAccountId) {
      const a = await prisma.gLAccount.findFirst({ where: { id: glAccountId, status: "Active" }, select: { id: true, description: true } });
      if (!a) redirect(`/dv/${id}?error=account`);
      accountName = a.description;
    }
    items.push({ glAccountId, description: itemDescs[i] || accountName || "(item)", amount: itemAmounts[i] ?? 0 });
  }
  const directAmount = round2(items.reduce((s, i) => s + i.amount, 0));
  if (items.length && directAmount < 0) redirect(`/dv/${id}?error=negative`);
  const amount = round2(allocations.reduce((s, a) => s + a.amount, 0) + Math.max(0, directAmount));
  const date = formDate(formData.get("date")) ?? dv.date;
  const changes: string[] = [];

  // the Account Title block: whatever the form carries, each account verified against the chart
  const lineTitles = formData.getAll("lineTitle").map((v) => String(v || "").trim());
  const lineAccounts = formData.getAll("lineAccountId").map(String);
  const lineDebits = formData.getAll("lineDebit").map((v) => round2(Math.max(0, Number(v) || 0)));
  const lineCredits = formData.getAll("lineCredit").map((v) => round2(Math.max(0, Number(v) || 0)));
  const accountLines: { glAccountId: string | null; title: string; debit: number; credit: number }[] = [];
  for (let i = 0; i < lineTitles.length; i++) {
    if (!lineTitles[i] && !lineDebits[i] && !lineCredits[i]) continue;
    let glAccountId: string | null = lineAccounts[i] || null;
    if (glAccountId) {
      const a = await prisma.gLAccount.findFirst({ where: { id: glAccountId, status: "Active" }, select: { id: true } });
      if (!a) redirect(`/dv/${id}?error=account`);
    }
    accountLines.push({ glAccountId, title: lineTitles[i] || "(untitled)", debit: lineDebits[i] ?? 0, credit: lineCredits[i] ?? 0 });
  }
  const linesGiven = formData.getAll("lineTitle").length > 0;
  for (const a of allocations) {
    const before = dv.bills.find((b) => b.billId === a.billId);
    if (!before) changes.push(`${a.billNo}: ₱${a.amount.toFixed(2)} added`);
    else if (Math.abs(before.amount - a.amount) > 0.004) changes.push(`${a.billNo}: ₱${before.amount.toFixed(2)} → ₱${a.amount.toFixed(2)}`);
  }
  for (const b of dv.bills) if (!allocations.some((a) => a.billId === b.billId)) changes.push(`${b.bill.billNo}: removed`);
  if (Math.abs(dv.directAmount - directAmount) > 0.004 || dv.items.length !== items.length) changes.push(`Items: ${items.length} line(s), ₱${directAmount.toFixed(2)}`);
  if (Math.abs(dv.amount - amount) > 0.004) changes.push(`Amount: ₱${dv.amount.toFixed(2)} → ₱${amount.toFixed(2)}`);

  await prisma.$transaction(async (tx) => {
    await tx.dVBill.deleteMany({ where: { dvId: id } });
    if (allocations.length) await tx.dVBill.createMany({ data: allocations.map((a) => ({ dvId: id, billId: a.billId, amount: a.amount })) });
    await tx.dVItem.deleteMany({ where: { dvId: id } });
    if (items.length) await tx.dVItem.createMany({ data: items.map((it, i) => ({ dvId: id, ...it, sortOrder: i })) });
    if (linesGiven) {
      await tx.dVAccountLine.deleteMany({ where: { dvId: id } });
      if (accountLines.length) await tx.dVAccountLine.createMany({ data: accountLines.map((l, i) => ({ dvId: id, ...l, sortOrder: i })) });
    }
    await tx.disbursementVoucher.update({
      where: { id },
      data: {
        payee: String(formData.get("payee") || "").trim() || dv.supplier?.name || dv.employee?.name || dv.payee,
        date, terms: String(formData.get("terms") || "").trim() || null, particulars: String(formData.get("particulars") || "").trim(),
        padRef: String(formData.get("padRef") || "").trim() || null, memo: String(formData.get("memo") || "").trim() || null, amount, directAmount: Math.max(0, directAmount),
      },
    });
  });
  await logAudit({ entity: "DisbursementVoucher", entityId: id, action: "EDITED", detail: changes.length ? `${dv.dvNo} — ${changes.join("; ")}` : `${dv.dvNo} saved`, actorName: user.name, actorEmail: user.email, companyId: company.id });
  revalidatePath(`/dv/${id}`);
  redirect(`/dv/${id}?saved=ok`);
}

/** Throw away the edited Account Title block and rebuild it from the bills, items and payments. */
export async function regenerateDVLines(formData: FormData) {
  const user = await requirePermWrite("dv");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const dv = await prisma.disbursementVoucher.findUnique({
    where: { id },
    include: {
      company: { select: { glPayablesId: true, glPayables: { select: { code: true, description: true } }, glInputVatId: true, glInputVat: { select: { code: true, description: true } } } },
      bills: { include: { bill: { select: { billNo: true, kind: true, total: true, inputVat: true, supplier: { select: { name: true } }, expenseLines: { include: { glAccount: { select: { code: true, description: true } } } } } } } },
      items: { orderBy: { sortOrder: "asc" }, include: { glAccount: { select: { code: true, description: true } } } },
      payments: { where: { status: "Posted" }, include: { lines: { select: { amount: true } }, cashAccount: { include: { glAccount: { select: { code: true, description: true } } } } } },
    },
  });
  if (!dv || dv.companyId !== company.id) redirect("/dv");
  if (dvEditBlocker(dv)) redirect(`/dv/${id}?error=locked`);
  const lines = generateAccountLines(dv);
  await prisma.$transaction(async (tx) => {
    await tx.dVAccountLine.deleteMany({ where: { dvId: id } });
    if (lines.length) await tx.dVAccountLine.createMany({ data: lines.map((l, i) => ({ dvId: id, glAccountId: l.glAccountId, title: l.title, debit: l.debit, credit: l.credit, sortOrder: i })) });
  });
  await logAudit({ entity: "DisbursementVoucher", entityId: id, action: "EDITED", detail: `${dv.dvNo} — account lines regenerated`, actorName: user.name, actorEmail: user.email, companyId: company.id });
  revalidatePath(`/dv/${id}`);
  redirect(`/dv/${id}?saved=ok`);
}

/**
 * Walk the approval chain. Prepared = the clerk is done with it. Checked must be someone
 * other than the preparer. Approved and Posted need an Admin; Posted is the authorisation
 * to pay — the payee is NOT paid until a Payment is recorded against the voucher. Posting a
 * voucher that carries its own items also books them (Dr the items' accounts / Cr Accounts
 * Payable), so its date must fall in an open period and every item must name an account.
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
    if (dv.amount <= 0 || (!dv.bills.length && !dv.items.length)) redirect(`/dv/${id}?error=empty`);
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
      // the voucher's own items become an entry: accounts named, period open
      if (dv.items.length) {
        const blockers = directPostBlockers(dv);
        if (blockers.length) redirect(`/dv/${id}?error=items&bill=${encodeURIComponent(blockers[0])}`);
        const check = await checkVoucherDate({ companyId: company.id, voucherDate: dv.date, canPriorPeriod: getPerm(user, "priorPeriod") !== "NONE", noun: "voucher" });
        if (!check.ok) redirect(`/dv/${id}?error=period&bill=${encodeURIComponent(check.why ?? "")}`);
        const { year, month } = periodOf(dv.date);
        Object.assign(data, { accountingYear: year, accountingMonth: month });
      }
      Object.assign(data, { status: to, postedById: user.id, postedAt: now });
    }
  }
  await prisma.disbursementVoucher.update({ where: { id }, data });
  const booked = to === "Posted" && dv.items.length ? ` · booked ₱${dv.directAmount.toFixed(2)}: Dr ${dv.items.map((i) => i.description).join(", ")} / Cr Accounts Payable — ${dv.payee}` : "";
  await logAudit({ entity: "DisbursementVoucher", entityId: id, action: to === "Draft" ? "RETURNED" : to.toUpperCase(), detail: `${dv.dvNo}: ${from} → ${to}${to === "Posted" ? ` — ₱${dv.amount.toFixed(2)} authorised for payment to ${dv.payee}${booked}` : ""}`, actorName: user.name, actorEmail: user.email, companyId: company.id });
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

/** Void a voucher. Not once a payment has been made against it — reverse the payment first. A posted voucher's own items leave the books with it. */
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
  await logAudit({ entity: "DisbursementVoucher", entityId: id, action: "VOIDED", detail: `${dv.dvNo} voided from ${dv.status} — ${reason}${dv.status === "Posted" && dv.items.length ? ` · ₱${dv.directAmount.toFixed(2)} reversed out of the books` : ""}`, actorName: user.name, actorEmail: user.email, companyId: company.id, reason });
  revalidatePath(`/dv/${id}`);
  redirect(`/dv/${id}`);
}
