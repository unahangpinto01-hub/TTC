import { prisma } from "./db";
import type { PermLevel } from "./permissions";

/**
 * What each report access level is allowed to do.
 *
 * The levels themselves are fixed — No Access, Read Only, Read/Write — but what Read Only
 * and Read/Write mean is the Super Admin's policy, held in the database rather than decided
 * in this file. Change it on the Report Permissions screen and every report and export route
 * follows immediately.
 */
export type LevelRules = {
  /** download the report as a spreadsheet */
  export: boolean;
  /** show the Print / Save as PDF button */
  print: boolean;
};

export type ReportPolicy = {
  READ_ONLY: LevelRules;
  READ_WRITE: LevelRules;
};

export const SETTING_KEY = "report.policy";

/** Used until a Super Admin saves something different. */
export const DEFAULT_POLICY: ReportPolicy = {
  READ_ONLY: { export: false, print: true },
  READ_WRITE: { export: true, print: true },
};

function coerce(raw: unknown): ReportPolicy {
  const p = raw as Partial<Record<keyof ReportPolicy, Partial<LevelRules>>> | null;
  const level = (k: keyof ReportPolicy): LevelRules => ({
    export: typeof p?.[k]?.export === "boolean" ? (p[k]!.export as boolean) : DEFAULT_POLICY[k].export,
    print: typeof p?.[k]?.print === "boolean" ? (p[k]!.print as boolean) : DEFAULT_POLICY[k].print,
  });
  return { READ_ONLY: level("READ_ONLY"), READ_WRITE: level("READ_WRITE") };
}

/** The saved policy, or the defaults when nothing has been saved or the row is unreadable. */
export async function getReportPolicy(): Promise<ReportPolicy> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return DEFAULT_POLICY;
    return coerce(JSON.parse(row.value));
  } catch {
    // a malformed setting must never lock the reports module — fall back, do not throw
    return DEFAULT_POLICY;
  }
}

export async function saveReportPolicy(policy: ReportPolicy, userId?: string) {
  const value = JSON.stringify(policy);
  await prisma.appSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value, updatedById: userId ?? null },
    update: { value, updatedById: userId ?? null },
  });
}

/**
 * Super Admin is never restricted, so it is answered before the policy is consulted at all —
 * a policy that switched exporting off must not be able to lock out the person who has to
 * switch it back on.
 */
export function mayExport(role: string, perm: PermLevel, policy: ReportPolicy): boolean {
  if (role === "SUPER_ADMIN") return true;
  if (perm === "NONE") return false;
  return policy[perm].export;
}

export function mayPrint(role: string, perm: PermLevel, policy: ReportPolicy): boolean {
  if (role === "SUPER_ADMIN") return true;
  if (perm === "NONE") return false;
  return policy[perm].print;
}
