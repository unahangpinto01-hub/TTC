import { prisma } from "./db";

/** The company details singleton — created with defaults on first access. */
export async function getCompany() {
  const existing = await prisma.companySetting.findUnique({ where: { id: "company" } });
  if (existing) return existing;
  return prisma.companySetting.create({ data: { id: "company" } });
}

export const DOC_TYPES = [
  ["SO", "Sales Order"],
  ["DR", "Delivery Receipt"],
  ["SR", "Sales Receipt"],
  ["PO", "Purchase Order"],
  ["ORDER", "Incoming Order"],
] as const;
export type DocTypeKey = (typeof DOC_TYPES)[number][0];

export const PRINT_FIELDS = [
  ["address", "Address"],
  ["contactNo", "Contact No."],
  ["tin", "TIN"],
  ["sssNo", "SSS No."],
  ["phicNo", "PHIC No."],
  ["hdmfNo", "HDMF No."],
] as const;
export type PrintFieldKey = (typeof PRINT_FIELDS)[number][0];

/** Default: what documents already showed before this option existed. */
export const DEFAULT_VISIBILITY: Record<PrintFieldKey, boolean> = {
  address: true,
  contactNo: true,
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
