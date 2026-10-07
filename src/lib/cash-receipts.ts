import { prisma } from "./db";

/**
 * The Cash Receipts Journal: every peso that came in, by date, with the account each part
 * was credited to — the office's cash receipts book. Customer collections (Receive Payments)
 * credit Accounts Receivable for what was applied on posting and Advances from Customers for
 * what was not; other receipts credit each of their lines. Discounts never appear here: they
 * are not cash.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
export type Range = { from: Date; to: Date };

export type JournalCredit = { code: string; name: string; amount: number };
export type JournalRow = {
  id: string;
  date: Date;
  company: string;
  docNo: string;
  href: string;
  kind: "Customer collection" | "Other receipt";
  payor: string;
  reference: string;
  method: string;
  cashAccount: string;
  amount: number;
  credits: JournalCredit[];
};

const acct = (a: { code: string; description: string } | null | undefined, fallback: string): { code: string; name: string } =>
  a ? { code: a.code, name: a.description } : { code: "", name: fallback };

export async function getCashReceiptsJournal(range: Range, companyIds: string[], f: { cashAccountId?: string; q?: string } = {}) {
  const [receipts, others] = await Promise.all([
    prisma.receivePayment.findMany({
      where: { companyId: { in: companyIds }, status: "Posted", date: { gte: range.from, lte: range.to }, ...(f.cashAccountId ? { cashAccountId: f.cashAccountId } : {}) },
      select: {
        id: true, prNumber: true, date: true, amount: true, method: true, refNo: true, checkNo: true, affiliateAmount: true,
        customer: { select: { businessName: true } }, company: { select: { companyName: true, glCustomerAdvances: { select: { code: true, description: true } }, glAffiliateAdvances: { select: { code: true, description: true } } } },
        cashAccount: { select: { name: true } }, applications: { select: { amount: true, fromCredit: true } },
      },
      orderBy: [{ date: "asc" }, { prNumber: "asc" }],
    }),
    prisma.otherReceipt.findMany({
      where: { companyId: { in: companyIds }, status: "Posted", date: { gte: range.from, lte: range.to }, ...(f.cashAccountId ? { cashAccountId: f.cashAccountId } : {}) },
      select: {
        id: true, crNumber: true, date: true, amount: true, method: true, refNo: true, checkNo: true, payor: true,
        company: { select: { companyName: true } }, cashAccount: { select: { name: true } },
        lines: { select: { amount: true, glAccount: { select: { code: true, description: true } } }, orderBy: { sortOrder: "asc" } },
      },
      orderBy: [{ date: "asc" }, { crNumber: "asc" }],
    }),
  ]);
  const rows: JournalRow[] = [
    ...receipts.map((r) => {
      const applied = round2(r.applications.filter((a) => !a.fromCredit).reduce((s, a) => s + a.amount, 0));
      const advance = round2(r.amount - applied - r.affiliateAmount);
      const credits: JournalCredit[] = [];
      if (applied > 0) credits.push({ code: "", name: "Accounts Receivable", amount: applied });
      if (r.affiliateAmount > 0.005) credits.push({ ...acct(r.company.glAffiliateAdvances, "Advances from Affiliate (account not set)"), amount: r.affiliateAmount });
      if (advance > 0.005) credits.push({ ...acct(r.company.glCustomerAdvances, "Advances from Customers (account not set)"), amount: advance });
      return {
        id: r.id, date: r.date, company: r.company.companyName, docNo: r.prNumber, href: `/payments/${r.id}`, kind: "Customer collection" as const,
        payor: r.customer.businessName, reference: [r.refNo, r.checkNo ? `cheque ${r.checkNo}` : ""].filter(Boolean).join(" · "), method: r.method,
        cashAccount: r.cashAccount?.name ?? "—", amount: r.amount, credits,
      };
    }),
    ...others.map((r) => ({
      id: r.id, date: r.date, company: r.company.companyName, docNo: r.crNumber, href: `/other-receipts/${r.id}`, kind: "Other receipt" as const,
      payor: r.payor, reference: [r.refNo, r.checkNo ? `cheque ${r.checkNo}` : ""].filter(Boolean).join(" · "), method: r.method,
      cashAccount: r.cashAccount?.name ?? "—", amount: r.amount,
      credits: r.lines.map((l) => ({ code: l.glAccount.code, name: l.glAccount.description, amount: l.amount })),
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.docNo.localeCompare(b.docNo));
  const q = f.q?.trim().toLowerCase();
  const filtered = q ? rows.filter((r) => r.docNo.toLowerCase().includes(q) || r.payor.toLowerCase().includes(q) || r.reference.toLowerCase().includes(q)) : rows;

  const byAccount = new Map<string, JournalCredit & { count: number }>();
  const byCash = new Map<string, { name: string; count: number; amount: number }>();
  for (const r of filtered) {
    for (const c of r.credits) {
      const key = `${c.code}|${c.name}`;
      const cur = byAccount.get(key) ?? { code: c.code, name: c.name, amount: 0, count: 0 };
      cur.amount = round2(cur.amount + c.amount); cur.count++;
      byAccount.set(key, cur);
    }
    const cur = byCash.get(r.cashAccount) ?? { name: r.cashAccount, count: 0, amount: 0 };
    cur.amount = round2(cur.amount + r.amount); cur.count++;
    byCash.set(r.cashAccount, cur);
  }
  return {
    rows: filtered,
    total: round2(filtered.reduce((s, r) => s + r.amount, 0)),
    customerTotal: round2(filtered.filter((r) => r.kind === "Customer collection").reduce((s, r) => s + r.amount, 0)),
    otherTotal: round2(filtered.filter((r) => r.kind === "Other receipt").reduce((s, r) => s + r.amount, 0)),
    byAccount: [...byAccount.values()].sort((a, b) => b.amount - a.amount),
    byCash: [...byCash.values()].sort((a, b) => b.amount - a.amount),
  };
}
