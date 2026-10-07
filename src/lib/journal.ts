import { prisma } from "./db";
import { nextDocNumber } from "./numbering";
import { logAudit } from "./salespeople";

/**
 * General Journal — journal vouchers for what no other document can carry: an accrual, a
 * depreciation run, a bank charge or an autodebit, dividends applied to a shareholder's
 * account, an intercompany settlement, a reclassification. Every voucher is balanced debit
 * and credit lines on Chart of Accounts entries. Draft → Pending Approval → Posted; only a
 * Posted voucher reaches the ledger. A line on an account that one of the company's cash/bank
 * accounts books to names that cash account, so the bank balance and register carry it too.
 *
 * The sub-ledgers stay authoritative: a voucher on Accounts Receivable, Accounts Payable or
 * Inventory moves the ledger but never a customer's, supplier's or product's own balance —
 * the screens warn when such an account is used.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export const JV_STATUSES = ["Draft", "Pending Approval", "Posted", "Cancelled", "Void"] as const;

/** Approve / Post / Void are for admins; everyone else drafts and submits. */
export function canPostJournal(user: { role: string }): boolean {
  return user.role === "SUPER_ADMIN" || user.role === "ADMIN";
}

export type JournalLineIn = { glAccountId: string; cashAccountId: string | null; description: string; debit: number; credit: number };

/** The lines as the entry form posts them (index-aligned columns). */
export function readJournalLines(formData: FormData): JournalLineIn[] {
  const ids = formData.getAll("lineAccountId").map(String);
  const cash = formData.getAll("lineCashAccountId").map((v) => String(v ?? "") || null);
  const descriptions = formData.getAll("lineDescription").map((v) => String(v ?? "").trim());
  const debits = formData.getAll("lineDebit").map((v) => round2(Math.max(0, Number(v) || 0)));
  const credits = formData.getAll("lineCredit").map((v) => round2(Math.max(0, Number(v) || 0)));
  const out: JournalLineIn[] = [];
  for (let i = 0; i < ids.length; i++) {
    if (!ids[i] && !descriptions[i] && !debits[i] && !credits[i]) continue; // a blank row is not a line
    out.push({ glAccountId: ids[i] ?? "", cashAccountId: cash[i] ?? null, description: (descriptions[i] ?? "").slice(0, 200), debit: debits[i] ?? 0, credit: credits[i] ?? 0 });
  }
  return out;
}

export const totalsOf = (lines: { debit: number; credit: number }[]) => ({
  debit: round2(lines.reduce((s, l) => s + l.debit, 0)),
  credit: round2(lines.reduce((s, l) => s + l.credit, 0)),
});

/** Every reason the lines cannot be saved, so the user fixes the voucher in one pass. Also
    resolves the cash account of a line on a bank account when the company has exactly one. */
export async function journalLineProblems(lines: JournalLineIn[], companyId: string): Promise<string[]> {
  const out: string[] = [];
  if (lines.length < 2) out.push("A voucher needs at least two lines — one debit and one credit.");
  for (const l of lines) {
    const label = l.description || "(no particulars)";
    if (!l.glAccountId) out.push(`"${label}": choose the account.`);
    if (l.debit > 0 && l.credit > 0) out.push(`"${label}": a line is either a debit or a credit, not both.`);
    if (!(l.debit > 0) && !(l.credit > 0)) out.push(`"${label}": enter a debit or a credit amount.`);
  }
  const t = totalsOf(lines);
  if (Math.abs(t.debit - t.credit) > 0.005) out.push(`Debits ₱${t.debit.toFixed(2)} and credits ₱${t.credit.toFixed(2)} do not balance.`);
  const ids = [...new Set(lines.map((l) => l.glAccountId).filter(Boolean))];
  if (ids.length) {
    const found = await prisma.gLAccount.findMany({ where: { id: { in: ids }, status: "Active" }, select: { id: true } });
    if (found.length !== ids.length) out.push("A line names an account that is not in the Chart of Accounts, or is inactive.");
  }
  // a bank-account line: the physical account must be this company's and book to that GL account
  const cashIds = [...new Set(lines.map((l) => l.cashAccountId).filter((x): x is string => !!x))];
  const cashRows = cashIds.length ? await prisma.cashAccount.findMany({ where: { id: { in: cashIds } }, select: { id: true, companyId: true, glAccountId: true, name: true } }) : [];
  for (const l of lines) {
    if (!l.cashAccountId) continue;
    const c = cashRows.find((x) => x.id === l.cashAccountId);
    if (!c || c.companyId !== companyId) out.push(`"${l.description || "(no particulars)"}": the cash/bank account picked is not this company's.`);
    else if (c.glAccountId && c.glAccountId !== l.glAccountId) out.push(`"${l.description || "(no particulars)"}": ${c.name} books to a different chart account than the line.`);
  }
  return out;
}

/** For lines on an account that one of the company's cash/bank accounts books to, fill the cash
    account when exactly one matches and none was picked; returns the account names the user must
    still choose between when several match. */
export async function resolveCashAccounts(lines: JournalLineIn[], companyId: string): Promise<string[]> {
  const accounts = await prisma.cashAccount.findMany({ where: { companyId, status: "Active", glAccountId: { not: null } }, select: { id: true, name: true, glAccountId: true } });
  const ambiguous: string[] = [];
  for (const l of lines) {
    if (l.cashAccountId || !l.glAccountId) continue;
    const matches = accounts.filter((a) => a.glAccountId === l.glAccountId);
    if (matches.length === 1) l.cashAccountId = matches[0].id;
    else if (matches.length > 1) ambiguous.push(`"${l.description || "(no particulars)"}": pick which of ${matches.map((m) => m.name).join(" / ")} the line moves.`);
  }
  return ambiguous;
}

/** Accounts the sub-ledgers own: a voucher on them moves the ledger only, never a customer,
    supplier or product balance. The screens warn; posting is not blocked. */
export async function controlAccountWarnings(lines: { glAccountId: string }[], companyId: string): Promise<string[]> {
  const ids = [...new Set(lines.map((l) => l.glAccountId).filter(Boolean))];
  if (!ids.length) return [];
  const [accts, company] = await Promise.all([
    prisma.gLAccount.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, description: true } }),
    prisma.company.findUnique({ where: { id: companyId }, select: { glPayablesId: true, glInventoryId: true } }),
  ]);
  return accts
    .filter((a) => a.id === company?.glPayablesId || a.id === company?.glInventoryId || /receivable|payable|inventory/i.test(a.description))
    .map((a) => `${a.code} ${a.description} is a control account: this voucher moves the ledger only — no customer, supplier or product balance changes.`);
}

export const nextJvNo = (companyId: string, date: Date) => nextDocNumber("JV", companyId, date);

/** Post: the voucher is checked once more against the live chart, then booked. */
export async function postJournalVoucher(id: string, actor: { id?: string; name: string; email: string }) {
  const v = await prisma.journalVoucher.findUniqueOrThrow({ where: { id }, include: { lines: { include: { glAccount: { select: { code: true, description: true, status: true } } }, orderBy: { sortOrder: "asc" } } } });
  if (v.status !== "Draft" && v.status !== "Pending Approval") throw new Error(`Cannot post a ${v.status} voucher.`);
  const problems = await journalLineProblems(v.lines.map((l) => ({ glAccountId: l.glAccountId, cashAccountId: l.cashAccountId, description: l.description, debit: l.debit, credit: l.credit })), v.companyId);
  if (problems.length) throw new Error(problems.join(" "));
  await prisma.journalVoucher.update({ where: { id }, data: { status: "Posted", postedAt: new Date(), postedById: actor.id ?? null } });
  const t = totalsOf(v.lines);
  await logAudit({
    entity: "JournalVoucher", entityId: id, action: "POSTED",
    detail: `${v.jvNumber} posted: ₱${t.debit.toFixed(2)} · ${v.lines.map((l) => `${l.debit > 0 ? "Dr" : "Cr"} ${l.glAccount.code} ${l.glAccount.description} ₱${(l.debit || l.credit).toFixed(2)}`).join(", ")} — ${v.memo}`,
    actorName: actor.name, actorEmail: actor.email, companyId: v.companyId,
  });
}

/** Void a posted voucher: the ledger and any bank balance drop it again; the document stays on record. */
export async function voidJournalVoucher(id: string, reason: string, actor: { name: string; email: string }) {
  const v = await prisma.journalVoucher.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  if (v.status !== "Posted") throw new Error(`Only a Posted voucher can be voided (this one is ${v.status}).`);
  await prisma.journalVoucher.update({ where: { id }, data: { status: "Void", voidReason: reason || "voided" } });
  await logAudit({
    entity: "JournalVoucher", entityId: id, action: "VOIDED",
    detail: `${v.jvNumber} voided (${reason || "no reason given"}) — ₱${totalsOf(v.lines).debit.toFixed(2)} reversed`,
    actorName: actor.name, actorEmail: actor.email, companyId: v.companyId, reason,
  });
}

/**
 * The ledger rows of a posted voucher: every debit line paired with the credit lines it is
 * matched against, in order, so a one-to-many voucher reads as its natural entries and a
 * many-to-many one still balances line by line.
 */
export function pairJournalLines<T extends { debit: number; credit: number }>(lines: T[]): { debit: T; credit: T; amount: number }[] {
  const debits = lines.filter((l) => l.debit > 0).map((l) => ({ line: l, left: round2(l.debit) }));
  const credits = lines.filter((l) => l.credit > 0).map((l) => ({ line: l, left: round2(l.credit) }));
  const out: { debit: T; credit: T; amount: number }[] = [];
  let i = 0, j = 0;
  while (i < debits.length && j < credits.length) {
    const take = round2(Math.min(debits[i].left, credits[j].left));
    if (take > 0) out.push({ debit: debits[i].line, credit: credits[j].line, amount: take });
    debits[i].left = round2(debits[i].left - take); credits[j].left = round2(credits[j].left - take);
    if (debits[i].left <= 0.005) i++;
    if (credits[j].left <= 0.005) j++;
  }
  return out;
}
