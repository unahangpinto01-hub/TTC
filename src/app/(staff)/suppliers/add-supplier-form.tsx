"use client";

import { useEffect, useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createSupplier } from "./actions";

function AddBtn() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" type="submit" disabled={pending}>
      {pending ? "Adding…" : "Add"}
    </button>
  );
}

export function AddSupplierForm() {
  const [result, formAction] = useFormState(createSupplier, null);
  const formRef = useRef<HTMLFormElement>(null);

  // clear the fields after every attempt — successful add or duplicate — so the form is ready for fresh input
  useEffect(() => {
    if (result) formRef.current?.reset();
  }, [result]);

  return (
    <form ref={formRef} action={formAction} className="card h-fit space-y-3">
      <h2 className="font-semibold">Add Supplier</h2>
      <div><label className="label">Name</label><input name="name" required className="input" /></div>
      <div><label className="label">Contact</label><input name="contact" className="input" /></div>
      <div><label className="label">Address</label><input name="address" className="input" /></div>
      <div>
        <label className="label">Status</label>
        <select name="status" className="input"><option>Active</option><option>Inactive</option></select>
      </div>
      <AddBtn />
      {result && (
        <p key={result.ts} className={`text-sm font-medium ${result.ok ? "text-emerald-700" : "text-red-600"}`}>
          {result.ok ? "✔ " : "✖ "}{result.message}
        </p>
      )}
    </form>
  );
}
