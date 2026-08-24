"use client";

import { useFormState, useFormStatus } from "react-dom";
import { changePassword, verifyTwoFactorSetup, disableTwoFactor, regenerateRecoveryCodes, type FormResult } from "./actions";

function Btn({ label, pendingLabel, danger }: { label: string; pendingLabel: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={danger ? "btn-danger" : "btn-primary"}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function Feedback({ state }: { state: FormResult }) {
  if (!state) return null;
  return (
    <>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state.ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✔ {state.ok}</p>}
      {state.recoveryCodes && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="mb-2 text-sm font-semibold text-amber-900">
            Save these recovery codes somewhere safe — they will NOT be shown again. Each works once.
          </p>
          <div className="grid grid-cols-2 gap-1 font-mono text-sm">
            {state.recoveryCodes.map((c) => <span key={c}>{c}</span>)}
          </div>
        </div>
      )}
    </>
  );
}

export function ChangePasswordForm() {
  const [state, action] = useFormState(changePassword, null);
  return (
    <form action={action} className="max-w-sm space-y-3">
      <div>
        <label className="label">Current password</label>
        <input name="current" type="password" required autoComplete="current-password" className="input" />
      </div>
      <div>
        <label className="label">New password (min. 12 characters)</label>
        <input name="next" type="password" required minLength={12} autoComplete="new-password" className="input" />
      </div>
      <Feedback state={state} />
      <Btn label="Change Password" pendingLabel="Changing…" />
    </form>
  );
}

export function EnrollVerifyForm() {
  const [state, action] = useFormState(verifyTwoFactorSetup, null);
  if (state?.ok) {
    return (
      <div className="max-w-sm space-y-3">
        <Feedback state={state} />
        <a href="/account/security" className="btn-primary inline-block">I saved my codes — Continue</a>
      </div>
    );
  }
  return (
    <form action={action} className="max-w-sm space-y-3">
      <input
        name="code" inputMode="numeric" maxLength={6} required placeholder="123456"
        className="input w-40 text-center font-mono text-lg tracking-widest"
      />
      <Feedback state={state} />
      <Btn label="Verify & Enable 2FA" pendingLabel="Verifying…" />
    </form>
  );
}

export function DisableTwoFactorForm() {
  const [state, action] = useFormState(disableTwoFactor, null);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-red-600 hover:underline">Disable two-factor authentication…</summary>
      <form action={action} className="mt-3 max-w-sm space-y-3">
        <div>
          <label className="label">Password</label>
          <input name="password" type="password" required autoComplete="current-password" className="input" />
        </div>
        <div>
          <label className="label">Current authenticator code</label>
          <input name="code" inputMode="numeric" maxLength={6} required className="input w-40 text-center font-mono" />
        </div>
        <Feedback state={state} />
        <Btn label="Disable 2FA" pendingLabel="Disabling…" danger />
      </form>
    </details>
  );
}

export function RegenerateCodesForm() {
  const [state, action] = useFormState(regenerateRecoveryCodes, null);
  return (
    <details className="text-sm" open={!!state}>
      <summary className="cursor-pointer text-emerald-700 hover:underline">Regenerate recovery codes…</summary>
      <form action={action} className="mt-3 max-w-sm space-y-3">
        <div>
          <label className="label">Current authenticator code</label>
          <input name="code" inputMode="numeric" maxLength={6} required className="input w-40 text-center font-mono" />
        </div>
        <Feedback state={state} />
        {!state?.recoveryCodes && <Btn label="Regenerate Codes" pendingLabel="Generating…" />}
      </form>
    </details>
  );
}
