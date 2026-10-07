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
  const policy = await prisma.company.findUniqueOrThrow({ where: { id: company.id }, select: { glPpdId: true, glOtherDiscountId: true, glCustomerAdvancesId: true, ppdRate: true, ppdDays: true, ppdMaxRate: true, affiliateCompanyId: true, glAffiliateAdvancesId: true, affiliateHeldCashAccountId: true } });
  const pct = (r: number) => (Math.round(r * 10000) / 100).toString();
  // intercompany collections: the other active companies and this company's own cash accounts
  const [otherCompanies, ownCashAccounts] = await Promise.all([
    prisma.company.findMany({ where: { status: "Active", NOT: { id: company.id } }, select: { id: true, companyName: true }, orderBy: { companyName: "asc" } }),
    prisma.cashAccount.findMany({ where: { companyId: company.id, status: "Active" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  // signatory pickers list the active employee master — never a hard-coded name
  // income accounts to map the billing components to — the Chart of Accounts is the source
  const incomeAccounts = await prisma.gLAccount.findMany({
    where: { status: "Active", statement: "IS" },
    orderBy: { code: "asc" },
    select: { id: true, code: true, description: true },
  });
  // balance-sheet accounts for what a supplier bill moves — inventory, the payable, input VAT
  const bsAccounts = await prisma.gLAccount.findMany({
    where: { status: "Active", statement: "BS" },
    orderBy: { code: "asc" },
    select: { id: true, code: true, description: true },
  });
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
      {searchParams.error === "affiliate" && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">The affiliate settings point at a company, account or cash account that does not exist or is inactive.</p>}

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
          <p className="mb-1 font-semibold">Sales Account Mapping</p>
          <p className="mb-3 text-xs text-gray-500">
            Which Chart of Accounts entry each part of an invoice credits. Freight and other charges are billed to the
            customer but are not product revenue, so they are credited separately — an account left unset simply shows
            as unset in the Ledger rather than being folded into Sales.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {([
              ["glSalesId", "Product Sales", company.glSalesId],
              ["glFreightId", "Freight Income", company.glFreightId],
              ["glOtherId", "Other Income", company.glOtherId],
            ] as const).map(([field, label, current]) => (
              <div key={field}>
                <label className="label">{label}</label>
                {readOnly ? (
                  <p className="text-sm font-semibold">
                    {(() => {
                      const a = incomeAccounts.find((x) => x.id === current);
                      return a ? `${a.code} ${a.description}` : "— not set —";
                    })()}
                  </p>
                ) : (
                  <select name={field} defaultValue={current ?? ""} className="input">
                    <option value="">— not set —</option>
                    {incomeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} · {a.description}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 font-semibold">Collections — Discounts, Customer Advances and PPD Policy</p>
          <p className="mb-3 text-xs text-gray-500">
            Where a prompt payment discount and an other discount granted on a receive payment are booked (an other-discount reason with
            its own account overrides the default), and the PPD policy: the default rate offered, the window in days from the invoice date
            inside which PPD is granted by rule (0 = no window, every PPD is entered by hand), and the highest rate allowed (0 = no ceiling).
            Money received from a customer and not yet applied to an invoice is booked to the customer advances account until it is applied.
            PPD is computed on the product amount of the invoice (freight and other charges are never discounted), pro-rated to what the payment settles. Outside the window only a user with PPD
            Override may grant it, with a reason.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">Customer advances (unapplied receipts)</label>
              {readOnly ? (
                <p className="text-sm font-semibold">{(() => { const a = bsAccounts.find((x) => x.id === policy.glCustomerAdvancesId); return a ? `${a.code} ${a.description}` : "— not set —"; })()}</p>
              ) : (
                <select name="glCustomerAdvancesId" defaultValue={policy.glCustomerAdvancesId ?? ""} className="input">
                  <option value="">— not set —</option>
                  {bsAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.description}</option>)}
                </select>
              )}
            </div>
            {([
              ["glPpdId", "Prompt Payment Discount account", policy.glPpdId],
              ["glOtherDiscountId", "Other Discount account (default)", policy.glOtherDiscountId],
            ] as const).map(([field, label, current]) => (
              <div key={field}>
                <label className="label">{label}</label>
                {readOnly ? (
                  <p className="text-sm font-semibold">
                    {(() => {
                      const a = incomeAccounts.find((x) => x.id === current);
                      return a ? `${a.code} ${a.description}` : "— not set —";
                    })()}
                  </p>
                ) : (
                  <select name={field} defaultValue={current ?? ""} className="input">
                    <option value="">— not set —</option>
                    {incomeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} · {a.description}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
            <div><label className="label">PPD default rate %</label><input name="ppdRatePct" type="number" step="0.01" min={0} max={99} defaultValue={pct(policy.ppdRate)} disabled={readOnly} className="input" /></div>
            <div><label className="label">PPD window (days from invoice)</label><input name="ppdDays" type="number" step="1" min={0} defaultValue={policy.ppdDays} disabled={readOnly} className="input" /></div>
            <div><label className="label">PPD ceiling rate %</label><input name="ppdMaxRatePct" type="number" step="0.01" min={0} max={99} defaultValue={pct(policy.ppdMaxRate)} disabled={readOnly} className="input" /></div>
          </div>
        </div>

        <div>
          <p className="mb-1 font-semibold">Intercompany Collections</p>
          <p className="mb-3 text-xs text-gray-500">
            A customer of both companies may pay one lump sum into this company&rsquo;s bank. On a Receive Payment the part that settles the
            affiliate&rsquo;s invoices is entered as &ldquo;collected for the affiliate&rdquo;: it is booked to the Advances from Affiliate account
            (owed to them) and a mirrored receipt is drafted in the affiliate&rsquo;s books on the cash account the affiliate names here as
            &ldquo;held by&rdquo; — the account that stands for money the other company holds for it.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">Affiliate company</label>
              {readOnly ? (
                <p className="text-sm font-semibold">{otherCompanies.find((c) => c.id === policy.affiliateCompanyId)?.companyName ?? "— not set —"}</p>
              ) : (
                <select name="affiliateCompanyId" defaultValue={policy.affiliateCompanyId ?? ""} className="input">
                  <option value="">— not set —</option>
                  {otherCompanies.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="label">Advances from Affiliate account (owed to them)</label>
              {readOnly ? (
                <p className="text-sm font-semibold">{(() => { const a = bsAccounts.find((x) => x.id === policy.glAffiliateAdvancesId); return a ? `${a.code} ${a.description}` : "— not set —"; })()}</p>
              ) : (
                <select name="glAffiliateAdvancesId" defaultValue={policy.glAffiliateAdvancesId ?? ""} className="input">
                  <option value="">— not set —</option>
                  {bsAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.description}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="label">Our &ldquo;held by affiliate&rdquo; cash account</label>
              {readOnly ? (
                <p className="text-sm font-semibold">{ownCashAccounts.find((c) => c.id === policy.affiliateHeldCashAccountId)?.name ?? "— not set —"}</p>
              ) : (
                <select name="affiliateHeldCashAccountId" defaultValue={policy.affiliateHeldCashAccountId ?? ""} className="input">
                  <option value="">— not set —</option>
                  {ownCashAccounts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              <p className="mt-1 text-[11px] text-gray-500">Where the affiliate&rsquo;s collections for us land (e.g. &ldquo;Held by Teamagro&rdquo;, mapped to Advances to Affiliate).</p>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-1 font-semibold">Purchasing Account Mapping</p>
          <p className="mb-3 text-xs text-gray-500">
            Which Chart of Accounts entry a posted supplier bill moves: inventory is debited for the product cost plus
            allocated freight and other purchasing costs, input VAT is debited separately (it is never part of inventory
            cost), expanded withholding tax is credited to Withholding Tax Payable, and the supplier&rsquo;s payable is credited for the net.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([
              ["glInventoryId", "Inventory Asset", company.glInventoryId],
              ["glPayablesId", "Accounts Payable", company.glPayablesId],
              ["glInputVatId", "Input VAT", company.glInputVatId],
              ["glEwtPayableId", "Withholding Tax Payable (EWT)", company.glEwtPayableId],
            ] as const).map(([field, label, current]) => (
              <div key={field}>
                <label className="label">{label}</label>
                {readOnly ? (
                  <p className="text-sm font-semibold">
                    {(() => {
                      const a = bsAccounts.find((x) => x.id === current);
                      return a ? `${a.code} ${a.description}` : "— not set —";
                    })()}
                  </p>
                ) : (
                  <select name={field} defaultValue={current ?? ""} className="input">
                    <option value="">— not set —</option>
                    {bsAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} · {a.description}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </div>

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
