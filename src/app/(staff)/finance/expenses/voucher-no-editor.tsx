"use client";

import { useState } from "react";

/**
 * Manual override of a voucher number, for the few users granted "Edit Voucher Number".
 *
 * Automatic numbering is the rule and this is the exception, so it stays behind a click,
 * asks why, and says plainly that the old number is not released. The server checks the
 * permission, the reason and the duplicate again — this is only the way in.
 */
export function VoucherNoEditor({
  id,
  voucherNo,
  action,
}: {
  id: string;
  voucherNo: string;
  action: (formData: FormData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState(voucherNo);
  const [reason, setReason] = useState("");
  const ready = next.trim().length > 0 && next.trim() !== voucherNo && reason.trim().length >= 5;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-1 text-[10px] font-semibold text-emerald-700 hover:underline"
        title="Change this voucher number"
      >
        ✎
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div className="w-full max-w-md rounded-xl bg-white p-5 text-left shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-emerald-900">Change voucher number</h2>
            <p className="mt-1 text-sm text-gray-600">
              Currently <span className="font-mono font-semibold">{voucherNo || "(none)"}</span>. The number you replace
              is not returned to the sequence, and no other voucher may take it.
            </p>
            <form action={action} className="mt-4 space-y-3">
              <input type="hidden" name="id" value={id} />
              <div>
                <label className="label">New voucher number</label>
                <input
                  name="voucherNo"
                  value={next}
                  onChange={(e) => setNext(e.target.value.toUpperCase())}
                  className="input w-full font-mono"
                  placeholder="EV-TTC-2026-000126"
                />
              </div>
              <div>
                <label className="label">Reason <span className="text-red-600">*</span></label>
                <textarea
                  name="reason"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="input w-full"
                  placeholder="e.g. matching the pre-printed voucher book"
                />
                <p className="mt-1 text-xs text-gray-500">Recorded in the audit trail with the original number and your name.</p>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
                <button
                  type="submit"
                  disabled={!ready}
                  className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  Change Number
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
