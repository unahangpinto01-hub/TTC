import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { canApprovePayments, cashAccountBalances } from "@/lib/receive-payments";
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
                  <th className="table-th text-right">Opening Balance</th>
                  <th className="table-th text-right">Payments In (Posted)</th>
                  <th className="table-th text-right">Refunds Out (Posted)</th>
                  <th className="table-th text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {accounts.map((a) => (
                  <tr key={a.id} className={a.status !== "Active" ? "opacity-50" : ""}>
                    <td className="table-td font-medium">{a.name}</td>
                    <td className="table-td text-sm text-gray-500">{a.type}</td>
                    <td className="table-td text-right">{peso(a.openingBalance)}</td>
                    <td className="table-td text-right">{peso(a.inflows)}</td>
                    <td className="table-td text-right text-red-600">{a.outflows ? `(${peso(a.outflows)})` : "—"}</td>
                    <td className="table-td text-right font-bold text-emerald-800">{peso(a.balance)}</td>
                  </tr>
                ))}
                {!accounts.length && (
                  <tr><td colSpan={6} className="p-8 text-center text-sm text-gray-500">No accounts yet — add Cash on Hand and your bank accounts.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Balance = opening balance + Posted customer payments in − Posted customer refunds out. Voiding a
            document removes its effect again. Other outgoing money (expenses, purchases) is not tracked here.
          </p>
        </div>
        {canAdmin && (
          <form action={createCashAccount} className="card h-fit space-y-3">
            <h2 className="font-semibold">New Account</h2>
            <div><label className="label">Name</label><input name="name" required className="input" placeholder="Cash on Hand / BDO #1234" /></div>
            <div>
              <label className="label">Type</label>
              <select name="type" className="input"><option>Cash</option><option>Bank</option><option>E-Wallet</option></select>
            </div>
            <div><label className="label">Opening Balance (₱)</label><input name="openingBalance" type="number" step="0.01" defaultValue="0" className="input" /></div>
            <button className="btn-primary" type="submit">Add Account</button>
          </form>
        )}
      </div>
    </div>
  );
}
