import { requirePerm } from "@/lib/auth";
import { getActiveCompany, getDocVisibility, DOC_TYPES, PRINT_FIELDS } from "@/lib/company";
import { fmtDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { updateCompany } from "./actions";
import { LogoField } from "./logo-field";
import { prisma } from "@/lib/db";

export default async function CompanyPage({ searchParams }: { searchParams: { saved?: string; error?: string } }) {
  const user = await requirePerm("company");
  const company = await getActiveCompany(user);
  const readOnly = user.perm !== "READ_WRITE";
  // signatory pickers list the active employee master — never a hard-coded name
  const staff = await prisma.employee.findMany({
    where: { status: "Active" },
    select: { id: true, name: true, position: true },
    orderBy: { name: "asc" },
  });

  const FIELDS: [string, string, string][] = [
    ["companyName", "Company Name", company.companyName],
    ["address", "Company Address", company.address],
    ["mobileNo", "Mobile Phone", company.mobileNo],
    ["telephoneNo", "Telephone Number", company.telephoneNo],
    ["email", "Email Address", company.email],
    ["tin", "TIN", company.tin],
    ["sssNo", "SSS Number", company.sssNo],
    ["phicNo", "PHIC Number", company.phicNo],
    ["hdmfNo", "HDMF Number", company.hdmfNo],
  ];

  return (
    <div className="max-w-2xl">
      <PageHeader title="Company Details" />
      <p className="mb-4 text-sm text-gray-500">
        One source of truth for the company information printed on Sales Orders, Delivery Receipts,
        Sales Receipts, and other documents. Changes apply to all documents generated from now on.
      </p>

      {searchParams.saved && (
        <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">✔ Company details saved. Future documents will use the updated information.</p>
      )}
      {searchParams.error === "name" && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">Company name is required.</p>}
      {searchParams.error === "logo" && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">The logo must be a PNG or JPG image.</p>}
      {searchParams.error === "logosize" && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">That logo file is too large even after resizing — try a simpler image.</p>}

      <form action={updateCompany} className="card space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.map(([name, label, value]) => (
            <div key={name} className={name === "companyName" || name === "address" ? "sm:col-span-2" : ""}>
              <label className="label">{label}</label>
              <input
                name={name}
                defaultValue={value}
                required={name === "companyName"}
                disabled={readOnly}
                className="input"
                placeholder={
                  name === "mobileNo" ? "0917-XXXXXXX"
                  : name === "telephoneNo" ? "(049) XXX-XXXX"
                  : name === "email" ? "info@company.com"
                  : name === "tin" ? "XXX-XXX-XXX-XXX"
                  : ""
                }
              />
            </div>
          ))}
        </div>

        <div>
          <label className="label">Show on Printed Documents</label>
          <p className="mb-2 text-xs text-gray-500">
            Tick which details appear in each document&apos;s header. Company name and logo always print.
          </p>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Detail</th>
                  {DOC_TYPES.map(([key, label]) => (
                    <th key={key} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {PRINT_FIELDS.map(([field, label]) => (
                  <tr key={field}>
                    <td className="px-3 py-1.5 font-medium">{label}</td>
                    {DOC_TYPES.map(([doc]) => (
                      <td key={doc} className="px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          name={`vis_${doc}_${field}`}
                          defaultChecked={getDocVisibility(company, doc)[field]}
                          disabled={readOnly}
                          className="h-4 w-4 accent-emerald-700"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {readOnly ? (
          <div>
            <label className="label">Company Logo</label>
            {company.logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logoDataUrl} alt="Company logo" className="h-[100px] w-[100px] rounded-xl border border-gray-200 object-contain" />
            ) : (
              <p className="text-sm text-gray-400">No logo uploaded.</p>
            )}
          </div>
        ) : (
          <LogoField currentLogo={company.logoDataUrl} />
        )}

        <div>
          <p className="mb-1 font-semibold">Delivery Receipt Signatories</p>
          <p className="mb-3 text-xs text-gray-500">
            Who a new delivery receipt is assigned to for {company.companyName}. Stored as employee links, so renaming
            someone in HR updates every receipt that names them. An individual receipt can still be reassigned by an
            admin, and that change is recorded in the audit trail.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {([
              ["drPreparedById", "Prepared by", company.drPreparedById],
              ["drCheckedById", "Checked by", company.drCheckedById],
              ["drApprovedById", "Approved by", company.drApprovedById],
            ] as const).map(([field, label, current]) => (
              <div key={field}>
                <label className="label">{label}</label>
                {readOnly ? (
                  <p className="text-sm font-semibold">{staff.find((e) => e.id === current)?.name ?? "—"}</p>
                ) : (
                  <select name={field} defaultValue={current ?? ""} className="input">
                    <option value="">— none —</option>
                    {staff.map((e) => (
                      <option key={e.id} value={e.id}>{e.name} · {e.position}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </div>

        {!readOnly && <button className="btn-primary" type="submit">💾 Save Company Details</button>}
        <p className="text-xs text-gray-400">Last updated {fmtDateTime(company.updatedAt)}</p>
      </form>
    </div>
  );
}
