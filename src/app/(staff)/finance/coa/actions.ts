"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermWrite } from "@/lib/auth";
import { logAudit } from "@/lib/salespeople";

/** Chart of Accounts management. The COA is shared master data (no company on the
    account itself); every change lands in the audit trail. Accounts are never deleted —
    one that has been used anywhere is deactivated instead. */

const STATEMENTS = ["BS", "IS"]; // a "use server" file may only export async functions

function err(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function readAccount(formData: FormData, path: string) {
  const code = String(formData.get("code") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const statement = String(formData.get("statement") || "").trim();
  const group = String(formData.get("group") || "").trim();
  if (!code) err(path, "Account code is required.");
  if (!description) err(path, "GL account description is required.");
  if (!STATEMENTS.includes(statement)) err(path, "Financial statement must be BS or IS.");
  if (!group) err(path, "Account group is required.");
  return {
    code,
    description,
    statement,
    group,
    normalBalance: String(formData.get("normalBalance")) === "Credit" ? "Credit" : "Debit",
    allowManualEntry: formData.get("allowManualEntry") === "on",
    isSystem: formData.get("isSystem") === "on",
  };
}

export async function createGLAccount(formData: FormData) {
  const user = await requirePermWrite("coa");
  const a = readAccount(formData, "/finance/coa");
  if (await prisma.gLAccount.findUnique({ where: { code: a.code } })) {
    err("/finance/coa", `Account code ${a.code} already exists.`);
  }
  const acct = await prisma.gLAccount.create({ data: a });
  await logAudit({
    entity: "GLAccount", entityId: acct.id, action: "CREATED",
    detail: `${a.code} "${a.description}" created (${a.statement} · ${a.group} · ${a.normalBalance}-normal)`,
    actorName: user.name, actorEmail: user.email,
  });
  revalidatePath("/finance/coa");
  redirect(`/finance/coa/${acct.id}`);
}

export async function updateGLAccount(formData: FormData) {
  const user = await requirePermWrite("coa");
  const id = String(formData.get("id"));
  const path = `/finance/coa/${id}`;
  const before = await prisma.gLAccount.findUniqueOrThrow({ where: { id } });
  // system accounts are used automatically by BMS modules — only the Super Admin edits them
  if (before.isSystem && user.role !== "SUPER_ADMIN") err(path, "This is a system account — only the Super Admin can modify it.");
  const a = readAccount(formData, path);
  const clash = await prisma.gLAccount.findUnique({ where: { code: a.code } });
  if (clash && clash.id !== id) err(path, `Account code ${a.code} already exists.`);
  await prisma.gLAccount.update({ where: { id }, data: a });

  const changes: string[] = [];
  if (before.code !== a.code) changes.push(`code ${before.code} → ${a.code}`);
  if (before.description !== a.description) changes.push(`description "${before.description}" → "${a.description}"`);
  if (before.statement !== a.statement || before.group !== a.group) {
    changes.push(`classification ${before.statement}/${before.group} → ${a.statement}/${a.group}`);
  }
  if (before.normalBalance !== a.normalBalance) changes.push(`normal balance → ${a.normalBalance}`);
  if (before.allowManualEntry !== a.allowManualEntry) changes.push(`manual journal entry → ${a.allowManualEntry ? "allowed" : "blocked"}`);
  if (before.isSystem !== a.isSystem) changes.push(`system account → ${a.isSystem ? "yes" : "no"}`);
  await logAudit({
    entity: "GLAccount", entityId: id, action: "EDITED",
    detail: `${a.code}: ${changes.join("; ") || "no field changes"}`,
    actorName: user.name, actorEmail: user.email,
  });
  revalidatePath("/finance/coa");
  revalidatePath(path);
  redirect(`${path}?saved=ok`);
}

export async function toggleGLAccount(formData: FormData) {
  const user = await requirePermWrite("coa");
  const id = String(formData.get("id"));
  const acct = await prisma.gLAccount.findUniqueOrThrow({ where: { id } });
  if (acct.isSystem && user.role !== "SUPER_ADMIN") {
    err(`/finance/coa/${id}`, "This is a system account — only the Super Admin can deactivate it.");
  }
  const status = acct.status === "Active" ? "Inactive" : "Active";
  await prisma.gLAccount.update({ where: { id }, data: { status } });
  await logAudit({
    entity: "GLAccount", entityId: id, action: status === "Active" ? "ACTIVATED" : "DEACTIVATED",
    detail: `${acct.code} "${acct.description}" ${status.toLowerCase()}`,
    actorName: user.name, actorEmail: user.email,
  });
  revalidatePath("/finance/coa");
  revalidatePath(`/finance/coa/${id}`);
  redirect(`/finance/coa/${id}`);
}

export type ImportRow = {
  code: string;
  description: string;
  statement: string;
  group: string;
};

/** Commit a validated import from the Import page. Existing codes are only overwritten
    when the user explicitly ticked that authorization. */
export async function importGLAccounts(input: { rows: ImportRow[]; overwrite: boolean }): Promise<{ created: number; updated: number; skipped: number }> {
  const user = await requirePermWrite("coa");
  const CREDIT_GROUPS = new Set(["Liabilities", "Stockholder's Equity", "Sales", "Other Income"]);
  let created = 0, updated = 0, skipped = 0;
  const seen = new Set<string>();
  for (const r of input.rows) {
    const code = r.code.trim();
    const description = r.description.trim();
    const statement = r.statement.trim();
    const group = r.group.trim();
    if (!code || !description || !STATEMENTS.includes(statement) || !group || seen.has(code)) { skipped++; continue; }
    seen.add(code);
    const existing = await prisma.gLAccount.findUnique({ where: { code } });
    if (existing) {
      if (!input.overwrite) { skipped++; continue; }
      if (existing.isSystem && user.role !== "SUPER_ADMIN") { skipped++; continue; }
      await prisma.gLAccount.update({ where: { id: existing.id }, data: { description, statement, group } });
      updated++;
    } else {
      await prisma.gLAccount.create({
        data: { code, description, statement, group, normalBalance: CREDIT_GROUPS.has(group) ? "Credit" : "Debit" },
      });
      created++;
    }
  }
  await logAudit({
    entity: "GLAccount", entityId: "IMPORT", action: "IMPORTED",
    detail: `masterlist import: ${created} created, ${updated} updated${input.overwrite ? " (overwrite authorized)" : ""}, ${skipped} skipped`,
    actorName: user.name, actorEmail: user.email,
  });
  revalidatePath("/finance/coa");
  return { created, updated, skipped };
}
