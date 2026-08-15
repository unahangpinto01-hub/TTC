"use client";

import { useState } from "react";
import { ALLOWANCE_FIELDS, DEDUCTION_FIELDS } from "@/lib/payroll";
import { createPayrollEntry } from "../actions";

export type EmployeeComp = {
  id: string;
  name: string;
  position: string;
  basicSalary: number;
} & Record<string, string | number>;

const ITEM_KEYS = [...ALLOWANCE_FIELDS, ...DEDUCTION_FIELDS].map(([k]) => k);

function prefill(emp: EmployeeComp | undefined) {
  const values: Record<string, string> = { basicPay: emp ? (emp.basicSalary / 2).toFixed(2) : "" };
  for (const key of ITEM_KEYS) {
    const v = emp ? Number(emp[key]) || 0 : 0;
    values[key] = v > 0 ? v.toFixed(2) : "";
  }
  return values;
}

export function PayrollEntryForm({ employees, defaultCutoff }: { employees: EmployeeComp[]; defaultCutoff: string }) {
  const [values, setValues] = useState<Record<string, string>>(() => prefill(employees[0]));

  const onEmployeeChange = (id: string) => {
    setValues(prefill(employees.find((e) => e.id === id)));
  };
  const set = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  const num = (k: string) => Number(values[k]) || 0;
  const totalAllow = ALLOWANCE_FIELDS.reduce((s, [k]) => s + num(k), 0);
  const totalDed = DEDUCTION_FIELDS.reduce((s, [k]) => s + num(k), 0);
  const gross = num("basicPay") + totalAllow;
  const fmt = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <form action={createPayrollEntry} className="no-print card max-w-4xl space-y-4">
      <h2 className="font-semibold">Add Payroll Entry</h2>
      <p className="text-xs text-gray-500">
        Amounts prefill from the employee's profile (set them via HR → Employees → Edit) — every box stays editable; nothing is added automatically.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Employee</label>
          <select name="employeeId" className="input" onChange={(e) => onEmployeeChange(e.target.value)}>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name} — {e.position}</option>)}
          </select>
        </div>
        <div><label className="label">Cutoff</label><input name="cutoff" required className="input" placeholder="Aug 16-31, 2026" defaultValue={defaultCutoff} /></div>
        <div>
          <label className="label">Basic Pay</label>
          <input name="basicPay" type="number" step="0.01" min="0" value={values.basicPay} onChange={(e) => set("basicPay", e.target.value)} className="input" />
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Allowances</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {ALLOWANCE_FIELDS.map(([key, label]) => (
            <div key={key}>
              <label className="label text-xs">{label}</label>
              <input name={key} type="number" step="0.01" min="0" placeholder="0.00" value={values[key]} onChange={(e) => set(key, e.target.value)} className="input" />
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-700">Deductions</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {DEDUCTION_FIELDS.map(([key, label]) => (
            <div key={key}>
              <label className="label text-xs">{label}</label>
              <input name={key} type="number" step="0.01" min="0" placeholder="0.00" value={values[key]} onChange={(e) => set(key, e.target.value)} className="input" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-6 rounded-lg bg-gray-50 px-4 py-2.5 text-sm">
        <span>Allowances: <span className="font-semibold text-emerald-700">{fmt(totalAllow)}</span></span>
        <span>Gross Pay: <span className="font-semibold">{fmt(gross)}</span></span>
        <span>Deductions: <span className="font-semibold text-red-600">({fmt(totalDed)})</span></span>
        <span>Net Pay: <span className="font-bold">{fmt(gross - totalDed)}</span></span>
      </div>
      <button className="btn-primary" type="submit">Add Entry</button>
    </form>
  );
}
