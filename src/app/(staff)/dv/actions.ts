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
import { nextDvNo, dvEditBlocker, availableForVoucher, directPostBlockers, lockBills } from "@/lib/dv";
import { defaultParticulars } from "@/lib/dv-text";

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
 * Start a voucher. The primary path: from one or more posted bills with an unvouchered
 * balance — all of one supplier, who becomes the payee — each with the amount this voucher
 * authorises. The allocations are reserved the moment the voucher is created, under row
 * locks on the bills, so no second voucher can claim the same peso. The secondary path: a
 * voucher with no bill (an employee, a government office, a name), whose own items are typed
 * on its page.
 */
export async function createDV(formData: FormData) {
  const user = await requirePermWrite("dv");
  const company = await getActiveCompany(user);
  const date = formDate(formData.get("date")) ?? new Date();
  const header = {
    date, terms: String(formData.get("terms") || "").trim() || null,
    padRef: String(formData.get("padRef") || "").trim() || null, memo: String(formData.get("memo") || "").trim() || null,
  };

  // bills ticked on the Search / Select Bills screen
  const billIds = formData.getAll("billId").map(String).filter(Boolean);
  const allocs = formData.getAll("alloc").map((v) => round2(Math.max(0, Number(v) || 0)));
  const picks = billIds.map((billId, i) => ({ billId, amount: allocs[i] ?? 0 })).filter((p) => p.amount > 0);

  if (picks.length) {
    const bills = await prisma.supplierBill.findMany({
      where: { id: { in: picks.map((p) => p.billId) }, companyId: company.id, status: { in: OPEN_BILL_STATUSES } },
      select: { id: true, billNo: true, kind: true, supplierInvoiceNo: true, supplierId: true, supplier: { select: { name: true } } },
    });
    if (bills.length !== picks.length) redirect("/dv/new?error=bill");
    const supplierIds = new Set(bills.map((b) => b.supplierId));
    if (supplierIds.size !== 1) redirect("/dv/new?error=mixed");
    const supplier = { id: bills[0].supplierId, name: bills[0].supplier.name };
    const payee = String(formData.get("payee") || "").trim() || supplier.name;
    const particulars = String(formData.get("particulars") || "").trim() || defaultParticulars(bills);
    const amount = round2(picks.reduce((s, p) => s + p.amount, 0));
    const dvNo = await nextDvNo(company.id, date);
    const dv = await prisma.$transaction(async (tx) => {
      await lockBills(tx, picks.map((p) => p.billId));
      for (const p of picks) {
        const { available } = await availableForVoucher(p.billId, undefined, tx);
        if (p.amount > available + 0.005) {
          const b = bills.find((x) => x.id === p.billId)!;
          redirect(`/dv/new?error=over&bill=${encodeURIComponent(b.billNo)}&avail=${available}`);
        }
      }
      return tx.disbursementVoucher.create({
        data: {
          companyId: company.id, dvNo, supplierId: supplier.id, employeeId: null, payee, ...header, particulars, amount,
          status: "Draft", preparedById: user.id,
          bills: { create: picks.map((p) => ({ billId: p.billId, amount: p.amount })) },
        },
      });
    });
    await logAudit({
      entity: "DisbursementVoucher", entityId: dv.id, action: "CREATED",
      detail: `${dvNo} raised for supplier ${supplier.name} from ${bills.map((b) => b.billNo).join(", ")} · ₱${amount.toFixed(2)} reserved`,
      actorName: user.name, actorEmail: user.email, companyId: company.id,
    });
    for (const p of picks) {
      const b = bills.find((x) => x.id === p.billId)!;
      await logAudit({ entity: "SupplierBill", entityId: b.id, action: "VOUCHERED", detail: `₱${p.amount.toFixed(2)} allocated on ${dvNo}`, actorName: user.name, actorEmail: user.email, companyId: company.id });
    }
    redirect(`/dv/${dv.id}`);
  }

  // no bill: an employee, a government office, a name
  const supplierId = String(formData.get("supplierId") || "");
  const employeeId = String(formData.get("employeeId") || "");
  const supplier = supplierId ? await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true } }) : null;
  const employee = !supplier && employeeId ? await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, name: true } }) : null;
  const payee = String(formData.get("payee") || "").trim() || supplier?.name || employee?.name || "";
  if (!payee) redirect("/dv/new?error=payee&nobill=1");
  const dvNo = await nextDvNo(company.id, date);
  const dv = await prisma.disbursementVoucher.create({
    data: {
      companyId: company.id, dvNo, supplierId: supplier?.id ?? null, employeeId: employee?.id ?? null, payee, ...header,
      particulars: String(formData.get("particulars") || "").trim(), status: "Draft", preparedById: user.id,
    },
  });
  const who = supplier ? `supplier ${supplier.name}` : employee ? `employee ${employee.name}` : payee;
  await logAudit({ entity: "DisbursementVoucher", entityId: dv.id, action: "CREATED", detail: `${dvNo} raised for ${who} (no bill)`, actorName: user.name, actorEmail: user.email, companyId: company.id });
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
  // the block is stored only when the office edited it; otherwise it is generated from the bills and items whenever shown
  const linesCustomised = String(formData.get("linesCustomised") || "0") === "1";
  for (const a of allocations) {
    const before = dv.bills.find((b) => b.billId === a.billId);
    if (!before) changes.push(`${a.billNo}: ₱${a.amount.toFixed(2)} added`);
    else if (Math.abs(before.amount - a.amount) > 0.004) changes.push(`${a.billNo}: ₱${before.amount.toFixed(2)} → ₱${a.amount.toFixed(2)}`);
  }
  for (const b of dv.bills) if (!allocations.some((a) => a.billId === b.billId)) changes.push(`${b.bill.billNo}: removed`);
  if (Math.abs(dv.directAmount - directAmount) > 0.004 || dv.items.length !== items.length) changes.push(`Items: ${items.length} line(s), ₱${directAmount.toFixed(2)}`);
  if (Math.abs(dv.amount - amount) > 0.004) changes.push(`Amount: ₱${dv.amount.toFixed(2)} → ₱${amount.toFixed(2)}`);

  await prisma.$transaction(async (tx) => {
    // the bills are locked while this voucher's claim on them is re-checked and written
    await lockBills(tx, allocations.map((a) => a.billId));
    for (const a of allocations) {
      const { available } = await availableForVoucher(a.billId, id, tx);
      if (a.amount > available + 0.005) redirect(`/dv/${id}?error=over&bill=${encodeURIComponent(a.billNo)}&avail=${available}`);
    }
    await tx.dVBill.deleteMany({ where: { dvId: id } });
    if (allocations.length) await tx.dVBill.createMany({ data: allocations.map((a) => ({ dvId: id, billId: a.billId, amount: a.amount })) });
    await tx.dVItem.deleteMany({ where: { dvId: id } });
    if (items.length) await tx.dVItem.createMany({ data: items.map((it, i) => ({ dvId: id, ...it, sortOrder: i })) });
    await tx.dVAccountLine.deleteMany({ where: { dvId: id } });
    if (linesCustomised && accountLines.length) await tx.dVAccountLine.createMany({ data: accountLines.map((l, i) => ({ dvId: id, ...l, sortOrder: i })) });
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

/** Forget the edited Account Title block: the voucher shows the block generated from its bills and items again. */
export async function regenerateDVLines(formData: FormData) {
  const user = await requirePermWrite("dv");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const dv = await loadDv(id, company.id);
  if (dvEditBlocker(dv)) redirect(`/dv/${id}?error=locked`);
  await prisma.dVAccountLine.deleteMany({ where: { dvId: id } });
  await logAudit({ entity: "DisbursementVoucher", entityId: id, action: "EDITED", detail: `${dv.dvNo} — account lines follow the bills and items again`, actorName: user.name, actorEmail: user.email, companyId: company.id });
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
  if (to === "Posted" && dv.bills.length) {
    // the bills must still be open and not authorised elsewhere — checked under row locks, so a
    // voucher posted at the same moment cannot take the same peso
    await prisma.$transaction(async (tx) => {
      await lockBills(tx, dv.bills.map((b) => b.billId));
      for (const b of dv.bills) {
        const { available } = await availableForVoucher(b.billId, id, tx);
        if (b.amount > available + 0.005) redirect(`/dv/${id}?error=over&bill=${encodeURIComponent(b.bill.billNo)}&avail=${available}`);
      }
      await tx.disbursementVoucher.update({ where: { id }, data });
    });
  } else {
    await prisma.disbursementVoucher.update({ where: { id }, data });
  }
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
