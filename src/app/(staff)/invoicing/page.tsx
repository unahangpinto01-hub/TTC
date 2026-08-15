import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { fmtDate, peso, termLabel } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { convertDRtoSR } from "./actions";

export default async function InvoicingQueuePage() {
  await requireStaff(["SUPER_ADMIN", "ADMIN"]);
  const queue = await prisma.deliveryReceipt.findMany({
    where: { status: "Delivered", salesReceipt: null },
    orderBy: { deliveredAt: "asc" },
    include: { salesOrder: { include: { customer: true } }, lines: true },
  });

  return (
    <div>
      <PageHeader title={`For Invoicing · ${queue.length} waiting`} />
      <p className="mb-4 text-sm text-gray-500">Delivered DRs waiting to be converted to Sales Receipts. Accounting no longer waits for paper.</p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="table-th">DR #</th>
              <th className="table-th">Delivered</th>
              <th className="table-th">Customer</th>
              <th className="table-th">Term</th>
              <th className="table-th text-right">Amount</th>
              <th className="table-th" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {queue.map((dr) => (
              <tr key={dr.id} className="hover:bg-gray-50">
                <td className="table-td">
                  <Link href={`/deliveries/${dr.id}`} className="font-mono text-sm font-medium text-emerald-700 hover:underline">{dr.drNumber}</Link>
                </td>
                <td className="table-td">{fmtDate(dr.deliveredAt)}</td>
                <td className="table-td">{dr.salesOrder.customer.businessName}</td>
                <td className="table-td text-sm">{termLabel(dr.salesOrder.term)}</td>
                <td className="table-td text-right">{peso(dr.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0))}</td>
                <td className="table-td text-right">
                  <form action={convertDRtoSR} className="flex items-center justify-end gap-3">
                    <input type="hidden" name="drId" value={dr.id} />
                    <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-gray-600">
                      <input type="checkbox" name="applyVat" defaultChecked /> Apply 12% VAT
                    </label>
                    <button className="btn-primary" type="submit">Convert to SR →</button>
                  </form>
                </td>
              </tr>
            ))}
            {!queue.length && <tr><td colSpan={6} className="p-8 text-center text-sm text-gray-500">🎉 Queue is empty — everything delivered has been invoiced.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
