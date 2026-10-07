import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { CONDITIONS, type Condition } from "@/lib/stock-conditions";
import { voidReclassAction } from "../actions";

/** Every stock reclassification of the company — see lib/stock-conditions.ts. */
export default async function ReclassListPage({ searchParams }: { searchParams: { error?: string } }) {
  const user = await requirePerm("inventory");
  const company = await getActiveCompany(user);
  const rows = await prisma.stockReclass.findMany({
    where: { companyId: company.id },
    include: { product: { select: { id: true, name: true, sku: true } }, createdBy: { select: { name: true } } },
    orderBy: [{ date: "desc" }, { rsNumber: "desc" }],
    take: 300,
  });
  const buckets = await prisma.stockBucket.findMany({ where: { product: { companyId: company.id }, qty: { not: 0 } }, select: { condition: true, qty: true, unitCost: true } });
  const totals = Object.fromEntries(Object.keys(CONDITIONS).filter((c) => c !== "GOOD").map((c) => [c, buckets.filter((b) => b.condition === c).reduce((s, b) => s + b.qty * b.unitCost, 0)]));
  const canEdit = user.perm === "READ_WRITE";
  const label = (c: string) => (c === "OPENING" ? "Opening load" : CONDITIONS[c as Condition] ?? c);

  return (
    <div>
      <PageHeader title={`Stock Reclassifications — ${company.companyName}`}>
        <Link href="/reports/merchandise-inventory" className="btn-secondary">Merchandise Inventory</Link>
      </PageHeader>
      <p className="mb-3 max-w-4xl text-sm text-gray-600">
        Stock moved between conditions at cost: declared obsolete, sent for relabelling, sent to the supplier for reformulation, or brought
        back as good stock. Each move is made from the product&rsquo;s own page and booked between the stock accounts in the ledger.
      </p>
      {searchParams.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">⚠</span> {searchParams.error}</p>}
      <div className="mb-4 grid grid-cols-3 gap-3">
        {(["OBSOLETE", "RELABEL", "AT_SUPPLIER"] as const).map((c) => (
          <div key={c} className="card py-3"><p className="text-xs text-gray-500">{CONDITIONS[c]}</p><p className="text-lg font-bold">{peso(totals[c] ?? 0)}</p></div>
        ))}
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[960px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">RS No.</th><th className="table-th">Date</th><th className="table-th">Product</th><th className="table-th">From</th><th className="table-th">To</th>
              <th className="table-th text-right">Qty (PCS)</th><th className="table-th text-right">Unit Cost</th><th className="table-th text-right">Amount</th><th className="table-th">Reason</th><th className="table-th">By</th><th className="table-th">Status</th>{canEdit && <th className="table-th" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.id} className={r.status === "Void" ? "opacity-50" : ""}>
                <td className="table-td font-mono text-xs font-semibold">{r.rsNumber}</td>
                <td className="table-td whitespace-nowrap text-sm">{fmtDate(r.date)}</td>
                <td className="table-td text-sm"><Link href={`/inventory/${r.product.id}`} className="text-emerald-700 hover:underline">{r.product.name}</Link><span className="block font-mono text-[10px] text-gray-400">{r.product.sku}</span></td>
                <td className="table-td text-sm">{label(r.fromCondition)}</td>
                <td className="table-td text-sm">{label(r.toCondition)}</td>
                <td className="table-td text-right">{r.qty.toLocaleString()}</td>
                <td className="table-td text-right text-sm">{peso(r.unitCost)}</td>
                <td className="table-td text-right font-semibold">{peso(r.amount)}</td>
                <td className="table-td text-xs text-gray-600">{r.reason}{r.remarks ? ` · ${r.remarks}` : ""}{r.voidReason ? <span className="block text-red-600">void: {r.voidReason}</span> : null}</td>
                <td className="table-td text-xs text-gray-600">{r.createdBy?.name ?? "—"}</td>
                <td className="table-td"><StatusBadge status={r.status} /></td>
                {canEdit && (
                  <td className="table-td">
                    {r.status === "Posted" && (
                      <form action={voidReclassAction} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={r.id} />
                        <input name="reason" placeholder="void reason" required minLength={5} className="input w-36 py-1 text-xs" />
                        <button className="text-xs text-red-600 hover:underline" type="submit">void</button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={12} className="p-8 text-center text-sm text-gray-500">No reclassifications yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
