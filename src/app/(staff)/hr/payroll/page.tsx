import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany, getPrimaryCompany } from "@/lib/company";
import { HrPrimaryOnlyNotice } from "@/app/(staff)/hr/primary-only";
import { peso } from "@/lib/format";
import { ALLOWANCE_FIELDS, DEDUCTION_FIELDS } from "@/lib/payroll";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { HrTabs } from "../hr-tabs";
import { deletePayrollEntry } from "../actions";
import { PayrollEntryForm, type EmployeeComp, type EditEntry } from "./entry-form";

export default async function PayrollPage({ searchParams }: { searchParams: { cutoff?: string; error?: string; emp?: string; entry?: string } }) {
  await requirePerm("hr");
  const activeCompany = await getActiveCompany();
  if (!activeCompany.isPrimary) return <HrPrimaryOnlyNotice primaryName={(await getPrimaryCompany()).companyName} />;
  const [entries, employees] = await Promise.all([
    prisma.payrollEntry.findMany({ orderBy: { createdAt: "desc" }, include: { employee: true } }),
    prisma.employee.findMany({ where: { status: "Active" }, orderBy: { name: "asc" } }),
  ]);
  const cutoffs = [...new Set(entries.map((e) => e.cutoff))];
  const selected = searchParams.cutoff || cutoffs[0] || "";
  const shown = entries.filter((e) => e.cutoff === selected);
  const totals = shown.reduce(
    (t, e) => ({
      basic: t.basic + e.basicPay,
      allow: t.allow + e.allowances,
      gross: t.gross + e.grossPay,
      ded: t.ded + e.deductions,
      net: t.net + e.netPay,
    }),
    { basic: 0, allow: 0, gross: 0, ded: 0, net: 0 }
  );

  const breakdown = (e: (typeof shown)[number]) => {
    const parts: string[] = [];
    for (const [key, label] of ALLOWANCE_FIELDS) {
      const v = e[key as keyof typeof e] as number;
      if (v > 0) parts.push(`${label} ${peso(v)}`);
    }
    for (const [key, label] of DEDUCTION_FIELDS) {
      const v = e[key as keyof typeof e] as number;
      if (v > 0) parts.push(`${label} (${peso(v)})`);
    }
    return parts.join(" · ");
  };

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

      {searchParams.error === "duplicate" && (
        <div className="no-print mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          ⚠ <span className="font-semibold">{searchParams.emp || "This employee"}</span> already has a payroll entry for
          cutoff <span className="font-semibold">{selected}</span> — duplication is not allowed. Remove the existing
          entry first if you need to re-enter it.
        </div>
      )}

      <p className="mb-2 text-sm text-gray-600">Payroll summary · cutoff: <span className="font-semibold">{selected || "—"}</span></p>
      <div className="card mb-4 overflow-x-auto p-0">
        <table className="w-full min-w-[820px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Employee</th>
              <th className="table-th text-right">Basic Pay</th>
              <th className="table-th text-right">Allowances</th>
              <th className="table-th text-right">Gross Pay</th>
              <th className="table-th text-right">Deductions</th>
              <th className="table-th text-right">Net Pay</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shown.map((e) => (
              <tr key={e.id} className={searchParams.entry === e.id ? "bg-emerald-50/60" : ""}>
                <td className="table-td">
                  <a href={`/hr/payroll?cutoff=${encodeURIComponent(selected)}&entry=${e.id}#entry-form`} className="font-medium text-emerald-700 hover:underline">
                    {e.employee.name}
                  </a>
                  <p className="text-xs text-gray-500">{e.employee.position}</p>
                  {breakdown(e) && <p className="mt-0.5 max-w-md text-[10px] leading-4 text-gray-400">{breakdown(e)}</p>}
                </td>
                <td className="table-td text-right align-top">{peso(e.basicPay)}</td>
                <td className="table-td text-right align-top">{peso(e.allowances)}</td>
                <td className="table-td text-right align-top font-semibold">{peso(e.grossPay)}</td>
                <td className="table-td text-right align-top text-red-600">({peso(e.deductions)})</td>
                <td className="table-td text-right align-top font-bold">
                  {peso(e.netPay)}
                  <div className="no-print mt-1 flex items-center justify-end gap-2">
                    <a href={`/hr/payroll?cutoff=${encodeURIComponent(selected)}&entry=${e.id}#entry-form`} className="text-[10px] font-normal text-emerald-700 hover:underline">edit</a>
                    <form action={deletePayrollEntry}>
                      <input type="hidden" name="id" value={e.id} />
                      <button className="text-[10px] font-normal text-red-500 hover:underline" type="submit">remove</button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={6} className="p-8 text-center text-sm text-gray-500">No entries for this cutoff.</td></tr>}
          </tbody>
          {shown.length > 0 && (
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <tr>
                <td className="table-td">TOTAL</td>
                <td className="table-td text-right">{peso(totals.basic)}</td>
                <td className="table-td text-right">{peso(totals.allow)}</td>
                <td className="table-td text-right">{peso(totals.gross)}</td>
                <td className="table-td text-right text-red-600">({peso(totals.ded)})</td>
                <td className="table-td text-right">{peso(totals.net)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <PayrollEntryForm
        key={searchParams.entry ?? "new"}
        employees={employees as unknown as EmployeeComp[]}
        defaultCutoff={selected}
        editEntry={(() => {
          const e = searchParams.entry ? entries.find((x) => x.id === searchParams.entry) : undefined;
          if (!e) return undefined;
          return { ...e, employeeName: e.employee.name } as unknown as EditEntry;
        })()}
      />
    </div>
  );
}
