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

const MISSION = [
  "To provide products with real benefits;",
  "To look for practical alternatives to those that are currently used by farmers;",
  "To look for quality products at reasonable prices;",
  "To convince our farmers to consider farming as a business; and,",
  "To introduce new technology",
];

const PERFORMANCE = [
  "Supply quality products at reasonable price",
  "Improving farmer's lives",
];

export default function LoginPage() {
  const [state, formAction] = useFormState(login, null);
  return (
    <div className="relative flex min-h-screen flex-col lg:flex-row">
      <Backdrop />

      {/* Left: vision / mission */}
      <div className="relative z-10 flex flex-1 items-center p-6 sm:p-10 lg:p-16">
        <div className="max-w-xl rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-emerald-50 backdrop-blur-sm sm:p-8">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-lg font-bold text-white">
              T
            </div>
            <div>
              <h1 className="text-xl font-bold leading-tight text-white">Teamagro Trading Corp.</h1>
              <p className="text-xs text-emerald-300">Agricultural Chemicals & Foliar Fertilizers</p>
            </div>
          </div>

          <h2 className="text-xs font-semibold uppercase tracking-widest text-emerald-300">Company Vision</h2>
          <p className="mb-4 mt-1 text-lg font-medium italic text-white">
            “To see the farmers enjoy the fruits of their labors.”
          </p>

          <h2 className="text-xs font-semibold uppercase tracking-widest text-emerald-300">Company Mission</h2>
          <ol className="mb-4 mt-1 list-decimal space-y-1 pl-5 text-sm text-emerald-50">
            {MISSION.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ol>

          <h2 className="text-xs font-semibold uppercase tracking-widest text-emerald-300">Performance Areas</h2>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-emerald-50">
            {PERFORMANCE.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
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
          <div className="mt-6 rounded-lg bg-gray-50 p-3 text-xs text-gray-500">
            <p className="mb-1 font-semibold text-gray-600">Demo accounts (password: password123)</p>
            <p>superadmin@teamagro.ph · admin@teamagro.ph</p>
            <p>clerk@teamagro.ph · dealer@sample.ph</p>
          </div>
        </div>
      </div>
    </div>
  );
}
