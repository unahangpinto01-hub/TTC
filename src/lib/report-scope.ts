import { allowedCompanies, getActiveCompany } from "./company";
import type { SessionUser } from "./auth";

export const COMBINED = "__all__";

export type ReportScope = {
  /** company ids the report must read — one, or several when combined */
  ids: string[];
  /** value for the filter control */
  value: string;
  /** true when more than one company is in scope: show the Company column and per-company subtotals */
  combined: boolean;
  /** heading/letterhead company: the single company, or the primary one when combined */
  company: Awaited<ReturnType<typeof getActiveCompany>>;
  label: string;
  /** options to render in the filter (already permission-filtered) */
  options: { value: string; label: string }[];
  /** id -> name, for labelling rows in combined mode */
  names: Record<string, string>;
};

/**
 * Resolves which companies a report covers. The picker only ever offers companies the user
 * is granted, and "Combined (All Companies)" is Super Admin only — so a normal user cannot
 * reach another company's figures by editing the query string.
 */
export async function resolveReportScope(user: SessionUser, requested?: string): Promise<ReportScope> {
  const companies = await allowedCompanies(user);
  const active = await getActiveCompany(user);
  const canCombine = user.role === "SUPER_ADMIN" && companies.length > 1;

  const options = [
    ...(canCombine ? [{ value: COMBINED, label: "Combined (All Companies)" }] : []),
    ...companies.map((c) => ({ value: c.id, label: c.companyName })),
  ];
  const names = Object.fromEntries(companies.map((c) => [c.id, c.companyName]));

  if (requested === COMBINED && canCombine) {
    return {
      ids: companies.map((c) => c.id),
      value: COMBINED,
      combined: true,
      company: companies.find((c) => c.isPrimary) ?? companies[0],
      label: "Combined — All Companies",
      options,
      names,
    };
  }
  const picked = companies.find((c) => c.id === requested) ?? active;
  return {
    ids: [picked.id],
    value: picked.id,
    combined: false,
    company: picked,
    label: picked.companyName,
    options,
    names,
  };
}

/** Same resolution for the Excel export routes, which receive the raw query value. */
export async function scopeIds(user: SessionUser, requested?: string): Promise<{ ids: string[]; label: string; combined: boolean; names: Record<string, string> }> {
  const s = await resolveReportScope(user, requested);
  return { ids: s.ids, label: s.label, combined: s.combined, names: s.names };
}
