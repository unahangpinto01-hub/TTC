import Link from "next/link";
import { requireStaff } from "@/lib/auth";

export default async function DeniedPage() {
  await requireStaff();
  return (
    <div className="mx-auto max-w-md pt-16 text-center">
      <div className="card p-8">
        <p className="mb-2 text-4xl">🔒</p>
        <h1 className="mb-2 text-lg font-bold">Read-only account</h1>
        <p className="mb-4 text-sm text-gray-600">
          Your account can view records but cannot create, edit, or delete anything.
          Contact your administrator if you need write access.
        </p>
        <Link href="/dashboard" className="btn-primary">← Back to Dashboard</Link>
      </div>
    </div>
  );
}
