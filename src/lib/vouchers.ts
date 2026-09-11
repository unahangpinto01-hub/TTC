import { prisma } from "./db";

/**
 * Expense voucher numbering, accounting periods and the year-end cutoff.
 *
 * The rule the whole module turns on: the VOUCHER DATE decides the number series, the
 * accounting year and the accounting period. The date something was typed in never does.
 * A December invoice received in January is voucher-dated 31 December, so it keeps a
 * December number and lands in December, however long afterwards it reaches the office.
 */

export type PeriodStatus = "Open" | "Closing" | "Locked";

/** A company's short code for document numbers, e.g. TTC. Never hard-coded: it is a field
    on Company, and only falls back to initials when nobody has filled it in yet. */
export function companyCode(company: { code?: string | null; companyName: string }): string {
  const set = (company.code ?? "").trim().toUpperCase();
  if (set) return set;
  const initials = company.companyName
    .replace(/[^A-Za-z ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return initials.slice(0, 4) || "CO";
}

/** The accounting period a voucher date falls in. */
export function periodOf(voucherDate: Date): { year: number; month: number } {
  return { year: voucherDate.getFullYear(), month: voucherDate.getMonth() + 1 };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const periodLabel = (year: number, month: number) => `${MONTHS[month - 1] ?? "?"} ${year}`;

/**
 * The next voucher number for a company and accounting year: EV-TTC-2026-000001.
 *
 * The counter is keyed on company + document type + ACCOUNTING YEAR, so 2026 and 2027 run
 * as separate series and both can be issued on the same January day — a late December
 * voucher and a genuine January one — without either disturbing the other.
 *
 * Numbers are drawn from a counter that only ever increments, so voiding or deleting a
 * voucher never releases its number for reuse.
 */
export async function nextSeriesNo(docType: string, companyId: string, docDate: Date): Promise<string> {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { code: true, companyName: true },
  });
  const year = docDate.getFullYear();
  const counter = await prisma.documentCounter.upsert({
    where: { docType_year_companyId: { docType, year, companyId } },
    create: { docType, year, companyId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });
  return `${docType}-${companyCode(company)}-${year}-${String(counter.lastNumber).padStart(6, "0")}`;
}

/** EV-TTC-2026-000001 — the expense voucher series. Supplier bills run the same way under BL. */
export const nextVoucherNo = (companyId: string, voucherDate: Date) => nextSeriesNo("EV", companyId, voucherDate);

/** A period with no row has never been closed, so it is Open. */
export async function periodStatus(companyId: string, year: number, month: number): Promise<PeriodStatus> {
  const row = await prisma.accountingPeriod.findUnique({
    where: { companyId_year_month: { companyId, year, month } },
    select: { status: true },
  });
  return (row?.status as PeriodStatus) ?? "Open";
}

/* ------------------------------------------------------------------ cutoff */

export type CutoffConfig = {
  /** whether late entries for the previous December are accepted at all */
  enabled: boolean;
  /** last day of January on which they are still accepted */
  lastDay: number;
};

export const CUTOFF_KEY = "expense.cutoff";
export const DEFAULT_CUTOFF: CutoffConfig = { enabled: true, lastDay: 20 };

export async function getCutoff(): Promise<CutoffConfig> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: CUTOFF_KEY } });
    if (!row) return DEFAULT_CUTOFF;
    const raw = JSON.parse(row.value) as Partial<CutoffConfig>;
    const lastDay = Number(raw.lastDay);
    return {
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_CUTOFF.enabled,
      lastDay: Number.isInteger(lastDay) && lastDay >= 1 && lastDay <= 31 ? lastDay : DEFAULT_CUTOFF.lastDay,
    };
  } catch {
    // a malformed setting must not stop expenses being recorded
    return DEFAULT_CUTOFF;
  }
}

export async function saveCutoff(cfg: CutoffConfig, userId?: string) {
  const value = JSON.stringify(cfg);
  await prisma.appSetting.upsert({
    where: { key: CUTOFF_KEY },
    create: { key: CUTOFF_KEY, value, updatedById: userId ?? null },
    update: { value, updatedById: userId ?? null },
  });
}

/** True while last year's December may still be voucher-dated — 1 January to the cutoff day. */
export function inCutoffWindow(now: Date, cfg: CutoffConfig): boolean {
  return cfg.enabled && now.getMonth() === 0 && now.getDate() <= cfg.lastDay;
}

export type VoucherDateCheck =
  | { ok: true; reasonRequired: false }
  | { ok: true; reasonRequired: true; why: string }
  | { ok: false; why: string };

/**
 * May a voucher be dated here?
 *
 * Open period — yes. Closing — yes, it is still accepting entries. Locked — only for
 * someone holding the prior-period permission, and only with a reason on the record.
 * The January cutoff is what makes a previous-December date ordinary rather than
 * exceptional, so it is checked before the period status is held against the user.
 */
export async function checkVoucherDate(opts: {
  companyId: string;
  voucherDate: Date;
  now?: Date;
  canPriorPeriod: boolean;
  /** what the document is called in the messages — "voucher" unless told otherwise */
  noun?: string;
}): Promise<VoucherDateCheck> {
  const now = opts.now ?? new Date();
  const { year, month } = periodOf(opts.voucherDate);
  const status = await periodStatus(opts.companyId, year, month);

  if (status !== "Locked") return { ok: true, reasonRequired: false };

  const cutoff = await getCutoff();
  const isLastDecember = month === 12 && year === now.getFullYear() - 1;
  if (isLastDecember && inCutoffWindow(now, cutoff)) {
    return {
      ok: true,
      reasonRequired: false,
    };
  }
  if (!opts.canPriorPeriod) {
    return {
      ok: false,
      why: `${periodLabel(year, month)} is locked. A ${opts.noun ?? "voucher"} dated in a locked period needs Prior-Period Adjustment permission.`,
    };
  }
  return {
    ok: true,
    reasonRequired: true,
    why: `${periodLabel(year, month)} is locked — this is a prior-period adjustment and needs a reason.`,
  };
}
