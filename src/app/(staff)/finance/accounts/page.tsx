import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { canApprovePayments, cashAccountBalances } from "@/lib/receive-payments";
import { SearchSelect } from "@/components/search-select";
import { createCashAccount } from "../../payments/actions";

/** Cash & bank accounts, per company: opening balance + posted customer payments in.
    A simple register on purpose — not a general ledger. */
export default async function CashAccountsPage({ searchParams }: { searchParams: { error?: string } }) {
  const user = await requirePerm("receivePayments");
  const company = await getActiveCompany(user);
  const accounts = await cashAccountBalances(company.id);
  const canAdmin = user.perm === "READ_WRITE" && canApprovePayments(user);

  return (
    <div>
      <PageHeader title={`Cash / Bank Accounts — ${company.companyName}`} />
      {searchParams.error === "name" && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Give the account a name.</p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="card overflow-x-auto p-0">
            <table className="w-full">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="table-th">Account</th>
                  <th className="table-th">Type</th>
                  <th className="table-th text-right">Opening</th>
                  <th className="table-th text-right">Customer In</th>
                  <th className="table-th text-right">Other In</th>
                  <th className="table-th text-right">Transfers ±</th>
                  <th className="table-th text-right">Journal ±</th>
                  <th className="table-th text-right">Refunds Out</th>
                  <th className="table-th text-right">Cheques Out</th>
                  <th className="table-th text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {accounts.map((a) => (
                  <tr key={a.id} className={a.status !== "Active" ? "opacity-50" : ""}>
                    <td className="table-td font-medium">
                      <Link href={`/finance/accounts/${a.id}`} className="text-emerald-700 hover:underline">{a.name}</Link>
                      {a.accountNo && <span className="block text-[10px] text-gray-500">{a.bankName ? `${a.bankName} · ` : ""}{a.accountNo}</span>}
                      {a.glCode && <span className="block font-mono text-[10px] text-gray-400">{a.glCode}</span>}
                    </td>
                    <td className="table-td text-sm text-gray-500">{a.type}</td>
                    <td className="table-td text-right">{peso(a.openingBalance)}</td>
                    <td className="table-td text-right">{a.customerIn ? peso(a.customerIn) : "—"}</td>
                    <td className="table-td text-right">{a.otherIn ? peso(a.otherIn) : "—"}</td>
                    <td className="table-td text-right">
                      {a.transfersIn || a.transfersOut ? (
                        <span className={a.transfersIn - a.transfersOut >= 0 ? "" : "text-red-600"}>
                          {peso(a.transfersIn - a.transfersOut)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="table-td text-right">
                      {a.journalIn || a.journalOut ? (
                        <span className={a.journalIn - a.journalOut >= 0 ? "" : "text-red-600"}>{peso(a.journalIn - a.journalOut)}</span>
                      ) : "—"}
                    </td>
                    <td className="table-td text-right text-red-600">{a.refundsOut ? `(${peso(a.refundsOut)})` : "—"}</td>
                    <td className="table-td text-right text-red-600">{a.chequesOut ? `(${peso(a.chequesOut)})` : "—"}</td>
                    <td className={`table-td text-right font-bold ${a.balance < 0 ? "text-red-600" : "text-emerald-800"}`}>{peso(a.balance)}</td>
                  </tr>
                ))}
                {!accounts.length && (
                  <tr><td colSpan={10} className="p-8 text-center text-sm text-gray-500">No accounts yet — add Cash on Hand and your bank accounts.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Balance = opening + Posted customer payments, other receipts, transfers in and journal debits − Posted customer refunds,
            supplier cheques/payments, transfers out and journal credits. Every posted money document is counted; voiding one removes
            its effect again.
          </p>
          {accounts.some((a) => a.balance < 0) && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <span className="font-semibold">A negative balance</span> usually means money OUT was encoded before the
              money IN that funded it: customer collections not yet entered as Receive Payments / Other Receipts, or an
              opening balance dated after cheques that are also encoded. Fix by encoding the missing inflows, or by
              setting the opening balance as of a date before the encoded cheques.
            </p>
          )}
        </div>
        {canAdmin && (
          <form action={createCashAccount} className="card h-fit space-y-3">
            <h2 className="font-semibold">New Account</h2>
            <div><label className="label">Name</label><input name="name" required className="input" placeholder="Cash on Hand / BDO #1234" /></div>
            <div>
              <label className="label">Type</label>
              <select name="type" className="input"><option>Cash</option><option>Bank</option><option>E-Wallet</option></select>
            </div>
            <div><label className="label">Bank</label><input name="bankName" className="input" placeholder="e.g. BDO, Metrobank" /></div>
            <div><label className="label">Account number</label><input name="accountNo" className="input font-mono" placeholder="as the bank knows it" /></div>
            <div><label className="label">Opening Balance (₱)</label><input name="openingBalance" type="number" step="0.01" defaultValue="0" className="input" /></div>
            <div><label className="label">Opening balance as of</label><input name="openingDate" type="date" className="input" /></div>
            <div>
              <label className="label">GL Account (Chart of Accounts)</label>
              <SearchSelect entity="gl-accounts" name="glAccountId" params={{ statement: "BS" }} placeholder="e.g. 110007 Petty Cash Fund" />
            </div>
            <button className="btn-primary" type="submit">Add Account</button>
          </form>
        )}
      </div>
    </div>
  );
}
