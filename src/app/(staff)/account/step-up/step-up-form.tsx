"use client";

import { useFormState, useFormStatus } from "react-dom";
import { confirmStepUp } from "./actions";

function Btn() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full justify-center">
      {pending ? "Confirming…" : "Confirm"}
    </button>
  );
}

export function StepUpForm({ next, useTotp }: { next: string; useTotp: boolean }) {
  const [state, action] = useFormState(confirmStepUp, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      {useTotp ? (
        <input
          name="code" inputMode="numeric" maxLength={6} required autoFocus placeholder="123456"
          className="input w-full text-center font-mono text-xl tracking-widest"
        />
      ) : (
        <input name="password" type="password" required autoFocus placeholder="Your password" autoComplete="current-password" className="input w-full" />
      )}
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <Btn />
    </form>
  );
}
