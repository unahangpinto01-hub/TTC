"use client";

import { useState } from "react";
import { deleteIncomingOrder } from "./actions";
import { DELETE_REASON_MIN } from "@/lib/orders";

/**
 * Permanent delete, Super Admin only.
 *
 * A browser confirm() cannot collect the reason the audit trail has to record, so the
 * confirmation is a dialog: it names the order being destroyed, asks the question in as
 * many words, and keeps the button disabled until a reason is actually typed. Two
 * deliberate steps, so nothing goes on a stray click.
 *
 * Rendering this component is not what authorises the delete — the action re-checks the
 * role, the freshness of the sign-in and the downstream links on the server.
 */
export function DeleteOrderButton({
  orderId,
  orderNo,
  customer,
  company,
  amount,
  lines,
  size = "sm",
}: {
  orderId: string;
  orderNo: string;
  customer: string;
  company: string;
  amount: string;
  lines: number;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const ready = reason.trim().length >= DELETE_REASON_MIN;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          size === "md"
            ? "rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50"
            : "rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
        }
        title="Permanently delete this order (Super Admin)"
      >
        🗑 Delete
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="del-order-title"
          onClick={() => setOpen(false)}
        >
          <div className="w-full max-w-lg rounded-xl bg-white p-5 text-left shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 id="del-order-title" className="text-lg font-bold text-red-700">
              Are you sure you want to permanently delete this order?
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              This cannot be undone. The order and its lines are removed from the database for good — only the audit
              record remains.
            </p>

            <dl className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 text-sm">
              <div><dt className="text-xs text-gray-500">Order No.</dt><dd className="font-mono font-semibold">{orderNo}</dd></div>
              <div><dt className="text-xs text-gray-500">Customer</dt><dd className="font-semibold">{customer}</dd></div>
              <div><dt className="text-xs text-gray-500">Company</dt><dd>{company}</dd></div>
              <div><dt className="text-xs text-gray-500">Amount</dt><dd className="font-semibold">{amount} · {lines} line(s)</dd></div>
            </dl>

            <form action={deleteIncomingOrder} className="mt-4">
              <input type="hidden" name="orderId" value={orderId} />
              <label className="label" htmlFor="del-reason">
                Reason for deletion <span className="text-red-600">*</span>
              </label>
              <textarea
                id="del-reason"
                name="reason"
                rows={3}
                required
                minLength={DELETE_REASON_MIN}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. duplicate entry — same order encoded twice"
                className="input w-full resize-y"
              />
              <p className="mt-1 text-xs text-gray-500">
                Recorded in the audit trail against your name. At least {DELETE_REASON_MIN} characters.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="btn-secondary">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!ready}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  Delete Permanently
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
