"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { scheduleSO } from "../actions";

/** Schedule form with a confirm step. Cancelling puts the cursor back on the date;
    confirming saves and stays on this sales order, announcing the result. */
export function ScheduleForm({
  soId,
  defaultDate,
  truck,
  driver,
  hasSchedule,
  justScheduled,
}: {
  soId: string;
  defaultDate: string;
  truck: string;
  driver: string;
  hasSchedule: boolean;
  justScheduled: boolean;
}) {
  const dateRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!justScheduled) return;
    window.alert("Delivery schedule successful");
    router.replace(`/sales-orders/${soId}`); // drop the flag so a refresh doesn't repeat it
  }, [justScheduled, soId, router]);

  return (
    <form
      action={scheduleSO}
      onSubmit={(e) => {
        if (!window.confirm("Are you sure you want to continue?")) {
          e.preventDefault();
          dateRef.current?.focus();
        }
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="soId" value={soId} />
      <div>
        <label className="label">Date</label>
        <input ref={dateRef} name="date" type="date" required defaultValue={defaultDate} className="input" />
      </div>
      <div>
        <label className="label">Truck</label>
        <input name="truck" defaultValue={truck} placeholder="Isuzu Elf ABC-1234" className="input" />
      </div>
      <div>
        <label className="label">Driver</label>
        <input name="driver" defaultValue={driver} placeholder="Driver name" className="input" />
      </div>
      <button className="btn-primary" type="submit">{hasSchedule ? "Update Schedule" : "Schedule"}</button>
    </form>
  );
}
