"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function createEmployee(formData: FormData) {
  await requireStaff(["SUPER_ADMIN", "ADMIN"]);
  await prisma.employee.create({
    data: {
      name: String(formData.get("name")).trim(),
      position: String(formData.get("position")).trim(),
      department: String(formData.get("department")).trim(),
      hireDate: new Date(String(formData.get("hireDate"))),
      basicSalary: Number(formData.get("basicSalary")) || 0,
    },
  });
  revalidatePath("/hr");
  redirect("/hr");
}

export async function createPayrollEntry(formData: FormData) {
  await requireStaff(["SUPER_ADMIN", "ADMIN"]);
  const { ALLOWANCE_FIELDS, DEDUCTION_FIELDS } = await import("@/lib/payroll");
  const employeeId = String(formData.get("employeeId"));
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const basicPay = round2(Number(formData.get("basicPay")) || emp.basicSalary / 2);

  const items: Record<string, number> = {};
  let allowances = 0;
  for (const [key] of ALLOWANCE_FIELDS) {
    const v = round2(Math.max(0, Number(formData.get(key)) || 0));
    items[key] = v;
    allowances += v;
  }
  let deductions = 0;
  for (const [key] of DEDUCTION_FIELDS) {
    const v = round2(Math.max(0, Number(formData.get(key)) || 0));
    items[key] = v;
    deductions += v;
  }
  allowances = round2(allowances);
  deductions = round2(deductions);
  const grossPay = round2(basicPay + allowances);

  await prisma.payrollEntry.create({
    data: {
      employeeId,
      cutoff: String(formData.get("cutoff")).trim(),
      basicPay,
      ...items,
      allowances,
      grossPay,
      deductions,
      netPay: round2(grossPay - deductions),
    },
  });
  revalidatePath("/hr/payroll");
  redirect("/hr/payroll");
}

export async function createEvaluation(formData: FormData) {
  const user = await requireStaff(["SUPER_ADMIN", "ADMIN"]);
  const scores = {
    Punctuality: Number(formData.get("score_punctuality")) || 3,
    Quality: Number(formData.get("score_quality")) || 3,
    Teamwork: Number(formData.get("score_teamwork")) || 3,
    Initiative: Number(formData.get("score_initiative")) || 3,
  };
  await prisma.evaluation.create({
    data: {
      employeeId: String(formData.get("employeeId")),
      period: String(formData.get("period")).trim(),
      scoresJson: JSON.stringify(scores),
      remarks: String(formData.get("remarks") || "").trim() || null,
      evaluatorId: user.id,
    },
  });
  revalidatePath("/hr/evaluations");
  redirect("/hr/evaluations");
}
