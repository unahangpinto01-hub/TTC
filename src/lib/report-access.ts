import { redirect } from "next/navigation";
import { requireStaff, type SessionUser } from "./auth";
import { getPerm, type PermLevel } from "./permissions";
import { REPORTS, reportByKey, reportPermKey, type ReportDef } from "./report-registry";

/**
 * Report access, in one place.
 *
 * Every report page and every export route resolves through here, so hiding a link and
 * refusing a request can never disagree. Two rules decide it:
 *
 *   1. The report's own grant, stored per user. Unset means No Access — a report nobody has
 *      been given is a report nobody can open, which is what makes a newly added report safe
 *      by default.
 *   2. The module permission the report reads from. A report never widens access to a
 *      module, so the stricter of the two wins: someone who cannot see AR cannot pull AR
 *      figures out through a report either.
 *
 * Super Admin is exempt from both and always has full access, which cannot be removed.
 */

const NONE: PermLevel = "NONE";
const RO: PermLevel = "READ_ONLY";
const RW: PermLevel = "READ_WRITE";

type PermUser = Pick<SessionUser, "role" | "access" | "permsJson">;

const stricter = (a: PermLevel, b: PermLevel): PermLevel => {
  if (a === NONE || b === NONE) return NONE;
  if (a === RO || b === RO) return RO;
  return RW;
};

/** The grant stored against a report, before the module permission caps it. */
export function storedReportPerm(user: PermUser, key: string): PermLevel {
  if (user.role === "SUPER_ADMIN") return RW;
  if (!user.permsJson) return NONE;
  try {
    const p = (JSON.parse(user.permsJson) as Record<string, PermLevel>)[reportPermKey(key)];
    return p && [NONE, RO, RW].includes(p) ? p : NONE;
  } catch {
    return NONE;
  }
}

/** What this user may actually do with this report. */
export function reportPerm(user: PermUser, key: string): PermLevel {
  if (user.role === "SUPER_ADMIN") return RW; // never restricted
  if (user.role === "DEALER" || user.access === "NONE") return NONE;
  const def = reportByKey(key);
  if (!def) return NONE; // an unregistered report is not grantable, so not reachable
  const own = storedReportPerm(user, key);
  if (own === NONE) return NONE;
  // the module the report reads from still applies …
  const capped = stricter(own, getPerm(user, def.fn));
  // … and so does the account-level switch
  return user.access === "READ_ONLY" ? stricter(capped, RO) : capped;
}

export const canViewReport = (user: PermUser, key: string) => reportPerm(user, key) !== NONE;

/** Excel export is the Read/Write action: reading a report on screen is one thing, taking
    the whole dataset out of the building is another. Printing cannot be prevented by any
    application, so it is not gated here. */
export const canExportReport = (user: PermUser, key: string) => reportPerm(user, key) === RW;

/** Every report this user may open, in registry order — the Reports hub reads this. */
export function visibleReports(user: PermUser): (ReportDef & { perm: PermLevel })[] {
  return REPORTS.map((r) => ({ ...r, perm: reportPerm(user, r.key) })).filter((r) => r.perm !== NONE);
}

/**
 * Page guard. Bounces to /denied when the report is not granted, exactly as the module
 * guards do — the UI hiding the link is a convenience, this is the control.
 */
export async function requireReport(key: string): Promise<SessionUser & { perm: PermLevel; canExport: boolean }> {
  const user = await requireStaff();
  const perm = reportPerm(user, key);
  if (perm === NONE) redirect("/denied");
  return { ...user, perm, canExport: perm === RW };
}
