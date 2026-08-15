"use client";

import { useFormState, useFormStatus } from "react-dom";
import { login } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-emerald-700 py-2.5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
    >
      {pending ? "Signing in…" : "Sign In"}
    </button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useFormState(login, null);
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-900 via-emerald-800 to-emerald-950 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-700 text-2xl font-bold text-white">
            T
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Teamagro Trading Corp.</h1>
          <p className="text-sm text-gray-500">Business Management System</p>
        </div>
        <form action={formAction} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
            <input
              name="email"
              type="email"
              required
              placeholder="you@teamagro.ph"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-emerald-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Password</label>
            <input
              name="password"
              type="password"
              required
              placeholder="••••••••"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-emerald-600 focus:outline-none"
            />
          </div>
          {state?.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
          )}
          <SubmitButton />
        </form>
        <div className="mt-6 rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
          <p className="mb-1 font-semibold text-gray-600">Demo accounts (password: password123)</p>
          <p>superadmin@teamagro.ph · admin@teamagro.ph</p>
          <p>clerk@teamagro.ph · dealer@sample.ph</p>
        </div>
      </div>
    </div>
  );
}
