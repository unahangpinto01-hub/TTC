import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { getPerm } from "@/lib/permissions";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { defaultAsOf, listOpeningBalances, type OpeningRow } from "@/lib/opening-balances";
import { addOpeningBalance, voidOpeningBalance } from "./actions";

const ERRORS: Record<string, string> = {
  party: "Pick the customer or supplier first.",
  date: "The as-of date is required.",
  future: "An opening balance cannot be dated in the future.",
  amount: "The amount must be greater than zero. A credit balance is not entered here.",
  due: "The due date cannot be earlier than the as-of date.",
  period: "That date falls in a locked accounting period. Entering there needs Prior-Period Adjustment permission.",
  failed: "The balance could not be saved. Try again.",
  reason: "Give a reason for withdrawing it (at least 5 characters).",
  touched: "This balance has already been collected, paid or vouchered against — reverse those first.",
  missing: "That opening balance could not be found.",
};
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Finance → Opening Balances: what each customer owed, and what was owed to each supplier,
 * on the day before the BMS started. Entered once, collected and paid through the ordinary
 * screens, and left out of every sales and purchase figure.
 */
export default async function OpeningBalancesPage({ searchParams }: { searchParams: { side?: string; error?: string; saved?: string; voided?: string } }) {
  const user = await requireStaff();
  const arPerm = getPerm(user, "ar");
  const apPerm = getPerm(user, "ap");
  if (arPerm === "NONE" && apPerm === "NONE") redirect("/denied");
  const company = await getActiveCompany(user);
  const { customers, suppliers } = await listOpeningBalances(company.id);
  const side = searchParams.side === "supplier" ? "supplier" : "customer";
  const asOf = ymd(defaultAsOf());

  return (
    <div>
      <PageHeader title="Opening Balances" />
      {searchParams.error && ERRORS[searchParams.error] && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">⚠ {ERRORS[searchParams.error]}</p>}
      {searchParams.saved && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✔ {searchParams.saved} entered. It now shows in {side === "customer" ? "AR Aging and the customer's statement, and Receive Payments can collect it" : "AP Aging and the supplier's statement, and a voucher can pay it"}.</p>}
      {searchParams.voided && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✔ Withdrawn.</p>}
      <p className="mb-4 max-w-4xl text-sm text-gray-600">
        <span className="font-semibold">{company.companyName}</span> · The balances carried into the BMS from before it started — normally as of{" "}
        <span className="font-semibold">{fmtDate(defaultAsOf())}</span>. A customer balance is collected through Receive Payments like any invoice and ages in
        AR; a supplier balance is paid through a voucher and cheque like any bill and ages in AP. Neither is a sale or a purchase of the period, so the sales,
        purchase and ledger reports leave them out. Enter one balance per customer or supplier, or one per old invoice if the office wants to collect them
        separately. The as-of date is the invoice date; the due date defaults to it, so an old balance ages from the day it was carried in.
      </p>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        {arPerm === "READ_WRITE" && (
          <EntryForm side="customer" asOf={asOf} title="Customer owes us (Accounts Receivable)" entity="customers" placeholder="Type customer name…" />
        )}
        {apPerm === "READ_WRITE" && (
          <EntryForm side="supplier" asOf={asOf} title="We owe a supplier (Accounts Payable)" entity="suppliers" placeholder="Type supplier name…" />
        )}
      </div>

      {arPerm !== "NONE" && <Table title="Customers — balances receivable" side="customer" rows={customers} canWrite={arPerm === "READ_WRITE"} />}
      {apPerm !== "NONE" && <Table title="Suppliers — balances payable" side="supplier" rows={suppliers} canWrite={apPerm === "READ_WRITE"} />}
    </div>
  );
}

function EntryForm({ side, asOf, title, entity, placeholder }: { side: "customer" | "supplier"; asOf: string; title: string; entity: string; placeholder: string }) {
  return (
    <form action={addOpeningBalance} className="card space-y-3">
      <input type="hidden" name="side" value={side} />
      <h2 className="font-semibold">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">{side === "customer" ? "Customer" : "Supplier"}</label>
          <SearchSelect entity={entity} name="partyId" placeholder={placeholder} required />
        </div>
        <div><label className="label">Balance as of</label><input name="asOf" type="date" defaultValue={asOf} required className="input" /></div>
        <div><label className="label">Due date <span className="font-normal text-gray-400">(optional)</span></label><input name="dueDate" type="date" className="input" /></div>
        <div><label className="label">Amount</label><input name="amount" type="number" step="0.01" min="0.01" required placeholder="0.00" className="input text-right" /></div>
        <div><label className="label">Reference / memo</label><input name="memo" maxLength={300} placeholder={side === "customer" ? "e.g. SOA Dec 2025 · SI 1234, 1235" : "e.g. SOA Dec 2025 · Inv 8870"} className="input" /></div>
      </div>
      <button className="btn-primary" type="submit">Enter balance</button>
    </form>
  );
}

function Table({ title, side, rows, canWrite }: { title: string; side: "customer" | "supplier"; rows: OpeningRow[]; canWrite: boolean }) {
  const live = rows.filter((r) => r.status !== "Void");
  const amount = live.reduce((s, r) => s + r.amount, 0);
  const settled = live.reduce((s, r) => s + r.settled, 0);
  const balance = live.reduce((s, r) => s + r.balance, 0);
  return (
    <div className="mb-6">
      <h2 className="mb-2 font-semibold">{title} <span className="text-sm font-normal text-gray-500">— {live.length} {live.length === 1 ? "entry" : "entries"}</span></h2>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">Document</th>
              <th className="table-th">{side === "customer" ? "Customer" : "Supplier"}</th>
              <th className="table-th">As of</th>
              <th className="table-th">Due</th>
              <th className="table-th">Reference / memo</th>
              <th className="table-th text-right">Amount</th>
              <th className="table-th text-right">{side === "customer" ? "Collected" : "Paid"}</th>
              <th className="table-th text-right">Balance</th>
              <th className="table-th">Status</th>
              {canWrite && <th className="table-th" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.id} className={`hover:bg-gray-50 ${r.status === "Void" ? "text-gray-400" : ""}`}>
                <td className="table-td"><Link href={r.href} className="font-mono text-sm font-medium text-emerald-700 hover:underline">{r.docNo}</Link></td>
                <td className="table-td"><Link href={side === "customer" ? `/customers/${r.partyId}` : `/suppliers/${r.partyId}`} className="hover:underline">{r.party}</Link></td>
                <td className="table-td text-sm">{fmtDate(r.asOf)}</td>
                <td className="table-td text-sm">{fmtDate(r.dueDate)}</td>
                <td className="table-td text-xs text-gray-600">{r.status === "Void" ? <span>Withdrawn: {r.voidReason}</span> : r.memo || "—"}</td>
                <td className="table-td text-right">{peso(r.amount)}</td>
                <td className="table-td text-right text-emerald-700">{r.settled ? peso(r.settled) : "—"}</td>
                <td className={`table-td text-right font-semibold ${r.balance > 0 ? "text-red-600" : ""}`}>{peso(r.balance)}</td>
                <td className="table-td"><StatusBadge status={r.status} /></td>
                {canWrite && (
                  <td className="table-td">
                    {r.canVoid && (
                      <form action={voidOpeningBalance} className="flex items-center gap-1">
                        <input type="hidden" name="side" value={side} />
                        <input type="hidden" name="id" value={r.id} />
                        <input name="reason" placeholder="reason" required minLength={5} className="input w-36 py-1 text-xs" />
                        <button className="text-xs font-medium text-red-600 hover:underline" type="submit">Withdraw</button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={canWrite ? 10 : 9} className="p-6 text-center text-sm text-gray-500">No opening balances entered yet.</td></tr>}
          </tbody>
          {live.length > 0 && (
            <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
              <tr>
                <td className="table-td" colSpan={5}>TOTAL</td>
                <td className="table-td text-right">{peso(amount)}</td>
                <td className="table-td text-right text-emerald-700">{peso(settled)}</td>
                <td className="table-td text-right text-red-600">{peso(balance)}</td>
                <td colSpan={canWrite ? 2 : 1} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
