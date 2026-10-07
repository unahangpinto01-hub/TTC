import { JournalLines, type JournalLineRow, type CashAccountOption } from "./journal-lines";

export type JournalFormValues = {
  id?: string;
  date: string;
  refNo: string;
  memo: string;
  lines: JournalLineRow[];
};

/** The entry form shared by New and Edit Draft: date, reference, memo and the balanced lines. */
export function JournalForm({
  action, values, cashAccounts, submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  values: JournalFormValues;
  cashAccounts: CashAccountOption[];
  submitLabel: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form action={action} className="space-y-4">
      {values.id && <input type="hidden" name="id" value={values.id} />}
      <div className="card grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <label className="label">Voucher Date</label>
          <input name="date" type="date" defaultValue={values.date} max={today} required className="input" />
        </div>
        <div>
          <label className="label">Reference # <span className="font-normal text-gray-400">(the books&rsquo; GJV number, a schedule, a bank advice)</span></label>
          <input name="refNo" defaultValue={values.refNo} className="input" placeholder="e.g. GJV 2026-159" />
        </div>
        <div className="col-span-2">
          <label className="label">Explanation (memo)</label>
          <input name="memo" defaultValue={values.memo} required className="input" placeholder="what this voucher records and why" />
        </div>
      </div>

      <div>
        <h2 className="mb-2 font-semibold">Entry</h2>
        <JournalLines lines={values.lines} cashAccounts={cashAccounts} canEdit />
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-primary" type="submit">{submitLabel}</button>
        <p className="text-xs text-gray-500">
          A draft is submitted for approval from its page; only a Posted voucher reaches the ledger and, for a line on a bank account,
          that account&rsquo;s balance. Accounts Receivable, Accounts Payable and Inventory are control accounts: a voucher on them moves
          the ledger only, never a customer, supplier or product balance.
        </p>
      </div>
    </form>
  );
}
