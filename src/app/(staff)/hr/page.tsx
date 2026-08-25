import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany, getPrimaryCompany } from "@/lib/company";
import { HrPrimaryOnlyNotice } from "@/app/(staff)/hr/primary-only";
import { peso, fmtDate } from "@/lib/format";
import { ALLOWANCE_FIELDS, DEDUCTION_FIELDS } from "@/lib/payroll";
import { PageHeader, StatusBadge } from "@/components/ui";
import { createEmployee, updateEmployee } from "./actions";
import { HrTabs } from "./hr-tabs";

export default async function EmployeesPage({ searchParams }: { searchParams: { edit?: string } }) {
  await requirePerm("hr");
  const activeCompany = await getActiveCompany();
  if (!activeCompany.isPrimary) return <HrPrimaryOnlyNotice primaryName={(await getPrimaryCompany()).companyName} />;
  const employees = await prisma.employee.findMany({ orderBy: { name: "asc" } });
  const today = new Date().toISOString().slice(0, 10);
  const editing = searchParams.edit ? employees.find((e) => e.id === searchParams.edit) : undefined;

  return (
    <div>
      <PageHeader title="Human Resources" />
      <HrTabs />

      {editing && (
        <form action={updateEmployee} className="card mb-4 space-y-4 border-emerald-300 bg-emerald-50/40">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Edit Employee — {editing.name}</h2>
            <Link href="/hr" className="btn-secondary">Cancel</Link>
          </div>
          <input type="hidden" name="id" value={editing.id} />
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div><label className="label">Name</label><input name="name" defaultValue={editing.name} required className="input" /></div>
            <div><label className="label">Position</label><input name="position" defaultValue={editing.position} required className="input" /></div>
            <div><label className="label">Department</label><input name="department" defaultValue={editing.department} required className="input" /></div>
            <div><label className="label">Basic Salary (₱/month)</label><input name="basicSalary" type="number" step="0.01" min="0" defaultValue={editing.basicSalary} required className="input" /></div>
            <div>
              <label className="label">Status</label>
              <select name="status" defaultValue={editing.status} className="input"><option>Active</option><option>Inactive</option></select>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Default Allowances (per cutoff — prefill only)</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {ALLOWANCE_FIELDS.map(([key, label]) => (
                <div key={key}>
                  <label className="label text-xs">{label}</label>
                  <input name={key} type="number" step="0.01" min="0" defaultValue={(editing as any)[key] || ""} placeholder="0.00" className="input" />
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-700">Default Deductions (per cutoff — prefill only)</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {DEDUCTION_FIELDS.map(([key, label]) => (
                <div key={key}>
                  <label className="label text-xs">{label}</label>
                  <input name={key} type="number" step="0.01" min="0" defaultValue={(editing as any)[key] || ""} placeholder="0.00" className="input" />
                </div>
              ))}
            </div>
          </div>
          <button className="btn-primary" type="submit">Save Employee</button>
        </form>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="table-th">Name</th>
                  <th className="table-th">Position</th>
                  <th className="table-th">Department</th>
                  <th className="table-th">Hired</th>
                  <th className="table-th text-right">Basic Salary</th>
                  <th className="table-th">Status</th>
                  <th className="table-th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {employees.map((e) => (
                  <tr key={e.id} className={e.status === "Inactive" ? "opacity-60" : ""}>
                    <td className="table-td font-medium">{e.name}</td>
                    <td className="table-td text-sm">{e.position}</td>
                    <td className="table-td text-sm text-gray-600">{e.department}</td>
                    <td className="table-td text-sm">{fmtDate(e.hireDate)}</td>
                    <td className="table-td text-right">{peso(e.basicSalary)}</td>
                    <td className="table-td"><StatusBadge status={e.status} /></td>
                    <td className="table-td text-right">
                      <Link href={`/hr?edit=${e.id}`} className="text-sm font-medium text-emerald-700 hover:underline">Edit</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <form action={createEmployee} className="card h-fit space-y-3">
          <h2 className="font-semibold">Add Employee</h2>
          <div><label className="label">Name</label><input name="name" required className="input" /></div>
          <div><label className="label">Position</label><input name="position" required className="input" /></div>
          <div><label className="label">Department</label><input name="department" required className="input" /></div>
          <div><label className="label">Hire Date</label><input name="hireDate" type="date" defaultValue={today} required className="input" /></div>
          <div><label className="label">Basic Salary (₱/month)</label><input name="basicSalary" type="number" step="0.01" required className="input" /></div>
          <p className="text-xs text-gray-500">Set default allowances and deductions after saving, via Edit.</p>
          <button className="btn-primary" type="submit">Add Employee</button>
        </form>
      </div>
    </div>
  );
}
