import Link from "next/link";
import { requireStaff } from "@/lib/auth";

export default async function DeniedPage() {
  await requireStaff();
  return (
    <div className="mx-auto max-w-md pt-16 text-center">
      <div className="card p-8">
        <p className="mb-2 text-4xl">🔒</p>
        <h1 className="mb-2 text-lg font-bold">No permission</h1>
        <p className="mb-4 text-sm text-gray-600">
          Your account doesn't have permission for that page or action — it may be
          read-only or blocked for this function. Contact your administrator if you
          need access.
        </p>
        <Link href="/dashboard" className="btn-primary">← Back to Dashboard</Link>
      </div>
    </div>
  );
}
