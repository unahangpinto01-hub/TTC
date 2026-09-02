import type { ReportScope } from "@/lib/report-scope";

/** Company picker for reports. Renders nothing when the user has only one company,
    so single-company staff see no needless control. */
export function CompanyFilter({ scope, className = "max-w-[210px]" }: { scope: ReportScope; className?: string }) {
  if (scope.options.length < 2) return null;
  return (
    <div>
      <label className="label">Company</label>
      <select name="company" defaultValue={scope.value} className={`input ${className}`}>
        {scope.options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

/** Small badge identifying which company a row belongs to in a combined report. */
export function CompanyTag({ name }: { name: string }) {
  return (
    <span className="whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600 print:bg-gray-100">
      {name}
    </span>
  );
}
