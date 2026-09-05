import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import { getUser, type SessionUser } from "./auth";

const COMPANY_COOKIE = "tt_company";

/** The primary company (owns employees/HR/payroll and the dealer portal). */
export async function getPrimaryCompany() {
  const primary = await prisma.company.findFirst({ where: { isPrimary: true } });
  if (primary) return primary;
  const oldest = await prisma.company.findFirst({ orderBy: { createdAt: "asc" } });
  if (oldest) return oldest;
  return prisma.company.create({ data: { companyName: "My Company", isPrimary: true } });
}

/** Company ids this user may access. null/unset = primary company only (explicit assignment required for more). */
export async function allowedCompanyIds(user: Pick<SessionUser, "companyIdsJson">): Promise<string[]> {
  if (user.companyIdsJson) {
    try {
      const ids = JSON.parse(user.companyIdsJson);
      if (Array.isArray(ids) && ids.length) return ids.map(String);
    } catch {}
  }
  return [(await getPrimaryCompany()).id];
}

export async function allowedCompanies(user: Pick<SessionUser, "companyIdsJson">) {
  const ids = await allowedCompanyIds(user);
  return prisma.company.findMany({
    where: { id: { in: ids }, status: "Active" },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], // primary company first / default
  });
}

/** SERVER-SIDE active company resolution: the cookie is only a preference — it is always
    validated against the user's explicit company access. Never trust it directly. */
export async function getActiveCompany(user?: SessionUser | null) {
  const u = user ?? (await getUser());
  if (!u) redirect("/login");
  const companies = await allowedCompanies(u);
  if (!companies.length) redirect("/denied");
  const pref = cookies().get(COMPANY_COOKIE)?.value;
  return companies.find((c) => c.id === pref) ?? companies[0];
}

/** Guard for company-specific records: the record's company must be the ACTIVE one.
    Cross-company access (URL/id manipulation) gets denied even if the user could switch. */
export async function requireCompanyRecord(recordCompanyId: string, user?: SessionUser | null) {
  const active = await getActiveCompany(user);
  if (recordCompanyId !== active.id) redirect("/denied");
  return active;
}

export const COMPANY_COOKIE_NAME = COMPANY_COOKIE;

/* ------------------------------------------------- print visibility (unchanged) */

export const DOC_TYPES = [
  ["SO", "Sales Order"],
  ["DR", "Delivery Receipt"],
  ["SR", "Sales Receipt"],
  ["PO", "Purchase Order"],
  ["ORDER", "Incoming Order"],
  ["PR", "Payment Receipt"],
] as const;
export type DocTypeKey = (typeof DOC_TYPES)[number][0];

export const PRINT_FIELDS = [
  ["address", "Address"],
  ["mobileNo", "Mobile No."],
  ["telephoneNo", "Telephone No."],
  ["email", "Email Address"],
  ["tin", "TIN"],
  ["sssNo", "SSS No."],
  ["phicNo", "PHIC No."],
  ["hdmfNo", "HDMF No."],
] as const;
export type PrintFieldKey = (typeof PRINT_FIELDS)[number][0];

/** Default: what documents already showed before this option existed. */
export const DEFAULT_VISIBILITY: Record<PrintFieldKey, boolean> = {
  address: true,
  mobileNo: true,
  telephoneNo: true,
  email: true,
  tin: true,
  sssNo: false,
  phicNo: false,
  hdmfNo: false,
};

/** Which fields print on a given document type, from the saved matrix (defaults fill gaps). */
export function getDocVisibility(
  company: { printVisibilityJson: string | null },
  doc: DocTypeKey
): Record<PrintFieldKey, boolean> {
  let saved: Partial<Record<PrintFieldKey, boolean>> = {};
  if (company.printVisibilityJson) {
    try {
      saved = (JSON.parse(company.printVisibilityJson) as Record<string, Partial<Record<PrintFieldKey, boolean>>>)[doc] ?? {};
    } catch {
      saved = {};
    }
  }
  const result = { ...DEFAULT_VISIBILITY };
  for (const [key] of PRINT_FIELDS) {
    if (typeof saved[key] === "boolean") result[key] = saved[key]!;
  }
  return result;
}
