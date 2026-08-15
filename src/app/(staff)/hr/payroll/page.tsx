import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { peso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { createPayrollEntry } from "../actions";
import { HrTabs } from "../hr-tabs";

export default async function PayrollPage({ searchParams }: { searchParams: { cutoff?: string } }) {
  await requireStaff(["SUPER_ADMIN", "ADMIN"]);
  const [entries, employees] = await Promise.all([
    prisma.payrollEntry.findMany({ orderBy: { createdAt: "desc" }, include: { employee: true } }),
    prisma.employee.findMany({ where: { status: "Active" }, orderBy: { name: "asc" } }),
  ]);
  const cutoffs = [...new Set(entries.map((e) => e.cutoff))];
  const selected = searchParams.cutoff || cutoffs[0] || "";
  const shown = entries.filter((e) => e.cutoff === selected);
  const totals = shown.reduce(
    (t, e) => ({ basic: t.basic + e.basicPay, allow: t.allow + e.allowances, ded: t.ded + e.deductions, net: t.net + e.netPay }),
    { basic: 0, allow: 0, ded: 0, net: 0 }
  );

  return (
    <div className="print-page">
      <PageHeader title="Payroll Register">
        <span className="no-print"><PrintButton /></span>
      </PageHeader>
      <div className="no-print"><HrTabs /></div>

      <form method="GET" className="no-print mb-4 flex items-end gap-2">
        <div>
          <label className="label">Cutoff</label>
          <select name="cutoff" defaultValue={selected} className="input">
            {cutoffs.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <button className="btn-secondary" type="submit">View</button>
      </form>

      <p className="mb-2 text-sm text-gray-600">Payroll summary · cutoff: <span className="font-semibold">{selected || "—"}</span></p>
      <div className="card mb-4 overflow-x-auto p-0">
        <table className="w-full min-w-[680px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Employee</th>
              <th className="table-th">Position</th>
              <th className="table-th text-right">Basic Pay</th>
              <th className="table-th text-right">Allowances</th>
              <th className="table-th text-right">Deductions</th>
              <th className="table-th text-right">Net Pay</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shown.map((e) => (
              <tr key={e.id}>
                <td className="table-td font-medium">{e.employee.name}</td>
                <td className="table-td text-sm text-gray-600">{e.employee.position}</td>
                <td className="table-td text-right">{peso(e.basicPay)}</td>
                <td className="table-td text-right">{peso(e.allowances)}</td>
                <td className="table-td text-right">({peso(e.deductions)})</td>
                <td className="table-td text-right font-bold">{peso(e.netPay)}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={6} className="p-8 text-center text-sm text-gray-500">No entries for this cutoff.</td></tr>}
          </tbody>
          {shown.length > 0 && (
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <tr>
                <td className="table-td" colSpan={2}>TOTAL</td>
                <td className="table-td text-right">{peso(totals.basic)}</td>
                <td className="table-td text-right">{peso(totals.allow)}</td>
                <td className="table-td text-right">({peso(totals.ded)})</td>
                <td className="table-td text-right">{peso(totals.net)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <form action={createPayrollEntry} className="no-print card max-w-2xl space-y-3">
        <h2 className="font-semibold">Add Payroll Entry</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Employee</label>
            <select name="employeeId" className="input">
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.position}</option>)}
            </select>
          </div>
          <div><label className="label">Cutoff</label><input name="cutoff" required className="input" placeholder="Aug 16-31, 2026" defaultValue={selected} /></div>
          <div><label className="label">Basic Pay (blank = ½ monthly)</label><input name="basicPay" type="number" step="0.01" className="input" /></div>
          <div><label className="label">Allowances</label><input name="allowances" type="number" step="0.01" defaultValue={0} className="input" /></div>
          <div><label className="label">Deductions</label><input name="deductions" type="number" step="0.01" defaultValue={0} className="input" /></div>
        </div>
        <button className="btn-primary" type="submit">Add Entry</button>
      </form>
    </div>
  );
}
