import { requirePerm } from "@/lib/auth";
import { getCompany } from "@/lib/company";
import { fmtDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { updateCompany } from "./actions";
import { LogoField } from "./logo-field";

export default async function CompanyPage({ searchParams }: { searchParams: { saved?: string; error?: string } }) {
  const user = await requirePerm("company");
  const company = await getCompany();
  const readOnly = user.perm !== "READ_WRITE";

  const FIELDS: [string, string, string][] = [
    ["companyName", "Company Name", company.companyName],
    ["address", "Company Address", company.address],
    ["contactNo", "Contact Number", company.contactNo],
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
                placeholder={name === "contactNo" ? "0917-XXXXXXX" : name === "tin" ? "XXX-XXX-XXX-XXX" : ""}
              />
            </div>
          ))}
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

        {!readOnly && <button className="btn-primary" type="submit">💾 Save Company Details</button>}
        <p className="text-xs text-gray-400">Last updated {fmtDateTime(company.updatedAt)}</p>
      </form>
    </div>
  );
}
