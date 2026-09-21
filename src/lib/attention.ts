import { prisma } from "./db";
import { OPEN_BILL_STATUSES, round2 } from "./bills";
import { LIVE_DV_STATUSES } from "./dv";
import { getUnbilledReceipts, getInvoiceDiscrepancies, getThreeWayMatch } from "./purchasing-reports";

/**
 * Management Attention: everything in the purchase-to-payment chain that is waiting on
 * someone — goods received with no invoice, invoices that disagree with the receipt, posted
 * bills no voucher has picked up, vouchers stuck in the approval chain, vouchers posted but
 * unpaid or partly paid, cheques voided lately, and supplier prices that moved against the
 * order. Read-only; every item links to where it is dealt with.
 */

export type AttentionItem = { id: string; href: string; ref: string; who: string; when: Date; amount: number; note: string; company: string };
export type AttentionSection = { key: string; title: string; hint: string; href: string; count: number; amount: number; items: AttentionItem[] };

const DAY = 86400000;

export async function getManagementAttention(companyIds: string[], now: Date = new Date()): Promise<AttentionSection[]> {
  const yearAgo = new Date(now.getTime() - 365 * DAY);
  const ninetyAgo = new Date(now.getTime() - 90 * DAY);
  const [unbilled, discrepancies, billsAwaiting, dvsPending, dvsUnpaid, dvsPartial, voidedCheques, threeWay] = await Promise.all([
    getUnbilledReceipts(companyIds, now),
    getInvoiceDiscrepancies({ from: yearAgo, to: now }, companyIds),
    // posted, unpaid bills that no live voucher has picked up
    prisma.supplierBill.findMany({
      where: { companyId: { in: companyIds }, status: { in: OPEN_BILL_STATUSES }, dvBills: { none: { dv: { status: { in: LIVE_DV_STATUSES } } } } },
      select: { id: true, billNo: true, kind: true, billDate: true, dueDate: true, total: true, paidAmount: true, supplier: { select: { name: true } }, company: { select: { companyName: true } } },
      orderBy: { dueDate: "asc" },
    }),
    prisma.disbursementVoucher.findMany({
      where: { companyId: { in: companyIds }, status: { in: ["Draft", "Prepared", "Checked", "Approved"] } },
      select: { id: true, dvNo: true, payee: true, date: true, amount: true, status: true, company: { select: { companyName: true } } },
      orderBy: { date: "asc" },
    }),
    prisma.disbursementVoucher.findMany({
      where: { companyId: { in: companyIds }, status: "Posted" },
      select: { id: true, dvNo: true, payee: true, date: true, amount: true, paidAmount: true, postedAt: true, company: { select: { companyName: true } } },
      orderBy: { date: "asc" },
    }),
    prisma.disbursementVoucher.findMany({
      where: { companyId: { in: companyIds }, status: "Partially Paid" },
      select: { id: true, dvNo: true, payee: true, date: true, amount: true, paidAmount: true, company: { select: { companyName: true } }, _count: { select: { payments: { where: { status: "Posted" } } } } },
      orderBy: { date: "asc" },
    }),
    prisma.supplierPayment.findMany({
      where: { companyId: { in: companyIds }, status: "Void", voidedAt: { gte: ninetyAgo } },
      select: { id: true, paymentNo: true, checkNo: true, payee: true, amount: true, voidedAt: true, voidReason: true, cashAccount: { select: { name: true } }, dv: { select: { dvNo: true } }, company: { select: { companyName: true } } },
      orderBy: { voidedAt: "desc" },
    }),
    getThreeWayMatch({ from: yearAgo, to: now }, companyIds, {}),
  ]);

  const sections: AttentionSection[] = [];
  const push = (key: string, title: string, hint: string, href: string, items: AttentionItem[]) =>
    sections.push({ key, title, hint, href, count: items.length, amount: round2(items.reduce((s, i) => s + i.amount, 0)), items });

  push("unbilled", "Inventory received, invoice pending", "goods in stock at an estimated (PO) cost, waiting for the supplier's invoice", "/reports/unbilled-receipts",
    unbilled.rows.map((r) => ({ id: r.id, href: `/receiving/${r.id}`, ref: r.grnNumber, who: r.supplier, when: r.receivedDate, amount: r.remainingValue, note: `${r.days} day(s) · ${r.remainingPcs.toLocaleString()} PCS still to bill${r.invoiceStatus !== "Pending" ? ` · ${r.invoiceStatus}` : ""}`, company: r.company })));

  push("discrepancies", "Supplier invoice discrepancies", "bills whose quantities disagree with the receipt", "/reports/invoice-discrepancies",
    discrepancies.rows.map((d) => ({ id: d.billId, href: `/bills/${d.billId}`, ref: d.billNo, who: d.supplier, when: d.billDate, amount: d.total, note: `${d.matchStatus} vs ${d.grnNumber}${d.discrepancyNote ? ` · ${d.discrepancyNote}` : ""}`, company: d.company })));

  push("awaiting-voucher", "Bills awaiting a voucher", "posted, unpaid bills that no voucher has picked up yet", "/finance/ap",
    billsAwaiting.map((b) => ({ id: b.id, href: `/bills/${b.id}`, ref: b.billNo, who: b.supplier.name, when: b.dueDate, amount: round2(b.total - b.paidAmount), note: `${b.kind === "EXPENSE" ? "non-inventory" : "inventory"} · due ${fmt(b.dueDate)}${b.dueDate < now ? ` · ${Math.floor((now.getTime() - b.dueDate.getTime()) / DAY)} day(s) overdue` : ""}`, company: b.company.companyName })));

  push("awaiting-approval", "Vouchers awaiting approval", "in the chain: Draft → Prepared → Checked → Approved", "/dv?status=pending",
    dvsPending.map((d) => ({ id: d.id, href: `/dv/${d.id}`, ref: d.dvNo, who: d.payee, when: d.date, amount: d.amount, note: d.status, company: d.company.companyName })));

  push("approved-unpaid", "Approved vouchers not yet paid", "posted — payment authorised, no cheque issued", "/dv?status=unpaid",
    dvsUnpaid.map((d) => ({ id: d.id, href: `/dv/${d.id}`, ref: d.dvNo, who: d.payee, when: d.postedAt ?? d.date, amount: round2(d.amount - d.paidAmount), note: d.postedAt ? `posted ${Math.floor((now.getTime() - d.postedAt.getTime()) / DAY)} day(s) ago` : "posted", company: d.company.companyName })));

  push("partially-paid", "Partially paid vouchers", "some cheques issued, a balance remains", "/dv?status=partial",
    dvsPartial.map((d) => ({ id: d.id, href: `/dv/${d.id}`, ref: d.dvNo, who: d.payee, when: d.date, amount: round2(d.amount - d.paidAmount), note: `${d._count.payments} cheque(s) · ${peso(d.paidAmount)} of ${peso(d.amount)} paid`, company: d.company.companyName })));

  push("voided-cheques", "Voided cheques (last 90 days)", "no longer count as paid; the voucher reopened", "/reports/check-register?status=Void",
    voidedCheques.map((p) => ({ id: p.id, href: `/payments/bills/${p.id}`, ref: p.checkNo ? `cheque ${p.checkNo}` : p.paymentNo, who: p.payee, when: p.voidedAt ?? now, amount: p.amount, note: `${p.cashAccount.name}${p.dv ? ` · ${p.dv.dvNo}` : ""} · ${p.voidReason ?? ""}`, company: p.company.companyName })));

  const variances = threeWay.rows.filter((r) => Math.abs(r.costVariance) > 0.005 && r.billedQty > 0);
  push("cost-variances", "Supplier cost variances", "invoiced at a different price than ordered (last 12 months)", "/reports/po-receiving-invoice",
    variances.map((r) => ({ id: `${r.poId}:${r.productId}`, href: `/purchase-orders/${r.poId}`, ref: r.poNumber, who: r.supplier, when: r.poDate, amount: r.costVariance, note: `${r.product} · ordered ${peso(r.orderedCost)}/${r.unit}, billed ${r.bills.join(", ")} · ${r.costVariance > 0 ? "over" : "under"} by ${peso(Math.abs(r.costVariance))}`, company: r.company })));

  return sections;
}

const fmt = (d: Date) => d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "2-digit" });
const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
