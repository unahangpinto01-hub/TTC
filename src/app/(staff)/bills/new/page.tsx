import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { getActiveCompany } from "@/lib/company";
import { TERMS, DEFAULT_TERMS } from "@/lib/bills";
import { PageHeader } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { prisma } from "@/lib/db";
import { createBill } from "../actions";

const ERRORS: Record<string, string> = {
  supplier: "Choose a supplier, or pick the receipt or purchase order the bill is for.",
  grn: "That receipt could not be found for this company.",
  grnstatus: "Only a posted receipt can be billed. Post the receipt first.",
  grnbilled: "That receipt already has a bill.",
  po: "That purchase order could not be found for this company.",
  postatus: "A draft or cancelled purchase order cannot be billed.",
};

export default async function NewBillPage({ searchParams }: { searchParams: { error?: string; ref?: string; grn?: string } }) {
  const user = await requirePerm("bills");
  if (user.perm !== "READ_WRITE") return <div className="card text-sm text-gray-600">You have read-only access to bills.</div>;
  const company = await getActiveCompany(user);
  // arrived here from a receipt: offer it pre-picked (only if it is this company's, posted and unbilled)
  const preGrn = searchParams.grn
    ? await prisma.goodsReceipt.findFirst({
        where: { id: searchParams.grn, companyId: company.id, status: "Posted", invoiceStatus: { not: "Billed" } },
        select: { id: true, grnNumber: true, supplierInvoiceNo: true, purchaseOrder: { select: { poNumber: true, supplier: { select: { name: true } } } } },
      })
    : null;
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <div className="max-w-3xl">
      <Link href="/bills" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">← Back to Bills</Link>
      <PageHeader title="New Supplier Bill" />
      {searchParams.error && ERRORS[searchParams.error] && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <span className="font-semibold">⚠</span> {ERRORS[searchParams.error]}
          {searchParams.ref && <span className="font-mono"> ({searchParams.ref})</span>}
        </p>
      )}

      <form action={createBill} className="card space-y-4">
        <div>
          <p className="mb-1 font-semibold">What is this bill for?</p>
          <p className="mb-3 text-xs text-gray-500">
            Pick the posted receipt and the accepted lines are copied in — those quantities are already in stock, so
            they stay as they are and only the costs can change. Pick a purchase order instead for goods that were never
            put through Receiving (the bill will stock them), or leave both blank and add the lines yourself. The receipt
            or order decides the supplier.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Receiving Report (GRN)</label>
              <SearchSelect
                entity="goods-receipts"
                name="goodsReceiptId"
                params={{ company: company.id, billable: "1" }}
                placeholder="Posted receipt, not yet billed…"
                defaultValue={preGrn ? { id: preGrn.id, label: preGrn.grnNumber, sub: `${preGrn.purchaseOrder.supplier.name} · ${preGrn.purchaseOrder.poNumber}` } : null}
              />
            </div>
            <div>
              <label className="label">Purchase Order</label>
              <SearchSelect entity="purchase-orders" name="purchaseOrderId" params={{ company: company.id, billable: "1" }} placeholder="Only if there is no receipt…" />
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Supplier <span className="font-normal text-gray-400">(when no receipt or order is picked)</span></label>
            <SearchSelect entity="suppliers" name="supplierId" placeholder="Type supplier name…" />
          </div>
          <div>
            <label className="label">Supplier Invoice No.</label>
            <input name="supplierInvoiceNo" className="input" defaultValue={preGrn?.supplierInvoiceNo ?? ""} placeholder="as printed on the supplier's invoice" />
            <label className="mt-1 flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" name="invoiceUnavailable" /> No invoice number available
            </label>
          </div>
          <div>
            <label className="label">Bill Date</label>
            <input name="billDate" type="date" defaultValue={ymd} required className="input" />
          </div>
          <div>
            <label className="label">Terms</label>
            <select name="terms" defaultValue={DEFAULT_TERMS} className="input">
              {TERMS.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Due Date <span className="font-normal text-gray-400">(blank = bill date + terms)</span></label>
            <input name="dueDate" type="date" className="input" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Memo / Remarks</label>
            <input name="memo" className="input" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="btn-primary" type="submit">Create Bill (Draft)</button>
          <p className="text-xs text-gray-500">Company: <span className="font-semibold">{company.companyName}</span>. Lines, freight and VAT are entered on the next screen.</p>
        </div>
      </form>
    </div>
  );
}
