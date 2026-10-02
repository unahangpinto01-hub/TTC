import { SearchSelect } from "@/components/search-select";
import { PAYMENT_METHODS } from "@/lib/receive-payments";
import { ReceiptLines, type ReceiptLineRow } from "./receipt-lines";

export type ReceiptFormValues = {
  id?: string;
  date: string;
  payor: string;
  employee: { id: string; name: string; position?: string | null } | null;
  method: string;
  cashAccountId: string;
  refNo: string;
  checkNo: string;
  checkDate: string;
  remarks: string;
  lines: ReceiptLineRow[];
};

/** The entry form shared by New and Edit Draft: header, payor, cash/bank account, lines. */
export function ReceiptForm({
  action, values, accounts, submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  values: ReceiptFormValues;
  accounts: { id: string; name: string; type: string }[];
  submitLabel: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form action={action} className="space-y-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <div className="card grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="col-span-2">
          <label className="label">Payor — employee</label>
          <SearchSelect entity="employees" name="employeeId" placeholder="Pick an employee, or leave blank and type a name →" defaultValue={values.employee ? { id: values.employee.id, label: values.employee.name, sub: values.employee.position ?? undefined } : null} />
        </div>
        <div className="col-span-2">
          <label className="label">Payor — name <span className="font-normal text-gray-400">(when not an employee: an affiliate, a bank, a court…)</span></label>
          <input name="payor" defaultValue={values.payor} placeholder="e.g. Trigreen Trading Corp." className="input" />
        </div>
        <div>
          <label className="label">Receipt Date</label>
          <input name="date" type="date" defaultValue={values.date} max={today} required className="input" />
        </div>
        <div>
          <label className="label">Method</label>
          <select name="method" defaultValue={values.method} className="input">
            {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Cash/Bank Account <span className="font-normal text-gray-400">(where the money went — required to post)</span></label>
          <select name="cashAccountId" defaultValue={values.cashAccountId} className="input">
            <option value="">— pick on posting —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
          </select>
        </div>
        <div>
          <label className="label">Reference #</label>
          <input name="refNo" defaultValue={values.refNo} className="input" placeholder="OR / deposit slip / txn no." />
        </div>
        <div>
          <label className="label">Check # (if check)</label>
          <input name="checkNo" defaultValue={values.checkNo} className="input" />
        </div>
        <div>
          <label className="label">Check Date</label>
          <input name="checkDate" type="date" defaultValue={values.checkDate} className="input" />
        </div>
        <div>
          <label className="label">Remarks</label>
          <input name="remarks" defaultValue={values.remarks} className="input" placeholder="optional notes" />
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-semibold">What the money settles or earns</h2>
        <ReceiptLines lines={values.lines} canEdit />
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-primary" type="submit">{submitLabel}</button>
        <p className="text-xs text-gray-500">
          A draft is submitted for approval from its page; only a Posted receipt reaches the bank balance and the ledger,
          as Dr the cash/bank account and Cr each line&rsquo;s account.
        </p>
      </div>
    </form>
  );
}
