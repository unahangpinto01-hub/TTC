import { redirect } from "next/navigation";
import { getPendingSession } from "@/lib/auth";
import { TwoFactorForm } from "./two-factor-form";

export default async function TwoFactorPage() {
  const pending = await getPendingSession();
  if (!pending) redirect("/login");
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#07120e] p-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <h1 className="mb-1 text-center text-xl font-bold text-gray-900">Two-Factor Authentication</h1>
        <p className="mb-6 text-center text-sm text-gray-500">
          Enter the 6-digit code from your authenticator app
        </p>
        <TwoFactorForm />
      </div>
    </div>
  );
}
