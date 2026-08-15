import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { createEmployee } from "./actions";
import { HrTabs } from "./hr-tabs";

export default async function EmployeesPage() {
  await requireStaff(["SUPER_ADMIN", "ADMIN"]);
  const employees = await prisma.employee.findMany({ orderBy: { name: "asc" } });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader title="Human Resources" />
      <HrTabs />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[640px]">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="table-th">Name</th>
                  <th className="table-th">Position</th>
                  <th className="table-th">Department</th>
                  <th className="table-th">Hired</th>
                  <th className="table-th text-right">Basic Salary</th>
                  <th className="table-th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td className="table-td font-medium">{e.name}</td>
                    <td className="table-td text-sm">{e.position}</td>
                    <td className="table-td text-sm text-gray-600">{e.department}</td>
                    <td className="table-td text-sm">{fmtDate(e.hireDate)}</td>
                    <td className="table-td text-right">{peso(e.basicSalary)}</td>
                    <td className="table-td"><StatusBadge status={e.status} /></td>
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
          <button className="btn-primary" type="submit">Add Employee</button>
        </form>
      </div>
    </div>
  );
}
