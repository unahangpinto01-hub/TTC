import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { resolveReportScope } from "@/lib/report-scope";
import { CompanyFilter, CompanyTag } from "@/components/company-filter";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { parseRange } from "@/lib/reports";
import { PrintButton, BackButton } from "@/components/print-button";
import { creditDisplayStatus } from "@/lib/refunds-credits";

const STATUSES = ["Posted", "Draft", "Pending Approval", "Approved", "Rejected", "Void"];

/** Refunds & Credits Register — filter Type to Refund for the Customer Refund Report. */
export default async function RefundsCreditsRegisterPage({
  searchParams,
}: {
  searchParams: { company?: string; from?: string; to?: string; type?: string; status?: string };
}) {
  const user = await requirePerm("reports");
  const scope = await resolveReportScope(user, searchParams.company);
  const range = parseRange(searchParams);
  const type = ["Credit", "Refund"].includes(searchParams.type || "") ? searchParams.type! : "";
  const status = STATUSES.includes(searchParams.status || "") ? searchParams.status! : "Posted";

  const docs = await prisma.refundCredit.findMany({
    where: {
      companyId: { in: scope.ids },
      status,
      date: { gte: range.from, lte: range.to },
      ...(type ? { type } : {}),
    },
    include: {
      company: { select: { companyName: true } },
      customer: { select: { businessName: true } },
      salesReceipt: { select: { srNumber: true } },
      applications: { select: { amount: true } },
      refundsDrawn: { where: { status: "Posted" }, select: { amount: true, status: true } },
    },
    orderBy: [{ date: "asc" }, { rcNumber: "asc" }],
  });
  const totalCredits = docs.filter((d) => d.type === "Credit").reduce((s, d) => s + d.amount, 0);
  const totalRefunds = docs.filter((d) => d.type === "Refund").reduce((s, d) => s + d.amount, 0);

  return (
    <div className="print-page">
      <div className="no-print mb-3 flex items-center justify-between">
        <BackButton />
        <PrintButton />
      </div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">{scope.company.companyName}</h1>
        <p className="text-sm text-gray-600">Refunds &amp; Credits Register{scope.combined && " · Combined (All Companies)"}</p>
        <p className="text-xs text-gray-500">
          {fmtDate(range.from)} – {fmtDate(range.to)} · {status}{type ? ` · ${type}s only` : ""} · generated {fmtDateTime(new Date())}
        </p>
      </div>

      <form method="GET" className="no-print card mb-4 flex flex-wrap items-end gap-2">
        <CompanyFilter scope={scope} />
        <div className="w-40"><label className="label">From</label><input type="date" name="from" defaultValue={range.from.toISOString().slice(0, 10)} className="input" /></div>
        <div className="w-40"><label className="label">To</label><input type="date" name="to" defaultValue={range.to.toISOString().slice(0, 10)} className="input" /></div>
        <div className="w-36">
          <label className="label">Type</label>
          <select name="type" defaultValue={type} className="input">
            <option value="">Both</option>
            <option>Credit</option>
            <option>Refund</option>
          </select>
        </div>
        <div className="w-44">
          <label className="label">Status</label>
          <select name="status" defaultValue={status} className="input">
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <button className="btn-primary" type="submit">Apply</button>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="card py-3"><p className="text-xs text-gray-500">Documents</p><p className="text-lg font-bold">{docs.length}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Credits Issued</p><p className="text-lg font-bold text-emerald-800">{peso(totalCredits)}</p></div>
        <div className="card py-3"><p className="text-xs text-gray-500">Refunds Paid</p><p className="text-lg font-bold text-red-600">{peso(totalRefunds)}</p></div>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[940px] text-sm">
          <thead className="border-b-2 border-gray-300 bg-gray-50">
            <tr>
              <th className="table-th">No.</th>
              {scope.combined && <th className="table-th">Company</th>}
              <th className="table-th">Date</th>
              <th className="table-th">Type</th>
              <th className="table-th">Customer</th>
              <th className="table-th">Reason</th>
              <th className="table-th">Invoice</th>
              <th className="table-th text-right">Amount</th>
              <th className="table-th text-right">Applied</th>
              <th className="table-th">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {docs.map((d) => (
              <tr key={d.id}>
                <td className="table-td">
                  <Link href={`/refunds/${d.id}`} className="font-mono text-xs font-semibold text-emerald-700 hover:underline">{d.rcNumber}</Link>
                </td>
                {scope.combined && <td className="table-td"><CompanyTag name={d.company.companyName} /></td>}
                <td className="table-td whitespace-nowrap text-sm">{fmtDate(d.date)}</td>
                <td className="table-td text-sm">{d.type}</td>
                <td className="table-td text-sm">{d.customer.businessName}</td>
                <td className="table-td text-xs text-gray-500">{d.reason}</td>
                <td className="table-td font-mono text-xs">{d.salesReceipt?.srNumber ?? "—"}</td>
                <td className="table-td text-right font-semibold">{peso(d.amount)}</td>
                <td className="table-td text-right text-gray-600">{d.type === "Credit" ? peso(d.applications.reduce((s, a) => s + a.amount, 0)) : "—"}</td>
                <td className="table-td text-xs">{creditDisplayStatus(d)}</td>
              </tr>
            ))}
            {!docs.length && (
              <tr><td colSpan={scope.combined ? 10 : 9} className="p-8 text-center text-sm text-gray-500">Nothing in this period.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
