import { PASSWORD_POLICY_MESSAGES } from "@/lib/security";

/**
 * Every outcome in the user module gets a plain-language banner. Server actions redirect
 * with a short code (never free text, so a crafted link cannot put words on the page) and
 * this maps the code to the sentence an operator needs to read.
 */
const ERRORS: Record<string, string> = {
  ...PASSWORD_POLICY_MESSAGES,
  weakpw: "That password does not meet the security policy — use at least 12 characters and avoid common passwords.",
  name: "Name must be between 2 and 80 characters.",
  self: "You cannot change your own access level.",
  selfco: "You cannot remove your own access to every company.",
  email_invalid: "That is not a valid email address. Use the form name@example.com.",
  email_taken: "That email address already belongs to another user. Every account needs its own address.",
  email_long: "Email address is too long — 120 characters maximum.",
  email_required: "Enter an email address.",
  name_required: "Enter the user's full name.",
  create_failed: "The user could not be created. Check that the email address is not already in use.",
};

const OKS: Record<string, string> = {
  renamed: "Name updated and recorded in the audit trail.",
  reset: "Password reset. The user was signed out everywhere. Their 2FA (if enabled) still applies.",
  companies: "Company access saved.",
  email: "Email address updated. The user was signed out everywhere and must sign in with the new address. The change is recorded in the audit trail.",
  created: "User created.",
};

export function UserNotice({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const error = ERRORS[one(searchParams.error) ?? ""];
  const okKey = Object.keys(OKS).find((k) => one(searchParams[k]) === "ok");

  if (!error && !okKey) return null;
  return (
    <div className="mb-4 space-y-2">
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <span className="font-semibold">⚠ Not saved.</span> {error}
        </p>
      )}
      {okKey && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✔ {OKS[okKey]}</p>}
    </div>
  );
}
