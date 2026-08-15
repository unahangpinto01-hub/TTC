import { requireStaff } from "@/lib/auth";

export default async function DashboardPage() {
  await requireStaff();
  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Dashboard</h1>
      <p className="text-sm text-gray-500">Dashboard widgets arrive in Phase 5.</p>
    </div>
  );
}
