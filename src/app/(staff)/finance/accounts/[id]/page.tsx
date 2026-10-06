import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { PrintButton } from "@/components/print-button";
import { getAuditTrail } from "@/lib/salespeople";
import { cashAccountRegister } from "@/lib/cash-accounts";
import { updateCashAccount } from "../actions";

const ERRORS: Record<string, string> = {
  name: "Give the account a name.",
  opening: "The opening balance must be a number.",
  gl: "That is not an active Chart of Accounts entry.",
  dupe: "Another account of this company already has that name.",
};
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const day = (s?: string, end = false) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T${end ? "23:59:59.999" : "00:00:00"}Z`) : undefined);

/** One cash or bank account: its details, its register of every posted money document, and the edit form for a Super Admin. */
export default async function CashAccountPage({ params, searchParams }: { params: { id: string }; searchParams: { from?: string; to?: string; error?: string; saved?: string } }) {
  const user = await requirePerm("receivePayments");
  const company = await getActiveCompany(user);
  const range = { from: day(searchParams.from), to: day(searchParams.to, true) };
  let reg;
  try { reg = await cashAccountRegister(params.id, range); } catch { notFound(); }
  const { account: a, rows, broughtForward, balance, totals } = reg;
  if (a.companyId !== company.id) notFound();
  const canEdit = user.role === "SUPER_ADMIN" && user.perm === "READ_WRITE";
  const audit = await getAuditTrail("CashAccount", a.id, 20);
  const filtered = !!(range.from || range.to);

  return (
    <div className="print-page">
      <div className="no-print mb-3 flex items-center justify-between">
        <Link href="/finance/accounts" className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">← Back to Cash / Bank Accounts</Link>
        <PrintButton />
      </div>
      <PageHeader title={`${a.name} — ${company.companyName}`}>
        <StatusBadge status={a.status} />
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">{a.type}</span>
      </PageHeader>
      {searchParams.error && ERRORS[searchParams.error] && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">⚠ {ERRORS[searchParams.error]}</p>}
      {searchParams.saved && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✔ Saved.</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div className="card py-3"><p className="text-xs text-gray-500">Bank · account no.</p><p className="font-semibold">{a.bankName ?? "—"}</p><p className="font-mono text-xs text-gray-600">{a.accountNo ?? "no account number"}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Books to</p><p className="font-semibold">{a.glAccount ? `${a.glAccount.code} ${a.glAccount.description}` : "— not mapped —"}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Opening balance</p><p className="font-semibold">{peso(a.openingBalance)}</p><p className="text-xs text-gray-500">{a.openingDate ? `as of ${fmtDate(a.openingDate)}` : "no as-of date"}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Balance now</p><p className={`text-lg font-bold ${balance < 0 ? "text-red-600" : "text-emerald-800"}`}>{peso(balance)}</p><p className="text-xs text-gray-500">{totals.documents} posted document{totals.documents === 1 ? "" : "s"}</p></div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 text-xs md:grid-cols-6">
        {([["Customer payments in", totals.customerIn], ["Other receipts in", totals.otherIn], ["Transfers in", totals.transfersIn], ["Supplier cheques out", totals.chequesOut], ["Customer refunds out", totals.refundsOut], ["Transfers out", totals.transfersOut]] as [string, number][]).map(([k, v]) => (
          <div key={k} className="card py-2"><p className="text-gray-500">{k}</p><p className="font-semibold">{v ? peso(v) : "—"}</p></div>
        ))}
      </div>
      {a.notes && <p className="mb-4 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{a.notes}</p>}

      <h2 className="mb-2 font-semibold">Register</h2>
      <form method="GET" className="no-print mb-3 flex flex-wrap items-end gap-2">
        <div><label className="label">From</label><input type="date" name="from" defaultValue={searchParams.from ?? ""} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={searchParams.to ?? ""} className="input" /></div>
        <button className="btn-secondary" type="submit">Apply</button>
        {filtered && <Link href={`/finance/accounts/${a.id}`} className="btn-secondary">All dates</Link>}
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr><th className="table-th">Date</th><th className="table-th">Document</th><th className="table-th">Kind</th><th className="table-th">Party</th><th className="table-th">Detail</th><th className="table-th text-right">In</th><th className="table-th text-right">Out</th><th className="table-th text-right">Balance</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            <tr className="bg-gray-50/60"><td className="table-td text-sm">{range.from ? fmtDate(range.from) : a.openingDate ? fmtDate(a.openingDate) : "—"}</td><td className="table-td" colSpan={6}><span className="text-sm font-semibold">{filtered ? "Balance brought forward" : "Opening balance"}</span></td><td className="table-td text-right font-semibold">{peso(broughtForward)}</td></tr>
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="table-td whitespace-nowrap">{fmtDate(r.date)}</td>
                <td className="table-td"><Link href={r.href} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{r.docNo}</Link></td>
                <td className="table-td text-xs text-gray-600">{r.kind}</td>
                <td className="table-td">{r.party}</td>
                <td className="table-td text-xs text-gray-600">{r.detail || "—"}</td>
                <td className="table-td text-right text-emerald-700">{r.inflow ? peso(r.inflow) : "—"}</td>
                <td className="table-td text-right text-red-600">{r.outflow ? `(${peso(r.outflow)})` : "—"}</td>
                <td className={`table-td text-right font-semibold ${r.balance < 0 ? "text-red-600" : ""}`}>{peso(r.balance)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="p-6 text-center text-sm text-gray-500">No posted movement {filtered ? "in this period" : "yet"}.</td></tr>}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
            <tr><td className="table-td" colSpan={5}>{filtered ? "PERIOD TOTAL · BALANCE AT END" : "TOTAL · BALANCE NOW"}</td><td className="table-td text-right text-emerald-700">{peso(totals.inflow)}</td><td className="table-td text-right text-red-600">({peso(totals.outflow)})</td><td className={`table-td text-right ${(rows.length ? rows[rows.length - 1].balance : broughtForward) < 0 ? "text-red-600" : ""}`}>{peso(rows.length ? rows[rows.length - 1].balance : broughtForward)}</td></tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500">Posted documents only. Customer payments, other receipts and transfers in add; customer refunds, supplier cheques and payments, and transfers out subtract. Voiding a document takes it off this register.</p>

      {canEdit && (
        <form action={updateCashAccount} className="no-print card mt-6 space-y-3">
          <input type="hidden" name="id" value={a.id} />
          <h2 className="font-semibold">Edit account <span className="text-sm font-normal text-gray-500">— Super Admin</span></h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><label className="label">Name</label><input name="name" defaultValue={a.name} required className="input" /></div>
            <div><label className="label">Type</label><select name="type" defaultValue={a.type} className="input"><option>Cash</option><option>Bank</option><option>E-Wallet</option></select></div>
            <div><label className="label">Bank</label><input name="bankName" defaultValue={a.bankName ?? ""} placeholder="e.g. BDO, Metrobank" className="input" /></div>
            <div><label className="label">Account number</label><input name="accountNo" defaultValue={a.accountNo ?? ""} placeholder="as the bank knows it" className="input font-mono" /></div>
            <div><label className="label">Opening balance (₱)</label><input name="openingBalance" type="number" step="0.01" defaultValue={a.openingBalance} className="input text-right" /></div>
            <div><label className="label">Opening balance as of</label><input name="openingDate" type="date" defaultValue={ymd(a.openingDate)} className="input" /></div>
            <div><label className="label">Status</label><select name="status" defaultValue={a.status} className="input"><option>Active</option><option>Inactive</option></select></div>
            <div>
              <label className="label">Books to (Chart of Accounts)</label>
              <SearchSelect entity="gl-accounts" name="glAccountId" params={{ statement: "BS" }} placeholder="leave as is, or pick an account" pinned={[{ id: "none", label: "— clear the mapping —" }]} defaultValue={a.glAccount ? { id: a.glAccountId!, label: a.glAccount.description, sub: a.glAccount.code } : null} />
            </div>
            <div className="sm:col-span-2 lg:col-span-4"><label className="label">Notes</label><input name="notes" defaultValue={a.notes ?? ""} maxLength={500} placeholder="e.g. collection account; cheque series 2091xx" className="input" /></div>
          </div>
          <div className="flex items-center gap-3">
            <button className="btn-primary" type="submit">Save</button>
            <p className="text-xs text-gray-500">Changing the opening balance or the mapping changes the books. Every change is written to the audit trail.</p>
          </div>
        </form>
      )}

      {audit.length > 0 && (
        <div className="no-print mt-6">
          <h2 className="mb-2 font-semibold">Audit Trail</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50"><tr><th className="table-th">When</th><th className="table-th">Action</th><th className="table-th">Detail</th><th className="table-th">By</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {audit.map((e) => <tr key={e.id}><td className="table-td whitespace-nowrap text-xs">{fmtDateTime(e.createdAt)}</td><td className="table-td text-xs font-semibold">{e.action}</td><td className="table-td text-xs">{e.detail}</td><td className="table-td text-xs text-gray-600">{e.actorName}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
