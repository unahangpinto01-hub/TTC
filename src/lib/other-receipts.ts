import { prisma } from "./db";
import { nextDocNumber } from "./numbering";
import { logAudit } from "./salespeople";

/**
 * Other Receipts — money in that is not a customer collection: an employee repaying an
 * advance or a salary loan, a director returning a loan, an affiliate settling advances,
 * bank interest, a refund from a supplier. Receive Payments only knows customers and only
 * ever credits Accounts Receivable; this is the mirror of the any-payee voucher on the
 * payables side. The payor is an employee or a typed name, and each line credits the
 * account the money settles or earns. Posting books Dr cash/bank account / Cr each line;
 * a draft touches nothing.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export const OR_STATUSES = ["Draft", "Pending Approval", "Posted", "Cancelled", "Void"] as const;

export type ReceiptLineIn = { glAccountId: string; description: string; amount: number };

/** The lines as the entry form posts them (lineAccountId / lineDescription / lineAmount, index-aligned). */
export function readReceiptLines(formData: FormData): ReceiptLineIn[] {
  const ids = formData.getAll("lineAccountId").map(String);
  const descriptions = formData.getAll("lineDescription").map((v) => String(v ?? "").trim());
  const amounts = formData.getAll("lineAmount").map((v) => round2(Number(v) || 0));
  const out: ReceiptLineIn[] = [];
  for (let i = 0; i < ids.length; i++) {
    if (!ids[i] && !descriptions[i] && !amounts[i]) continue; // a blank row is not a line
    out.push({ glAccountId: ids[i] ?? "", description: (descriptions[i] ?? "").slice(0, 200), amount: amounts[i] ?? 0 });
  }
  return out;
}

/** Why the lines cannot be saved — every reason, so the user fixes the document in one pass. */
export async function receiptLineProblems(lines: ReceiptLineIn[]): Promise<string[]> {
  const out: string[] = [];
  if (!lines.length) out.push("At least one line is required — what the money settles or earns.");
  for (const l of lines) {
    if (!l.glAccountId) out.push(`"${l.description || "(no description)"}": choose the account it is credited to.`);
    if (!(l.amount > 0)) out.push(`"${l.description || "(no description)"}": amount must be greater than zero.`);
  }
  const ids = [...new Set(lines.map((l) => l.glAccountId).filter(Boolean))];
  if (ids.length) {
    const found = await prisma.gLAccount.findMany({ where: { id: { in: ids }, status: "Active" }, select: { id: true } });
    if (found.length !== ids.length) out.push("A line names an account that is not in the Chart of Accounts, or is inactive.");
  }
  return out;
}

export const linesTotal = (lines: { amount: number }[]) => round2(lines.reduce((s, l) => s + l.amount, 0));

export const nextCrNo = (companyId: string, date: Date) => nextDocNumber("CR", companyId, date);

/** Post: the money is in the bank from this moment — the receipt needs its cash/bank account. */
export async function postOtherReceipt(id: string, actor: { name: string; email: string }) {
  const r = await prisma.otherReceipt.findUniqueOrThrow({ where: { id }, include: { lines: { include: { glAccount: { select: { code: true, description: true } } } }, cashAccount: { select: { name: true } } } });
  if (r.status !== "Draft" && r.status !== "Pending Approval") throw new Error(`Cannot post a ${r.status} receipt.`);
  if (!r.cashAccountId) throw new Error("Pick the cash/bank account the money went to before posting.");
  if (!r.lines.length) throw new Error("The receipt has no lines.");
  await prisma.otherReceipt.update({ where: { id }, data: { status: "Posted", postedAt: new Date() } });
  await logAudit({
    entity: "OtherReceipt", entityId: id, action: "POSTED",
    detail: `${r.crNumber} posted: ₱${r.amount.toFixed(2)} from ${r.payor} into ${r.cashAccount?.name ?? "—"} · ${r.lines.map((l) => `${l.glAccount.code} ${l.glAccount.description} ₱${l.amount.toFixed(2)}`).join(", ")}`,
    actorName: actor.name, actorEmail: actor.email, companyId: r.companyId,
  });
}

/** Void a posted receipt: the bank balance and the ledger drop it again; the document stays on record. */
export async function voidOtherReceipt(id: string, reason: string, actor: { name: string; email: string }) {
  const r = await prisma.otherReceipt.findUniqueOrThrow({ where: { id } });
  if (r.status !== "Posted") throw new Error(`Only a Posted receipt can be voided (this one is ${r.status}).`);
  await prisma.otherReceipt.update({ where: { id }, data: { status: "Void", voidReason: reason || "voided" } });
  await logAudit({
    entity: "OtherReceipt", entityId: id, action: "VOIDED",
    detail: `${r.crNumber} voided (${reason || "no reason given"}) — ₱${r.amount.toFixed(2)} from ${r.payor} reversed`,
    actorName: actor.name, actorEmail: actor.email, companyId: r.companyId, reason,
  });
}
