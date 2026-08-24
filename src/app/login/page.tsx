"use client";

import { useFormState, useFormStatus } from "react-dom";
import { login } from "./actions";

/** Minimal enterprise-style backdrop: deep gradient, soft brand glows, faint grid. */
function Backdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#07120e]" aria-hidden="true">
      {/* soft radial brand glows */}
      <div className="absolute -top-40 -left-40 h-[560px] w-[560px] rounded-full bg-emerald-600/25 blur-[140px]" />
      <div className="absolute bottom-[-180px] right-[-120px] h-[620px] w-[620px] rounded-full bg-teal-500/15 blur-[160px]" />
      <div className="absolute left-1/2 top-1/3 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-emerald-400/10 blur-[130px]" />
      {/* faint grid */}
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />
      {/* vignette for focus */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.45)_100%)]" />
    </div>
  );
}

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
    <div className="relative flex min-h-screen flex-col lg:flex-row">
      <Backdrop />

      {/* Left: artistic company wordmark */}
      <div className="relative z-10 flex flex-1 items-center p-6 sm:p-10 lg:p-16">
        {/* oversized ghost monogram behind the wordmark */}
        <span
          className="pointer-events-none absolute -left-10 top-1/2 -translate-y-1/2 select-none text-[26rem] font-black leading-none text-white/[0.03]"
          aria-hidden="true"
        >
          T
        </span>

        <div className="relative">
          <p className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.35em] text-emerald-400">
            <span className="inline-block h-px w-10 bg-emerald-400/60" />
            Est. Philippines
          </p>
          <h1 className="font-black leading-[0.95] tracking-tight">
            <span className="block bg-gradient-to-br from-white via-emerald-100 to-emerald-400 bg-clip-text text-6xl text-transparent sm:text-7xl lg:text-8xl">
              Teamagro
            </span>
            <span
              className="mt-2 block text-4xl uppercase text-transparent sm:text-5xl lg:text-6xl"
              style={{ WebkitTextStroke: "1.5px rgba(110, 231, 183, 0.55)" }}
            >
              Trading Corp.
            </span>
          </h1>
          <p className="mt-6 max-w-md text-sm font-medium tracking-wide text-emerald-200/70">
            Agricultural Chemicals & Foliar Fertilizers
          </p>
        </div>
      </div>

      {/* Right: login form */}
      <div className="relative z-10 flex w-full items-center justify-center p-6 pb-12 lg:w-[440px] lg:justify-end lg:pr-16">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
          <div className="mb-6 text-center">
            <h1 className="text-xl font-bold text-gray-900">Welcome back</h1>
            <p className="text-sm text-gray-500">Sign in to the Business Management System</p>
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
          <p className="mt-6 text-center text-xs text-gray-400">
            Forgot your password? Contact your administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
