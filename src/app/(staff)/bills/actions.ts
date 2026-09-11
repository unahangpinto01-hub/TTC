"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite, requireStepUp } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { getPerm } from "@/lib/permissions";
import { logAudit } from "@/lib/salespeople";
import { recomputeStockChain } from "@/lib/stock";
import { convertToBaseUnit, parseUnit, UnitError } from "@/lib/units";
import { checkVoucherDate, periodOf, periodLabel } from "@/lib/vouchers";
import {
  computeBill, dueDateFor, nextBillNo, postBlockers, billEditBlocker, billVoidBlocker,
  DEFAULT_TERMS, TERMS, round2,
} from "@/lib/bills";

const POSTERS = ["SUPER_ADMIN", "ADMIN"];

const money = (n: unknown) => round2(Math.max(0, Number(n) || 0));

function formDate(raw: unknown): Date | null {
  const s = String(raw || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The stock-card date a bill posts under: its own date, at end of day when that day is
    already past, otherwise right now — the same rule receiving and deliveries use. */
function effectiveDate(billDate: Date): Date {
  const end = new Date(billDate);
  end.setHours(23, 59, 59, 999);
  return end.getTime() < Date.now() ? end : new Date();
}

function header(formData: FormData) {
  const terms = String(formData.get("terms") || DEFAULT_TERMS);
  return {
    supplierInvoiceNo: String(formData.get("supplierInvoiceNo") || "").trim() || null,
    invoiceUnavailable: formData.get("invoiceUnavailable") === "on",
    terms: (TERMS as readonly string[]).includes(terms) ? terms : DEFAULT_TERMS,
    memo: String(formData.get("memo") || "").trim() || null,
    freight: money(formData.get("freight")),
    otherCosts: money(formData.get("otherCosts")),
    allocationBasis: String(formData.get("allocationBasis")) === "qty" ? "qty" : "value",
    vatRate: formData.get("applyVat") === "on" ? 0.12 : 0,
  };
}

/**
 * Start a bill. Raised from a posted receipt it copies the accepted lines; from a purchase
 * order, the lines still outstanding; on its own, it starts empty. A Draft touches nothing.
 */
export async function createBill(formData: FormData) {
  const user = await requirePermWrite("bills");
  const company = await getActiveCompany(user);
  const h = header(formData);
  const billDate = formDate(formData.get("billDate")) ?? new Date();
  const dueDate = formDate(formData.get("dueDate")) ?? dueDateFor(billDate, h.terms);

  let supplierId = String(formData.get("supplierId") || "");
  const grnId = String(formData.get("goodsReceiptId") || "");
  const poIdRaw = String(formData.get("purchaseOrderId") || "");
  let purchaseOrderId: string | null = null;
  let goodsReceiptId: string | null = null;
  let supplierInvoiceNo = h.supplierInvoiceNo;

  type NewLine = {
    productId: string; grnLineId: string | null; poLineId: string | null; batchNo: string | null; expDate: Date | null;
    qty: number; unit: string; baseQty: number; unitCost: number; discount: number;
  };
  let lines: NewLine[] = [];

  if (grnId) {
    const grn = await prisma.goodsReceipt.findUnique({
      where: { id: grnId },
      include: { purchaseOrder: true, lines: { include: { poLine: true } }, bills: { where: { status: { not: "Void" } }, select: { billNo: true } } },
    });
    if (!grn || grn.companyId !== company.id) redirect("/bills/new?error=grn");
    if (grn.status !== "Posted") redirect("/bills/new?error=grnstatus");
    if (grn.bills.length) redirect(`/bills/new?error=grnbilled&ref=${encodeURIComponent(grn.bills[0].billNo)}`);
    // the goods belong to the receipt's supplier — a bill cannot name another
    supplierId = grn.purchaseOrder.supplierId;
    goodsReceiptId = grn.id;
    purchaseOrderId = grn.purchaseOrderId;
    supplierInvoiceNo = supplierInvoiceNo ?? grn.supplierInvoiceNo;
    lines = grn.lines
      .filter((l) => l.acceptedQty > 0)
      .map((l) => ({
        productId: l.productId, grnLineId: l.id, poLineId: l.poLineId, batchNo: l.batchNo, expDate: l.expDate,
        qty: l.acceptedQty, unit: l.unit, baseQty: l.acceptedBaseQty, unitCost: l.unitCost, discount: 0,
      }));
  } else if (poIdRaw) {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: poIdRaw }, include: { lines: true } });
    if (!po || po.companyId !== company.id) redirect("/bills/new?error=po");
    if (["Draft", "Cancelled"].includes(po.status)) redirect("/bills/new?error=postatus");
    supplierId = po.supplierId;
    purchaseOrderId = po.id;
    lines = po.lines
      .filter((l) => l.qty - l.receivedQty > 0)
      .map((l) => {
        const remaining = l.qty - l.receivedQty;
        const factor = l.qty > 0 ? l.baseQty / l.qty : 1;
        return {
          productId: l.productId, grnLineId: null, poLineId: l.id, batchNo: null, expDate: null,
          qty: remaining, unit: l.unit, baseQty: Math.round(remaining * factor), unitCost: l.unitCost, discount: 0,
        };
      });
  }

  if (!supplierId) redirect("/bills/new?error=supplier");
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true } });
  if (!supplier) redirect("/bills/new?error=supplier");

  const math = computeBill(lines, h);
  const billNo = await nextBillNo(company.id, billDate);
  const bill = await prisma.supplierBill.create({
    data: {
      companyId: company.id,
      billNo,
      supplierId,
      supplierInvoiceNo,
      invoiceUnavailable: h.invoiceUnavailable,
      billDate,
      dueDate,
      terms: h.terms,
      purchaseOrderId,
      goodsReceiptId,
      memo: h.memo,
      status: "Draft",
      subtotal: math.subtotal,
      freight: math.freight,
      otherCosts: math.otherCosts,
      allocationBasis: h.allocationBasis,
      vatRate: h.vatRate,
      inputVat: math.inputVat,
      total: math.total,
      createdById: user.id,
      lines: { create: lines.map((l, i) => ({ ...l, ...math.lines[i] })) },
    },
  });
  await logAudit({
    entity: "SupplierBill",
    entityId: bill.id,
    action: "CREATED",
    detail:
      `${billNo} raised for ${supplier.name}` +
      (goodsReceiptId ? ` from receipt` : purchaseOrderId ? ` from purchase order` : "") +
      ` — ${lines.length} line(s), ₱${math.total.toFixed(2)}`,
    actorName: user.name,
    actorEmail: user.email,
    companyId: company.id,
  });
  redirect(`/bills/${bill.id}`);
}

/**
 * Save a Draft: header, costs and lines. A bill raised from a receipt keeps the receipt's
 * products and quantities — those are what physically arrived — and only the costs,
 * discounts and batch details can change. Any other bill rebuilds its lines from the form.
 */
export async function saveBill(formData: FormData) {
  const user = await requirePermWrite("bills");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const bill = await prisma.supplierBill.findUnique({
    where: { id },
    include: { supplier: true, lines: { include: { product: true }, orderBy: { id: "asc" } } },
  });
  if (!bill || bill.companyId !== company.id) redirect("/bills");
  if (billEditBlocker(bill)) redirect(`/bills/${id}?error=locked`);

  const h = header(formData);
  const billDate = formDate(formData.get("billDate")) ?? bill.billDate;
  const dueDate = formDate(formData.get("dueDate")) ?? dueDateFor(billDate, h.terms);
  const changes: string[] = [];

  // supplier may change only on a bill that is not tied to a receipt or an order
  let supplierId = bill.supplierId;
  const askedSupplier = String(formData.get("supplierId") || "");
  if (askedSupplier && askedSupplier !== bill.supplierId && !bill.goodsReceiptId && !bill.purchaseOrderId) {
    const s = await prisma.supplier.findUnique({ where: { id: askedSupplier }, select: { id: true, name: true } });
    if (!s) redirect(`/bills/${id}?error=supplier`);
    changes.push(`Supplier: ${bill.supplier.name} → ${s.name}`);
    supplierId = s.id;
  }

  const lineIds = formData.getAll("lineId").map(String);
  const productIds = formData.getAll("productId").map(String);
  const qtys = formData.getAll("qty").map((v) => Math.floor(Number(v) || 0));
  const units = formData.getAll("unit").map(parseUnit);
  const costs = formData.getAll("cost").map((v) => Number(v) || 0);
  const discs = formData.getAll("disc").map(money);
  const batches = formData.getAll("batch").map((v) => String(v || "").trim() || null);
  const exps = formData.getAll("exp").map((v) => {
    const raw = String(v || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00.000Z`) : null;
  });

  type Row = {
    id: string | null; productId: string; grnLineId: string | null; poLineId: string | null;
    qty: number; unit: string; baseQty: number; unitCost: number; discount: number; batchNo: string | null; expDate: Date | null;
  };
  const rows: Row[] = [];
  const productCache = new Map(bill.lines.map((l) => [l.productId, l.product]));

  for (let i = 0; i < lineIds.length; i++) {
    const existing = bill.lines.find((l) => l.id === lineIds[i]) ?? null;
    if (bill.goodsReceiptId) {
      // receipt-backed: product and quantity are the receipt's; a line cannot be dropped or added
      if (!existing) continue;
      rows.push({
        id: existing.id, productId: existing.productId, grnLineId: existing.grnLineId, poLineId: existing.poLineId,
        qty: existing.qty, unit: existing.unit, baseQty: existing.baseQty,
        unitCost: costs[i] > 0 ? round2(costs[i]) : existing.unitCost, discount: discs[i] ?? 0, batchNo: batches[i] ?? null, expDate: exps[i] ?? null,
      });
      continue;
    }
    const productId = productIds[i] || existing?.productId || "";
    if (!productId || qtys[i] <= 0) continue; // a blank row is simply not a line
    let product = productCache.get(productId);
    if (!product) {
      const p = await prisma.product.findFirst({ where: { id: productId, companyId: company.id } });
      if (!p) redirect(`/bills/${id}?error=product`);
      product = p;
      productCache.set(productId, p);
    }
    let baseQty: number;
    try {
      baseQty = convertToBaseUnit(qtys[i], units[i] ?? "PCS", product);
    } catch (e) {
      if (e instanceof UnitError) redirect(`/bills/${id}?error=nocarton`);
      throw e;
    }
    const unit = units[i] ?? "PCS";
    const unitCost = costs[i] > 0 ? round2(costs[i]) : unit === "CARTON" ? round2(product.unitCost * (baseQty / qtys[i])) : product.unitCost;
    rows.push({
      id: existing?.id ?? null, productId, grnLineId: null, poLineId: existing?.poLineId ?? null,
      qty: qtys[i], unit, baseQty, unitCost, discount: discs[i] ?? 0, batchNo: batches[i] ?? null, expDate: exps[i] ?? null,
    });
  }
  if (bill.goodsReceiptId && rows.length !== bill.lines.length) {
    // a receipt-backed line went missing from the form — keep the receipt's lines whole
    for (const l of bill.lines) {
      if (!rows.some((r) => r.id === l.id)) {
        rows.push({
          id: l.id, productId: l.productId, grnLineId: l.grnLineId, poLineId: l.poLineId, qty: l.qty, unit: l.unit, baseQty: l.baseQty,
          unitCost: l.unitCost, discount: l.discount, batchNo: l.batchNo, expDate: l.expDate,
        });
      }
    }
  }

  const math = computeBill(rows, h);

  // what changed, for the audit trail — every quantity, cost and batch is named
  for (const r of rows) {
    const before = r.id ? bill.lines.find((l) => l.id === r.id) : null;
    const name = productCache.get(r.productId)?.name ?? r.productId;
    if (!before) { changes.push(`Added ${name} × ${r.qty} ${r.unit} @ ${r.unitCost.toFixed(2)}`); continue; }
    if (before.qty !== r.qty || before.unit !== r.unit) changes.push(`${name}: qty ${before.qty} ${before.unit} → ${r.qty} ${r.unit}`);
    if (Math.abs(before.unitCost - r.unitCost) > 0.004) changes.push(`${name}: cost ${before.unitCost.toFixed(2)} → ${r.unitCost.toFixed(2)}`);
    if (Math.abs(before.discount - r.discount) > 0.004) changes.push(`${name}: discount ${before.discount.toFixed(2)} → ${r.discount.toFixed(2)}`);
    if ((before.batchNo ?? "") !== (r.batchNo ?? "")) changes.push(`${name}: batch ${before.batchNo ?? "(none)"} → ${r.batchNo ?? "(none)"}`);
  }
  for (const l of bill.lines) {
    if (!rows.some((r) => r.id === l.id)) changes.push(`Removed ${l.product.name} × ${l.qty} ${l.unit}`);
  }
  if ((bill.supplierInvoiceNo ?? "") !== (h.supplierInvoiceNo ?? "")) changes.push(`Supplier invoice: ${bill.supplierInvoiceNo ?? "(none)"} → ${h.supplierInvoiceNo ?? "(none)"}`);
  if (bill.billDate.toDateString() !== billDate.toDateString()) changes.push(`Bill date: ${bill.billDate.toDateString()} → ${billDate.toDateString()}`);
  if (bill.dueDate.toDateString() !== dueDate.toDateString()) changes.push(`Due date: ${bill.dueDate.toDateString()} → ${dueDate.toDateString()}`);
  if (Math.abs(bill.freight - math.freight) > 0.004 || Math.abs(bill.otherCosts - math.otherCosts) > 0.004)
    changes.push(`Freight/other: ${bill.freight.toFixed(2)} + ${bill.otherCosts.toFixed(2)} → ${math.freight.toFixed(2)} + ${math.otherCosts.toFixed(2)}`);
  if (Math.abs(bill.total - math.total) > 0.004) changes.push(`Total: ${bill.total.toFixed(2)} → ${math.total.toFixed(2)}`);

  await prisma.$transaction(async (tx) => {
    const keep = rows.filter((r) => r.id).map((r) => r.id!);
    await tx.supplierBillLine.deleteMany({ where: { billId: id, id: { notIn: keep } } });
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const data = {
        productId: r.productId, grnLineId: r.grnLineId, poLineId: r.poLineId, batchNo: r.batchNo, expDate: r.expDate,
        qty: r.qty, unit: r.unit, baseQty: r.baseQty, unitCost: r.unitCost, discount: r.discount, ...math.lines[i],
      };
      if (r.id) await tx.supplierBillLine.update({ where: { id: r.id }, data });
      else await tx.supplierBillLine.create({ data: { billId: id, ...data } });
    }
    await tx.supplierBill.update({
      where: { id },
      data: {
        supplierId,
        supplierInvoiceNo: h.supplierInvoiceNo,
        invoiceUnavailable: h.invoiceUnavailable,
        billDate,
        dueDate,
        terms: h.terms,
        memo: h.memo,
        subtotal: math.subtotal,
        freight: math.freight,
        otherCosts: math.otherCosts,
        allocationBasis: h.allocationBasis,
        vatRate: h.vatRate,
        inputVat: math.inputVat,
        total: math.total,
      },
    });
  });

  await logAudit({
    entity: "SupplierBill",
    entityId: id,
    action: "EDITED",
    detail: changes.length ? `${bill.billNo} — ${changes.join("; ")}` : `${bill.billNo} saved (no change)`,
    actorName: user.name,
    actorEmail: user.email,
    companyId: company.id,
  });
  revalidatePath(`/bills/${id}`);
  redirect(`/bills/${id}?saved=ok`);
}

/**
 * Post the bill — the one step that moves inventory and money.
 *
 *   Dr Inventory           product cost + allocated freight and other costs
 *   Dr Input VAT           the VAT on the bill
 *       Cr Accounts Payable    the whole bill
 *
 * Each line goes into stock at its inventory cost per piece and folds into the product's
 * weighted average. A line billed against a receipt that had ALREADY stocked (receipts
 * posted before receiving stopped stocking) adds no quantity; instead the difference
 * between what the receipt stocked at and what the bill says re-costs the pieces on hand.
 */
export async function postBill(formData: FormData) {
  const user = await requirePermWrite("bills");
  if (!POSTERS.includes(user.role)) redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const bill = await prisma.supplierBill.findUnique({
    where: { id },
    include: {
      supplier: true,
      goodsReceipt: { include: { lines: { include: { poLine: true } } } },
      lines: { include: { product: true }, orderBy: { id: "asc" } },
    },
  });
  if (!bill || bill.companyId !== company.id) redirect("/bills");
  if (bill.status !== "Draft") redirect(`/bills/${id}?error=locked`);

  const blockers = await postBlockers(bill);
  if (blockers.length) redirect(`/bills/${id}?error=blocked`);

  const reason = String(formData.get("periodReason") || "").trim();
  const check = await checkVoucherDate({ companyId: company.id, voucherDate: bill.billDate, canPriorPeriod: getPerm(user, "priorPeriod") !== "NONE", noun: "bill" });
  if (!check.ok) redirect(`/bills/${id}?error=period`);
  if (check.reasonRequired && reason.length < 5) redirect(`/bills/${id}?error=reason`);

  const grn = bill.goodsReceipt;
  const alreadyStocked = !!grn?.stockedAt;
  const at = effectiveDate(bill.billDate);
  const backdated = at.getTime() < Date.now() - 60 * 1000;
  const { year, month } = periodOf(bill.billDate);
  const notes: string[] = [];
  let stockedPcs = 0;

  try {
    await prisma.$transaction(async (tx) => {
      for (const line of bill.lines) {
        // stock and cost are read inside the transaction — another posting may have moved them
        const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId } });
        const grnLine = grn?.lines.find((g) => g.id === line.grnLineId) ?? null;

        if (alreadyStocked && grnLine) {
          // the pieces are on the shelf already, valued at the receipt's cost — move them to the billed cost
          const receiptCost = round2(grnLine.unitCost * grnLine.acceptedQty);
          const delta = round2(line.inventoryCost - receiptCost);
          if (Math.abs(delta) >= 0.01 && product.stockQty > 0) {
            const newAvg = Math.max(0, (product.stockQty * product.unitCost + delta) / product.stockQty);
            await tx.product.update({ where: { id: product.id }, data: { unitCost: newAvg } });
            notes.push(`${product.name}: re-costed by ₱${delta.toFixed(2)} (avg ${product.unitCost.toFixed(4)} → ${newAvg.toFixed(4)})`);
          } else if (Math.abs(delta) >= 0.01) {
            notes.push(`${product.name}: ₱${delta.toFixed(2)} cost difference not applied — no stock on hand`);
          }
          continue;
        }

        const basePcs = line.baseQty;
        const costPerPcs = basePcs > 0 ? line.inventoryCost / basePcs : 0;
        const oldQty = Math.max(0, product.stockQty);
        const newAvg = oldQty > 0 ? (oldQty * product.unitCost + basePcs * costPerPcs) / (oldQty + basePcs) : costPerPcs;
        const newStock = product.stockQty + basePcs;
        await tx.product.update({ where: { id: product.id }, data: { stockQty: newStock, unitCost: newAvg } });
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            type: "IN",
            qty: basePcs,
            balanceAfter: newStock,
            enteredQty: line.qty,
            enteredUnit: line.unit,
            refType: "BILL",
            // the movement names the bill and, when there is one, the receipt it stocks
            refNo: grn ? `${bill.billNo} / ${grn.grnNumber}` : bill.billNo,
            supplierRef: bill.supplierInvoiceNo ?? grn?.deliveryRefNo ?? null,
            date: at,
            userId: user.id,
          },
        });
        await tx.supplierBillLine.update({ where: { id: line.id }, data: { stockedBaseQty: basePcs } });
        if (backdated) await recomputeStockChain(tx, product.id);
        stockedPcs += basePcs;

        // a bill straight off a purchase order, with no receipt in between, is the receiving
        if (!grn && line.poLineId) {
          await tx.pOLine.update({ where: { id: line.poLineId }, data: { receivedQty: { increment: line.qty } } });
        }
      }

      if (grn && !alreadyStocked) {
        await tx.goodsReceipt.update({ where: { id: grn.id }, data: { stockedAt: new Date() } });
      }
      if (!grn && bill.purchaseOrderId) {
        const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: bill.purchaseOrderId }, include: { lines: true } });
        const fully = po.lines.every((l) => l.receivedQty >= l.qty);
        const any = po.lines.some((l) => l.receivedQty > 0);
        if (!["Closed", "Cancelled"].includes(po.status)) {
          await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: fully ? "Received" : any ? "Partially Received" : po.status } });
        }
      }

      await tx.supplierBill.update({
        where: { id },
        data: {
          status: "Posted",
          postedAt: new Date(),
          postedById: user.id,
          accountingYear: year,
          accountingMonth: month,
          periodReason: check.reasonRequired ? reason : null,
        },
      });
    }, { timeout: 60000 });
  } catch (e) {
    if (e instanceof UnitError) redirect(`/bills/${id}?error=history`);
    throw e;
  }

  await logAudit({
    entity: "SupplierBill",
    entityId: id,
    action: "POSTED",
    detail:
      `${bill.billNo} posted · ${periodLabel(year, month)} · Dr Inventory ₱${round2(bill.subtotal + bill.freight + bill.otherCosts).toFixed(2)}` +
      (bill.inputVat ? ` · Dr Input VAT ₱${bill.inputVat.toFixed(2)}` : "") +
      ` · Cr Accounts Payable ₱${bill.total.toFixed(2)} (${bill.supplier.name}, due ${bill.dueDate.toDateString()})` +
      (stockedPcs ? ` · ${stockedPcs.toLocaleString()} PCS into stock` : alreadyStocked ? ` · receipt had already stocked the goods` : "") +
      (notes.length ? ` · ${notes.join("; ")}` : "") +
      (check.reasonRequired ? ` · prior-period adjustment: ${reason}` : ""),
    actorName: user.name,
    actorEmail: user.email,
    companyId: company.id,
    reason: check.reasonRequired ? reason : undefined,
  });
  revalidatePath(`/bills/${id}`);
  revalidatePath("/bills");
  if (bill.purchaseOrderId) revalidatePath(`/purchase-orders/${bill.purchaseOrderId}`);
  redirect(`/bills/${id}?posted=ok`);
}

/**
 * Void a bill. A Draft simply becomes Void. A posted bill is REVERSED: the pieces it put into
 * stock come back out, the payable is cancelled and the receipt (if any) is open to be billed
 * again — and because that undoes an accounting entry, it needs a fresh sign-in and a reason.
 */
export async function voidBill(formData: FormData) {
  const user = await requirePermWrite("bills");
  if (!POSTERS.includes(user.role)) redirect("/denied");
  const company = await getActiveCompany(user);
  const id = String(formData.get("id"));
  const reason = String(formData.get("voidReason") || "").trim();
  const bill = await prisma.supplierBill.findUnique({
    where: { id },
    include: { goodsReceipt: { select: { id: true, grnNumber: true } }, lines: { include: { product: true } } },
  });
  if (!bill || bill.companyId !== company.id) redirect("/bills");
  const blocker = billVoidBlocker(bill);
  if (blocker) redirect(`/bills/${id}?error=voidblocked`);
  if (reason.length < 5) redirect(`/bills/${id}?error=voidreason`);

  if (bill.status === "Draft") {
    await prisma.supplierBill.update({ where: { id }, data: { status: "Void", voidedAt: new Date(), voidedById: user.id, voidReason: reason } });
    await logAudit({ entity: "SupplierBill", entityId: id, action: "VOIDED", detail: `${bill.billNo} (draft) voided — ${reason}`, actorName: user.name, actorEmail: user.email, companyId: company.id, reason });
    revalidatePath(`/bills/${id}`);
    redirect(`/bills/${id}`);
  }

  await requireStepUp(`/bills/${id}`);

  // the stock this bill added must still be there to take back
  for (const l of bill.lines) {
    if (l.stockedBaseQty > 0 && l.product.stockQty < l.stockedBaseQty) redirect(`/bills/${id}?error=stock`);
  }

  const stockedAny = bill.lines.some((l) => l.stockedBaseQty > 0);
  await prisma.$transaction(async (tx) => {
    for (const l of bill.lines) {
      if (l.stockedBaseQty <= 0) continue;
      const product = await tx.product.findUniqueOrThrow({ where: { id: l.productId } });
      const newQty = product.stockQty - l.stockedBaseQty;
      await tx.product.update({ where: { id: product.id }, data: { stockQty: newQty } });
      await tx.stockMovement.create({
        data: {
          productId: product.id, type: "OUT", qty: l.stockedBaseQty, balanceAfter: newQty,
          enteredQty: l.qty, enteredUnit: l.unit, refType: "BILL", refNo: `VOID ${bill.billNo}`, userId: user.id,
        },
      });
      await tx.supplierBillLine.update({ where: { id: l.id }, data: { stockedBaseQty: 0 } });
      if (!bill.goodsReceiptId && l.poLineId) {
        await tx.pOLine.update({ where: { id: l.poLineId }, data: { receivedQty: { decrement: l.qty } } });
      }
    }
    if (bill.goodsReceiptId && stockedAny) {
      await tx.goodsReceipt.update({ where: { id: bill.goodsReceiptId }, data: { stockedAt: null } });
    }
    await tx.supplierBill.update({ where: { id }, data: { status: "Void", voidedAt: new Date(), voidedById: user.id, voidReason: reason } });
  }, { timeout: 60000 });

  const pcs = bill.lines.reduce((s, l) => s + l.stockedBaseQty, 0);
  await logAudit({
    entity: "SupplierBill",
    entityId: id,
    action: "VOIDED",
    detail: `${bill.billNo} reversed — ${reason} · payable of ₱${bill.total.toFixed(2)} cancelled` + (pcs ? ` · ${pcs.toLocaleString()} PCS taken back out of stock` : ""),
    actorName: user.name,
    actorEmail: user.email,
    companyId: company.id,
    reason,
  });
  revalidatePath(`/bills/${id}`);
  revalidatePath("/bills");
  redirect(`/bills/${id}`);
}
