import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { peso, fmtDate, fmtDateTime } from "@/lib/format";
import { PageHeader, StatusBadge } from "@/components/ui";
import { canPostJournal, controlAccountWarnings, totalsOf } from "@/lib/journal";
import { getAuditTrail } from "@/lib/salespeople";
import { submitJournalVoucher, approveAndPostJournalVoucher, cancelJournalVoucher, voidJournalVoucherAction } from "../actions";

export default async function JournalVoucherDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
  const user = await requirePerm("journal");
  const company = await getActiveCompany(user);
  const v = await prisma.journalVoucher.findUnique({
    where: { id: params.id },
    include: {
      preparedBy: { select: { name: true } },
      postedBy: { select: { name: true } },
      lines: { include: { glAccount: { select: { code: true, description: true } }, cashAccount: { select: { name: true } } }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!v || v.companyId !== company.id) notFound();
  const canEdit = user.perm === "READ_WRITE";
  const isApprover = canEdit && canPostJournal(user);
  const [audit, warnings] = await Promise.all([getAuditTrail("JournalVoucher", v.id, 30), controlAccountWarnings(v.lines, company.id)]);
  const t = totalsOf(v.lines);

  return (
    <div className="max-w-5xl">
      <Link href="/finance/journal" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">← Back to General Journal</Link>
      <PageHeader title={`${v.jvNumber} — ${v.memo}`}>
        <StatusBadge status={v.status} />
      </PageHeader>

      {searchParams.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><span className="font-semibold">⚠</span> {searchParams.error}</p>}
      {warnings.map((w) => <p key={w} className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{w}</p>)}

      <div className="card mb-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-4">
        <div><p className="text-xs text-gray-500">Company</p><p className="font-semibold">{company.companyName}</p></div>
        <div><p className="text-xs text-gray-500">Voucher Date</p><p className="font-semibold">{fmtDate(v.date)}</p></div>
        <div><p className="text-xs text-gray-500">Reference #</p><p className="font-semibold">{v.refNo ?? "—"}</p></div>
        <div><p className="text-xs text-gray-500">Amount</p><p className="text-lg font-bold text-emerald-800">{peso(t.debit)}</p></div>
        <div><p className="text-xs text-gray-500">Prepared By</p><p className="font-semibold">{v.preparedBy?.name ?? (v.source === "IMPORT" ? "loaded from the books" : "—")}</p></div>
        <div><p className="text-xs text-gray-500">Posted</p><p className="font-semibold">{v.postedAt ? `${fmtDateTime(v.postedAt)}${v.postedBy ? ` · ${v.postedBy.name}` : ""}` : "—"}</p></div>
        <div className="col-span-2"><p className="text-xs text-gray-500">Explanation</p><p>{v.memo}</p></div>
        {v.voidReason && <div className="col-span-2 md:col-span-4"><p className="text-xs text-gray-500">Void Reason</p><p className="text-red-600">{v.voidReason}</p></div>}
      </div>

      <h2 className="mb-2 font-semibold">Entry</h2>
      <div className="card mb-4 overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr><th className="table-th">Account</th><th className="table-th">Particulars</th><th className="table-th text-right">Debit</th><th className="table-th text-right">Credit</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {v.lines.map((l) => (
              <tr key={l.id}>
                <td className={`table-td ${l.credit > 0 ? "pl-8" : "font-medium"}`}>{l.glAccount.code} {l.glAccount.description}{l.cashAccount && <span className="block text-[10px] text-gray-500">bank: {l.cashAccount.name}</span>}</td>
                <td className="table-td text-xs text-gray-600">{l.description}</td>
                <td className="table-td text-right font-semibold">{l.debit > 0 ? peso(l.debit) : <span className="text-gray-300">—</span>}</td>
                <td className="table-td text-right font-semibold">{l.credit > 0 ? peso(l.credit) : <span className="text-gray-300">—</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold">
            <tr><td className="table-td" colSpan={2}>TOTAL</td><td className="table-td text-right">{peso(t.debit)}</td><td className="table-td text-right">{peso(t.credit)}</td></tr>
          </tfoot>
        </table>
      </div>
      {v.status !== "Posted" && v.status !== "Void" && <p className="mb-4 text-xs text-gray-500">Nothing is booked until this voucher is approved and posted.</p>}

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {canEdit && v.status === "Draft" && (
          <>
            <Link href={`/finance/journal/${v.id}/edit`} className="btn-secondary">✏ Edit Draft</Link>
            <form action={submitJournalVoucher}><input type="hidden" name="id" value={v.id} /><button className="btn-primary" type="submit">Submit for Approval</button></form>
          </>
        )}
        {isApprover && (v.status === "Draft" || v.status === "Pending Approval") && (
          <form action={approveAndPostJournalVoucher}><input type="hidden" name="id" value={v.id} /><button className="btn-primary" type="submit">✔ Approve &amp; Post</button></form>
        )}
        {canEdit && (v.status === "Draft" || (v.status === "Pending Approval" && isApprover)) && (
          <form action={cancelJournalVoucher}><input type="hidden" name="id" value={v.id} /><button className="btn-secondary" type="submit">Cancel</button></form>
        )}
        {isApprover && v.status === "Posted" && (
          <form action={voidJournalVoucherAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={v.id} />
            <input name="reason" placeholder="void reason" required minLength={5} className="input w-52" />
            <button className="rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50" type="submit">Void Voucher</button>
          </form>
        )}
      </div>

      {audit.length > 0 && (
        <>
          <h2 className="mb-2 font-semibold">Audit Trail</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50"><tr><th className="table-th">When</th><th className="table-th">Action</th><th className="table-th">Detail</th><th className="table-th">By</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {audit.map((e) => (
                  <tr key={e.id}>
                    <td className="table-td whitespace-nowrap text-xs">{fmtDateTime(e.createdAt)}</td>
                    <td className="table-td text-xs font-semibold">{e.action}</td>
                    <td className="table-td text-xs">{e.detail}</td>
                    <td className="table-td text-xs text-gray-600">{e.actorName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
