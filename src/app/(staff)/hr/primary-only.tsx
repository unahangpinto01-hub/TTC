import { PageHeader } from "@/components/ui";

/** Shown when HR/Payroll is opened while a non-primary company is active —
    employees and payroll belong exclusively to the primary company. */
export function HrPrimaryOnlyNotice({ primaryName }: { primaryName: string }) {
  return (
    <div className="max-w-xl">
      <PageHeader title="HR & Payroll" />
      <div className="card border-amber-200 bg-amber-50/60 p-6 text-sm text-amber-900">
        <p className="mb-1 font-semibold">👥 HR and Payroll are exclusive to {primaryName}.</p>
        <p>
          All employees and payroll records belong to {primaryName}. Switch the active company using the
          selector in the sidebar to access this module.
        </p>
      </div>
    </div>
  );
}
