import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { requireStaff, getCurrentSession } from "@/lib/auth";
import { decryptSecret, otpauthUrl, deviceLabel } from "@/lib/security";
import { fmtDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { beginTwoFactorSetup, cancelTwoFactorSetup, revokeSession, revokeOtherSessions, revokeTrustedDevice } from "./actions";
import { ChangePasswordForm, EnrollVerifyForm, DisableTwoFactorForm, RegenerateCodesForm } from "./security-forms";

const MFA_REQUIRED_ROLES = ["SUPER_ADMIN", "ADMIN"];

export default async function SecurityPage({ searchParams }: { searchParams: { enroll?: string } }) {
  const user = await requireStaff(undefined, { allowUnenrolled: true });
  const me = await getCurrentSession();
  const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const mfaMandatory = MFA_REQUIRED_ROLES.includes(user.role);

  const [sessions, devices, codesLeft, events] = await Promise.all([
    prisma.authSession.findMany({
      where: { userId: user.id, revokedAt: null, pendingTwoFactor: false, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
    }),
    prisma.trustedDevice.findMany({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
    prisma.recoveryCode.count({ where: { userId: user.id, usedAt: null } }),
    prisma.securityEvent.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 15 }),
  ]);

  // Enrollment in progress: render the QR + manual key (only visible during setup, never after)
  let qrDataUrl: string | null = null;
  let manualKey: string | null = null;
  if (!dbUser.twoFactorEnabled && dbUser.pendingTotpSecretEnc) {
    manualKey = decryptSecret(dbUser.pendingTotpSecretEnc);
    qrDataUrl = await QRCode.toDataURL(otpauthUrl(user.email, manualKey), { margin: 1, width: 220 });
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Account Security" />

      {searchParams.enroll === "required" && !dbUser.twoFactorEnabled && (
        <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          🔒 Two-factor authentication is <b>mandatory for administrator accounts</b>. Please set it up below before continuing.
        </p>
      )}

      {/* ------------------------------------------------ two-factor authentication */}
      <div className="card mb-4">
        <h2 className="mb-1 font-semibold">Two-Factor Authentication</h2>
        <p className="mb-3 text-sm text-gray-500">
          Adds a 6-digit code from Google Authenticator, Microsoft Authenticator, or any TOTP app to every sign-in.
        </p>

        {dbUser.twoFactorEnabled ? (
          <div className="space-y-4">
            <p className="text-sm">
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">Enabled</span>
              <span className="ml-2 text-gray-500">since {dbUser.twoFactorEnabledAt ? fmtDateTime(dbUser.twoFactorEnabledAt) : "—"}</span>
              <span className="ml-2 text-gray-500">· {codesLeft} recovery code(s) unused</span>
            </p>
            <RegenerateCodesForm />
            {mfaMandatory ? (
              <p className="text-xs text-gray-500">Two-factor authentication is mandatory for administrator accounts and cannot be disabled.</p>
            ) : (
              <DisableTwoFactorForm />
            )}
          </div>
        ) : qrDataUrl && manualKey ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">1 · Scan this QR code with your authenticator app</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="2FA setup QR code" className="rounded-lg border border-gray-200" />
            <p className="text-sm">
              Can&apos;t scan? Enter this key manually:{" "}
              <code className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs">{manualKey}</code>
            </p>
            <p className="text-sm font-medium">2 · Enter the 6-digit code the app shows</p>
            <EnrollVerifyForm />
            <form action={cancelTwoFactorSetup}>
              <button className="text-sm text-gray-500 hover:underline" type="submit">Cancel setup</button>
            </form>
          </div>
        ) : (
          <form action={beginTwoFactorSetup}>
            <button className="btn-primary" type="submit">Enable 2FA</button>
          </form>
        )}
      </div>

      {/* ---------------------------------------------------------- change password */}
      <div className="card mb-4">
        <h2 className="mb-1 font-semibold">Change Password</h2>
        <p className="mb-3 text-sm text-gray-500">At least 12 characters. Changing your password signs out all other sessions.</p>
        <ChangePasswordForm />
      </div>

      {/* ----------------------------------------------------------- active sessions */}
      <div className="card mb-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Active Sessions</h2>
          <form action={revokeOtherSessions}>
            <button className="btn-secondary text-sm" type="submit">Sign out all other sessions</button>
          </form>
        </div>
        <div className="divide-y divide-gray-100">
          {sessions.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {deviceLabel(s.userAgent)}
                  {me?.id === s.id && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">This device</span>}
                </p>
                <p className="text-xs text-gray-500">
                  {s.ip ? `IP ${s.ip} · ` : ""}signed in {fmtDateTime(s.createdAt)} · last active {fmtDateTime(s.lastSeenAt)}
                </p>
              </div>
              {me?.id !== s.id && (
                <form action={revokeSession}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="text-sm text-red-600 hover:underline" type="submit">Revoke</button>
                </form>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ----------------------------------------------------------- trusted devices */}
      <div className="card mb-4">
        <h2 className="mb-2 font-semibold">Trusted Devices</h2>
        {devices.length ? (
          <div className="divide-y divide-gray-100">
            {devices.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{deviceLabel(d.userAgent)}</p>
                  <p className="text-xs text-gray-500">trusted {fmtDateTime(d.createdAt)} · expires {fmtDateTime(d.expiresAt)}</p>
                </div>
                <form action={revokeTrustedDevice}>
                  <input type="hidden" name="id" value={d.id} />
                  <button className="text-sm text-red-600 hover:underline" type="submit">Revoke</button>
                </form>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No trusted devices. Tick “Remember this device” at the 2FA step to add one (30-day expiry).</p>
        )}
      </div>

      {/* -------------------------------------------------------------- recent events */}
      <div className="card">
        <h2 className="mb-2 font-semibold">Recent Security Activity</h2>
        <div className="divide-y divide-gray-100 text-sm">
          {events.map((e) => (
            <div key={e.id} className="flex items-center justify-between py-1.5">
              <span className={e.success ? "" : "text-red-600"}>{e.action.replaceAll("_", " ")}</span>
              <span className="text-xs text-gray-500">{deviceLabel(e.userAgent)}{e.ip ? ` · ${e.ip}` : ""} · {fmtDateTime(e.createdAt)}</span>
            </div>
          ))}
          {!events.length && <p className="py-2 text-gray-500">No security events yet.</p>}
        </div>
      </div>
    </div>
  );
}
