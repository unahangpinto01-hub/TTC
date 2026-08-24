"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { verifyTwoFactor } from "../actions";

function VerifyBtn() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="w-full rounded-lg bg-emerald-700 py-2.5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">
      {pending ? "Verifying…" : "Verify"}
    </button>
  );
}

export function TwoFactorForm() {
  const [state, formAction] = useFormState(verifyTwoFactor, null);
  const [recovery, setRecovery] = useState(false);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="mode" value={recovery ? "recovery" : "totp"} />
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          {recovery ? "Recovery code" : "Authenticator code"}
        </label>
        <input
          key={recovery ? "rec" : "totp"}
          name="code"
          inputMode={recovery ? "text" : "numeric"}
          autoComplete="one-time-code"
          maxLength={recovery ? 11 : 6}
          required
          autoFocus
          placeholder={recovery ? "XXXXX-XXXXX" : "123456"}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-center font-mono text-xl tracking-widest focus:border-emerald-600 focus:outline-none"
        />
      </div>
      {!recovery && (
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" name="rememberDevice" />
          Remember this device for 30 days
        </label>
      )}
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <VerifyBtn />
      <button
        type="button"
        onClick={() => setRecovery((r) => !r)}
        className="w-full text-center text-sm text-emerald-700 hover:underline"
      >
        {recovery ? "Use authenticator code instead" : "Use a recovery code"}
      </button>
    </form>
  );
}
